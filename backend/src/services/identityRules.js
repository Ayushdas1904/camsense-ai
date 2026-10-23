/**
 * Pure decision rules for Review 2 identity, attendance and alerting.
 *
 * Deliberately DEPENDENCY-FREE: this module imports nothing — no mongoose, no
 * env, no logger. Every rule is a pure function of its arguments, which is what
 * makes the trust-boundary behaviour (threshold gating, disabled/inactive
 * people, embedding-dimension mismatch, unknown-identity persistence and
 * cooldown, embedding redaction) unit-testable with node:test and no live
 * MongoDB, no AI service, and no model weights.
 *
 * The services in this directory hold the I/O; the judgement lives here.
 */

/** Escapes regex metacharacters so user search input cannot alter the query. */
export function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Coerces a query-string value into a plain string, or returns undefined.
 *
 * NOSQL OPERATOR GUARD. Express's extended query parser turns `?date[$ne]=x`
 * into the OBJECT `{ $ne: 'x' }`, and `?date=a&date=b` into an ARRAY. Either
 * one, assigned straight into a Mongo filter, reaches the database as an
 * operator and changes which documents a caller can read. Every raw request
 * value that becomes an equality filter goes through here first: strings and
 * finite numbers pass, everything else (object, array, boolean, NaN) is
 * DROPPED rather than coerced into something surprising.
 */
export function toQueryString(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

/** Normalises the string/boolean mixture that arrives from query strings. */
function toTristate(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  const text = String(value).toLowerCase();
  if (text === 'true' || text === '1') return true;
  if (text === 'false' || text === '0') return false;
  return undefined;
}

/**
 * Builds the Mongo filter for the people list.
 *
 * `search` matches personId OR name OR email, case-insensitively. The term is
 * regex-escaped first: an unescaped term would let a caller inject regex
 * metacharacters (e.g. a catastrophic `(a+)+$`) into the query.
 */
export function buildPersonFilter({ search, category, recognitionEnabled, active } = {}) {
  const filter = {};

  // Coerced, not trusted: `?category[$ne]=student` would otherwise reach Mongo
  // as an operator.
  const categoryTerm = toQueryString(category);
  if (categoryTerm) filter.category = categoryTerm;

  const enabled = toTristate(recognitionEnabled);
  if (enabled !== undefined) filter.recognitionEnabled = enabled;

  const isActive = toTristate(active);
  if (isActive !== undefined) filter.active = isActive;

  const term = toQueryString(search);
  if (term) {
    const pattern = new RegExp(escapeRegex(term), 'i');
    filter.$or = [{ personId: pattern }, { name: pattern }, { email: pattern }];
  }

  return filter;
}

/**
 * Client-facing shape of a Person.
 *
 * Builds a WHITELIST of keys, so `faceEmbedding` is structurally absent rather
 * than merely emptied — the vector is biometric data and only the internal,
 * shared-secret-gated embeddings endpoint may emit it. Recognition readiness is
 * communicated through derived flags instead.
 */
export function serializePerson(person) {
  if (!person) return null;

  const embedding = person.faceEmbedding;
  const declaredDim = Number(person.embeddingDim) || 0;
  // Readiness is derived from METADATA (embeddingDim / faceRegisteredAt), not
  // from the vector — the vector is select:false, so ordinary reads never load
  // it, and this serializer must still report readiness correctly.
  const hasEmbedding = declaredDim > 0 || (Array.isArray(embedding) && embedding.length > 0);
  const isActive = person.active !== false;
  const recognitionEnabled = Boolean(person.recognitionEnabled);
  const dim =
    declaredDim || (Array.isArray(embedding) && embedding.length > 0 ? embedding.length : null);

  return {
    id: person._id ? String(person._id) : undefined,
    personId: person.personId,
    name: person.name,
    email: person.email || '',
    category: person.category || 'student',
    department: person.department || '',
    role: person.role || '',
    photo: person.photo || null,
    recognitionEnabled,
    active: isActive,
    // Derived readiness — never the vector itself.
    faceRegistered: hasEmbedding,
    recognitionReady: hasEmbedding && recognitionEnabled && isActive,
    embeddingModel: person.embeddingModel || null,
    embeddingDim: dim,
    faceRegisteredAt: person.faceRegisteredAt || null,
    registeredAt: person.registeredAt || person.createdAt || null,
    createdAt: person.createdAt,
    updatedAt: person.updatedAt,
  };
}

/**
 * Re-verifies an identity claim reported by the AI service.
 *
 * The backend is the trust boundary: it does NOT accept the AI service's
 * verdict at face value. Every claim is re-checked against the backend's own
 * person records and its own configured threshold, in this order:
 *
 *   1. the person exists
 *   2. the person is active (not deactivated)
 *   3. recognition is enabled for the person
 *   4. a stored embedding exists, and its dimension agrees with what the
 *      record declares (and with the live model, when `expectedDim` is given)
 *   5. the stored embedding came from the SAME model the reporter used, when
 *      both names are known (`expectedModel`) — two models' vectors are not
 *      comparable, so a cross-model similarity is meaningless
 *   6. a usable numeric similarity was supplied
 *   7. the similarity MEETS the configured threshold
 *
 * Being the closest candidate is not a match. A claim that fails any check is
 * rejected — the caller downgrades it to an unknown identity rather than
 * accepting it, and it can never create attendance.
 *
 * @returns {{ ok: boolean, reason: string }}
 */
export function validateIdentityClaim({
  person,
  similarity,
  threshold,
  expectedDim,
  expectedModel,
} = {}) {
  if (!person) return { ok: false, reason: 'person_not_found' };
  if (person.active === false) return { ok: false, reason: 'person_inactive' };
  if (!person.recognitionEnabled) return { ok: false, reason: 'recognition_disabled' };

  const embedding = person.faceEmbedding;
  const storedDim = Array.isArray(embedding) ? embedding.length : 0;
  const declaredDim = Number(person.embeddingDim) || 0;
  const dim = storedDim || declaredDim;
  if (!dim) return { ok: false, reason: 'no_embedding' };
  if (storedDim && declaredDim && storedDim !== declaredDim) {
    return { ok: false, reason: 'embedding_dim_mismatch' };
  }
  if (expectedDim !== undefined && expectedDim !== null && dim !== Number(expectedDim)) {
    return { ok: false, reason: 'embedding_dim_mismatch' };
  }

  // Only compared when BOTH sides are known. A person enrolled before the
  // model name was recorded, or a reporter that did not send one, is not
  // evidence of a mismatch — the dimension checks still apply.
  const storedModel = person.embeddingModel;
  if (expectedModel && storedModel && String(storedModel) !== String(expectedModel)) {
    return { ok: false, reason: 'embedding_model_mismatch' };
  }

  if (typeof similarity !== 'number' || !Number.isFinite(similarity)) {
    return { ok: false, reason: 'similarity_missing' };
  }

  const limit = Number(threshold);
  if (!Number.isFinite(limit)) return { ok: false, reason: 'threshold_misconfigured' };
  if (similarity < limit) return { ok: false, reason: 'below_threshold' };

  return { ok: true, reason: 'verified' };
}

/**
 * Temporal verification + cooldown for unknown-identity events.
 *
 * Two independent rules, both required by the spec:
 *   PERSISTENCE — a single fleeting sighting is not an event. The same
 *     camera+track must be observed `unknownPersistenceCount` times within
 *     `unknownPersistenceWindowSec` before anything is raised.
 *   COOLDOWN — once raised, further sightings of the same continuously visible
 *     face are suppressed for `unknownAlertCooldownSec`, so one person loitering
 *     produces one alert rather than one per frame.
 *
 * Pure: the caller owns the state map and stores the returned `state` back.
 *
 * @param {{ sightings?: number[], lastAlertAt?: number|null }} state
 * @param {number} now epoch ms
 * @param {{ unknownPersistenceCount?: number,
 *           unknownPersistenceWindowSec?: number,
 *           unknownAlertCooldownSec?: number }} config
 * @returns {{ raise: boolean, reason: string, sightings: number,
 *             state: { sightings: number[], lastAlertAt: number|null } }}
 */
export function shouldRaiseUnknownAlert(state, now, config = {}) {
  const requiredCount = Number(config.unknownPersistenceCount) || 1;
  const windowMs = (Number(config.unknownPersistenceWindowSec) || 0) * 1000;
  const cooldownMs = (Number(config.unknownAlertCooldownSec) || 0) * 1000;

  const previous = Array.isArray(state?.sightings) ? state.sightings : [];
  // Drop sightings that fell out of the persistence window, then record this one.
  const sightings = [...previous.filter((at) => now - at < windowMs), now];
  const lastAlertAt = state?.lastAlertAt ?? null;

  if (sightings.length < requiredCount) {
    return {
      raise: false,
      reason: 'awaiting_persistence',
      sightings: sightings.length,
      state: { sightings, lastAlertAt },
    };
  }

  if (lastAlertAt !== null && now - lastAlertAt < cooldownMs) {
    return {
      raise: false,
      reason: 'cooldown',
      sightings: sightings.length,
      state: { sightings, lastAlertAt },
    };
  }

  return {
    raise: true,
    reason: 'persisted',
    sightings: sightings.length,
    state: { sightings, lastAlertAt: now },
  };
}

/**
 * Whether `cooldownSec` has elapsed since `lastAt`.
 *
 * Returns true when nothing has happened yet, so the FIRST occurrence always
 * passes. Used for two separate throttles: how often an attendance record's
 * `lastSeen` is rewritten, and how often a 'known' recognition event is stored
 * and emitted for the same person on the same camera.
 */
export function cooldownElapsed(lastAt, now, cooldownSec) {
  if (lastAt === undefined || lastAt === null) return true;
  const cooldownMs = (Number(cooldownSec) || 0) * 1000;
  return now - Number(lastAt) >= cooldownMs;
}

/**
 * Whether an attendance write is due, given when this person/session was last
 * written. Limits how often `lastSeen` is updated for someone who is already
 * marked present — a recognised person standing in front of a camera must not
 * cause a database write per recognition pass.
 *
 * Returns true when nothing has been written yet, so the FIRST sighting always
 * writes.
 */
export function attendanceWriteDue(lastWriteAt, now, cooldownSec) {
  return cooldownElapsed(lastWriteAt, now, cooldownSec);
}

/**
 * Reads `created` out of a mongoose `findOneAndUpdate(..., { upsert: true,
 * includeResultMetadata: true })` result.
 *
 * Extracted from attendanceService so the branch that decides "did THIS call
 * insert the record?" — the piece whose mongoose-8 metadata field names could
 * not be confirmed against a running database — is a pure function with unit
 * tests covering every shape, including the fallback.
 *
 * mongoose 8 returns the raw driver ModifyResult:
 *   { value, lastErrorObject: { n, updatedExisting, upserted }, ok }
 * where `lastErrorObject.upserted` holds the new _id on an insert. When no
 * metadata comes back we fall back to comparing firstSeen with lastSeen: the
 * update sets firstSeen only on insert and lastSeen always, in one call, so
 * they are equal exactly when this call inserted.
 *
 * @returns {{ created: boolean, record: object|null }}
 */
export function interpretUpsertResult(result) {
  if (!result) return { created: false, record: null };

  const meta = result.lastErrorObject;
  const record = meta ? (result.value ?? null) : result;

  if (meta) {
    return { created: Boolean(meta.upserted) || meta.updatedExisting === false, record };
  }

  const created =
    Boolean(record?.firstSeen) && Number(record.firstSeen) === Number(record.lastSeen);
  return { created, record: record ?? null };
}

/**
 * Whether database-enforced attendance duplicate prevention is actually in
 * force, given the index state recorded at startup by `config/db.js`.
 *
 * The unique `{ personId, date }` index IS the mechanism: without it the
 * atomic upsert can race and two concurrent reports can both insert. So when
 * the index could not be built or verified, attendance is not written at all —
 * refusing the write is the honest failure mode, and it keeps the rest of the
 * application (detection, alerts, cameras, people) running, which refusing to
 * boot the process did not.
 */
export function attendanceDuplicatePreventionReady(indexState) {
  return Boolean(indexState && indexState.verified === true);
}

/**
 * Whether a normalised recognition status may become a stored event.
 *
 * `recognition_unavailable`, `no_face` and `low_quality` are COUNTED ONLY:
 * an unavailable pipeline is a service-health fact rather than an unknown
 * person, and a poor-quality or absent face is a measurement statement rather
 * than a security one. Neither may write an event, an attendance record, or an
 * alert. Only 'known' and 'unknown' are persistable.
 */
export function isPersistableRecognitionStatus(status) {
  return status === 'known' || status === 'unknown';
}

/**
 * The attendance session key for a moment in time: the LOCAL calendar date as
 * "YYYY-MM-DD", matching the Attendance.date contract and the unique
 * { personId, date } index that enforces duplicate prevention.
 *
 * Local rather than UTC on purpose: a workday boundary is a local-time concept,
 * and the operator reads these dates as their own calendar days.
 */
export function attendanceDateKey(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Normalises the AI service's RecognitionStatus (upper snake case, e.g.
 * "RECOGNITION_UNAVAILABLE") into the RecognitionEvent status enum (lower
 * snake case). Returns null for a value this backend does not recognise, so an
 * unexpected status is ignored rather than guessed at.
 */
export function normalizeRecognitionStatus(status) {
  const key = String(status ?? '').trim().toUpperCase();
  switch (key) {
    case 'KNOWN':
      return 'known';
    case 'UNKNOWN':
      return 'unknown';
    case 'LOW_QUALITY':
      return 'low_quality';
    case 'RECOGNITION_UNAVAILABLE':
      return 'recognition_unavailable';
    case 'NO_FACE':
      return 'no_face';
    default:
      return null;
  }
}
