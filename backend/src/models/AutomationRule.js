import mongoose from 'mongoose';

/**
 * AutomationRule — one occupancy-driven switching policy (Review 3).
 *
 * `enabled` DEFAULTS TO FALSE. Together with Device.controlMode defaulting to
 * 'disabled', that means a freshly seeded system switches nothing: an
 * administrator must enable the rule AND put the device into 'automatic'
 * before any command is ever issued. Automation that turns itself on is not
 * something an academic demo — or anything else — should ship.
 *
 * THE SAFETY FIELD IS `onUnavailableOccupancy`, DEFAULT 'suspend':
 *
 *   'suspend'      — when the occupancy figure is unavailable or stale, the
 *                    rule issues NO command and records 'skipped_stale_data'.
 *                    This is the correct default and the behaviour the project
 *                    requires: absent data is NOT evidence that a room is
 *                    empty, and switching the lights off on a room full of
 *                    people because a camera went dark is the exact failure
 *                    being guarded against.
 *
 *   'leave_as_is'  — an EXPLICITLY CONFIGURED SAFETY POLICY the operator opted
 *                    into. It also issues no switching command; it exists as a
 *                    separate value so the intent is recorded in the rule
 *                    rather than inferred. ANY value other than 'suspend' is a
 *                    deliberate operator decision that must be documented
 *                    alongside the deployment — the engine never silently
 *                    chooses it.
 *
 * DELAYS AND COOLDOWNS, and what each one is for:
 *   occupancyThreshold  — count at or below which the room counts as empty for
 *                         switching purposes; above it the room is occupied.
 *   unoccupiedForSec    — how long the count must stay at/below the threshold
 *                         CONTINUOUSLY before the room is considered
 *                         unoccupied. Stops a lunch break from going dark.
 *   switchOffDelaySec   — an ADDITIONAL grace period after that, before the
 *                         off command is issued.
 *   switchOnDelaySec    — how long the room must be occupied before switching
 *                         on. Usually 0: a person walking in wants the light
 *                         now.
 *   commandCooldownSec  — minimum gap between commands to the same device.
 *                         With the "already in the desired state" check in
 *                         services/automationRules.js, this is what prevents
 *                         a device being flapped on and off.
 */
const automationRuleSchema = new mongoose.Schema(
  {
    ruleId: { type: String, required: true, unique: true, trim: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: '' },
    // Room.roomId — validated against a real Room by the controller.
    roomId: { type: String, required: true, trim: true, index: true },
    // Device.deviceId values this rule controls. Validated by the controller.
    deviceIds: { type: [String], default: [] },

    // OFF BY DEFAULT. See the note above.
    enabled: { type: Boolean, default: false, index: true },

    occupancyThreshold: { type: Number, min: 0, default: 1 },
    unoccupiedForSec: { type: Number, min: 0, default: 300 },
    switchOffDelaySec: { type: Number, min: 0, default: 0 },
    switchOnDelaySec: { type: Number, min: 0, default: 0 },

    // Optional operating window as 24-hour 'HH:MM' strings. BOTH EMPTY means
    // "always allowed". A window whose end is before its start wraps past
    // midnight (e.g. 18:00 → 06:00), which is handled in
    // services/automationRules.js → isWithinAllowedHours.
    allowedHours: {
      start: { type: String, default: '' },
      end: { type: String, default: '' },
    },

    commandCooldownSec: { type: Number, min: 0, default: 60 },

    // 'suspend' is the safe default. Anything else is an explicitly configured
    // operator policy — see the note above.
    onUnavailableOccupancy: {
      type: String,
      enum: ['suspend', 'leave_as_is'],
      default: 'suspend',
    },

    // Default lifetime of a manual override created against this rule's
    // devices, in minutes. The override itself always carries its own explicit
    // expiry timestamp; this is only the default offered.
    manualOverrideMinutes: { type: Number, min: 0, default: 30 },

    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// "Which enabled rules apply to this room?" — the lookup the automation engine
// performs on every occupancy update.
automationRuleSchema.index({ roomId: 1, enabled: 1, active: 1 });

export const AutomationRule = mongoose.model('AutomationRule', automationRuleSchema);
