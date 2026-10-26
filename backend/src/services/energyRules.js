/**
 * Pure energy arithmetic for Review 3.
 *
 * DEPENDENCY-FREE, exactly like services/identityRules.js,
 * services/occupancyRules.js and services/automationRules.js: this module
 * imports NOTHING. Every function is a pure function of its arguments, so
 * node:test can check the maths — including the awkward cases, like an
 * interval still open at the end of the window and a zero baseline — without
 * MongoDB, without devices and without the AI service.
 *
 * ═══ READ THIS BEFORE QUOTING ANY NUMBER THIS MODULE PRODUCES ═══
 *
 * EVERY RESULT HERE IS AN ESTIMATE, NOT A MEASUREMENT. There is no power meter
 * anywhere in this project. The arithmetic is
 *
 *     (power rating an operator typed in) × (time the device was recorded on)
 *
 * so the output inherits the accuracy of a configured number. A device whose
 * `powerRatingWatts` is wrong produces a confidently wrong kWh figure, and a
 * device driven by the simulation adapter was never physically on at all — the
 * on-duration is real elapsed time, but the "device" was an entry in a Map.
 *
 * Every function below repeats this in its own doc comment, deliberately, and
 * services/energyService.js stamps `estimated: true` (plus `simulated: true`
 * where it applies) on every response. A savings figure quoted without its
 * baseline is meaningless, so the baseline travels with it.
 */

/**
 * ENERGY, THE STANDARD CALCULATION:
 *
 *     kWh = watts × (seconds / 3600) / 1000
 *
 * That is implemented here EXACTLY as written, in one place, so nothing else
 * in the codebase re-derives it and gets the units wrong. (The common slip is
 * dividing by 1000 twice, or treating the duration as hours when it is
 * seconds.)
 *
 * ESTIMATE, NOT A MEASUREMENT: `watts` is an operator-configured rating, not a
 * meter reading. Non-finite or negative inputs yield 0 rather than NaN, so one
 * misconfigured device cannot poison a whole report with NaN.
 *
 * @param {number} watts    configured power rating
 * @param {number} seconds  duration the device was on
 * @returns {number} kWh
 */
export function energyKwh(watts, seconds) {
  const w = Number(watts);
  const s = Number(seconds);
  if (!Number.isFinite(w) || !Number.isFinite(s) || w <= 0 || s <= 0) return 0;
  return (w * (s / 3600)) / 1000;
}

/**
 * Sums the seconds a device was in state 'on' inside [windowStart, windowEnd].
 *
 * Input is a list of DeviceStateHistory-like transitions,
 * `{ changedAt, toState, confirmed }`, which the caller should already have
 * filtered to `confirmed: true` — an unconfirmed row records a command that
 * FAILED, and counting it would bill a room for electricity a device never
 * used. This function also skips `confirmed === false` defensively.
 *
 * THE TWO CASES THAT ARE EASY TO GET WRONG, both handled explicitly:
 *
 *   • A STATE THAT BEGAN BEFORE THE WINDOW. The newest transition at or before
 *     windowStart establishes the state the device was ALREADY in when the
 *     window opened, and its contribution is counted from windowStart (not
 *     from the transition's own timestamp, which may be days earlier).
 *   • AN INTERVAL STILL OPEN AT windowEnd. The final 'on' interval has no
 *     closing transition, so it is closed AT windowEnd — never at "now", and
 *     never left out, both of which silently understate consumption.
 *
 * A device whose state is 'unknown' contributes nothing: unknown is not off,
 * and guessing either way would be a fabricated figure.
 *
 * ESTIMATE, NOT A MEASUREMENT — the durations are real elapsed time, but
 * whether the hardware was truly drawing power is only as true as the adapter
 * that confirmed the state.
 *
 * @param {Array<{changedAt: Date|string|number, toState: string, confirmed?: boolean}>} transitions
 * @param {Date|number} windowStart
 * @param {Date|number} windowEnd
 * @returns {number} seconds the device was on within the window
 */
export function onSecondsFromHistory(transitions, windowStart, windowEnd) {
  const start = Number(new Date(windowStart));
  const end = Number(new Date(windowEnd));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;

  const rows = (Array.isArray(transitions) ? transitions : [])
    .filter((row) => row && row.confirmed !== false && typeof row.toState === 'string')
    .map((row) => ({ at: Number(new Date(row.changedAt)), toState: row.toState }))
    .filter((row) => Number.isFinite(row.at))
    .sort((a, b) => a.at - b.at);

  if (rows.length === 0) return 0;

  // The state the device was already in when the window opened.
  let state = 'unknown';
  for (const row of rows) {
    if (row.at <= start) state = row.toState;
    else break;
  }

  let cursor = start;
  let onSeconds = 0;

  for (const row of rows) {
    if (row.at <= start) continue;
    if (row.at >= end) break;
    if (state === 'on') onSeconds += (row.at - cursor) / 1000;
    state = row.toState;
    cursor = row.at;
  }

  // Close the last interval AT THE WINDOW END, not at "now".
  if (state === 'on') onSeconds += (end - cursor) / 1000;

  return Math.max(0, onSeconds);
}

/**
 * Whether there is enough history to say anything about a window.
 *
 * A window with no transitions at or before `windowEnd` is NOT a window in
 * which the device was off — it is a window about which nothing is known. The
 * caller uses this to return `insufficientData: true` with an explanation
 * instead of a 0 that looks like a measurement of an idle device.
 *
 * @returns {{ usable: boolean, reason: string }}
 */
export function hasUsableHistory(transitions, windowStart, windowEnd) {
  const rows = (Array.isArray(transitions) ? transitions : []).filter(
    (row) => row && row.confirmed !== false
  );
  if (rows.length === 0) {
    return { usable: false, reason: 'no_confirmed_state_changes' };
  }
  const end = Number(new Date(windowEnd));
  const earliest = Math.min(...rows.map((row) => Number(new Date(row.changedAt))));
  if (!Number.isFinite(earliest) || earliest >= end) {
    return { usable: false, reason: 'history_starts_after_the_window' };
  }
  return { usable: true, reason: 'ok' };
}

/**
 * THE DECLARED BASELINE: what the device would have consumed in a day under
 * its configured operating schedule with NO occupancy-based switching.
 *
 *     baselineKwh = watts × baselineHoursPerDay / 1000
 *
 * THIS IS AN ASSUMPTION, AND IT IS THE ONLY REASON A SAVINGS FIGURE CAN BE
 * QUOTED AT ALL. It is not measured, not inferred from history, and not a
 * hidden constant: it comes from env.energy.baselineHoursPerDay (default 12),
 * it is returned in every energy API response alongside a description of what
 * it means, and it should be set to match the schedule you are actually
 * claiming to have improved on. Quote the baseline whenever you quote a
 * saving; a percentage without one is not a result.
 *
 * `windowHours` scales the baseline for a window shorter or longer than a day
 * (a part-finished day, or a week), so a saving is never compared against a
 * full day's baseline for a two-hour window.
 */
export function baselineKwh({ watts, baselineHoursPerDay, windowHours = 24 } = {}) {
  const w = Number(watts);
  const hours = Number(baselineHoursPerDay);
  const window = Number(windowHours);
  if (!Number.isFinite(w) || !Number.isFinite(hours) || w <= 0 || hours <= 0) return 0;
  if (!Number.isFinite(window) || window <= 0) return 0;

  // Pro-rate: a 6-hour window gets a quarter of the daily baseline, and a
  // window longer than the configured daily hours is capped at the window
  // itself so the baseline never claims more hours than actually elapsed.
  const baselineHours = Math.min(hours * (window / 24), window);
  return (w * baselineHours) / 1000;
}

/**
 * ESTIMATED SAVING: baseline minus actual, CLAMPED AT ZERO.
 *
 * The clamp is deliberate. A device that ran LONGER than the baseline has not
 * saved a negative amount of electricity in any useful sense — it used more
 * than the comparison schedule — and reporting "-0.3 kWh saved" invites the
 * reader to subtract it from a total and get a number that means nothing.
 * Zero, with the consumption figure next to it, is the honest presentation.
 *
 * ESTIMATE, NOT A MEASUREMENT: both inputs derive from a configured power
 * rating, and the baseline is a declared assumption.
 */
export function savingsKwh(baseline, actual) {
  const b = Number(baseline);
  const a = Number(actual);
  if (!Number.isFinite(b) || !Number.isFinite(a)) return 0;
  return Math.max(0, b - a);
}

/**
 * ESTIMATED SAVING AS A PERCENTAGE OF THE BASELINE, or NULL.
 *
 * RETURNS NULL WHEN THE BASELINE IS 0 (or not a usable number), and that is
 * the important behaviour in this function. With no baseline there is nothing
 * to be a percentage OF: dividing by zero gives Infinity, and the tempting
 * "report 0%" or "report 100%" are both claims the data does not support. A
 * null travels to the UI as "not enough configuration to express this as a
 * percentage", which is true, instead of a confident figure that is not.
 *
 * This is also why `powerRatingWatts` defaults to 0 rather than to some
 * plausible wattage: an unconfigured device produces a null percentage rather
 * than a fabricated one.
 */
export function savingsPercent(baseline, actual) {
  const b = Number(baseline);
  const a = Number(actual);
  if (!Number.isFinite(b) || b <= 0) return null;
  if (!Number.isFinite(a)) return null;
  const saved = Math.max(0, b - a);
  return Math.min(100, (saved / b) * 100);
}

/**
 * Rounds a kWh figure for display without pretending to precision.
 *
 * Three decimals (1 Wh). ESTIMATE, NOT A MEASUREMENT — rounding does not make
 * a figure derived from a typed-in wattage any more accurate, it just stops
 * the UI printing 0.016666666666666666.
 */
export function roundKwh(value, decimals = 3) {
  const v = Number(value);
  if (!Number.isFinite(v)) return 0;
  const factor = 10 ** decimals;
  return Math.round(v * factor) / factor;
}

/** Hours between two instants, floored at 0. */
export function windowHours(windowStart, windowEnd) {
  const start = Number(new Date(windowStart));
  const end = Number(new Date(windowEnd));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return (end - start) / 3600000;
}
