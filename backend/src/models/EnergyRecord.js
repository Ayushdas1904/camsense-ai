import mongoose from 'mongoose';

/**
 * EnergySummary — one day's ESTIMATED energy figures for one device (Review 3).
 *
 * This replaces the thin unused foundation-phase placeholder that lived in
 * this file. Two deliberate continuity decisions, matching how Review 3
 * replaced the Occupancy placeholder:
 *
 *   1. THE MONGOOSE MODEL NAME IS STILL 'EnergyRecord', so the collection is
 *      still `energyrecords` and anything already stored there is not
 *      orphaned by this change. The exported binding is `EnergySummary`
 *      because that is what the schema now models; the collection name is
 *      read from the model (never hardcoded) wherever it matters — see
 *      config/db.js → ensureDeviceAutomationIndexes.
 *   2. THE LEGACY FIELDS ARE RETAINED AS OPTIONAL (`location`, `occupancy`,
 *      `lightStatus`, `fanStatus`, `energyConsumed`, `energySaved`). They were
 *      never written by any code path, but keeping them optional means an
 *      existing document still validates if it is ever read back and saved.
 *      `location` in particular was `required: true` before and is now
 *      optional, because new documents are keyed by device, not by location.
 *
 * WHAT THIS COLLECTION IS AND IS NOT:
 *   It is a CACHE, not a source of truth. Every figure in it is recomputed
 *   from DeviceStateHistory by services/energyService.js; the rollup exists so
 *   a weekly or monthly trend does not have to replay months of transitions.
 *   Deleting this collection loses nothing that cannot be recomputed.
 *
 *   `estimated` is ALWAYS true, and that is not a formality. This project has
 *   no power meter. Energy is (configured watts) × (measured on-seconds), so
 *   the result is an estimate derived from an operator-supplied rating, and
 *   `simulated` records whether the underlying device was driven by the
 *   simulation adapter — in which case the on-durations are real elapsed time
 *   but the "device" was a Map entry in this process, and the figure must
 *   never be presented as measured consumption of physical hardware.
 */
const energySummarySchema = new mongoose.Schema(
  {
    // Local calendar day as 'YYYY-MM-DD', produced by attendanceDateKey() in
    // services/identityRules.js — the same convention Review 2 attendance
    // uses, so both features agree on where a day starts for the operator.
    date: { type: String, required: true, trim: true, index: true },
    deviceId: { type: String, required: true, trim: true, index: true },
    roomId: { type: String, trim: true, index: true },

    // Measured from CONFIRMED DeviceStateHistory transitions only.
    onSeconds: { type: Number, min: 0, default: 0 },
    // The configured rating used for this day's arithmetic, stored alongside
    // the result so a later rating change does not silently rewrite history.
    powerRatingWatts: { type: Number, min: 0, default: 0 },
    // watts × (onSeconds / 3600) / 1000
    energyKwh: { type: Number, min: 0, default: 0 },
    // The declared baseline for the same day: what the device would have used
    // under its configured operating schedule with NO occupancy-based
    // switching. See env.energy.baselineHoursPerDay.
    baselineKwh: { type: Number, min: 0, default: 0 },
    // max(baselineKwh - energyKwh, 0). Clamped, so an above-baseline day
    // reports zero saving rather than a negative one.
    savedKwh: { type: Number, min: 0, default: 0 },
    baselineHoursPerDay: { type: Number, min: 0, default: 0 },

    // ALWAYS true — see the note above. Present as a field, not just a
    // comment, so every consumer of a stored row carries the caveat with it.
    estimated: { type: Boolean, default: true },
    // True when the contributing device used the simulation adapter.
    simulated: { type: Boolean, default: false },

    // ── Legacy placeholder fields, retained as OPTIONAL ─────────
    // Never written by current code. Kept so any pre-existing document in
    // `energyrecords` still validates.
    location: { type: String, index: true },
    occupancy: { type: Number, min: 0 },
    lightStatus: { type: String, enum: ['on', 'off'] },
    fanStatus: { type: String, enum: ['on', 'off'] },
    energyConsumed: { type: Number, min: 0 },
    energySaved: { type: Number, min: 0 },
    timestamp: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

// One row per device per day. The rollup is an idempotent upsert on this key,
// so re-running it recomputes rather than duplicating.
energySummarySchema.index({ date: 1, deviceId: 1 }, { unique: true });
energySummarySchema.index({ roomId: 1, date: -1 });

// Model name kept as 'EnergyRecord' on purpose — see note 1 above.
export const EnergySummary = mongoose.model('EnergyRecord', energySummarySchema);

/**
 * Back-compatible alias. Nothing in the codebase imported the old placeholder
 * (it had no routes, controllers or services), but the alias costs nothing and
 * means an out-of-tree script that did import `EnergyRecord` still resolves.
 */
export const EnergyRecord = EnergySummary;
