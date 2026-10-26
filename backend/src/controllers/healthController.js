import mongoose from 'mongoose';
import { asyncHandler } from '../utils/asyncHandler.js';
import { env } from '../config/env.js';
import { Camera } from '../models/Camera.js';
import { aiClient } from '../services/aiClient.js';
import {
  getAttendanceIndexState,
  getDeviceAutomationIndexState,
  getOccupancyIndexState,
} from '../config/db.js';
import { deviceHealth } from '../services/deviceService.js';
import { adapterHealth } from '../services/devices/index.js';
import { automationEngineHealth } from '../services/automationEngine.js';
import { AutomationRule } from '../models/AutomationRule.js';

const MONGO_STATES = ['disconnected', 'connected', 'connecting', 'disconnecting'];

/**
 * Health check for the application backend.
 * Reports process uptime and database connectivity so the frontend (and any
 * future monitoring) can show real system-health status, not a hardcoded "OK".
 */
export const getHealth = asyncHandler(async (_req, res) => {
  const dbState = MONGO_STATES[mongoose.connection.readyState] || 'unknown';

  res.status(200).json({
    success: true,
    data: {
      service: 'camsense-backend',
      status: 'ok',
      environment: env.nodeEnv,
      uptimeSeconds: Math.round(process.uptime()),
      database: { status: dbState },
      timestamp: new Date().toISOString(),
    },
  });
});

/**
 * ═══ PER-COMPONENT HEALTH (Review 3) ═══
 *
 * THE RULE THIS ENDPOINT EXISTS TO ENFORCE: no component's status is ever
 * inferred from the fact that this process is running. The backend answering
 * this request proves exactly one thing — that the backend is up. Everything
 * else is probed, counted or read from the component that actually owns the
 * state:
 *
 *   database            mongoose.connection.readyState, mapped through
 *                       MONGO_STATES. Not "ok because a query worked earlier".
 *   ai_service          an actual call to the AI service's /api/status.
 *   detection_model     the AI service's own `model_loaded` flag. A reachable
 *                       AI service with no weights loaded is DOWN here, which
 *                       is the distinction the dashboard needs.
 *   recognition         the AI service's /api/faces/status — detector,
 *                       embedder and identity-cache freshness, independently
 *                       of the detection model.
 *   cameras             online/offline counted from the Camera collection.
 *   device_adapter      the adapter registry. Simulation reports the dedicated
 *                       status 'simulation', NOT 'ok', because "the adapter
 *                       responds" is not "hardware is connected".
 *   automation_engine   the engine's own last-tick timestamp and last error.
 *   duplicate_prevention / occupancy_storage / device_storage
 *                       the three index-verification states from config/db.js.
 *
 * A component whose state CANNOT be determined reports status 'unknown' with a
 * `reason`, never 'ok'.
 *
 * NOTHING SENSITIVE IS EXPOSED: no connection string, no secret, no stack
 * trace. Error text from a failed AI call is truncated and carries only the
 * message, and the known-credential misconfiguration is reported as a sentence
 * that names the environment variable without its value.
 */

/** Component status vocabulary. 'simulation' is deliberately not 'ok'. */
const STATUS = {
  OK: 'ok',
  DEGRADED: 'degraded',
  DOWN: 'down',
  SIMULATION: 'simulation',
  UNKNOWN: 'unknown',
};

function component(key, label, status, detail, extra = {}) {
  return { key, label, status, detail, ...extra };
}

/** Strips anything that could be a stack trace or a secret out of a message. */
function safeMessage(err, fallback) {
  const raw = typeof err?.message === 'string' ? err.message : '';
  if (!raw) return fallback;
  // First line only (a stack trace lives on the lines after it), capped.
  return raw.split('\n')[0].slice(0, 200);
}

export const getComponentHealth = asyncHandler(async (_req, res) => {
  const components = [];

  // ── Backend API ────────────────────────────────────────────────
  // The ONLY component whose status this request proves.
  components.push(
    component('backend', 'Backend API', STATUS.OK, `Responding. Uptime ${Math.round(process.uptime())}s.`, {
      environment: env.nodeEnv,
      uptimeSeconds: Math.round(process.uptime()),
    })
  );

  // ── Database ───────────────────────────────────────────────────
  const readyState = mongoose.connection.readyState;
  const dbState = MONGO_STATES[readyState];
  components.push(
    component(
      'database',
      'MongoDB',
      dbState === 'connected'
        ? STATUS.OK
        : dbState === 'connecting' || dbState === 'disconnecting'
          ? STATUS.DEGRADED
          : dbState === 'disconnected'
            ? STATUS.DOWN
            : STATUS.UNKNOWN,
      dbState
        ? `Mongoose connection is ${dbState}.`
        : `Mongoose reported an unrecognised readyState (${readyState}).`
    )
  );

  // ── AI service + detection model ───────────────────────────────
  // Probed, not assumed. Graceful degradation: a failure here is reported and
  // the rest of the payload is still built (the pattern getAiStatus uses).
  let aiStatus = null;
  let aiError = null;
  try {
    aiStatus = await aiClient.getStatus();
  } catch (err) {
    aiError = safeMessage(err, 'The AI service could not be reached.');
  }

  components.push(
    component(
      'ai_service',
      'AI Service (FastAPI)',
      aiStatus ? STATUS.OK : STATUS.DOWN,
      aiStatus
        ? `Reachable. Reported mode '${aiStatus.mode ?? 'unknown'}'.`
        : `Not reachable: ${aiError}`,
      { reachable: Boolean(aiStatus) }
    )
  );

  components.push(
    component(
      'detection_model',
      'YOLO Detection Model',
      // Crucially independent of the backend AND of AI reachability.
      !aiStatus
        ? STATUS.UNKNOWN
        : aiStatus.model_loaded
          ? STATUS.OK
          : STATUS.DOWN,
      !aiStatus
        ? 'Cannot be determined while the AI service is unreachable — the backend has no ' +
            'way to know whether the model weights are loaded.'
        : aiStatus.model_loaded
          ? 'The AI service reports the detection model is loaded.'
          : 'The AI service is up but reports NO detection model loaded. Run ' +
            '`python download_assets.py` in ai-service to fetch the weights. Human and ' +
            'weapon detection are unavailable; no detections are being fabricated.',
      { detectors: Array.isArray(aiStatus?.detectors) ? aiStatus.detectors : [] }
    )
  );

  // ── Face recognition (its own probe, its own verdict) ──────────
  let faceStatus = null;
  let faceError = null;
  try {
    faceStatus = await aiClient.getFaceStatus();
  } catch (err) {
    faceError = safeMessage(err, 'The recognition status could not be read.');
  }

  const detectorReady = Boolean(faceStatus?.detector_available);
  const embedderReady = Boolean(faceStatus?.embedder_available);
  // Past its TTL + grace because refreshes keep failing: matching is failing
  // CLOSED, so recognition is degraded even though both models are loaded.
  const cacheStale = Boolean(faceStatus?.cache_stale);
  components.push(
    component(
      'recognition',
      'Face Recognition',
      !faceStatus
        ? STATUS.UNKNOWN
        : detectorReady && embedderReady
          ? cacheStale
            ? STATUS.DEGRADED
            : STATUS.OK
          : detectorReady || embedderReady
            ? STATUS.DEGRADED
            : STATUS.DOWN,
      !faceStatus
        ? `Cannot be determined: ${faceError}`
        : detectorReady && embedderReady
          ? cacheStale
            ? 'Both models are loaded but the enrolled-identity cache is STALE — refreshes ' +
              'are failing, so matching is failing closed and no name will be asserted.'
            : `Face detector and embedder are both loaded. ` +
              `${faceStatus.cache_size ?? 0} enrolled identit${
                (faceStatus.cache_size ?? 0) === 1 ? 'y' : 'ies'
              } cached.`
          : `Detector ${detectorReady ? 'loaded' : 'NOT loaded'}, embedder ` +
            `${embedderReady ? 'loaded' : 'NOT loaded'}. Recognition results are not ` +
            'produced while either is missing.',
      {
        detectorReady,
        embedderReady,
        // Identity-cache facts, relayed verbatim from the AI service rather
        // than re-derived here.
        cacheLoaded: faceStatus?.cache_loaded ?? null,
        cacheSize: faceStatus?.cache_size ?? null,
        cacheStale: faceStatus ? cacheStale : null,
        cacheAgeSeconds: faceStatus?.cache_age_seconds ?? null,
      }
    )
  );

  // ── Camera sources ─────────────────────────────────────────────
  let cameras = null;
  let cameraError = null;
  try {
    const rows = await Camera.find({}).select('cameraId status mode aiEnabled');
    cameras = {
      total: rows.length,
      online: rows.filter((c) => c.status === 'online').length,
      offline: rows.filter((c) => c.status === 'offline').length,
      error: rows.filter((c) => c.status === 'error').length,
      demo: rows.filter((c) => c.mode === 'demo').length,
    };
  } catch (err) {
    cameraError = safeMessage(err, 'The camera collection could not be read.');
  }

  components.push(
    component(
      'cameras',
      'Camera Sources',
      !cameras
        ? STATUS.UNKNOWN
        : cameras.total === 0
          ? STATUS.UNKNOWN
          : cameras.error > 0
            ? STATUS.DEGRADED
            : cameras.online > 0
              ? STATUS.OK
              : STATUS.DOWN,
      !cameras
        ? `Cannot be determined: ${cameraError}`
        : cameras.total === 0
          ? 'No cameras are configured, so there is nothing to report. Run ' +
            '`npm run seed:cameras` or add one under Cameras.'
          : `${cameras.online} of ${cameras.total} online` +
            (cameras.error > 0 ? `, ${cameras.error} in error` : '') +
            (cameras.demo > 0 ? `. ${cameras.demo} configured as DEMO sources.` : '.'),
      cameras ?? {}
    )
  );

  // ── Device adapter ─────────────────────────────────────────────
  // Simulation reports 'simulation', never 'ok'.
  let devices = null;
  let deviceError = null;
  try {
    devices = await deviceHealth();
  } catch (err) {
    deviceError = safeMessage(err, 'Device state could not be read.');
  }
  const adapters = adapterHealth();
  const implementedAdapters = adapters.adapters.filter((a) => a.implemented);

  components.push(
    component(
      'device_adapter',
      'Device Adapter',
      !devices
        ? STATUS.UNKNOWN
        : devices.total === 0
          ? STATUS.UNKNOWN
          : // Every implemented adapter in this build is a simulation, so the
            // honest answer is 'simulation' even when everything "works".
            devices.simulated === devices.total
            ? STATUS.SIMULATION
            : devices.offline > 0
              ? STATUS.DEGRADED
              : STATUS.OK,
      !devices
        ? `Cannot be determined: ${deviceError}`
        : devices.total === 0
          ? 'No devices are configured. Run `npm run seed:devices` to create two clearly ' +
            'labelled simulated devices for the demo.'
          : `${devices.total} device(s): ${devices.simulated} SIMULATED, ${devices.offline} ` +
            `offline, ${devices.unknownState} in an unconfirmed state, ${devices.automatic} ` +
            'under automatic control. ' +
            devices.note,
      {
        implementedAdapters: implementedAdapters.map((a) => a.type),
        adapters: adapters.adapters,
        simulatedDevices: devices?.simulated ?? null,
        totalDevices: devices?.total ?? null,
        offlineDevices: devices?.offline ?? null,
        unknownStateDevices: devices?.unknownState ?? null,
      }
    )
  );

  // ── Automation engine ──────────────────────────────────────────
  const engine = automationEngineHealth();
  let enabledRules = null;
  let ruleError = null;
  try {
    enabledRules = await AutomationRule.countDocuments({ enabled: true, active: true });
  } catch (err) {
    ruleError = safeMessage(err, 'The automation rules could not be counted.');
  }

  components.push(
    component(
      'automation_engine',
      'Automation Engine',
      engine.lastError
        ? STATUS.DEGRADED
        : !engine.running
          ? STATUS.DOWN
          : enabledRules === null
            ? STATUS.UNKNOWN
            : enabledRules === 0
              ? // Running correctly, but it will not act. Not an error, and not
                // "ok" either without saying so.
                STATUS.DEGRADED
              : STATUS.OK,
      engine.lastError
        ? `The last engine tick failed: ${String(engine.lastError).slice(0, 200)}`
        : !engine.running
          ? 'The automation engine is not running, so no rule will be evaluated.'
          : enabledRules === null
            ? `Running, but the rule count could not be read: ${ruleError}`
            : enabledRules === 0
              ? 'Running, but NO automation rule is enabled, so nothing will be switched. ' +
                'Enable a rule and set its devices to automatic control.'
              : `Running. ${enabledRules} enabled rule(s). ${engine.note}`,
      {
        running: engine.running,
        tickIntervalSec: engine.tickIntervalSec,
        lastTickAt: engine.lastTickAt ?? null,
        enabledRules,
      }
    )
  );

  // ── Index verification states (three independent groups) ───────
  const indexGroups = [
    [
      'duplicate_prevention',
      'Attendance Duplicate Prevention',
      getAttendanceIndexState(),
      'Attendance writes are refused while the unique index is unverified, so a duplicate ' +
        'cannot be created.',
    ],
    [
      'occupancy_storage',
      'Occupancy Storage',
      getOccupancyIndexState(),
      'Occupancy writes are refused while the unique indexes are unverified. Reads keep ' +
        'working.',
    ],
    [
      'device_storage',
      'Device & Automation Storage',
      getDeviceAutomationIndexState(),
      'Device commands and automation are disabled while the unique indexes are ' +
        'unverified, rather than risking two state records for one device.',
    ],
  ];

  for (const [key, label, state, consequence] of indexGroups) {
    components.push(
      component(
        key,
        label,
        state.verified ? STATUS.OK : STATUS.DEGRADED,
        state.verified
          ? 'The unique indexes were built and read back successfully.'
          : `Indexes UNVERIFIED${state.error ? `: ${String(state.error).slice(0, 200)}` : ''}. ` +
            consequence
      )
    );
  }

  // Worst status wins, so a single dead component cannot be hidden behind a
  // majority of healthy ones. 'simulation' is not a fault and does not drag
  // the overall verdict down, but it is reported separately.
  const rank = { down: 4, unknown: 3, degraded: 2, simulation: 1, ok: 0 };
  const overall = components.reduce(
    (worst, c) => ((rank[c.status] ?? 0) > (rank[worst] ?? 0) ? c.status : worst),
    STATUS.OK
  );

  res.json({
    success: true,
    data: {
      overall,
      // Plain prose so the UI does not have to invent a caption.
      overallNote:
        'Each component below was probed, counted or read from the component that owns the ' +
        'state. The backend answering this request only proves the backend is up — the AI ' +
        'model, the recognition subsystem and the device adapter each report for themselves.',
      simulationInUse: components.some((c) => c.status === STATUS.SIMULATION),
      components,
      timestamp: new Date().toISOString(),
    },
  });
});
