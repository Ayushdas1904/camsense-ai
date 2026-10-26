import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { Device } from '../models/Device.js';
import { AutomationRule } from '../models/AutomationRule.js';
import { logger } from '../utils/logger.js';
import {
  assertRoomExists,
  clearOverride,
  findDeviceOrThrow,
  issueCommand,
  listDeviceHistory,
  listDevices,
  serializeDevice,
  setControlMode,
  setManualOverride,
  syncDeviceState,
} from '../services/deviceService.js';
import { ADAPTER_TYPES } from '../services/devices/adapter.js';
import { adapterHealth } from '../services/devices/index.js';

/**
 * Device management and manual control (Review 3).
 *
 * AUTHORIZATION POLICY — the same shape Review 2 used for people and Review 3
 * used for rooms, with one tightening:
 *   Reads require requireAuth only.
 *   EVERY MUTATION requires requireRole('admin') as well — including
 *   POST /:id/command. Issuing a command is not an administrative convenience,
 *   it is the act of switching something; a viewer who could turn the lights
 *   off in an occupied room would make the role distinction meaningless.
 *   Registering a device, changing its power rating (which changes every
 *   energy figure), changing its control mode and deleting it are all
 *   admin-only for the same reason.
 *
 * SIMULATION IS DISCLOSED IN EVERY RESPONSE. serializeDevice always carries
 * `simulated` and `adapterType`, and `GET /api/devices/adapters` states
 * plainly which adapters are implemented. A device configured for the
 * unimplemented 'http' adapter is accepted into the database (so the
 * configuration can be prepared) but any command to it is REFUSED with a clear
 * error rather than silently simulated.
 */

export const deviceSchema = z.object({
  deviceId: z.string().min(1, 'Device ID is required').max(40),
  name: z.string().min(1, 'Name is required').max(80),
  roomId: z.string().min(1, 'Room ID is required').max(40),
  type: z.enum(['light', 'fan']),
  // 'disabled' by default: automation is opt-in per device.
  controlMode: z.enum(['automatic', 'manual', 'disabled']).optional().default('disabled'),
  adapterType: z.enum(['simulation', 'http']).optional().default('simulation'),
  // A CONFIGURED ESTIMATE used for energy arithmetic, not a measurement.
  // 0 (the default) means "not configured" and the device then contributes no
  // energy figure rather than a guessed one.
  powerRatingWatts: z.number().min(0).max(10000).optional().default(0),
  active: z.boolean().optional().default(true),
});

export const deviceUpdateSchema = deviceSchema.partial().omit({ deviceId: true });

export const commandSchema = z.object({
  state: z.enum(['on', 'off']),
  // A manual command WITHOUT an override just switches the device; automation
  // may change it again at the next evaluation. With `override: true` the
  // operator's choice is protected for `overrideMinutes`.
  override: z.boolean().optional().default(true),
  overrideMinutes: z.number().int().min(1).max(1440).optional(),
  reason: z.string().max(300).optional().default(''),
});

export const controlModeSchema = z.object({
  controlMode: z.enum(['automatic', 'manual', 'disabled']),
});

export const listDevicesHandler = asyncHandler(async (req, res) => {
  const { roomId, type, controlMode, active, limit, page } = req.query;
  const result = await listDevices({
    roomId: typeof roomId === 'string' ? roomId : undefined,
    type: typeof type === 'string' ? type : undefined,
    controlMode: typeof controlMode === 'string' ? controlMode : undefined,
    active: typeof active === 'string' ? active : undefined,
    limit,
    page,
  });
  res.json({ success: true, data: result });
});

export const getDevice = asyncHandler(async (req, res) => {
  const device = await findDeviceOrThrow(req.params.id);
  // Which rules act on this device — an operator asking "why did this switch?"
  // should not have to cross-reference the rules list by hand.
  const rules = await AutomationRule.find({ deviceIds: device.deviceId }).select(
    'ruleId name enabled roomId'
  );
  res.json({
    success: true,
    data: serializeDevice(device, {
      rules: rules.map((rule) => ({
        ruleId: rule.ruleId,
        name: rule.name,
        enabled: rule.enabled,
        roomId: rule.roomId,
      })),
    }),
  });
});

export const createDevice = asyncHandler(async (req, res) => {
  const exists = await Device.findOne({ deviceId: req.body.deviceId });
  if (exists) throw ApiError.conflict('A device with that ID already exists');

  await assertRoomExists(req.body.roomId);

  const adapterType = req.body.adapterType ?? 'simulation';
  const device = await Device.create({
    ...req.body,
    // Derived from the adapter, never taken from the client: a caller must not
    // be able to mark a simulated device as real hardware.
    simulated: ADAPTER_TYPES[adapterType]?.simulated ?? true,
    // Honest initial values — nothing has been confirmed yet.
    reportedState: 'unknown',
    desiredState: null,
    connectionStatus: 'unknown',
  });

  logger.info(
    `Device ${device.deviceId} (${device.type}) registered in ${device.roomId}, ` +
      `adapter '${device.adapterType}'${device.simulated ? ' [SIMULATED]' : ''}, ` +
      `control mode '${device.controlMode}'.`
  );

  res.status(201).json({
    success: true,
    data: serializeDevice(device, {
      note:
        device.adapterType === 'simulation'
          ? 'This device is SIMULATED — no physical hardware is controlled.'
          : `The '${device.adapterType}' adapter is not implemented, so commands to this ` +
            'device will be refused.',
    }),
  });
});

export const updateDevice = asyncHandler(async (req, res) => {
  const device = await findDeviceOrThrow(req.params.id);

  if (req.body.roomId && req.body.roomId !== device.roomId) {
    await assertRoomExists(req.body.roomId);
  }

  // controlMode goes through the service so the safe-transition rules apply
  // (clearing an override on the way into manual, keeping it on the way into
  // automatic) rather than being assigned raw.
  //
  // Undefined values are stripped before the assign: a partial zod schema can
  // hand back an explicitly-undefined key for a field the caller omitted, and
  // assigning that would clear a required field (name) or a power rating that
  // every energy figure depends on.
  const { controlMode, ...rest } = req.body;
  for (const [key, value] of Object.entries(rest)) {
    if (value === undefined) delete rest[key];
  }
  Object.assign(device, rest);
  if (req.body.adapterType) {
    device.simulated = ADAPTER_TYPES[req.body.adapterType]?.simulated ?? true;
  }
  await device.save();

  if (controlMode && controlMode !== device.controlMode) {
    await setControlMode({ device, controlMode, actorId: req.user?.id ?? null });
  }

  res.json({ success: true, data: serializeDevice(device) });
});

/**
 * Delete or deactivate a device.
 *
 * `?deactivate=true` is a SOFT delete: the device stops being automated and
 * stops appearing in the active list, but its state history — and therefore
 * the energy figures already derived from it — stay intact.
 *
 * A hard delete removes the device record and detaches it from every
 * automation rule, but DELIBERATELY RETAINS its DeviceStateHistory. Deleting a
 * device is a configuration change and must not silently rewrite past energy
 * reports.
 */
export const deleteDevice = asyncHandler(async (req, res) => {
  const device = await findDeviceOrThrow(req.params.id);
  const deactivateOnly = String(req.query.deactivate || '').toLowerCase() === 'true';

  if (deactivateOnly) {
    device.active = false;
    device.controlMode = 'disabled';
    await device.save();
    res.json({
      success: true,
      data: { deviceId: device.deviceId, deactivated: true, device: serializeDevice(device) },
    });
    return;
  }

  await device.deleteOne();
  // Detach from any rule so a rule cannot reference a device that is gone.
  const detached = await AutomationRule.updateMany(
    { deviceIds: device.deviceId },
    { $pull: { deviceIds: device.deviceId } }
  );

  logger.info(
    `Device ${device.deviceId} deleted and removed from ${detached.modifiedCount} rule(s). ` +
      'Its state history was RETAINED so past energy figures stay reproducible.'
  );

  res.json({
    success: true,
    data: {
      deviceId: device.deviceId,
      deactivated: false,
      historyRetained: true,
      rulesUpdated: detached.modifiedCount,
    },
  });
});

/**
 * POST /api/devices/:id/command — a MANUAL on/off command.
 *
 * Admin-only, and routed through deviceService so the same guarantee holds as
 * for an automated command: the device's reported state only moves if the
 * adapter confirms it, and a refusal raises a device_failure alert instead of
 * reporting a change that did not happen.
 *
 * By default the command also records a MANUAL OVERRIDE with an explicit
 * expiry, so automation does not immediately undo the operator's action. Pass
 * `override: false` for a one-off nudge that automation may correct at its
 * next evaluation.
 */
export const sendCommand = asyncHandler(async (req, res) => {
  const device = await findDeviceOrThrow(req.params.id);
  const { state, override, overrideMinutes, reason } = req.body;
  const actorId = req.user?._id?.toString?.() ?? null;

  const result = override
    ? await setManualOverride({
        device,
        state,
        minutes: overrideMinutes,
        actorId,
        reason,
      })
    : await issueCommand({
        device,
        state,
        trigger: 'manual',
        actorId,
        reason: reason || 'Manual command (no override).',
      });

  // A failed command is reported as a failure with HTTP 502, not as a success
  // with a quiet flag — the operator must not read it as "done". A command
  // refused because another one is already in flight for the same device is a
  // CONFLICT (409), not an adapter failure: nothing was attempted and nothing
  // broke, so trying again in a moment is the right advice.
  const status = result.ok ? 200 : result.inFlight ? 409 : 502;
  res.status(status).json({
    success: result.ok,
    data: {
      ok: result.ok,
      deviceId: device.deviceId,
      requestedState: state,
      // On failure this is the UNCHANGED previous state.
      reportedState: result.reportedState,
      simulated: result.simulated,
      message: result.message,
      override: result.override ?? null,
      device: serializeDevice(device),
    },
    ...(result.ok
      ? {}
      : {
          error: {
            message:
              result.message ||
              'The device adapter did not confirm the command, so the device state was ' +
                'left unchanged.',
          },
        }),
  });
});

/** POST /api/devices/:id/control-mode — switch between automatic/manual/disabled. */
export const changeControlMode = asyncHandler(async (req, res) => {
  const device = await findDeviceOrThrow(req.params.id);
  await setControlMode({
    device,
    controlMode: req.body.controlMode,
    actorId: req.user?._id?.toString?.() ?? null,
  });
  res.json({ success: true, data: serializeDevice(device) });
});

/**
 * DELETE /api/devices/:id/override — return to automatic control.
 *
 * Switches nothing. The device stays where the operator left it until
 * automation decides otherwise on the strength of a usable occupancy figure.
 */
export const removeOverride = asyncHandler(async (req, res) => {
  const device = await findDeviceOrThrow(req.params.id);
  await clearOverride({ device, actorId: req.user?._id?.toString?.() ?? null });
  res.json({
    success: true,
    data: {
      device: serializeDevice(device),
      note:
        'The override was cleared. Nothing was switched now — automatic control resumes ' +
        'at the next evaluation, which still requires a usable occupancy figure.',
    },
  });
});

/** POST /api/devices/:id/probe — read the adapter's view of the device. */
export const probeDevice = asyncHandler(async (req, res) => {
  const device = await findDeviceOrThrow(req.params.id);
  const result = await syncDeviceState(device);
  res.json({
    success: result.ok,
    data: { ok: result.ok, message: result.message, device: serializeDevice(device) },
  });
});

/** GET /api/devices/:id/history — paginated, hard-capped action history. */
export const getDeviceHistory = asyncHandler(async (req, res) => {
  const device = await findDeviceOrThrow(req.params.id);
  const { from, to, limit, page } = req.query;
  const result = await listDeviceHistory({
    deviceId: device.deviceId,
    from,
    to,
    limit,
    page,
  });
  res.json({ success: true, data: result });
});

/**
 * GET /api/devices/adapters — which adapters exist and which actually work.
 *
 * Exists so the UI never has to assume. It states that only the simulation
 * adapter is implemented, rather than offering a device-type dropdown that
 * implies hardware support this project does not have.
 */
export const getAdapters = asyncHandler(async (_req, res) => {
  res.json({
    success: true,
    data: {
      ...adapterHealth(),
      note:
        'Only the simulation adapter is implemented in this project. There is no MQTT, ' +
        'ESP32 or relay-board integration; a device configured for another adapter type ' +
        'will have its commands refused rather than silently simulated.',
    },
  });
});
