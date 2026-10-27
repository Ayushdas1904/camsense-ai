import { AutomationRule } from '../models/AutomationRule.js';
import { AutomationLog } from '../models/AutomationLog.js';
import { Device } from '../models/Device.js';
import { Room } from '../models/Room.js';
import { RoomOccupancyState } from '../models/RoomOccupancyState.js';
import { Alert } from '../models/Alert.js';
import { env } from '../config/env.js';
import { getDeviceAutomationIndexState } from '../config/db.js';
import { emit, SocketEvents } from '../sockets/index.js';
import { logger } from '../utils/logger.js';
import { deriveOccupancyStatus, isOccupancyUsable } from './occupancyRules.js';
import { attendanceDateKey } from './identityRules.js';
import {
  decideDeviceAction,
  minutesOfDay,
  updateThresholdMarkers,
} from './automationRules.js';
import { issueCommand, serializeDevice } from './deviceService.js';
import { rollupDay } from './energyService.js';

/**
 * The occupancy-driven automation engine (Review 3).
 *
 * HOW IT IS DRIVEN — two inputs, no new infrastructure:
 *
 *   1. EVENT-DRIVEN (the main path). occupancyService calls
 *      `onOccupancyUpdated(roomId)` directly after it upserts
 *      RoomOccupancyState. A plain function call, not a message bus and not a
 *      polling loop, so a room's devices respond to the report that just
 *      arrived.
 *
 *   2. A SINGLE LOW-FREQUENCY TICK (env.automation.tickIntervalSec, default
 *      30s). Some transitions are not triggered by a new report — they are
 *      triggered by TIME PASSING: an unoccupied delay maturing, a manual
 *      override expiring, and a reading going stale. The most important of
 *      those is the last one, because when a camera goes dark NO new report
 *      arrives at all, and the event-driven path alone would leave the room's
 *      last evaluation frozen forever. The tick is what makes a camera outage
 *      visible in the automation log.
 *
 * WHAT IT GUARANTEES:
 *   • Nothing runs until a rule is explicitly enabled AND the device is in
 *     'automatic' mode. Both default to off.
 *   • EVERY evaluation is written to AutomationLog — including the skips.
 *     A rule that refused to act because the data was stale is the single most
 *     important thing this feature has to be able to show, and it is invisible
 *     unless it is recorded.
 *   • All switching goes through deviceService.issueCommand, so a state change
 *     is only ever recorded when the adapter confirmed it.
 *   • The whole tick is wrapped in try/catch. An automation failure raises an
 *     `automation_failure` alert and the process keeps running; occupancy,
 *     detection, recognition and attendance are untouched by an automation
 *     fault.
 */

/** The interval handle, so shutdown can clear it. */
let tickHandle = null;
let tickRunning = false;
let lastTickAt = null;
let lastTickError = null;

/**
 * Starts the periodic tick. Idempotent — calling it twice does not create two
 * intervals, which would double every evaluation.
 */
export function startAutomationEngine() {
  if (tickHandle) return { started: false, reason: 'already_running' };

  const intervalMs = Math.max(5, Number(env.automation.tickIntervalSec) || 30) * 1000;
  tickHandle = setInterval(() => {
    // Fire and forget, but never unhandled: runTick catches everything.
    runTick('interval').catch((err) =>
      logger.error('Automation tick rejected unexpectedly', err.message)
    );
  }, intervalMs);
  // Does not hold the event loop open on its own, so a shutdown that forgets
  // to clear it still exits.
  tickHandle.unref?.();

  logger.info(
    `Automation engine started (tick every ${intervalMs / 1000}s). Rules are evaluated on ` +
      'every occupancy report as well; the tick exists so unoccupied delays, override ' +
      'expiries and stale-data skips still fire when no report is arriving.'
  );
  return { started: true, intervalMs };
}

/** Clears the tick. Called from the server's shutdown path. */
export function stopAutomationEngine() {
  if (!tickHandle) return { stopped: false };
  clearInterval(tickHandle);
  tickHandle = null;
  logger.info('Automation engine stopped');
  return { stopped: true };
}

/** Engine health for the service-health panel. Reports facts, not a colour. */
export function automationEngineHealth() {
  return {
    running: Boolean(tickHandle),
    tickIntervalSec: env.automation.tickIntervalSec,
    lastTickAt,
    lastError: lastTickError,
    note:
      'The engine is event-driven on every occupancy report, plus a periodic tick so ' +
      'time-based transitions (unoccupied delays, override expiry, stale data) still fire.',
  };
}

/**
 * Builds the occupancy view one rule evaluation needs.
 *
 * RE-DERIVES THE STATUS AT EVALUATION TIME rather than trusting the stored
 * one. That is the whole point: a stored status of 'occupied' was true when it
 * was written, and a room whose camera stopped reporting ten minutes ago still
 * has it. Re-deriving through occupancyRules turns it into 'stale' with a
 * count of null, which is what makes the fail-safe fire.
 */
function occupancyViewFor(room, state, now) {
  const derived = deriveOccupancyStatus({
    count: state?.count ?? null,
    capacity: room.capacity,
    available: Boolean(state?.available),
    lastUpdatedAt: state?.lastUpdatedAt ?? null,
    now,
    staleAfterSec: env.occupancy.staleAfterSec,
    monitoringEnabled: room.monitoringEnabled !== false,
    nearCapacityRatio:
      typeof room.nearCapacityRatio === 'number'
        ? room.nearCapacityRatio
        : env.occupancy.nearCapacityRatio,
    occupancyThreshold: room.occupancyThreshold,
  });

  const usable = isOccupancyUsable({
    count: state?.count ?? null,
    available: Boolean(state?.available),
    lastUpdatedAt: state?.lastUpdatedAt ?? null,
    now,
    staleAfterSec: env.occupancy.staleAfterSec,
  });

  return {
    // null, never 0, when the figure cannot be trusted.
    count: derived.count,
    status: derived.status,
    available: derived.available,
    usable: usable.usable,
    unusableReason: usable.usable ? null : usable.reason,
    lastUpdatedAt: state?.lastUpdatedAt ?? null,
    belowThresholdSince: state?.belowThresholdSince ?? null,
    aboveThresholdSince: state?.aboveThresholdSince ?? null,
  };
}

/** Writes one AutomationLog row. Never throws into the caller's control flow. */
async function logDecision({ rule, device, outcome, decision, adapterMessage = null, now }) {
  try {
    const row = await AutomationLog.create({
      ruleId: rule?.ruleId ?? null,
      roomId: rule?.roomId ?? device?.roomId ?? null,
      deviceId: device?.deviceId ?? null,
      decision: decision.decision,
      reason: decision.reason,
      // Null for an unavailable/stale figure — never 0.
      occupancyCount: decision.occupancyCount ?? null,
      occupancyStatus: decision.occupancyStatus ?? null,
      outcome,
      adapterMessage,
      evaluatedAt: new Date(now),
    });
    emit(SocketEvents.AUTOMATION_ACTION, {
      id: row._id.toString(),
      ruleId: row.ruleId,
      roomId: row.roomId,
      deviceId: row.deviceId,
      decision: row.decision,
      reason: row.reason,
      occupancyCount: row.occupancyCount,
      occupancyStatus: row.occupancyStatus,
      outcome: row.outcome,
      adapterMessage: row.adapterMessage,
      evaluatedAt: row.evaluatedAt,
    });
    return row;
  } catch (err) {
    logger.error(
      `Could not write the automation log row for ${rule?.ruleId}/${device?.deviceId}`,
      err.message
    );
    return null;
  }
}

/**
 * Per-rule threshold-marker clocks, keyed `${roomId}:${threshold}`.
 *
 * In memory because they are a running clock, not a record. The PERSISTED pair
 * on RoomOccupancyState (written below, using the ROOM's own threshold) is the
 * restart fallback the feature needs: without it, a fresh process has no
 * marker, and a rule whose unoccupied delay is satisfied by "no marker" would
 * fire a switch-off the room never actually earned.
 *
 * Keyed BY THRESHOLD, not just by room, because a room may carry several rules
 * with different thresholds and each one needs its own clock — a clock run
 * against the wrong threshold would be measuring a condition the decision
 * function does not recognise.
 */
const markerClocks = new Map();

/**
 * Hard cap on the clock map, in the same idiom as the Review 2 cooldown maps
 * (recognitionService's UNKNOWN_STATE_MAX_KEYS, attendanceService's
 * THROTTLE_MAX_KEYS).
 *
 * The key space is (room × configured threshold), so it is bounded by
 * configuration rather than by traffic — but an operator who edits a rule's
 * threshold repeatedly leaves one dead entry per old value for the life of the
 * process. The cap turns a slow trickle into a bounded one; dropping the
 * oldest entry only ever restarts a clock, which DELAYS a switch-off rather
 * than bringing one forward.
 */
const MARKER_CLOCK_MAX_KEYS = 500;

/** Clears the in-memory marker clocks (used by tests and by seeding). */
export function resetAutomationClocksForTests() {
  markerClocks.clear();
}

/**
 * The marker pair for one (room, threshold), seeded from persisted state on a
 * cache miss.
 *
 * SEEDING IS DELIBERATELY CONSERVATIVE. The persisted pair was written for the
 * ROOM's threshold, so it is only reused when the rule's threshold matches.
 * For any other threshold the clock starts NOW, which can only DELAY a
 * switch-off, never accelerate one — the direction that is safe to be wrong
 * in.
 */
function clockFor(roomId, threshold, roomThreshold, persisted) {
  const key = `${roomId}:${threshold}`;
  if (markerClocks.has(key)) return markerClocks.get(key);

  const seed =
    threshold === roomThreshold
      ? {
          belowThresholdSince: persisted?.belowThresholdSince ?? null,
          aboveThresholdSince: persisted?.aboveThresholdSince ?? null,
        }
      : { belowThresholdSince: null, aboveThresholdSince: null };

  markerClocks.set(key, seed);
  // Insertion-ordered, so the first key is the oldest. Evicting it restarts
  // that clock, which can only delay a switch-off.
  if (markerClocks.size > MARKER_CLOCK_MAX_KEYS) {
    const oldest = markerClocks.keys().next().value;
    markerClocks.delete(oldest);
  }
  return seed;
}

/**
 * Evaluates every enabled rule for ONE room.
 *
 * @returns {{ roomId, evaluations, commands, failures, skipped }}
 */
export async function evaluateRoom(roomId, { now = Date.now(), trigger = 'event' } = {}) {
  const summary = { roomId, evaluations: 0, commands: 0, failures: 0, skipped: 0 };

  const rules = await AutomationRule.find({ roomId, enabled: true, active: true });
  if (rules.length === 0) return summary;

  const room = await Room.findOne({ roomId });
  if (!room) {
    logger.warn(`Automation: rule(s) reference room ${roomId}, which no longer exists.`);
    return summary;
  }

  const state = await RoomOccupancyState.findOne({ roomId });
  const occupancyBase = occupancyViewFor(room, state, now);
  const nowMinutes = minutesOfDay(new Date(now));
  const roomThreshold = Number.isFinite(Number(room.occupancyThreshold))
    ? Number(room.occupancyThreshold)
    : 1;

  for (const rule of rules) {
    const deviceIds = (rule.deviceIds || []).filter(Boolean);
    if (deviceIds.length === 0) continue;

    // ── Advance (or freeze) this rule's threshold clock ─────────
    // Once per rule, before its devices are evaluated, so every device the
    // rule controls sees exactly the same clock.
    const threshold = Number.isFinite(Number(rule.occupancyThreshold))
      ? Number(rule.occupancyThreshold)
      : 1;
    const previousMarkers = clockFor(roomId, threshold, roomThreshold, state);
    const markers = updateThresholdMarkers({
      previous: previousMarkers,
      occupancy: occupancyBase,
      threshold,
      now,
    });
    markerClocks.set(`${roomId}:${threshold}`, {
      belowThresholdSince: markers.belowThresholdSince,
      aboveThresholdSince: markers.aboveThresholdSince,
    });

    // Persist only the ROOM-threshold clock — that is the one the restart
    // fallback reads back, and writing one pair per rule would mean the last
    // rule evaluated overwrote the others.
    if (markers.changed && state && threshold === roomThreshold) {
      await RoomOccupancyState.updateOne(
        { roomId },
        {
          $set: {
            belowThresholdSince: markers.belowThresholdSince,
            aboveThresholdSince: markers.aboveThresholdSince,
          },
        }
      );
    }

    const occupancy = {
      ...occupancyBase,
      belowThresholdSince: markers.belowThresholdSince,
      aboveThresholdSince: markers.aboveThresholdSince,
    };

    const devices = await Device.find({ deviceId: { $in: deviceIds } });
    for (const device of devices) {
      summary.evaluations += 1;

      const decision = decideDeviceAction({
        rule,
        device,
        occupancy,
        now,
        lastCommandAt: device.lastCommand?.issuedAt ?? null,
        override: device.override,
        nowMinutes,
      });

      if (decision.decision !== 'switch_on' && decision.decision !== 'switch_off') {
        // Recorded, including every skip. A suspended rule must be visible.
        if (decision.decision !== 'no_change') summary.skipped += 1;
        await logDecision({
          rule,
          device,
          outcome: 'not_applicable',
          decision,
          now,
        });
        continue;
      }

      // ── A real switching command ───────────────────────────────
      let result;
      try {
        result = await issueCommand({
          device,
          state: decision.desiredState,
          trigger: 'automation',
          ruleId: rule.ruleId,
          reason: decision.reason,
        });
      } catch (err) {
        // issueCommand throws for an unimplemented adapter or unverified
        // indexes. That is a configuration fault, not a crash.
        summary.failures += 1;
        await logDecision({
          rule,
          device,
          outcome: 'failed',
          decision: {
            ...decision,
            decision: 'command_failed',
            reason: `${decision.reason} The command could not be issued: ${err.message}`,
          },
          adapterMessage: err.message,
          now,
        });
        continue;
      }

      if (result.ok) {
        summary.commands += 1;
        await logDecision({
          rule,
          device,
          outcome: 'applied',
          decision,
          adapterMessage: result.message,
          now,
        });
      } else if (result.inFlight) {
        // Another path is already commanding this device (see the note on
        // inFlightCommands in deviceService.js). Nothing failed and nothing
        // was attempted, so this is recorded as a no-change rather than
        // counted as a failure — the next evaluation will see the settled
        // state.
        summary.skipped += 1;
        await logDecision({
          rule,
          device,
          outcome: 'not_applicable',
          decision: {
            ...decision,
            decision: 'no_change',
            reason: `${decision.reason} ${result.message}`,
          },
          adapterMessage: result.message,
          now,
        });
      } else {
        // issueCommand already wrote its own 'command_failed' log row, raised
        // the device_failure alert and left reportedState untouched. Counted
        // here so the tick summary is accurate.
        summary.failures += 1;
      }
    }
  }

  if (summary.evaluations > 0) {
    logger.debug(
      `Automation (${trigger}) ${roomId}: ${summary.evaluations} evaluation(s), ` +
        `${summary.commands} command(s), ${summary.skipped} skip(s), ` +
        `${summary.failures} failure(s).`
    );
  }
  return summary;
}

/**
 * Called by occupancyService immediately after a room's state is upserted.
 *
 * A DIRECT FUNCTION CALL, deliberately: no queue, no pub/sub, no second
 * process. Swallows its own errors so an automation fault can never fail an
 * occupancy ingest — losing the headcount because a light would not switch
 * would be the wrong trade.
 */
export async function onOccupancyUpdated(roomId) {
  if (!roomId) return null;
  try {
    const indexState = getDeviceAutomationIndexState();
    if (!indexState.verified) {
      // Logged once per report at debug level rather than warning on every
      // one; the startup log already carries the loud version.
      logger.debug(
        `Automation skipped for ${roomId}: the device/automation indexes are unverified.`
      );
      return null;
    }
    return await evaluateRoom(roomId, { now: Date.now(), trigger: 'occupancy' });
  } catch (err) {
    await raiseAutomationFailure(err, `evaluating room ${roomId} after an occupancy update`);
    return null;
  }
}

/**
 * One periodic pass over every room that has an enabled rule.
 *
 * Wrapped end to end in try/catch. An exception raises an
 * `automation_failure` alert and returns; it never propagates, so a bad rule,
 * a missing device or a database hiccup cannot take the process down and
 * cannot stop occupancy, detection, recognition or attendance from working.
 */
export async function runTick(trigger = 'interval') {
  if (tickRunning) {
    // A tick that overruns its interval must not run twice concurrently —
    // that would double-count the cooldown window and could double-command.
    logger.debug('Automation tick skipped: the previous tick is still running.');
    return { skipped: true, reason: 'already_running' };
  }
  tickRunning = true;
  const now = Date.now();

  try {
    const indexState = getDeviceAutomationIndexState();
    if (!indexState.verified) {
      lastTickAt = new Date(now);
      return { skipped: true, reason: 'indexes_unverified' };
    }

    const roomIds = await AutomationRule.distinct('roomId', { enabled: true, active: true });
    const totals = { rooms: roomIds.length, evaluations: 0, commands: 0, skipped: 0, failures: 0 };

    for (const roomId of roomIds) {
      try {
        const result = await evaluateRoom(roomId, { now, trigger });
        totals.evaluations += result.evaluations;
        totals.commands += result.commands;
        totals.skipped += result.skipped;
        totals.failures += result.failures;
      } catch (err) {
        // One room's failure must not abandon the others.
        totals.failures += 1;
        await raiseAutomationFailure(err, `evaluating room ${roomId} on the automation tick`);
      }
    }

    lastTickAt = new Date(now);
    lastTickError = null;
    await maybeRollupYesterday(now);
    return totals;
  } catch (err) {
    lastTickAt = new Date(now);
    await raiseAutomationFailure(err, 'running the automation tick');
    return { failed: true, error: err.message };
  } finally {
    tickRunning = false;
  }
}

/**
 * Rolls YESTERDAY's energy figures into the EnergySummary cache, at most once
 * per calendar day.
 *
 * Piggy-backs on the automation tick rather than adding a scheduler, because
 * no new infrastructure is in scope and the tick already runs. A guard keeps it
 * to one attempt per local day, so a 30-second tick does not re-run it 2,880
 * times — and the rollup is an idempotent upsert anyway, so a duplicate run
 * recomputes rather than double-counting.
 *
 * Only a COMPLETED day is rolled up (rollupDay refuses a day in progress): a
 * partial day's row would be wrong the moment it was written and would then be
 * served as a finished day in the weekly trend.
 *
 * Failures are logged and swallowed. The rollup is a cache for cheap trend
 * queries; everything it holds can be recomputed from DeviceStateHistory on
 * demand, so losing it must never disturb automation.
 */
let lastRollupDayKey = null;

async function maybeRollupYesterday(now) {
  // Same local-day key convention as Review 2 attendance and the
  // EnergySummary schema, taken from the one function that defines it.
  const key = attendanceDateKey(new Date(Number(now) - 24 * 60 * 60 * 1000));
  if (lastRollupDayKey === key) return;
  lastRollupDayKey = key;

  try {
    await rollupDay(key);
  } catch (err) {
    logger.warn(
      `Energy rollup for ${key} failed (${err.message}). The figures are still ` +
        'computable on demand from the device state history; only the trend cache is ' +
        'affected.'
    );
  }
}

/**
 * Raises an `automation_failure` alert (the Alert enum value Review 3 added).
 *
 * Itself wrapped in try/catch: if even the alert write fails — which is likely
 * when the cause is the database — it is logged and swallowed. The one
 * behaviour this function must guarantee is that it never throws, because
 * every call site is an error path already.
 */
async function raiseAutomationFailure(err, context) {
  lastTickError = `${context}: ${err.message}`;
  logger.error(`Automation failure while ${context}`, err.message);

  try {
    // PER-CONDITION COOLDOWN, keyed on the failure context. The engine ticks
    // continuously, so a persistent fault (a malformed rule, a database
    // hiccup) would otherwise raise one alert per tick. The failure is still
    // recorded on every occurrence in `lastTickError` and in the log, and it
    // is reported by GET /api/health/components; only the duplicate ALERT is
    // suppressed.
    const cooldownSec = env.automation.failureAlertCooldownSec;
    const now = new Date();
    const recent =
      cooldownSec > 0
        ? await Alert.findOne({
            type: 'automation_failure',
            timestamp: { $gte: new Date(Number(now) - cooldownSec * 1000) },
          }).select('_id')
        : null;

    if (recent) {
      logger.debug(
        `automation_failure alert suppressed: one was raised inside the ${cooldownSec}s ` +
          'cooldown. The failure is recorded in the engine health report.'
      );
      return;
    }

    const alert = await Alert.create({
      type: 'automation_failure',
      // 'warning': automation not running is an operational fault that needs
      // attention, not a security incident.
      severity: 'warning',
      message:
        `Automation failed while ${context}: ${err.message}. No device state was changed ` +
        'as a result of this failure.',
      status: 'new',
      timestamp: now,
    });
    emit(SocketEvents.ALERT_NEW, {
      id: alert._id.toString(),
      type: alert.type,
      severity: alert.severity,
      message: alert.message,
      status: alert.status,
      timestamp: alert.timestamp,
    });
  } catch (alertErr) {
    logger.error('Could not raise the automation_failure alert', alertErr.message);
  }
}

/**
 * Re-syncs a device after an administrator changes a rule, and returns the
 * devices a rule controls — used by the automation controller so an operator
 * sees immediately which devices a rule will act on.
 */
export async function devicesForRule(rule) {
  const deviceIds = (rule.deviceIds || []).filter(Boolean);
  if (deviceIds.length === 0) return [];
  const devices = await Device.find({ deviceId: { $in: deviceIds } });
  return devices.map((device) => serializeDevice(device));
}
