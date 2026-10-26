import { Device } from '../models/Device.js';
import { DeviceStateHistory } from '../models/DeviceStateHistory.js';
import { AutomationLog } from '../models/AutomationLog.js';
import { Alert } from '../models/Alert.js';
import { Room } from '../models/Room.js';
import { env } from '../config/env.js';
import { getDeviceAutomationIndexState } from '../config/db.js';
import { emit, SocketEvents } from '../sockets/index.js';
import { logger } from '../utils/logger.js';
import { ApiError } from '../utils/ApiError.js';
import { getAdapter } from './devices/index.js';
import { validateAdapterResult, COMMANDABLE_STATES } from './devices/adapter.js';
import { isOverrideActive } from './automationRules.js';
import { normalizeHistoryPaging, parseDateRange } from './occupancyRules.js';

/**
 * Device management and control (Review 3).
 *
 * THIS MODULE IS THE ONLY PLACE IN THE CODEBASE THAT WRITES DEVICE STATE, and
 * that is a design constraint rather than an accident. `issueCommand` below is
 * the single chokepoint through which every command — manual or automated —
 * must pass, which is what makes the following guarantee enforceable in one
 * place instead of at every call site:
 *
 *   A device's reportedState moves, and a DeviceStateHistory row is written
 *   with `confirmed: true`, ONLY WHEN THE ADAPTER RETURNS ok. A failed command
 *   leaves reportedState exactly as it was, records the attempt with
 *   `confirmed: false`, marks the device offline, and raises a
 *   `device_failure` alert.
 *
 * Why that matters past tidiness: DeviceStateHistory is the sole input to the
 * energy analytics. A state change recorded because a command was SENT rather
 * than CONFIRMED becomes fabricated kWh in a report, and a dashboard that says
 * "light off, 0.4 kWh saved" about a light that is still on is worse than no
 * dashboard. The adapter contract is in services/devices/adapter.js.
 *
 * Nothing here knows or cares whether a device is simulated. The `simulated`
 * flag travels from the adapter into the device payload, the state history and
 * the automation log so the UI can label it; the control logic is identical,
 * which is exactly what makes a future real adapter a drop-in.
 */

/**
 * Client-facing shape of a device.
 *
 * `simulated` and `adapterType` ARE ALWAYS PRESENT, with
 * `adapterImplemented` alongside them, so no caller can render a device
 * without knowing whether anything physical is behind it.
 */
export function serializeDevice(device, extra = {}) {
  const override = isOverrideActive(device.override, Date.now());
  return {
    id: device._id?.toString?.() ?? null,
    deviceId: device.deviceId,
    name: device.name,
    roomId: device.roomId,
    type: device.type,
    // 'unknown' until an adapter has confirmed something. Never defaulted to
    // 'off' for display.
    reportedState: device.reportedState ?? 'unknown',
    desiredState: device.desiredState ?? null,
    controlMode: device.controlMode ?? 'disabled',
    adapterType: device.adapterType ?? 'simulation',
    // The two flags the UI needs to label this honestly.
    simulated: device.simulated !== false,
    adapterImplemented: (device.adapterType ?? 'simulation') === 'simulation',
    connectionStatus: device.connectionStatus ?? 'unknown',
    lastCommand: device.lastCommand
      ? {
          state: device.lastCommand.state ?? null,
          issuedAt: device.lastCommand.issuedAt ?? null,
          by: device.lastCommand.by ?? null,
          reason: device.lastCommand.reason ?? null,
          outcome: device.lastCommand.outcome ?? null,
          message: device.lastCommand.message ?? null,
        }
      : null,
    lastSuccessfulStateAt: device.lastSuccessfulStateAt ?? null,
    override: override.active
      ? {
          active: true,
          state: override.state,
          expiresAt: override.expiresAt,
          remainingSec: override.remainingSec,
          actorId: device.override?.actorId ?? null,
          reason: device.override?.reason ?? null,
        }
      : { active: false, state: null, expiresAt: null, remainingSec: 0 },
    // CONFIGURED ESTIMATE, not a measurement — there is no power meter in this
    // project. Carried through so the UI can say so next to any kWh figure.
    powerRatingWatts: device.powerRatingWatts ?? 0,
    powerRatingConfigured: (device.powerRatingWatts ?? 0) > 0,
    active: device.active !== false,
    createdAt: device.createdAt ?? null,
    updatedAt: device.updatedAt ?? null,
    ...extra,
  };
}

/** Resolves a device by business `deviceId` or by Mongo _id. */
export async function findDeviceOrThrow(id) {
  const byDeviceId = await Device.findOne({ deviceId: id });
  if (byDeviceId) return byDeviceId;
  if (/^[a-f\d]{24}$/i.test(String(id))) {
    const byObjectId = await Device.findById(id);
    if (byObjectId) return byObjectId;
  }
  throw ApiError.notFound('Device not found');
}

/** Rejects a roomId that does not resolve to a real Room. */
export async function assertRoomExists(roomId) {
  const room = await Room.findOne({ roomId });
  if (!room) {
    throw ApiError.badRequest(
      `Unknown room '${roomId}'. Create the room under Rooms first — a device in a room ` +
        'that does not exist could never be automated.',
      { unknownRoomId: roomId }
    );
  }
  return room;
}

/** Rejects deviceIds that do not resolve to real Devices. */
export async function assertDevicesExist(deviceIds) {
  const ids = [...new Set((deviceIds || []).filter(Boolean))];
  if (ids.length === 0) return ids;
  const found = await Device.find({ deviceId: { $in: ids } }).select('deviceId');
  const known = new Set(found.map((device) => device.deviceId));
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw ApiError.badRequest(
      `Unknown device ${unknown.length === 1 ? 'ID' : 'IDs'}: ${unknown.join(', ')}.`,
      { unknownDeviceIds: unknown }
    );
  }
  return ids;
}

/**
 * Writes the device-state history row and closes the previous open interval.
 *
 * Closing the previous row is what gives a completed interval its own
 * `durationSec`, so the energy analytics can cross-check the figure it derives
 * from timestamps against a value recorded at the time.
 */
async function recordTransition({
  device,
  fromState,
  toState,
  trigger,
  reason,
  ruleId = null,
  actorId = null,
  confirmed,
  adapterMessage = null,
  at = new Date(),
}) {
  const previous = await DeviceStateHistory.findOne({
    deviceId: device.deviceId,
    confirmed: true,
    durationSec: null,
  }).sort({ changedAt: -1 });

  if (previous && confirmed) {
    const durationSec = Math.max(
      0,
      Math.round((Number(at) - Number(previous.changedAt)) / 1000)
    );
    await DeviceStateHistory.updateOne({ _id: previous._id }, { $set: { durationSec } });
  }

  return DeviceStateHistory.create({
    deviceId: device.deviceId,
    roomId: device.roomId,
    fromState,
    toState,
    changedAt: at,
    trigger,
    reason,
    ruleId,
    actorId,
    // TRUE ONLY WHEN THE ADAPTER ACKNOWLEDGED. Energy maths reads confirmed
    // rows exclusively.
    confirmed,
    adapterMessage,
    durationSec: null,
  });
}

/**
 * Issues one command to one device. THE ONLY PATH TO A DEVICE STATE CHANGE.
 *
 * Sequence, and what is written in each outcome:
 *
 *   1. Validate the requested state and resolve the adapter. An adapter that
 *      is not implemented THROWS here (services/devices/index.js), so a device
 *      configured for hardware that does not exist is refused rather than
 *      silently "controlled".
 *   2. Call adapter.apply(). Its result is validated
 *      (adapter.js → validateAdapterResult): a malformed response, or one that
 *      claims success while reporting a state nobody asked for, is treated as
 *      a FAILURE instead of being coerced into a success.
 *   3a. ok  → reportedState moves, lastSuccessfulStateAt is set,
 *             connectionStatus becomes 'online', a DeviceStateHistory row is
 *             written with confirmed: true, and device:state is emitted.
 *   3b. !ok → REPORTEDSTATE IS LEFT UNTOUCHED. lastCommand.outcome becomes
 *             'failed', connectionStatus becomes 'offline', a history row is
 *             written with confirmed: false, an AutomationLog row is written
 *             with decision 'command_failed', and a `device_failure` Alert is
 *             raised. The system says the command failed; it never says the
 *             device changed.
 *
 * @returns {{ ok, device, reportedState, message, simulated, alertRaised }}
 */
async function issueCommandUnguarded({
  device,
  state,
  trigger = 'manual',
  actorId = null,
  reason = '',
  ruleId = null,
}) {
  if (!COMMANDABLE_STATES.includes(state)) {
    throw ApiError.badRequest(`state must be one of: ${COMMANDABLE_STATES.join(', ')}`);
  }

  // Device/automation WRITES require the verified unique indexes (see
  // config/db.js). Without them a concurrent command pair can duplicate a
  // device record, after which two "current states" exist for one physical
  // device. Refusing is the honest failure mode.
  const indexState = getDeviceAutomationIndexState();
  if (!indexState.verified) {
    throw ApiError.internal(
      'Device control is disabled because the device/automation indexes are unverified ' +
        `(${indexState.error || 'see the startup log'}). No command was sent.`
    );
  }

  // Throws for any adapter type other than 'simulation'. Deliberate: see
  // services/devices/index.js for why a fallback would be worse.
  const adapter = getAdapter(device.adapterType);

  const now = new Date();
  const previousState = device.reportedState ?? 'unknown';

  let result;
  try {
    result = await adapter.apply(device, state, {
      trigger,
      reason,
      ruleId,
      actorId,
      timeoutSec: env.devices.commandTimeoutSec,
    });
  } catch (err) {
    // An adapter that throws is a failed command, not a crashed backend.
    result = {
      ok: false,
      reportedState: 'unknown',
      message: `Adapter error: ${err.message}`,
      simulated: Boolean(device.simulated),
    };
  }

  const validity = validateAdapterResult(result, state);
  if (!validity.valid) {
    result = {
      ok: false,
      reportedState: 'unknown',
      message: `Adapter response rejected: ${validity.problem}.`,
      simulated: Boolean(result?.simulated ?? device.simulated),
    };
  }

  device.desiredState = state;
  device.lastCommand = {
    state,
    issuedAt: now,
    by: actorId || trigger,
    reason: reason || null,
    outcome: result.ok ? 'applied' : 'failed',
    message: result.message ?? null,
  };

  // ── Failure path: claim nothing ──────────────────────────────
  if (!result.ok) {
    device.connectionStatus = 'offline';
    // reportedState is NOT touched. The device is wherever it actually was.
    await device.save();

    await recordTransition({
      device,
      fromState: previousState,
      // Recorded as the attempted state with confirmed:false — it is an
      // attempt, not a transition, and the energy maths excludes it.
      toState: previousState,
      trigger,
      reason: `Command to turn ${state} FAILED: ${result.message}`,
      ruleId,
      actorId,
      confirmed: false,
      adapterMessage: result.message ?? null,
      at: now,
    });

    await AutomationLog.create({
      ruleId,
      roomId: device.roomId,
      deviceId: device.deviceId,
      decision: 'command_failed',
      reason:
        `Command to turn ${device.deviceId} ${state} was not confirmed by its adapter, ` +
        `so the device state was left unchanged (still '${previousState}').`,
      occupancyCount: null,
      occupancyStatus: null,
      outcome: 'failed',
      adapterMessage: result.message ?? null,
      evaluatedAt: now,
    });

    let alertRaised = false;
    try {
      // PER-CONDITION COOLDOWN. A device whose adapter keeps refusing is
      // re-commanded on every engine tick, and one ongoing fault must not
      // produce one alert per tick. The failure itself is already recorded in
      // full above (a DeviceStateHistory row with confirmed:false and an
      // AutomationLog 'command_failed' row), so suppressing the duplicate
      // ALERT loses no information — it only stops the operator's alert list
      // being buried by a single broken device.
      const cooldownSec = env.devices.failureAlertCooldownSec;
      const recent =
        cooldownSec > 0
          ? await Alert.findOne({
              type: 'device_failure',
              deviceId: device.deviceId,
              timestamp: { $gte: new Date(Number(now) - cooldownSec * 1000) },
            }).select('_id timestamp')
          : null;

      if (recent) {
        logger.debug(
          `device_failure alert for ${device.deviceId} suppressed: one was raised ` +
            `${Math.round((Number(now) - Number(recent.timestamp)) / 1000)}s ago, inside the ` +
            `${cooldownSec}s cooldown. The failure is still in the device history.`
        );
      } else {
        const alert = await Alert.create({
          type: 'device_failure',
          // 'warning': a device that did not switch is an operational fault
          // needing attention, not a security incident.
          severity: 'warning',
          roomId: device.roomId,
          deviceId: device.deviceId,
          message:
            `${device.name} (${device.deviceId}) did not confirm a '${state}' command. ` +
            `Its state is unchanged (${previousState}). ${result.message ?? ''}`.trim(),
          status: 'new',
          timestamp: now,
        });
        emit(SocketEvents.ALERT_NEW, {
          id: alert._id.toString(),
          type: alert.type,
          severity: alert.severity,
          roomId: device.roomId,
          deviceId: device.deviceId,
          message: alert.message,
          status: alert.status,
          timestamp: alert.timestamp,
        });
        alertRaised = true;
      }
    } catch (err) {
      logger.error(`Could not raise device_failure alert for ${device.deviceId}`, err.message);
    }

    emit(SocketEvents.DEVICE_STATE, serializeDevice(device, { commandFailed: true }));
    logger.warn(
      `Device ${device.deviceId}: '${state}' command NOT confirmed — state left as ` +
        `'${previousState}'. ${result.message ?? ''}`
    );

    return {
      ok: false,
      device,
      reportedState: previousState,
      message: result.message ?? 'The adapter did not confirm the command.',
      simulated: Boolean(result.simulated),
      alertRaised,
    };
  }

  // ── Success path: the adapter confirmed it ───────────────────
  const changed = previousState !== result.reportedState;
  device.reportedState = result.reportedState;
  device.lastSuccessfulStateAt = now;
  device.connectionStatus = 'online';
  device.simulated = Boolean(result.simulated);
  await device.save();

  if (changed) {
    await recordTransition({
      device,
      fromState: previousState,
      toState: result.reportedState,
      trigger,
      reason: reason || `Switched ${result.reportedState} via ${trigger}.`,
      ruleId,
      actorId,
      confirmed: true,
      adapterMessage: result.message ?? null,
      at: now,
    });
  }

  emit(SocketEvents.DEVICE_STATE, serializeDevice(device, { stateChanged: changed }));
  logger.info(
    `Device ${device.deviceId} confirmed '${result.reportedState}' (${trigger})` +
      `${result.simulated ? ' [SIMULATED]' : ''}.`
  );

  return {
    ok: true,
    device,
    reportedState: result.reportedState,
    message: result.message ?? null,
    simulated: Boolean(result.simulated),
    stateChanged: changed,
    alertRaised: false,
  };
}

/**
 * Commands in flight, keyed by deviceId.
 *
 * WHY THIS EXISTS — a real race, found in the Review 3 reliability audit.
 * `issueCommand` is reached from THREE concurrent paths:
 *
 *   • POST /api/devices/:id/command (an operator, any number of clicks);
 *   • automationEngine.onOccupancyUpdated(), called on every accepted
 *     occupancy report — and two cameras in one room report independently, so
 *     two HTTP ingests can be in flight at once;
 *   • automationEngine.runTick(), whose `tickRunning` flag stops two TICKS
 *     overlapping but does nothing about a tick overlapping an occupancy
 *     event.
 *
 * Node is single-threaded, but every step in here awaits — the adapter call,
 * `device.save()`, the history write — so two commands for the SAME device can
 * interleave at any of those points. The consequences are not cosmetic: both
 * would read the same `previousState`, both would write a DeviceStateHistory
 * row, and the energy arithmetic reads those rows as the state timeline. Two
 * rows claiming the same transition at nearly the same instant produce an
 * on-interval that never happened.
 *
 * So the SECOND command for a device already being commanded is REFUSED, not
 * queued. Refusing is correct rather than merely simpler: the first command is
 * about to make the device's state current, and the right answer for the
 * duplicate is "ask again in a moment", which is exactly what the automation
 * tick and the operator both do anyway.
 *
 * The set is bounded by the number of concurrent commands (a handful) and is
 * always cleared in a `finally`, so a throwing adapter cannot leak an entry
 * and wedge a device permanently.
 */
const inFlightCommands = new Set();

/** Read-only view of the in-flight guard, for the health panel and tests. */
export function inFlightCommandCount() {
  return inFlightCommands.size;
}

/**
 * Issues a device command, serialised per device.
 *
 * Thin guard around `issueCommandUnguarded` — see the note on
 * `inFlightCommands` above for why. A refusal comes back with
 * `ok: false, inFlight: true` and NO device_failure alert and NO history row,
 * because nothing failed: the command was simply not attempted, and the
 * device's state is whatever the in-flight command is about to make it.
 */
export async function issueCommand(args) {
  const deviceId = args?.device?.deviceId;

  if (deviceId && inFlightCommands.has(deviceId)) {
    const message =
      `A command for ${deviceId} is already in flight, so this one was not attempted. ` +
      'The device state is unchanged by this call.';
    logger.debug(message);
    return {
      ok: false,
      inFlight: true,
      device: args.device,
      reportedState: args.device?.reportedState ?? 'unknown',
      message,
      simulated: Boolean(args.device?.simulated),
      alertRaised: false,
    };
  }

  if (deviceId) inFlightCommands.add(deviceId);
  try {
    return await issueCommandUnguarded(args);
  } finally {
    // Always, even if the adapter threw or the index check refused — a leaked
    // entry would wedge the device until the process restarted.
    if (deviceId) inFlightCommands.delete(deviceId);
  }
}

/**
 * Probes a device and syncs its reported state from the adapter.
 *
 * Used by the device detail view and by the health panel. A probe that fails
 * marks the device offline and LEAVES reportedState as it was — the same rule
 * as a failed command. A confirmed state change found by a probe is recorded
 * with trigger 'adapter_sync', so a device switched outside the system still
 * produces an accurate on-interval for the energy maths.
 */
export async function syncDeviceState(device) {
  const adapter = getAdapter(device.adapterType);
  const previousState = device.reportedState ?? 'unknown';

  let result;
  try {
    result = await adapter.probe(device);
  } catch (err) {
    result = {
      ok: false,
      reportedState: 'unknown',
      connectionStatus: 'offline',
      message: `Adapter error: ${err.message}`,
      simulated: Boolean(device.simulated),
    };
  }

  if (!result?.ok) {
    device.connectionStatus = 'offline';
    await device.save();
    return { ok: false, device, message: result?.message ?? 'Probe failed.' };
  }

  device.connectionStatus = result.connectionStatus ?? 'online';
  device.simulated = Boolean(result.simulated);

  if (result.reportedState !== previousState) {
    device.reportedState = result.reportedState;
    device.lastSuccessfulStateAt = new Date();
    await device.save();
    await recordTransition({
      device,
      fromState: previousState,
      toState: result.reportedState,
      trigger: 'adapter_sync',
      reason: 'State read back from the adapter during a probe.',
      confirmed: true,
      adapterMessage: result.message ?? null,
    });
    emit(SocketEvents.DEVICE_STATE, serializeDevice(device, { stateChanged: true }));
  } else {
    await device.save();
  }

  return { ok: true, device, message: result.message ?? null };
}

/**
 * Moves a device between control modes.
 *
 * SAFE TRANSITIONS, and what each one means:
 *   → 'disabled'  automation and manual control both stop. The device is left
 *                 in whatever state it is actually in; nothing is switched as
 *                 a side effect of changing a mode, because an operator
 *                 disabling automation has not asked for the lights to change.
 *   → 'manual'    automation stops; the operator drives it. Any override is
 *                 cleared, because an override only exists to protect an
 *                 operator action FROM automation, and in manual mode there is
 *                 no automation to protect it from.
 *   → 'automatic' automation may act from the next evaluation. An existing
 *                 unexpired override is KEPT, so switching a device back to
 *                 automatic does not instantly undo a deliberate override.
 */
export async function setControlMode({ device, controlMode, actorId = null }) {
  const allowed = ['automatic', 'manual', 'disabled'];
  if (!allowed.includes(controlMode)) {
    throw ApiError.badRequest(`controlMode must be one of: ${allowed.join(', ')}`);
  }

  const previous = device.controlMode;
  device.controlMode = controlMode;

  if (controlMode === 'manual') {
    device.override = {
      state: null,
      setAt: null,
      expiresAt: null,
      actorId: null,
      reason: null,
    };
  }

  await device.save();
  logger.info(
    `Device ${device.deviceId} control mode ${previous} → ${controlMode}` +
      `${actorId ? ` by ${actorId}` : ''}. No device state was changed.`
  );
  emit(SocketEvents.DEVICE_STATE, serializeDevice(device, { controlModeChanged: true }));
  return device;
}

/**
 * Records a manual override and issues the operator's command.
 *
 * THE OVERRIDE IS WHAT STOPS AUTOMATION IMMEDIATELY UNDOING THE OPERATOR. An
 * operator who turns a light on in a room the occupancy figure thinks is empty
 * would otherwise have it switched off again on the very next evaluation.
 * While the override is unexpired, decideDeviceAction returns
 * 'skipped_override' and issues nothing.
 *
 * IT ALWAYS HAS AN EXPLICIT EXPIRY. A device stuck in override forever because
 * somebody forgot to clear it is its own failure, so `minutes` (defaulting to
 * env.automation.manualOverrideMinutes) is written into `expiresAt` and
 * automatic control resumes by itself. `clearOverride` returns to automatic
 * immediately.
 *
 * The command is issued through issueCommand, so the same confirm-before-
 * recording rule applies: a manual command the adapter refuses leaves the
 * device state untouched and raises a device_failure alert, and the override
 * is still recorded (the operator's intent stands even though the hardware
 * did not comply).
 */
export async function setManualOverride({
  device,
  state,
  minutes = null,
  actorId = null,
  reason = '',
}) {
  if (!COMMANDABLE_STATES.includes(state)) {
    throw ApiError.badRequest(`state must be one of: ${COMMANDABLE_STATES.join(', ')}`);
  }

  const ttlMinutes = Number.isFinite(Number(minutes)) && Number(minutes) > 0
    ? Number(minutes)
    : env.automation.manualOverrideMinutes;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000);

  device.override = {
    state,
    setAt: now,
    expiresAt,
    actorId,
    reason: reason || 'Manual override',
  };

  const result = await issueCommand({
    device,
    state,
    trigger: 'manual',
    actorId,
    reason:
      reason ||
      `Manual override: hold ${state} until ${expiresAt.toISOString()} (${ttlMinutes} min).`,
  });

  // issueCommand saved the device; persist the override alongside it.
  await Device.updateOne({ _id: device._id }, { $set: { override: device.override } });

  return {
    ...result,
    override: {
      active: true,
      state,
      expiresAt,
      remainingSec: ttlMinutes * 60,
      reason: device.override.reason,
    },
  };
}

/**
 * Clears a manual override, returning the device to automatic control.
 *
 * Deliberately does NOT switch anything. The device stays where the operator
 * left it until the next automation evaluation decides otherwise on the
 * strength of a usable occupancy figure — which is the same bar every other
 * switching decision has to clear.
 */
export async function clearOverride({ device, actorId = null }) {
  device.override = { state: null, setAt: null, expiresAt: null, actorId: null, reason: null };
  await device.save();
  logger.info(
    `Override cleared on ${device.deviceId}${actorId ? ` by ${actorId}` : ''}. ` +
      'Automatic control resumes at the next evaluation; nothing was switched now.'
  );
  emit(SocketEvents.DEVICE_STATE, serializeDevice(device, { overrideCleared: true }));
  return device;
}

/** Paginated device list with a hard cap. */
export async function listDevices({ roomId, type, controlMode, active, limit, page } = {}) {
  const paging = normalizeHistoryPaging({ limit, page, maxLimit: 200 });

  const filter = {};
  if (typeof roomId === 'string' && roomId.trim()) filter.roomId = roomId.trim();
  if (type === 'light' || type === 'fan') filter.type = type;
  if (['automatic', 'manual', 'disabled'].includes(controlMode)) filter.controlMode = controlMode;
  if (active === 'true') filter.active = true;
  else if (active === 'false') filter.active = false;

  const [devices, total] = await Promise.all([
    Device.find(filter).sort({ roomId: 1, name: 1 }).skip(paging.skip).limit(paging.perPage),
    Device.countDocuments(filter),
  ]);

  return {
    items: devices.map((device) => serializeDevice(device)),
    total,
    page: paging.page,
    perPage: paging.perPage,
    // Carried so the UI can state plainly that these are simulated devices.
    simulatedCount: devices.filter((device) => device.simulated !== false).length,
  };
}

/**
 * Paginated device action history: state transitions AND failed attempts.
 *
 * Failed attempts are included on purpose — "this device has refused three
 * commands in a row" is the most useful thing this view can tell an operator —
 * and each row carries `confirmed` so a failure is never mistaken for a state
 * change.
 */
export async function listDeviceHistory({ deviceId, roomId, from, to, limit, page } = {}) {
  const paging = normalizeHistoryPaging({
    limit,
    page,
    maxLimit: env.energy.historyMaxLimit,
  });

  const filter = {};
  if (typeof deviceId === 'string' && deviceId.trim()) filter.deviceId = deviceId.trim();
  if (typeof roomId === 'string' && roomId.trim()) filter.roomId = roomId.trim();
  const range = parseDateRange({ from, to });
  if (range) filter.changedAt = range;

  const [rows, total] = await Promise.all([
    DeviceStateHistory.find(filter)
      .sort({ changedAt: -1 })
      .skip(paging.skip)
      .limit(paging.perPage),
    DeviceStateHistory.countDocuments(filter),
  ]);

  return {
    items: rows.map((row) => ({
      id: row._id.toString(),
      deviceId: row.deviceId,
      roomId: row.roomId ?? null,
      fromState: row.fromState,
      toState: row.toState,
      changedAt: row.changedAt,
      trigger: row.trigger,
      reason: row.reason,
      ruleId: row.ruleId ?? null,
      actorId: row.actorId ?? null,
      // false = the command was attempted and NOT confirmed. Excluded from
      // every energy calculation.
      confirmed: row.confirmed,
      adapterMessage: row.adapterMessage ?? null,
      durationSec: row.durationSec ?? null,
    })),
    total,
    page: paging.page,
    perPage: paging.perPage,
  };
}

/**
 * Device-side health for the service-health panel.
 *
 * Reports what is actually known: how many devices have never been confirmed
 * in any state, how many are offline, and how many are simulated. A green tick
 * here means "the backend can reach its adapters", NOT "the lights are wired
 * up".
 */
export async function deviceHealth() {
  const devices = await Device.find({ active: true }).select(
    'deviceId reportedState connectionStatus controlMode simulated adapterType'
  );
  return {
    total: devices.length,
    unknownState: devices.filter((d) => (d.reportedState ?? 'unknown') === 'unknown').length,
    offline: devices.filter((d) => d.connectionStatus === 'offline').length,
    automatic: devices.filter((d) => d.controlMode === 'automatic').length,
    simulated: devices.filter((d) => d.simulated !== false).length,
    // Plain statement rather than a status colour.
    note:
      'Only the simulation adapter is implemented in this project. A reachable adapter ' +
      'does not mean physical hardware is connected.',
  };
}
