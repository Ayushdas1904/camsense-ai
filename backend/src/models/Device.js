import mongoose from 'mongoose';

/**
 * Device — a controllable light or fan attached to a monitored room (Review 3).
 *
 * THREE FIELDS CARRY THE HONESTY OF THIS WHOLE FEATURE, so they are spelled
 * out before the schema:
 *
 *   reportedState  — what the ADAPTER last CONFIRMED. Its initial value is
 *                    'unknown', deliberately NOT 'off'. A device the system
 *                    has never spoken to has an unknown state; claiming it is
 *                    off would be a fabricated reading, and the energy
 *                    arithmetic downstream would silently treat it as a
 *                    measured off-interval. It only ever moves to 'on'/'off'
 *                    when an adapter call returns ok (see
 *                    services/deviceService.js → issueCommand).
 *
 *   desiredState   — what the system WANTS. Nullable, because "no command has
 *                    been issued" is a real state and must not be confused
 *                    with "we want it off".
 *
 *   controlMode    — DEFAULTS TO 'disabled'. Automation does nothing to a
 *                    device until an administrator explicitly moves it to
 *                    'automatic'. Combined with AutomationRule.enabled
 *                    defaulting to false, nothing in this project switches
 *                    anything until a human has opted in twice.
 *
 * SIMULATION IS NEVER HIDDEN: `adapterType` and `simulated` are part of every
 * serialized payload (services/deviceService.js → serializeDevice) so the UI
 * can label a simulated device as simulated. Only the 'simulation' adapter is
 * implemented in this repository; 'http' is declared as the documented
 * extension point and services/devices/index.js THROWS for it rather than
 * pretending to control hardware. No MQTT/ESP32/relay integration exists here.
 */
const deviceSchema = new mongoose.Schema(
  {
    // Human-readable business key, matching how Camera/Room are referenced
    // elsewhere (cameraId, roomId) rather than by ObjectId.
    deviceId: { type: String, required: true, unique: true, trim: true, index: true },
    name: { type: String, required: true, trim: true },
    // Room.roomId. Validated against a real Room by the controller — a device
    // in a room that does not exist could never be automated.
    roomId: { type: String, required: true, trim: true, index: true },
    type: { type: String, enum: ['light', 'fan'], required: true },

    // ── State ────────────────────────────────────────────────────
    // 'unknown' is the honest initial value. See the note above.
    reportedState: {
      type: String,
      enum: ['on', 'off', 'unknown'],
      default: 'unknown',
      index: true,
    },
    // null means "no command has ever been issued", which is not "off".
    // `null` is listed in the enum so mongoose accepts it explicitly.
    desiredState: { type: String, enum: ['on', 'off', null], default: null },

    // ── Control ──────────────────────────────────────────────────
    // 'disabled' by DEFAULT: automation is opt-in, per device.
    controlMode: {
      type: String,
      enum: ['automatic', 'manual', 'disabled'],
      default: 'disabled',
      index: true,
    },
    // Only 'simulation' is implemented. 'http' exists so a real integration
    // can be added later without reworking the automation engine; getAdapter
    // throws a clear not-implemented error for it today.
    adapterType: { type: String, enum: ['simulation', 'http'], default: 'simulation' },
    // Surfaced in every API payload so simulated devices are visibly labelled
    // and never presented as physical hardware.
    simulated: { type: Boolean, default: true },
    connectionStatus: {
      type: String,
      enum: ['online', 'offline', 'unknown'],
      default: 'unknown',
    },

    // ── Last command, successful or not ──────────────────────────
    // `outcome: 'failed'` with reportedState left untouched is the normal
    // record of a command the adapter did not confirm.
    lastCommand: {
      state: { type: String, enum: ['on', 'off', null], default: null },
      issuedAt: { type: Date, default: null },
      // 'automation' | 'manual' | 'adapter_sync' | 'startup', or a user id.
      by: { type: String, default: null },
      reason: { type: String, default: null },
      outcome: { type: String, enum: ['applied', 'failed', 'not_applicable', null], default: null },
      message: { type: String, default: null },
    },
    // Last time the adapter CONFIRMED a state. Stays null until it does.
    lastSuccessfulStateAt: { type: Date, default: null },

    // ── Manual override ─────────────────────────────────────────
    // An operator action that automation must not immediately undo. It has an
    // EXPLICIT expiry so control returns to automatic by itself rather than
    // leaving a device stuck in manual forever; clearing it early is also
    // supported (deviceService.clearOverride).
    override: {
      state: { type: String, enum: ['on', 'off', null], default: null },
      setAt: { type: Date, default: null },
      expiresAt: { type: Date, default: null },
      actorId: { type: String, default: null },
      reason: { type: String, default: null },
    },

    // ── Energy ──────────────────────────────────────────────────
    // CONFIGURED ESTIMATE, NOT A MEASUREMENT. This project has no power meter.
    // Every kWh figure in the energy analytics is this number multiplied by a
    // measured on-duration, which makes the result an estimate derived from an
    // operator-supplied rating. Every energy response is labelled
    // `estimated: true` for exactly this reason. 0 (the default) means "not
    // configured", and such a device contributes nothing rather than a guess.
    powerRatingWatts: { type: Number, min: 0, default: 0 },

    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Supports "which devices does this room's automation control?", the lookup
// the automation engine performs on every occupancy update.
deviceSchema.index({ roomId: 1, active: 1 });

export const Device = mongoose.model('Device', deviceSchema);
