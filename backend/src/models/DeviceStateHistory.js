import mongoose from 'mongoose';

/**
 * DeviceStateHistory — the audit trail of device state TRANSITIONS (Review 3).
 *
 * This collection is the sole input to the energy analytics: every kWh figure
 * the system reports is derived from the on-intervals recorded here multiplied
 * by the device's configured power rating. There are no sampled meter readings
 * and no synthetic rows anywhere in this project.
 *
 * `confirmed` IS THE IMPORTANT FIELD. It is true ONLY when the device adapter
 * acknowledged the command, i.e. when the state change actually happened as
 * far as the system can tell. A row with `confirmed: false` records that a
 * command was ATTEMPTED AND NOT CONFIRMED — it is kept because a failed
 * command is operationally interesting, but it is excluded from every energy
 * calculation. Billing a room for electricity on the strength of a command
 * that failed would be exactly the kind of fabricated figure this project must
 * not produce.
 *
 * `durationSec` is filled in on the row being CLOSED when the next transition
 * arrives, so a completed interval carries its own length and the analytics
 * can cross-check the figure it computes from timestamps.
 */
const deviceStateHistorySchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true, trim: true, index: true },
    roomId: { type: String, trim: true, index: true },
    // 'unknown' is a legitimate previous state for a device the system had
    // never successfully spoken to.
    fromState: { type: String, enum: ['on', 'off', 'unknown'], default: 'unknown' },
    toState: { type: String, enum: ['on', 'off', 'unknown'], required: true },
    changedAt: { type: Date, default: Date.now, index: true },
    trigger: {
      type: String,
      enum: ['automation', 'manual', 'adapter_sync', 'startup'],
      required: true,
    },
    reason: { type: String, default: '' },
    // Set when an automation rule caused the change.
    ruleId: { type: String, default: null },
    // Set when a human caused the change (the authenticated user's id).
    actorId: { type: String, default: null },
    // TRUE ONLY IF THE ADAPTER ACKNOWLEDGED. Energy maths uses confirmed rows
    // exclusively — see the note above.
    confirmed: { type: Boolean, default: false, index: true },
    // Message the adapter returned. For the simulation adapter this begins
    // with the literal word 'SIMULATED'.
    adapterMessage: { type: String, default: null },
    // Length of the interval this row OPENED, written when the following
    // transition closes it. Null while the interval is still open.
    durationSec: { type: Number, min: 0, default: null },
  },
  { timestamps: true }
);

// The two time-ordered lookups the analytics and the device detail view make.
deviceStateHistorySchema.index({ deviceId: 1, changedAt: -1 });
deviceStateHistorySchema.index({ roomId: 1, changedAt: -1 });

export const DeviceStateHistory = mongoose.model(
  'DeviceStateHistory',
  deviceStateHistorySchema
);
