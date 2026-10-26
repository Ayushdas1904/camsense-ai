import dotenv from 'dotenv';

dotenv.config();

/**
 * Centralized, validated access to environment variables.
 * Every module reads config from here instead of touching process.env directly,
 * so misconfiguration surfaces once, at startup, with a clear message.
 */
const required = ['MONGODB_URI', 'JWT_SECRET'];

const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  // In development we warn but keep running with safe fallbacks so the
  // foundation can boot on a fresh clone. In production this is fatal.
  const message = `Missing required environment variables: ${missing.join(', ')}`;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(message);
  }
  console.warn(`[config] ${message} — using development fallbacks.`);
}

// Not fatal (a deployment may run the backend alone), but nothing involving
// the AI service works without it, so say so once at startup rather than
// letting every call fail with an authentication error.
if (!process.env.AI_INGEST_SECRET) {
  console.warn(
    '[config] AI_INGEST_SECRET is not set. Every call to and from the AI service will be ' +
      "refused until it is set to the same value as the AI service's AI_SERVICE_INGEST_SECRET."
  );
}

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 5000,
  // Loopback by DEFAULT. This process serves JWT-authenticated operator APIs,
  // snapshot images and registration portraits, so it must not listen on every
  // interface out of the box. Set HOST explicitly (e.g. 0.0.0.0 inside a
  // container whose ports are published to 127.0.0.1) when a deployment really
  // needs a wider bind.
  host: process.env.HOST || '127.0.0.1',
  clientOrigins: (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/camsense',
  jwtSecret: process.env.JWT_SECRET || 'dev_insecure_secret_change_me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  // Lifetime of the NARROWED token used in /uploads image URLs. An <img> tag
  // cannot send an Authorization header, so that credential ends up in browser
  // history and any fronting proxy's log; it is therefore scoped to the asset
  // mount and expires well before the session does. Shorten it freely — the
  // only cost of expiry is that open tabs must be reloaded for images.
  assetTokenExpiresIn: process.env.ASSET_TOKEN_EXPIRES_IN || '1d',
  aiServiceUrl: process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000',
  seedAdmin: {
    name: process.env.SEED_ADMIN_NAME || 'Administrator',
    email: process.env.SEED_ADMIN_EMAIL || 'admin@camsense.ai',
    password: process.env.SEED_ADMIN_PASSWORD || 'ChangeMe123!',
  },

  // Shared secret for service-to-service AI → backend event ingestion, and for
  // the backend's own calls to the AI service. NO DEFAULT, deliberately: a
  // default value could not match the AI service's, so a half-configured
  // deployment would 401 every call instead of saying what is missing. Unset
  // means both sides fail closed with a message naming the variable to set
  // (requireInternalSecret rejects every service request; the AI service
  // returns 503). It MUST equal the AI service's AI_SERVICE_INGEST_SECRET.
  aiIngestSecret: process.env.AI_INGEST_SECRET || '',

  // Where detection snapshots are written and served from.
  snapshotDir: process.env.SNAPSHOT_DIR || 'uploads/snapshots',

  // Detection/alert throttling (seconds). Prevents flooding the DB with the
  // same object across consecutive frames. See eventService.
  detection: {
    // A stored detection event of the same (camera, type) inside this window
    // is treated as the same ongoing event.
    eventCooldownSec: Number(process.env.DETECTION_EVENT_COOLDOWN) || 5,
    weaponAlertCooldownSec: Number(process.env.WEAPON_ALERT_COOLDOWN) || 10,
    personAlertCooldownSec: Number(process.env.PERSON_ALERT_COOLDOWN) || 60,
  },

  // Face recognition / attendance (Review 2). The backend re-checks the match
  // threshold itself rather than trusting the AI service's verdict, so this
  // value is the authority for whether an identity claim is accepted.
  recognition: {
    // Cosine-similarity threshold an identity claim must clear. Default 0.363
    // is OpenCV's published STARTING POINT for the SFace model — it requires
    // validation on real enrolled data and is deliberately adjustable. It is
    // not a calibrated probability and implies no accuracy guarantee.
    matchThreshold: Number(process.env.RECOGNITION_MATCH_THRESHOLD) || 0.363,
    // Temporal verification before an unknown-identity event is raised: the
    // same camera+track must be seen this many times inside this window.
    unknownPersistenceCount: Number(process.env.UNKNOWN_PERSISTENCE_COUNT) || 2,
    unknownPersistenceWindowSec: Number(process.env.UNKNOWN_PERSISTENCE_WINDOW) || 10,
    // Per-camera/track cooldown so one continuously visible unmatched face
    // produces one alert, not one per frame.
    unknownAlertCooldownSec: Number(process.env.UNKNOWN_ALERT_COOLDOWN) || 60,
    // Per-camera/person cooldown for STORED 'known' recognition events and
    // their socket emits. Without it, one recognised person standing in view
    // writes one event per recognition report (≈1/s/camera) indefinitely.
    // Mirrors detection.eventCooldownSec, which does the same job for Review
    // 1 detection events.
    knownEventCooldownSec: Number(process.env.KNOWN_EVENT_COOLDOWN) || 30,
    // Minimum gap between lastSeen writes for an already-marked person.
    attendanceCooldownSec: Number(process.env.ATTENDANCE_UPDATE_COOLDOWN) || 30,
    // Embedding dimension the configured recognition model produces (SFace is
    // 128-d). Passed to the trust boundary so a stored vector from a different
    // embedding space is rejected rather than scored.
    embeddingDim: Number(process.env.RECOGNITION_EMBEDDING_DIM) || 128,
    // Registration photograph limits (decoded byte length).
    faceUploadMaxBytes: Number(process.env.FACE_UPLOAD_MAX_BYTES) || 5000000,
    allowedImageMimes: ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'],
    // Seconds the "is anybody enrolled?" count is cached for. A system with
    // nobody enrolled must not raise unknown-identity alerts on every face,
    // and that check must not cost a query per reported face.
    enrolledCountTtlSec: Number(process.env.ENROLLED_COUNT_TTL) || 30,
  },

  // Occupancy monitoring (Review 3). Occupancy is derived from the EXISTING
  // YOLO human detections; these knobs govern how the backend trusts, stores
  // and alerts on the figures the AI service reports.
  occupancy: {
    // Seconds after which a reported occupancy figure is treated as STALE and
    // stops being presented as a current reading. A stale figure is reported
    // with a null count, never 0 — "we cannot tell" is not "the room is
    // empty", and the later automation feature refuses to switch anything on
    // evidence this old.
    staleAfterSec: Number(process.env.OCCUPANCY_STALE_AFTER) || 30,
    // Minimum seconds between occupancy HISTORY writes for the same room when
    // nothing has changed. A change in count, status or availability always
    // writes immediately; this is the heartbeat for a steady room, and it is
    // what stops one row per processed frame reaching the database.
    minPersistIntervalSec: Number(process.env.OCCUPANCY_PERSIST_INTERVAL) || 60,
    // Per-room cooldown for near-capacity / capacity-exceeded alerts, so one
    // busy room produces one alert rather than one per report. Mirrors the
    // Review 1/2 cooldown knobs.
    capacityAlertCooldownSec: Number(process.env.OCCUPANCY_ALERT_COOLDOWN) || 300,
    // Hard ceiling on GET /api/occupancy/history page size. Enforced in the
    // rules module, so no request can produce an unbounded query.
    historyMaxLimit: Number(process.env.OCCUPANCY_HISTORY_MAX_LIMIT) || 500,
    // Default fraction of a room's capacity at which the status becomes "Near
    // Capacity". A room may override it; this is the fallback. Ignored when a
    // room has no configured capacity, since a ratio of an unknown capacity
    // means nothing.
    nearCapacityRatio: Number(process.env.OCCUPANCY_NEAR_CAPACITY_RATIO) || 0.8,
  },

  // Device control (Review 3). Only the SIMULATION adapter is implemented in
  // this project — there is no MQTT, ESP32 or relay integration — so these
  // knobs govern the in-process adapter and the shape a future real adapter
  // would have to honour.
  devices: {
    // Seconds an adapter call may take before it is treated as FAILED. The
    // simulation adapter is synchronous and never reaches this, but the
    // timeout is passed through the adapter contract so a real HTTP adapter
    // inherits a bound rather than hanging the automation tick.
    commandTimeoutSec: Number(process.env.DEVICE_COMMAND_TIMEOUT) || 5,
    // Minimum seconds between two `device_failure` alerts for the SAME device.
    // A device whose adapter keeps refusing is re-commanded on every engine
    // tick, so without this one ongoing fault would produce an alert every
    // tick and bury everything else. The failure is still recorded in full on
    // every attempt (DeviceStateHistory with confirmed:false and an
    // AutomationLog 'command_failed' row); only the duplicate ALERT is
    // suppressed, and the suppression is logged.
    failureAlertCooldownSec: Number(process.env.DEVICE_FAILURE_ALERT_COOLDOWN) || 300,
  },

  // Occupancy-driven automation (Review 3).
  //
  // NOTHING HERE ENABLES AUTOMATION. A rule must be explicitly enabled
  // (AutomationRule.enabled defaults to false) AND the device must be in
  // 'automatic' control mode (Device.controlMode defaults to 'disabled')
  // before a single command is issued. These values are only the defaults
  // offered when a rule is created.
  automation: {
    // How often the engine re-evaluates rules on its own, in seconds. The
    // engine is primarily EVENT-DRIVEN (occupancyService calls it after each
    // accepted report); this low-frequency tick exists so the unoccupied-delay
    // and manual-override-expiry transitions still fire when no new occupancy
    // report is arriving — which is exactly the case when a camera has gone
    // dark, i.e. when being careful matters most.
    tickIntervalSec: Number(process.env.AUTOMATION_TICK_INTERVAL) || 30,
    // Minimum seconds between commands to the SAME device. With the
    // already-in-the-desired-state check in services/automationRules.js, this
    // is what stops a device being flapped on and off.
    commandCooldownSec: Number(process.env.AUTOMATION_COMMAND_COOLDOWN) || 60,
    // Default "how long must the room stay at/below the threshold before it
    // counts as unoccupied", in seconds. Stops a short absence going dark.
    defaultUnoccupiedForSec: Number(process.env.AUTOMATION_DEFAULT_UNOCCUPIED_FOR) || 300,
    // Default lifetime of a manual override, in minutes. An override always
    // carries its own explicit expiry timestamp; this is the default offered.
    // Until it expires, automation records 'skipped_override' and issues no
    // command, so an operator's action is never immediately undone.
    manualOverrideMinutes: Number(process.env.AUTOMATION_MANUAL_OVERRIDE_MINUTES) || 30,
    // Hard ceiling on the GET /api/automation/history page size.
    historyMaxLimit: Number(process.env.AUTOMATION_HISTORY_MAX_LIMIT) || 500,
    // Minimum seconds between two `automation_failure` alerts for the SAME
    // room. The engine ticks continuously, so a persistent fault (a bad rule,
    // a database hiccup) would otherwise raise one alert per tick. Every
    // failure is still logged in full; only the duplicate alert is suppressed.
    failureAlertCooldownSec: Number(process.env.AUTOMATION_FAILURE_ALERT_COOLDOWN) || 300,
  },

  // Energy analytics (Review 3).
  energy: {
    // THE DECLARED BASELINE, and the only reason a savings figure can be
    // quoted at all. It represents "the device's configured operating schedule
    // WITHOUT occupancy-based switching" — i.e. the hours per day the device
    // would have been left on if nobody was automating it. Savings are
    // baseline minus measured, clamped at zero.
    //
    // IT IS AN ASSUMPTION, NOT A MEASUREMENT, and it is deliberately an
    // operator-set value rather than a hidden constant: change it to match the
    // schedule you are actually comparing against, and quote it whenever you
    // quote a saving. Every energy API response carries this number and a
    // description of it for that reason.
    baselineHoursPerDay: Number(process.env.ENERGY_BASELINE_HOURS_PER_DAY) || 12,
    // Hard ceiling on energy history page size and on how many device-state
    // transitions one window may pull, so no energy query is unbounded.
    historyMaxLimit: Number(process.env.ENERGY_HISTORY_MAX_LIMIT) || 500,
  },
};

export const isProduction = env.nodeEnv === 'production';
