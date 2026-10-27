/**
 * Review 3 — energy arithmetic, the declared baseline, and the honesty rules
 * that stop an estimate being presented as a measurement.
 *
 * Imports services/energyRules.js directly. That module imports NOTHING — no
 * mongoose, no models, no env, no logger — so these tests need no MongoDB, no
 * devices and no AI service, exactly like the Review 2 identityRules tests.
 *
 * WHAT THIS FILE EXISTS TO PROVE. The energy numbers are the ones most likely
 * to be quoted out of context, so the properties asserted hardest are the ones
 * that keep them defensible:
 *
 *   • the kWh formula is EXACTLY watts × (seconds/3600) / 1000, in one place;
 *   • on-duration comes from CONFIRMED state transitions only, so a command
 *     that failed never bills a room for electricity it did not use;
 *   • the two awkward window cases (a state that began before the window, an
 *     interval still open at the window end) are handled, not rounded away;
 *   • a zero baseline yields a NULL percentage, never 0% and never 100%;
 *   • a saving is clamped at zero rather than going negative;
 *   • "no data" is reported as no data, not as a zero that looks like a
 *     measurement of an idle device.
 *
 * review3-automation.test.js also touches energyRules as part of the
 * device-control story; this file is the dedicated arithmetic suite and goes
 * further — composition with the baseline, multi-transition windows, boundary
 * timestamps, and the source-text guarantees on services/energyService.js.
 *
 * WHAT THESE TESTS DO NOT PROVE: that any figure is TRUE. There is no power
 * meter in this project. The inputs are an operator-typed wattage and a
 * duration recorded against a simulated adapter, so a correct calculation over
 * those inputs is still an ESTIMATE. See docs/OCCUPANCY_ENERGY.md.
 * Nothing in this repository has been executed (docs/REVIEW3-REPORT.md §D).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  baselineKwh,
  energyKwh,
  hasUsableHistory,
  onSecondsFromHistory,
  roundKwh,
  savingsKwh,
  savingsPercent,
  windowHours,
} from '../src/services/energyRules.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(here, '..', 'src');
const readSrc = (...parts) => readFileSync(path.join(srcDir, ...parts), 'utf8');

const NOW = Date.UTC(2026, 0, 15, 0, 0, 0);
const HOUR = 3600_000;

/** Floating-point comparison for kWh figures. */
function closeTo(actual, expected, message) {
  assert.ok(
    Math.abs(actual - expected) < 1e-12,
    `${message ?? 'value'}: expected ≈${expected}, got ${actual}`
  );
}

// ════════════════════════════════════════════════════════════════
// THE FORMULA
// ════════════════════════════════════════════════════════════════

test('energyKwh is exactly watts × (seconds / 3600) / 1000', () => {
  // The two figures named in the acceptance criteria.
  assert.equal(energyKwh(100, 3600), 0.1);
  closeTo(energyKwh(60, 1800), 0.03, '60 W for 30 minutes');

  // And the rest of the sanity grid.
  assert.equal(energyKwh(1000, 3600), 1, '1 kW for 1 h is 1 kWh');
  closeTo(energyKwh(1, 3600), 0.001, '1 W for 1 h is 1 Wh');
  closeTo(energyKwh(2000, 1800), 1, '2 kW for 30 min is 1 kWh');

  // The seeded demo devices, so the documented worked example stays true.
  closeTo(energyKwh(108, 8 * 3600), 0.864, 'DEV-LIGHT-01 at 108 W for 8 h');
  closeTo(energyKwh(75, 8 * 3600), 0.6, 'DEV-FAN-01 at 75 W for 8 h');
});

test('the formula is not double-divided or hour/second confused', () => {
  // The two classic unit slips, asserted as explicit NOT-equals so a
  // regression that divides by 1000 twice, or treats seconds as hours, fails
  // here rather than quietly reporting a plausible-looking small number.
  assert.notEqual(energyKwh(100, 3600), 0.0001, 'dividing by 1000 twice');
  assert.notEqual(energyKwh(100, 3600), 360, 'treating seconds as hours');
  assert.notEqual(energyKwh(100, 3600), 100, 'ignoring the duration entirely');
});

test('a misconfigured device yields 0 rather than NaN poisoning a whole report', () => {
  for (const [w, s] of [
    [0, 3600],
    [100, 0],
    [-5, 3600],
    [100, -3600],
    [NaN, 10],
    [100, NaN],
    [Infinity, 10],
    ['x', 'y'],
    [null, null],
    [undefined, undefined],
  ]) {
    const result = energyKwh(w, s);
    assert.equal(result, 0, `energyKwh(${String(w)}, ${String(s)})`);
    assert.ok(Number.isFinite(result));
  }
});

// ════════════════════════════════════════════════════════════════
// ON-DURATION FROM PERSISTED STATE HISTORY
// ════════════════════════════════════════════════════════════════

test('a simple on/off pair inside the window is measured from the transitions', () => {
  const transitions = [
    { changedAt: new Date(NOW + 1 * HOUR), toState: 'on', confirmed: true },
    { changedAt: new Date(NOW + 3 * HOUR), toState: 'off', confirmed: true },
  ];
  assert.equal(onSecondsFromHistory(transitions, NOW, NOW + 24 * HOUR), 2 * 3600);
});

test('a state that began BEFORE the window is counted from the window start', () => {
  // Switched on two days earlier and still on when the window opened.
  const transitions = [
    { changedAt: new Date(NOW - 48 * HOUR), toState: 'on', confirmed: true },
    { changedAt: new Date(NOW + 2 * HOUR), toState: 'off', confirmed: true },
  ];
  // 2 hours, NOT 50 — the duration before the window is not in the window.
  assert.equal(onSecondsFromHistory(transitions, NOW, NOW + 24 * HOUR), 2 * 3600);
});

test('an interval still OPEN at the window end is closed at the window end', () => {
  const transitions = [
    { changedAt: new Date(NOW + 20 * HOUR), toState: 'on', confirmed: true },
  ];
  // Closed at windowEnd (4 h), never at "now" and never dropped as unknown.
  assert.equal(onSecondsFromHistory(transitions, NOW, NOW + 24 * HOUR), 4 * 3600);
});

test('both awkward cases together: on before the window and still on at its end', () => {
  const transitions = [
    { changedAt: new Date(NOW - 6 * HOUR), toState: 'on', confirmed: true },
  ];
  // The whole window, and exactly the window.
  assert.equal(onSecondsFromHistory(transitions, NOW, NOW + 8 * HOUR), 8 * 3600);
});

test('several on/off cycles in one window are summed, not just the first or last', () => {
  const transitions = [
    { changedAt: new Date(NOW + 1 * HOUR), toState: 'on', confirmed: true },
    { changedAt: new Date(NOW + 2 * HOUR), toState: 'off', confirmed: true },
    { changedAt: new Date(NOW + 5 * HOUR), toState: 'on', confirmed: true },
    { changedAt: new Date(NOW + 6 * HOUR), toState: 'off', confirmed: true },
    { changedAt: new Date(NOW + 9 * HOUR), toState: 'on', confirmed: true },
    { changedAt: new Date(NOW + 9.5 * HOUR), toState: 'off', confirmed: true },
  ];
  assert.equal(onSecondsFromHistory(transitions, NOW, NOW + 24 * HOUR), 2.5 * 3600);
});

test('transitions after the window end do not leak into it', () => {
  const transitions = [
    { changedAt: new Date(NOW + 1 * HOUR), toState: 'on', confirmed: true },
    // Switched off long after the window closed.
    { changedAt: new Date(NOW + 40 * HOUR), toState: 'off', confirmed: true },
  ];
  // 23 h, not 39 — the window caps it.
  assert.equal(onSecondsFromHistory(transitions, NOW, NOW + 24 * HOUR), 23 * 3600);
});

test('out-of-order transitions are sorted rather than mis-measured', () => {
  const shuffled = [
    { changedAt: new Date(NOW + 3 * HOUR), toState: 'off', confirmed: true },
    { changedAt: new Date(NOW + 1 * HOUR), toState: 'on', confirmed: true },
  ];
  assert.equal(onSecondsFromHistory(shuffled, NOW, NOW + 24 * HOUR), 2 * 3600);
});

test('a FAILED command never bills the room for electricity it did not use', () => {
  // confirmed:false means the adapter refused — the device never went on.
  const transitions = [
    { changedAt: new Date(NOW + 1 * HOUR), toState: 'on', confirmed: false },
    { changedAt: new Date(NOW + 5 * HOUR), toState: 'off', confirmed: false },
  ];
  assert.equal(onSecondsFromHistory(transitions, NOW, NOW + 24 * HOUR), 0);
  assert.equal(energyKwh(108, onSecondsFromHistory(transitions, NOW, NOW + 24 * HOUR)), 0);
});

test('an unconfirmed row in the middle of a confirmed sequence is skipped', () => {
  const transitions = [
    { changedAt: new Date(NOW + 1 * HOUR), toState: 'on', confirmed: true },
    // A refused switch-off: the device is still on.
    { changedAt: new Date(NOW + 2 * HOUR), toState: 'off', confirmed: false },
    { changedAt: new Date(NOW + 4 * HOUR), toState: 'off', confirmed: true },
  ];
  // 3 h, not 1 — the device stayed on because the command failed.
  assert.equal(onSecondsFromHistory(transitions, NOW, NOW + 24 * HOUR), 3 * 3600);
});

test("'unknown' is neither on nor off and contributes nothing", () => {
  const transitions = [
    { changedAt: new Date(NOW - HOUR), toState: 'unknown', confirmed: true },
    { changedAt: new Date(NOW + 2 * HOUR), toState: 'on', confirmed: true },
    { changedAt: new Date(NOW + 3 * HOUR), toState: 'unknown', confirmed: true },
  ];
  // Only the genuine 'on' hour counts; the unknown stretches are not guessed
  // either way, because guessing would be a fabricated figure.
  assert.equal(onSecondsFromHistory(transitions, NOW, NOW + 24 * HOUR), 3600);
});

test('a nonsense or inverted window yields 0, never a negative duration', () => {
  const transitions = [{ changedAt: new Date(NOW), toState: 'on', confirmed: true }];
  assert.equal(onSecondsFromHistory(transitions, NOW + HOUR, NOW), 0);
  assert.equal(onSecondsFromHistory(transitions, NOW, NOW), 0);
  assert.equal(onSecondsFromHistory(transitions, 'banana', NOW), 0);
  assert.equal(onSecondsFromHistory([], NOW, NOW + HOUR), 0);
  assert.equal(onSecondsFromHistory(null, NOW, NOW + HOUR), 0);
  assert.equal(onSecondsFromHistory(undefined, NOW, NOW + HOUR), 0);
  // A malformed row does not throw and does not count.
  assert.equal(
    onSecondsFromHistory([{ changedAt: 'nope', toState: 'on', confirmed: true }], NOW, NOW + HOUR),
    0
  );
});

// ════════════════════════════════════════════════════════════════
// "NO DATA" IS NOT "ZERO CONSUMPTION"
// ════════════════════════════════════════════════════════════════

test('hasUsableHistory separates "the device was off" from "nothing is known"', () => {
  const end = NOW + 24 * HOUR;

  // Nothing at all: not an idle device, an absence of evidence.
  assert.equal(hasUsableHistory([], NOW, end).usable, false);
  assert.equal(hasUsableHistory([], NOW, end).reason, 'no_confirmed_state_changes');
  assert.equal(hasUsableHistory(null, NOW, end).usable, false);

  // Only failed commands: still nothing confirmed.
  assert.equal(
    hasUsableHistory([{ changedAt: new Date(NOW), toState: 'on', confirmed: false }], NOW, end)
      .usable,
    false
  );

  // History that only begins after the window closes says nothing about it.
  assert.equal(
    hasUsableHistory(
      [{ changedAt: new Date(end + HOUR), toState: 'on', confirmed: true }],
      NOW,
      end
    ).usable,
    false
  );

  // One confirmed transition inside the window is enough to compute.
  assert.equal(
    hasUsableHistory([{ changedAt: new Date(NOW + HOUR), toState: 'off', confirmed: true }], NOW, end)
      .usable,
    true
  );
});

// ════════════════════════════════════════════════════════════════
// THE DECLARED BASELINE
// ════════════════════════════════════════════════════════════════

test('the baseline is watts × configured hours, pro-rated for the window', () => {
  closeTo(baselineKwh({ watts: 100, baselineHoursPerDay: 12, windowHours: 24 }), 1.2, 'full day');
  closeTo(baselineKwh({ watts: 100, baselineHoursPerDay: 12, windowHours: 12 }), 0.6, 'half day');
  closeTo(baselineKwh({ watts: 100, baselineHoursPerDay: 12, windowHours: 168 }), 8.4, 'a week');

  // The seeded demo pair against the default 12 h baseline.
  closeTo(baselineKwh({ watts: 108, baselineHoursPerDay: 12 }), 1.296, 'DEV-LIGHT-01');
  closeTo(baselineKwh({ watts: 75, baselineHoursPerDay: 12 }), 0.9, 'DEV-FAN-01');
});

test('the baseline never claims more hours than actually elapsed', () => {
  // A 2-hour window cannot be compared against 12 baseline hours: the cap
  // makes it 100 W × 2 h… except the pro-rata already gives 1 h, and the cap
  // is what stops a short window being measured against a whole day.
  closeTo(baselineKwh({ watts: 100, baselineHoursPerDay: 12, windowHours: 2 }), 0.1, '2 h window');
  // A baseline of 24 h over a 1 h window is capped at the window itself.
  closeTo(baselineKwh({ watts: 100, baselineHoursPerDay: 24, windowHours: 1 }), 0.1, 'capped');
  assert.ok(
    baselineKwh({ watts: 100, baselineHoursPerDay: 24, windowHours: 1 }) <= energyKwh(100, 3600),
    'the baseline for a window can never exceed running flat out for that window'
  );
});

test('an unconfigured power rating produces no baseline rather than a guess', () => {
  assert.equal(baselineKwh({ watts: 0, baselineHoursPerDay: 12 }), 0);
  assert.equal(baselineKwh({ watts: -10, baselineHoursPerDay: 12 }), 0);
  assert.equal(baselineKwh({ watts: 100, baselineHoursPerDay: 0 }), 0);
  assert.equal(baselineKwh({ watts: 100, baselineHoursPerDay: 12, windowHours: 0 }), 0);
  assert.equal(baselineKwh({}), 0);
  assert.equal(baselineKwh(), 0);
});

// ════════════════════════════════════════════════════════════════
// SAVINGS — CLAMPED, AND NULL WHEN THERE IS NO BASELINE
// ════════════════════════════════════════════════════════════════

test('savingsKwh is baseline minus actual, clamped at zero', () => {
  closeTo(savingsKwh(1.2, 0.4), 0.8, 'ordinary saving');
  assert.equal(savingsKwh(1.2, 1.2), 0, 'no saving is 0, not a rounding artefact');

  // Ran LONGER than the baseline. Not a negative saving — it used more than
  // the comparison schedule, and "-0.3 kWh saved" invites a reader to subtract
  // it from a total and get a number that means nothing.
  assert.equal(savingsKwh(0.4, 1.2), 0);
  assert.ok(savingsKwh(0.4, 1.2) >= 0);

  assert.equal(savingsKwh(NaN, 1), 0);
  assert.equal(savingsKwh(1, NaN), 0);
  assert.equal(savingsKwh(undefined, undefined), 0);
});

test('savingsPercent returns NULL for a zero baseline — no misleading percentage', () => {
  // The acceptance criterion. With no baseline there is nothing to be a
  // percentage OF: 0% and 100% are both claims the data does not support.
  assert.equal(savingsPercent(0, 0), null);
  assert.equal(savingsPercent(0, 5), null);
  assert.equal(savingsPercent(-1, 0), null);
  assert.equal(savingsPercent(NaN, 0), null);
  assert.equal(savingsPercent(1, NaN), null);
  assert.equal(savingsPercent(), null);

  // Explicitly NOT the tempting wrong answers.
  assert.notEqual(savingsPercent(0, 0), 0);
  assert.notEqual(savingsPercent(0, 0), 100);
  assert.ok(!Number.isFinite(savingsPercent(0, 1) ?? NaN), 'must not be Infinity either');
});

test('savingsPercent is an ordinary percentage, clamped to [0, 100]', () => {
  assert.equal(savingsPercent(1, 0.25), 75);
  assert.equal(savingsPercent(1, 0.5), 50);
  assert.equal(savingsPercent(1, 0), 100);
  assert.equal(savingsPercent(1, 2), 0, 'over-consumption is 0%, not negative');
  assert.equal(savingsPercent(2, 3), 0);
  const value = savingsPercent(1.296, 0.432);
  assert.ok(value >= 0 && value <= 100);
  closeTo(value, 66.66666666666667, 'two thirds saved');
});

// ════════════════════════════════════════════════════════════════
// COMPOSITION — the whole chain, end to end, on paper
// ════════════════════════════════════════════════════════════════

test('the worked example in docs/OCCUPANCY_ENERGY.md composes correctly', () => {
  // DEV-LIGHT-01, 108 W, recorded on for 4 hours of a 24-hour window, against
  // the default 12 h/day baseline.
  const transitions = [
    { changedAt: new Date(NOW + 9 * HOUR), toState: 'on', confirmed: true },
    { changedAt: new Date(NOW + 13 * HOUR), toState: 'off', confirmed: true },
  ];
  const seconds = onSecondsFromHistory(transitions, NOW, NOW + 24 * HOUR);
  assert.equal(seconds, 4 * 3600);

  const actual = energyKwh(108, seconds);
  closeTo(actual, 0.432, 'estimated consumption');

  const baseline = baselineKwh({
    watts: 108,
    baselineHoursPerDay: 12,
    windowHours: windowHours(NOW, NOW + 24 * HOUR),
  });
  closeTo(baseline, 1.296, 'declared baseline');

  closeTo(savingsKwh(baseline, actual), 0.864, 'estimated saving');
  closeTo(savingsPercent(baseline, actual), 66.66666666666667, 'estimated saving %');

  // Rounded for display without pretending to precision.
  assert.equal(roundKwh(actual), 0.432);
  assert.equal(roundKwh(baseline), 1.296);
  assert.equal(roundKwh(savingsKwh(baseline, actual)), 0.864);
});

test('a device with no configured wattage produces zeros and a null percentage', () => {
  // The important composition: an unconfigured device must not contribute a
  // confident-looking 0% saving to a report.
  const transitions = [{ changedAt: new Date(NOW), toState: 'on', confirmed: true }];
  const seconds = onSecondsFromHistory(transitions, NOW, NOW + 24 * HOUR);
  assert.equal(seconds, 24 * 3600, 'the duration is still real');

  assert.equal(energyKwh(0, seconds), 0);
  assert.equal(baselineKwh({ watts: 0, baselineHoursPerDay: 12 }), 0);
  assert.equal(savingsPercent(0, 0), null, 'no wattage means no percentage');
});

test('windowHours and roundKwh are floored and bounded', () => {
  assert.equal(windowHours(NOW, NOW + HOUR), 1);
  assert.equal(windowHours(NOW, NOW + 24 * HOUR), 24);
  assert.equal(windowHours(NOW + HOUR, NOW), 0, 'an inverted window is 0, not negative');
  assert.equal(windowHours('nope', NOW), 0);

  assert.equal(roundKwh(1 / 60), 0.017);
  assert.equal(roundKwh(0.0004), 0);
  assert.equal(roundKwh(NaN), 0);
  assert.equal(roundKwh(Infinity), 0);
  assert.equal(roundKwh(1.23456, 2), 1.23);
});

// ════════════════════════════════════════════════════════════════
// STRUCTURAL GUARANTEES, asserted on source text
// ════════════════════════════════════════════════════════════════

test('energyRules.js imports nothing, so the maths is testable without Mongo', () => {
  const source = readSrc('services', 'energyRules.js');
  assert.equal(
    /^\s*import\s/m.test(source),
    false,
    'services/energyRules.js must stay dependency-free'
  );
  assert.equal(/require\(/.test(source), false);
});

test('the kWh formula is derived in exactly ONE place', () => {
  // Any other file re-deriving `/ 3600 ... / 1000` is a second copy that can
  // drift. Energy figures must all flow through energyRules.energyKwh.
  const service = readSrc('services', 'energyService.js');
  assert.match(service, /energyKwh\(/, 'energyService must use the shared formula');
  assert.equal(
    /\/\s*3600\s*\)?\s*\/\s*1000/.test(service),
    false,
    'energyService must not re-derive the kWh formula'
  );
});

test('no energy figure anywhere is random, hardcoded or faked', () => {
  for (const file of ['energyService.js', 'energyRules.js']) {
    const source = readSrc('services', file);
    assert.equal(/Math\.random/.test(source), false, `${file} must not invent data`);
    assert.equal(/faker|lorem|placeholderSeries/i.test(source), false);
  }
});

test('every energy response carries the baseline, estimated and insufficient-data flags', () => {
  const service = readSrc('services', 'energyService.js');

  // The baseline is STATED, with a description, in one shared block.
  assert.match(service, /function baselineBlock/);
  assert.match(service, /hoursPerDay/);
  assert.match(service, /description:/);
  assert.match(service, /source: 'ENERGY_BASELINE_HOURS_PER_DAY'/);

  // Estimated, not measured — on every response.
  assert.match(service, /estimated: true/);
  // Simulation is disclosed rather than inferred by the reader.
  assert.match(service, /simulated/);
  // And an uncomputable window says so, with what is missing.
  assert.match(service, /insufficientData/);
  assert.match(service, /requires/);
});

test('the baseline comes from an operator-set env var, not a hidden constant', () => {
  const envSource = readSrc('config', 'env.js');
  assert.match(envSource, /baselineHoursPerDay:\s*Number\(process\.env\.ENERGY_BASELINE_HOURS_PER_DAY\)/);
  assert.match(envSource, /historyMaxLimit:\s*Number\(process\.env\.ENERGY_HISTORY_MAX_LIMIT\)/);

  // Documented for the operator with a placeholder, never a secret.
  const example = readFileSync(path.join(srcDir, '..', '.env.example'), 'utf8');
  assert.match(example, /^ENERGY_BASELINE_HOURS_PER_DAY=/m);
  assert.match(example, /^ENERGY_HISTORY_MAX_LIMIT=/m);
});

test('the EnergySummary rollup is keyed per day per device so it stays idempotent', () => {
  const model = readSrc('models', 'EnergyRecord.js');
  // A unique { date, deviceId } key is what makes the nightly rollup an
  // upsert rather than an append that double-counts on a restart.
  assert.match(model, /date/);
  assert.match(model, /deviceId/);
  assert.match(model, /unique: true/);
  // Every stored figure is flagged as an estimate at the schema level too.
  assert.match(model, /estimated/);
});
