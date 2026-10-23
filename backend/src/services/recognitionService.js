import { Alert } from '../models/Alert.js';
import { Camera } from '../models/Camera.js';
import { Person } from '../models/Person.js';
import { RecognitionEvent } from '../models/RecognitionEvent.js';
import { env } from '../config/env.js';
import { saveSnapshot } from '../utils/snapshot.js';
import { emit, SocketEvents } from '../sockets/index.js';
import { logger } from '../utils/logger.js';
import { computeDashboardStats } from './dashboardService.js';
import { serializeAlert } from './eventService.js';
import { findPersonForVerification } from './personService.js';
import { markAttendance } from './attendanceService.js';
import {
  cooldownElapsed,
  isPersistableRecognitionStatus,
  normalizeRecognitionStatus,
  shouldRaiseUnknownAlert,
  validateIdentityClaim,
} from './identityRules.js';

/**
 * The ONLY path by which a face-recognition result becomes persisted state.
 *
 * TRUST BOUNDARY. This service is reached exclusively from
 * POST /api/ai/recognition, which is gated by requireInternalSecret — the
 * shared secret the AI service sends in `x-ai-secret`. No authenticated browser
 * client can reach it, because a client must never be able to assert an
 * identity or create an attendance record.
 *
 * Even for the trusted AI service, its verdict is NOT taken at face value. A
 * reported KNOWN result is re-verified here against the backend's own person
 * records (exists / active / recognition enabled / embedding dimension) and
 * against the backend's own configured threshold. A claim that fails any check
 * is DOWNGRADED to an unknown identity, never accepted.
 *
 * Payload contract (from ai-service/app/services/event_reporter.py):
 *   { cameraId, mode, results: [ FaceRecognitionResult (snake_case) +
 *                                optional `snapshot` data URL ] }
 * Result items carry: status, person_id, person_name, similarity, bbox,
 * detection_score, quality, track_id, threshold, model_name, timestamp.
 * They never carry an embedding — the enrolled vectors live here, and the
 * decision travels as personId + similarity.
 */

/**
 * Unknown-identity temporal state: `${cameraId}:${trackId}` ->
 * { sightings: number[], lastAlertAt: number|null }.
 *
 * Same in-memory Map cooldown pattern as eventService's detection/alert clocks,
 * reused rather than reinvented. The decision itself is the pure
 * shouldRaiseUnknownAlert() so it can be tested without any of this I/O.
 */
const unknownState = new Map();
const UNKNOWN_STATE_MAX_KEYS = 500;

/**
 * 'Known' event clock: `${cameraId}:${personId}` -> epoch ms of the last
 * stored recognition event for that person on that camera.
 *
 * Without this, a recognised person standing in view writes one
 * RecognitionEvent and pushes one socket payload per recognition report
 * (≈1/s/camera) for as long as they are visible. The attendance cooldown does
 * not help: it gates the attendance upsert, not the event. This mirrors
 * Review 1's `detection.eventCooldownSec`, which does the same job for stored
 * detection events.
 */
const knownEventAt = new Map();
const KNOWN_STATE_MAX_KEYS = 1000;

/**
 * Cached count of people who are actually enrolled and matchable.
 *
 * An empty enrolled set is why this exists: with nobody enrolled, every
 * persistent face legitimately produces UNKNOWN / NO_ENROLLED_IDENTITIES, and
 * alerting on that is indistinguishable from a correctly configured system
 * detecting intruders. Checked once per TTL rather than once per reported
 * face.
 */
let enrolledCount = { value: null, at: 0 };

/** Keeps the unknown-identity state map from growing without bound. */
function pruneUnknownState(now) {
  if (unknownState.size <= UNKNOWN_STATE_MAX_KEYS) return;
  const maxAgeMs =
    Math.max(
      env.recognition.unknownPersistenceWindowSec,
      env.recognition.unknownAlertCooldownSec
    ) * 1000;
  for (const [key, state] of unknownState) {
    const newest = state?.sightings?.[state.sightings.length - 1] ?? 0;
    const lastAlert = state?.lastAlertAt ?? 0;
    if (now - Math.max(newest, lastAlert) > maxAgeMs) unknownState.delete(key);
  }
}

/** Keeps the known-event clock from growing without bound. */
function pruneKnownState(now) {
  if (knownEventAt.size <= KNOWN_STATE_MAX_KEYS) return;
  const maxAgeMs = Math.max(env.recognition.knownEventCooldownSec, 60) * 1000;
  for (const [key, at] of knownEventAt) {
    if (now - at > maxAgeMs) knownEventAt.delete(key);
  }
}

/**
 * How many people are enrolled AND matchable right now, cached for
 * `enrolledCountTtlSec`. Returns 0 on a query failure, which errs towards
 * suppressing alerts rather than raising ones that cannot be justified.
 */
async function countEnrolledPeople(now) {
  if (
    enrolledCount.value !== null &&
    !cooldownElapsed(enrolledCount.at, now, env.recognition.enrolledCountTtlSec)
  ) {
    return enrolledCount.value;
  }
  try {
    const value = await Person.countDocuments({
      active: true,
      recognitionEnabled: true,
      faceEmbedding: { $exists: true, $ne: [] },
    });
    enrolledCount = { value, at: now };
    return value;
  } catch (err) {
    logger.warn(`Could not count enrolled people: ${err.message}`);
    return 0;
  }
}

function toBoundingBox(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return undefined;
  const numbers = bbox.map((value) => Number(value));
  return numbers.every((value) => Number.isFinite(value)) ? numbers : undefined;
}

function toSimilarity(value) {
  if (value === null || value === undefined || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

/**
 * Tolerance for a reporter whose clock runs ahead of this backend's.
 *
 * The reported timestamp is the AI service's, and it is stored on the event.
 * A timestamp from the future is not usable, though: it would be written onto
 * an event and an attendance record as a time that has not happened, and it
 * used to feed the in-memory throttles as well — a host a few minutes ahead
 * suppressed every subsequent sighting until local time caught up. Reported
 * times beyond this tolerance are replaced with local time and logged.
 */
const MAX_CLOCK_SKEW_MS = 2 * 60 * 1000;

function toTimestamp(value) {
  if (!value) return new Date();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date();
  if (date.getTime() - Date.now() > MAX_CLOCK_SKEW_MS) {
    logger.warn(
      `Recognition report timestamp ${date.toISOString()} is in the future — the reporting ` +
        "host's clock is ahead. Using local time for this result."
    );
    return new Date();
  }
  return date;
}

/**
 * Ingests one batch of per-face recognition results from the AI service.
 *
 * Per-status behaviour:
 *   RECOGNITION_UNAVAILABLE — record NOTHING and raise NO alert. An unavailable
 *     pipeline is a service-health fact, not an unknown person; alerting on it
 *     would turn a missing model file into a security event. Operators learn
 *     availability from GET /api/ai/status instead.
 *   NO_FACE / LOW_QUALITY — counted only. No event, no alert: a poor-quality or
 *     partially visible face is not a security threat and not an identity.
 *   KNOWN — re-verified, then persisted (subject to the known-event cooldown) +
 *     attendance + socket events.
 *   UNKNOWN — subject to temporal persistence and cooldown before it becomes an
 *     event and an alert in the EXISTING alert system, and suppressed entirely
 *     when nobody is enrolled.
 */
export async function ingestRecognition(payload) {
  const { cameraId, mode = 'real', results = [] } = payload || {};

  const counters = {
    processed: 0,
    known: 0,
    unknown: 0,
    downgraded: 0,
    lowQuality: 0,
    noFace: 0,
    unavailable: 0,
    suppressed: 0,
    rejected: 0,
    attendanceMarked: 0,
    events: 0,
    alerts: 0,
  };

  if (!cameraId || !Array.isArray(results) || results.length === 0) {
    return counters;
  }

  const camera = await Camera.findOne({ cameraId }).select('cameraId name');
  const cameraName = camera?.name || cameraId;
  const source = mode === 'demo' ? 'demo' : 'real';

  for (const raw of results) {
    const status = normalizeRecognitionStatus(raw?.status);
    if (!status) {
      // An unrecognised status is ignored rather than guessed at.
      counters.rejected += 1;
      continue;
    }
    counters.processed += 1;

    const face = {
      cameraId,
      cameraName,
      source,
      similarity: toSimilarity(raw?.similarity),
      boundingBox: toBoundingBox(raw?.bbox),
      trackId: raw?.track_id || raw?.trackId || null,
      timestamp: toTimestamp(raw?.timestamp),
      snapshotDataUrl: typeof raw?.snapshot === 'string' ? raw.snapshot : null,
      personId: raw?.person_id || raw?.personId || null,
      personName: raw?.person_name || raw?.personName || null,
      quality: raw?.quality || null,
      // Which embedding model produced the probe. Compared against the
      // person's stored embeddingModel at the trust boundary.
      modelName: typeof raw?.model_name === 'string' ? raw.model_name : null,
    };

    try {
      if (!isPersistableRecognitionStatus(status)) {
        // Counted only. An unavailable pipeline is a service-health fact, not
        // an unknown person; a poor-quality or absent face is a measurement
        // statement, not a security one. None of them write anything.
        if (status === 'recognition_unavailable') counters.unavailable += 1;
        else if (status === 'no_face') counters.noFace += 1;
        else if (status === 'low_quality') counters.lowQuality += 1;
        continue;
      }
      if (status === 'known') {
        await handleKnown(face, counters);
        continue;
      }
      await handleUnknown(face, counters, 'unmatched');
    } catch (err) {
      counters.rejected += 1;
      logger.warn(`Recognition result could not be processed: ${err.message}`);
    }
  }

  if (counters.events > 0 || counters.attendanceMarked > 0) {
    // Push fresh KPIs so the dashboard updates live — same approach as
    // eventService.ingestDetections.
    computeDashboardStats()
      .then((stats) => emit(SocketEvents.DASHBOARD_UPDATE, stats))
      .catch((err) => logger.warn(`dashboard emit failed: ${err.message}`));
  }

  return counters;
}

/**
 * A reported identity match. Re-verified before it is believed.
 *
 * On any verification failure the result is DOWNGRADED to an unknown identity
 * (which then has to satisfy the persistence + cooldown rules like any other
 * unknown) rather than being accepted or silently dropped — so a disabled,
 * deactivated or deleted person, or a similarity that does not clear this
 * backend's threshold, can never produce a 'known' event or attendance.
 *
 * A verified match is subject to a per-camera/person EVENT COOLDOWN
 * (`KNOWN_EVENT_COOLDOWN`, default 30 s). Inside the cooldown the sighting
 * still refreshes attendance (itself throttled), but no second
 * RecognitionEvent is written and no second socket payload is pushed — one
 * person standing in a doorway must not produce an event per second forever.
 */
async function handleKnown(face, counters) {
  const person = await findPersonForVerification(face.personId);
  const claim = validateIdentityClaim({
    person,
    similarity: face.similarity,
    threshold: env.recognition.matchThreshold,
    // Use the metadata we already have: the dimension the configured model
    // produces, and the model the reporter says produced this probe. Vectors
    // from two different models are not comparable, so a cross-model
    // similarity is meaningless rather than merely low.
    expectedDim: env.recognition.embeddingDim,
    expectedModel: face.modelName,
  });

  if (!claim.ok) {
    counters.downgraded += 1;
    logger.warn(
      `Identity claim for "${face.personId}" on ${face.cameraId} rejected (${claim.reason}) — downgraded to unknown`
    );
    await handleUnknown(face, counters, claim.reason);
    return;
  }

  counters.known += 1;

  // THROTTLE CLOCKS USE LOCAL TIME, deliberately. The reported timestamp
  // belongs on the stored event (and it is used there); a cooldown compares
  // "when did we last act" against "now", and both must come from the same
  // clock. Reading the reporter's clock here meant a host running ahead wrote
  // a future time into the map and suppressed every later sighting until local
  // time caught up.
  const now = Date.now();
  const cooldownKey = `${face.cameraId}:${person.personId}`;
  const eventDue = cooldownElapsed(
    knownEventAt.get(cooldownKey),
    now,
    env.recognition.knownEventCooldownSec
  );

  let event = null;
  if (eventDue) {
    event = await RecognitionEvent.create({
      cameraId: face.cameraId,
      personId: person.personId,
      personName: person.name,
      status: 'known',
      similarity: face.similarity,
      boundingBox: face.boundingBox,
      trackId: face.trackId || undefined,
      source: face.source,
      timestamp: face.timestamp,
    });
    counters.events += 1;
    knownEventAt.set(cooldownKey, now);
    pruneKnownState(now);
  } else {
    counters.suppressed += 1;
  }

  const attendance = await markAttendance({
    person,
    cameraId: face.cameraId,
    similarity: face.similarity,
    // Only linked when this sighting actually produced an event.
    recognitionEventId: event?._id,
    source: face.source === 'demo' ? 'demo' : 'recognition',
    now: face.timestamp,
    expectedModel: face.modelName,
  });

  if (attendance.rejected) {
    logger.warn(
      `Attendance not marked for ${person.personId}: ${attendance.rejected}` +
        (attendance.detail ? ` — ${attendance.detail}` : '')
    );
  }
  if (attendance.created) counters.attendanceMarked += 1;

  // Emitted on the same clock as the stored event, so the socket stream and
  // the event collection stay in step.
  if (event) {
    emit(SocketEvents.PERSON_RECOGNIZED, {
      eventId: event._id.toString(),
      cameraId: face.cameraId,
      cameraName: face.cameraName,
      personId: person.personId,
      personName: person.name,
      // A cosine similarity, NOT a detector confidence and NOT a probability.
      similarity: face.similarity,
      threshold: env.recognition.matchThreshold,
      boundingBox: face.boundingBox,
      status: 'known',
      source: face.source,
      attendanceMarked: Boolean(attendance.created),
      timestamp: event.timestamp,
    });
  }

  if (attendance.created && attendance.record) {
    emit(SocketEvents.ATTENDANCE_MARKED, {
      id: attendance.record._id.toString(),
      personId: person.personId,
      personName: person.name,
      cameraId: attendance.record.cameraId,
      cameraName: face.cameraName,
      date: attendance.record.date,
      status: attendance.record.status,
      source: attendance.record.source,
      firstSeen: attendance.record.firstSeen,
      lastSeen: attendance.record.lastSeen,
      similarity: attendance.record.similarity,
    });
  }
}

/**
 * An unmatched face. Becomes an event + alert only once the configurable
 * temporal-verification and cooldown rules are satisfied.
 *
 * `downgradeReason` records WHY a result ended up here — 'unmatched' for a
 * genuine non-match reported by the AI service, or the failed verification
 * check when a claimed identity was rejected.
 *
 * NOBODY ENROLLED means nothing is raised. With an empty enrolled set every
 * face legitimately fails to match, so alerting would make a freshly deployed
 * system look exactly like one detecting intruders. The sighting is counted
 * and nothing is written.
 */
async function handleUnknown(face, counters, downgradeReason) {
  counters.unknown += 1;

  // Local clock, for the same reason as handleKnown: persistence windows and
  // cooldowns compare against "now".
  const now = Date.now();

  if ((await countEnrolledPeople(now)) === 0) {
    counters.suppressed += 1;
    logger.debug(
      `Unknown identity on ${face.cameraId} not raised: nobody is enrolled, so no face can match`
    );
    return;
  }

  // An untracked face still gets a key, scoped to the camera, so a camera with
  // no tracking still benefits from the cooldown.
  const key = `${face.cameraId}:${face.trackId || 'untracked'}`;
  const decision = shouldRaiseUnknownAlert(unknownState.get(key), now, env.recognition);
  unknownState.set(key, decision.state);
  pruneUnknownState(now);

  if (!decision.raise) {
    // Either the face has not persisted long enough to be an event, or we
    // already alerted on this same continuously visible face.
    counters.suppressed += 1;
    return;
  }

  // Evidence snapshot, stored on disk and referenced by URL (never embedded in
  // the document), through the existing storage layer.
  const snapshotUrl = face.snapshotDataUrl
    ? await saveSnapshot(face.snapshotDataUrl, face.cameraId)
    : null;

  const event = await RecognitionEvent.create({
    cameraId: face.cameraId,
    status: 'unknown',
    // Present only when a comparison actually happened (i.e. the best
    // candidate's score), so the operator can see how far off it was.
    similarity: face.similarity,
    boundingBox: face.boundingBox,
    snapshot: snapshotUrl || undefined,
    trackId: face.trackId || undefined,
    source: face.source,
    timestamp: face.timestamp,
  });
  counters.events += 1;

  // Reuses the EXISTING alert system — same model, same statuses, same
  // acknowledge/resolve controller. No second alert pipeline.
  //
  // severity is 'warning', NOT 'critical': an unmatched face means the system
  // could not confidently match it to a registered person. That is not proof
  // the person is unauthorised or dangerous.
  const alert = await Alert.create({
    type: 'unknown_identity',
    severity: 'warning',
    cameraId: face.cameraId,
    detectionId: undefined,
    message:
      `Unknown identity at ${face.cameraName} — this face could not be confirmed against a ` +
      'registered person. An unmatched face is not proof of wrongdoing; review the event to decide.',
    snapshot: snapshotUrl || undefined,
    status: 'new',
    timestamp: face.timestamp,
  });
  counters.alerts += 1;

  event.alertId = alert._id;
  await event.save();

  // The existing Alerts page picks this up with zero new alert machinery.
  // `confidence`/`objectClass` are intentionally left undefined: a face
  // similarity is a different measurement from a detector confidence and must
  // not be displayed in that column.
  emit(SocketEvents.ALERT_NEW, serializeAlert(alert, face.cameraName, undefined, undefined));

  emit(SocketEvents.IDENTITY_UNKNOWN, {
    eventId: event._id.toString(),
    alertId: alert._id.toString(),
    cameraId: face.cameraId,
    cameraName: face.cameraName,
    status: 'unknown',
    reason: downgradeReason,
    similarity: face.similarity,
    threshold: env.recognition.matchThreshold,
    boundingBox: face.boundingBox,
    snapshot: snapshotUrl,
    trackId: face.trackId,
    sightings: decision.sightings,
    source: face.source,
    timestamp: event.timestamp,
  });
}

/** Test/maintenance hook: clears the in-memory recognition throttles. */
export function resetUnknownState() {
  unknownState.clear();
  knownEventAt.clear();
  enrolledCount = { value: null, at: 0 };
}
