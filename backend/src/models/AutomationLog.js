import mongoose from 'mongoose';

/**
 * AutomationLog — the execution history of the automation engine (Review 3).
 *
 * EVERY EVALUATION IS RECORDED, INCLUDING THE ONES THAT DID NOTHING. That is
 * the point of the collection: "the lights stayed on because the camera went
 * dark and the rule refused to act on data it could not trust" is the single
 * most important thing this feature has to be able to show, and it is
 * invisible unless the skipped decision is written down. A log that only
 * contained successful switches would make a suspended rule look identical to
 * a rule that was never evaluated.
 *
 * `occupancyCount` IS NULLABLE and is null for exactly the cases that matter —
 * an unavailable or stale figure is recorded as null, never as 0, so reading
 * the log back can never suggest the room was measured empty when it was not
 * measured at all.
 */
const automationLogSchema = new mongoose.Schema(
  {
    ruleId: { type: String, trim: true, index: true },
    roomId: { type: String, trim: true, index: true },
    deviceId: { type: String, trim: true, index: true },
    decision: {
      type: String,
      enum: [
        'switch_on',
        'switch_off',
        // Nothing to do: rule/device not in automatic mode, or the device is
        // already in the state the rule wants.
        'no_change',
        // The fail-safe. Occupancy was unavailable or stale, so no command was
        // issued — absent data is not evidence of an empty room.
        'skipped_stale_data',
        // An operator's manual override is still in force.
        'skipped_override',
        // Outside the rule's configured operating hours.
        'skipped_schedule',
        // Too soon after the previous command to this device.
        'skipped_cooldown',
        // A command was issued and the adapter did NOT confirm it.
        'command_failed',
      ],
      required: true,
      index: true,
    },
    // Operator-facing explanation. Written for a human reading the history,
    // not a machine.
    reason: { type: String, default: '' },
    // NULL when the figure was unavailable or stale. Never 0 as a stand-in.
    occupancyCount: { type: Number, min: 0, default: null },
    occupancyStatus: { type: String, default: null },
    outcome: {
      type: String,
      enum: ['applied', 'failed', 'not_applicable'],
      default: 'not_applicable',
      index: true,
    },
    // Verbatim adapter response, so a failure can be diagnosed. For the
    // simulation adapter this begins with the literal word 'SIMULATED'.
    adapterMessage: { type: String, default: null },
    evaluatedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

// The two time-ordered reads: a room's automation timeline and a device's.
automationLogSchema.index({ roomId: 1, evaluatedAt: -1 });
automationLogSchema.index({ deviceId: 1, evaluatedAt: -1 });

export const AutomationLog = mongoose.model('AutomationLog', automationLogSchema);
