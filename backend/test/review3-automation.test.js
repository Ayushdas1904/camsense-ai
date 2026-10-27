/**
 * Review 3 — device control, automation safety and energy arithmetic.
 *
 * Exercises the two dependency-free rule modules (services/automationRules.js
 * and services/energyRules.js) plus the adapter registry, with NO MongoDB, NO
 * AI service and NO devices. That is possible because those modules import
 * nothing, which is the reason they were written that way.
 *
 * The decisions asserted here are the ones that matter if this feature is
 * wrong: that unavailable or stale occupancy NEVER switches anything, that a
 * null count is never read as an empty room, that an operator's override is
 * not immediately undone, that a device already in the desired state is not
 * re-commanded, and that the energy maths uses the right units and refuses to
 * quote a percentage it cannot justify.
 *
 * It also reads the route files as text to assert the authorization surface,
 * in the same style as review2-routes.test.js.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AUTOMATION_DECISIONS,
  decideDeviceAction,
  isOccupancyActionable,
  isOverrideActive,
  isWithinAllowedHours,
  minutesOfDay,
  parseHourMinute,
  updateThresholdMarkers,
} from '../src/services/automationRules.js';
import {
  baselineKwh,
  energyKwh,
  hasUsableHistory,
  onSecondsFromHistory,
  savingsKwh,
  savingsPercent,
  windowHours,
} from '../src/services/energyRules.js';
import { getAdapter, isAdapterImplemented } from '../src/services/devices/index.js';
import {
  resetSimulation,
  setSimulatedFailure,
  simulationAdapter,
} from '../src/services/devices/simulationAdapter.js';
import { validateAdapterResult } from '../src/services/devices/adapter.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(here, '..', 'src');
const readSrc = (...parts) => readFileSync(path.join(srcDir, ...parts), 'utf8');

const NOW = Date.UTC(2024, 4, 15, 12, 0, 0);

/** An enabled rule with no schedule and no cooldown, for the happy path. */
function ruleFixture(overrides = {}) {
  return {
    ruleId: 'RULE-1',
    roomId: 'ROOM-01',
    deviceIds: ['DEV-1'],
    enabled: true,
    active: true,
    occupancyThreshold: 0,
    unoccupiedForSec: 300,
    switchOffDelaySec: 0,
    switchOnDelaySec: 0,
    allowedHours: { start: '', end: '' },
    commandCooldownSec: 0,
    onUnavailableOccupancy: 'suspend',
    ...overrides,
  };
}

function deviceFixture(overrides = {}) {
  return {
    deviceId: 'DEV-1',
    name: 'Lab Light',
    roomId: 'ROOM-01',
    type: 'light',
    reportedState: 'off',
    controlMode: 'automatic',
    adapterType: 'simulation',
    simulated: true,
    active: true,
    override: null,
    powerRatingWatts: 100,
    ...overrides,
  };
}

/** A usable, freshly-measured occupancy view. */
function occupancyFixture(overrides = {}) {
  return {
    count: 3,
    status: 'occupied',
    available: true,
    usable: true,
    lastUpdatedAt: new Date(NOW - 1000),
    aboveThresholdSince: new Date(NOW - 60_000),
    belowThresholdSince: null,
    ...overrides,
  };
}

// ════════════════════════════════════════════════════════════════
// THE FAIL-SAFE: unavailable / stale occupancy must switch nothing
// ════════════════════════════════════════════════════════════════

test('unavailable occupancy produces skipped_stale_data and no command', () => {
  const decision = decideDeviceAction({
    rule: ruleFixture(),
    device: deviceFixture({ reportedState: 'on' }),
    occupancy: occupancyFixture({
      count: null,
      status: 'camera_unavailable',
      available: false,
      usable: false,
    }),
    now: NOW,
  });

  assert.equal(decision.decision, 'skipped_stale_data');
  assert.equal(decision.desiredState, null);
  // Recorded as null, never 0 — 0 would read as "measured empty".
  assert.equal(decision.occupancyCount, null);
  assert.match(decision.reason, /not evidence/i);
});

test('stale occupancy produces skipped_stale_data even with a last-known count', () => {
  // The dangerous case: the room WAS empty, the camera then went dark. A
  // figure of 0 from ten minutes ago must not be used to switch anything.
  const decision = decideDeviceAction({
    rule: ruleFixture(),
    device: deviceFixture({ reportedState: 'on' }),
    occupancy: occupancyFixture({
      count: null,
      status: 'stale',
      available: false,
      usable: false,
      belowThresholdSince: new Date(NOW - 3_600_000),
    }),
    now: NOW,
  });

  assert.equal(decision.decision, 'skipped_stale_data');
  assert.equal(decision.occupancyCount, null);
});

test("the 'leave_as_is' policy also issues no command on unusable data", () => {
  const decision = decideDeviceAction({
    rule: ruleFixture({ onUnavailableOccupancy: 'leave_as_is' }),
    device: deviceFixture({ reportedState: 'on' }),
    occupancy: occupancyFixture({ count: null, status: 'stale', available: false, usable: false }),
    now: NOW,
  });

  // A different recorded intent, the same safe outcome: nothing is switched.
  assert.equal(decision.decision, 'skipped_stale_data');
  assert.equal(decision.desiredState, null);
});

test('a null count is never actionable, however it is dressed up', () => {
  for (const occupancy of [
    null,
    { count: null, available: true, usable: true, status: 'occupied' },
    { count: undefined, available: true, usable: true },
    { count: '0', available: true, usable: true },
    { count: 1.5, available: true, usable: true },
    { count: -1, available: true, usable: true },
    { count: 0, available: false, usable: true },
    { count: 0, available: true, usable: false },
    { count: 0, available: true, usable: true, status: 'stale' },
  ]) {
    assert.equal(
      isOccupancyActionable(occupancy).actionable,
      false,
      `${JSON.stringify(occupancy)} must not be actionable`
    );
  }

  // A genuine measured zero IS actionable — that is the whole distinction.
  assert.equal(
    isOccupancyActionable({ count: 0, available: true, usable: true, status: 'unoccupied' })
      .actionable,
    true
  );
});

test('an unusable reading freezes the threshold markers instead of advancing them', () => {
  const previous = { belowThresholdSince: null, aboveThresholdSince: new Date(NOW - 60_000) };
  const markers = updateThresholdMarkers({
    previous,
    occupancy: { count: null, available: false, usable: false, status: 'camera_unavailable' },
    threshold: 0,
    now: NOW,
  });

  // Neither clock started: a camera outage must not accumulate "unoccupied"
  // time that later satisfies a switch-off delay.
  assert.equal(markers.belowThresholdSince, null);
  assert.equal(markers.aboveThresholdSince, previous.aboveThresholdSince);
  assert.match(markers.reason, /^markers_frozen:/);
});

// ════════════════════════════════════════════════════════════════
// Automation is opt-in twice over
// ════════════════════════════════════════════════════════════════

test('a disabled rule changes nothing', () => {
  const decision = decideDeviceAction({
    rule: ruleFixture({ enabled: false }),
    device: deviceFixture(),
    occupancy: occupancyFixture(),
    now: NOW,
  });
  assert.equal(decision.decision, 'no_change');
  assert.match(decision.reason, /disabled/i);
});

test("a device whose control mode is not 'automatic' changes nothing", () => {
  for (const controlMode of ['disabled', 'manual']) {
    const decision = decideDeviceAction({
      rule: ruleFixture(),
      device: deviceFixture({ controlMode }),
      occupancy: occupancyFixture(),
      now: NOW,
    });
    assert.equal(decision.decision, 'no_change', `controlMode ${controlMode}`);
    assert.equal(decision.desiredState, null);
  }
});

// ════════════════════════════════════════════════════════════════
// Manual override
// ════════════════════════════════════════════════════════════════

test('an unexpired override produces skipped_override so automation cannot undo it', () => {
  const decision = decideDeviceAction({
    rule: ruleFixture(),
    device: deviceFixture({ reportedState: 'on' }),
    // The room reads as empty for long enough that automation WOULD switch off.
    occupancy: occupancyFixture({
      count: 0,
      status: 'unoccupied',
      aboveThresholdSince: null,
      belowThresholdSince: new Date(NOW - 3_600_000),
    }),
    now: NOW,
    override: { state: 'on', expiresAt: new Date(NOW + 10 * 60_000) },
  });

  assert.equal(decision.decision, 'skipped_override');
  assert.equal(decision.desiredState, null);
  assert.match(decision.reason, /resumes when the override expires/i);
});

test('an expired override stops protecting the device, so automatic control resumes', () => {
  const decision = decideDeviceAction({
    rule: ruleFixture(),
    device: deviceFixture({ reportedState: 'on' }),
    occupancy: occupancyFixture({
      count: 0,
      status: 'unoccupied',
      aboveThresholdSince: null,
      belowThresholdSince: new Date(NOW - 3_600_000),
    }),
    now: NOW,
    override: { state: 'on', expiresAt: new Date(NOW - 1000) },
  });

  assert.equal(decision.decision, 'switch_off');
});

test('an override with no expiry is treated as expired, not as permanent', () => {
  assert.equal(isOverrideActive({ state: 'on' }, NOW).active, false);
  assert.equal(isOverrideActive({ state: 'on', expiresAt: null }, NOW).reason, 'no_expiry');
  assert.equal(isOverrideActive(null, NOW).active, false);
  assert.equal(isOverrideActive({ state: 'on', expiresAt: new Date(NOW + 60_000) }, NOW).active, true);
});

// ════════════════════════════════════════════════════════════════
// Flapping and repeated commands
// ════════════════════════════════════════════════════════════════

test('a device already in the desired state produces no_change, not a repeated command', () => {
  const alreadyOn = decideDeviceAction({
    rule: ruleFixture(),
    device: deviceFixture({ reportedState: 'on' }),
    occupancy: occupancyFixture({ count: 4 }),
    now: NOW,
  });
  assert.equal(alreadyOn.decision, 'no_change');
  assert.match(alreadyOn.reason, /already on/i);

  const alreadyOff = decideDeviceAction({
    rule: ruleFixture(),
    device: deviceFixture({ reportedState: 'off' }),
    occupancy: occupancyFixture({
      count: 0,
      status: 'unoccupied',
      aboveThresholdSince: null,
      belowThresholdSince: new Date(NOW - 3_600_000),
    }),
    now: NOW,
  });
  assert.equal(alreadyOff.decision, 'no_change');
  assert.match(alreadyOff.reason, /already off/i);
});

test('the command cooldown produces skipped_cooldown', () => {
  const decision = decideDeviceAction({
    rule: ruleFixture({ commandCooldownSec: 60 }),
    device: deviceFixture({ reportedState: 'off' }),
    occupancy: occupancyFixture({ count: 4 }),
    now: NOW,
    lastCommandAt: new Date(NOW - 10_000),
  });
  assert.equal(decision.decision, 'skipped_cooldown');
  assert.equal(decision.desiredState, null);

  // Past the cooldown, the same inputs do switch.
  const after = decideDeviceAction({
    rule: ruleFixture({ commandCooldownSec: 60 }),
    device: deviceFixture({ reportedState: 'off' }),
    occupancy: occupancyFixture({ count: 4 }),
    now: NOW,
    lastCommandAt: new Date(NOW - 120_000),
  });
  assert.equal(after.decision, 'switch_on');
});

// ════════════════════════════════════════════════════════════════
// Thresholds, delays and schedules
// ════════════════════════════════════════════════════════════════

test('an occupied room above the threshold switches on', () => {
  const decision = decideDeviceAction({
    rule: ruleFixture({ occupancyThreshold: 1 }),
    device: deviceFixture({ reportedState: 'off' }),
    occupancy: occupancyFixture({ count: 2 }),
    now: NOW,
  });
  assert.equal(decision.decision, 'switch_on');
  assert.equal(decision.desiredState, 'on');
  assert.equal(decision.occupancyCount, 2);
});

test('the unoccupied delay must elapse before a switch_off', () => {
  const tooSoon = decideDeviceAction({
    rule: ruleFixture({ unoccupiedForSec: 300 }),
    device: deviceFixture({ reportedState: 'on' }),
    occupancy: occupancyFixture({
      count: 0,
      status: 'unoccupied',
      aboveThresholdSince: null,
      belowThresholdSince: new Date(NOW - 60_000),
    }),
    now: NOW,
  });
  assert.equal(tooSoon.decision, 'no_change');
  assert.match(tooSoon.reason, /required 300s/);

  const elapsed = decideDeviceAction({
    rule: ruleFixture({ unoccupiedForSec: 300 }),
    device: deviceFixture({ reportedState: 'on' }),
    occupancy: occupancyFixture({
      count: 0,
      status: 'unoccupied',
      aboveThresholdSince: null,
      belowThresholdSince: new Date(NOW - 400_000),
    }),
    now: NOW,
  });
  assert.equal(elapsed.decision, 'switch_off');
});

test('switchOffDelaySec composes with unoccupiedForSec rather than replacing it', () => {
  const decision = decideDeviceAction({
    rule: ruleFixture({ unoccupiedForSec: 300, switchOffDelaySec: 120 }),
    device: deviceFixture({ reportedState: 'on' }),
    occupancy: occupancyFixture({
      count: 0,
      status: 'unoccupied',
      aboveThresholdSince: null,
      // Past 300s but short of 300 + 120.
      belowThresholdSince: new Date(NOW - 350_000),
    }),
    now: NOW,
  });
  assert.equal(decision.decision, 'no_change');
  assert.match(decision.reason, /required 420s/);
});

test('allowed hours gate the decision and wrap past midnight', () => {
  assert.equal(parseHourMinute('18:00'), 18 * 60);
  assert.equal(parseHourMinute('6:30'), 6 * 60 + 30);
  assert.equal(parseHourMinute('24:00'), null);
  assert.equal(parseHourMinute('nope'), null);

  // No window at all means always allowed.
  assert.equal(isWithinAllowedHours({ start: '', end: '' }, 720).allowed, true);
  assert.equal(isWithinAllowedHours(undefined, 720).allowed, true);
  // Ordinary window.
  assert.equal(isWithinAllowedHours({ start: '09:00', end: '17:00' }, 600).allowed, true);
  assert.equal(isWithinAllowedHours({ start: '09:00', end: '17:00' }, 1200).allowed, false);
  // Wrapping window: 18:00 → 06:00 covers 23:00 and 02:00, not 12:00.
  assert.equal(isWithinAllowedHours({ start: '18:00', end: '06:00' }, 23 * 60).allowed, true);
  assert.equal(isWithinAllowedHours({ start: '18:00', end: '06:00' }, 2 * 60).allowed, true);
  assert.equal(isWithinAllowedHours({ start: '18:00', end: '06:00' }, 12 * 60).allowed, false);

  const decision = decideDeviceAction({
    rule: ruleFixture({ allowedHours: { start: '18:00', end: '22:00' } }),
    device: deviceFixture({ reportedState: 'off' }),
    occupancy: occupancyFixture({ count: 4 }),
    now: NOW,
    nowMinutes: 12 * 60,
  });
  assert.equal(decision.decision, 'skipped_schedule');
});

test('minutesOfDay is in range, and every decision is a declared enum value', () => {
  const minutes = minutesOfDay(new Date(NOW));
  assert.ok(minutes >= 0 && minutes <= 1439);

  const decisions = [
    decideDeviceAction({ rule: ruleFixture({ enabled: false }), device: deviceFixture(), occupancy: occupancyFixture(), now: NOW }),
    decideDeviceAction({ rule: ruleFixture(), device: deviceFixture(), occupancy: occupancyFixture(), now: NOW }),
    decideDeviceAction({ rule: ruleFixture(), device: deviceFixture(), occupancy: occupancyFixture({ usable: false, count: null }), now: NOW }),
  ];
  for (const decision of decisions) {
    assert.ok(
      AUTOMATION_DECISIONS.includes(decision.decision),
      `${decision.decision} must be a declared AutomationLog decision`
    );
  }
});

// ════════════════════════════════════════════════════════════════
// The adapter registry and the simulation adapter
// ════════════════════════════════════════════════════════════════

test("getAdapter returns the simulation adapter and THROWS for anything else", () => {
  assert.equal(getAdapter('simulation'), simulationAdapter);
  assert.equal(isAdapterImplemented('simulation'), true);
  assert.equal(isAdapterImplemented('http'), false);

  // Not stubbed, not silently simulated — refused, with the reason named.
  assert.throws(() => getAdapter('http'), /NOT IMPLEMENTED/);
  assert.throws(() => getAdapter('mqtt'), /Unknown device adapter/);
  assert.throws(() => getAdapter('esp32'), /Unknown device adapter/);
});

test("the simulation adapter acknowledges with simulated:true and a 'SIMULATED' message", async () => {
  resetSimulation();
  const device = deviceFixture();

  const result = await simulationAdapter.apply(device, 'on', { trigger: 'manual' });
  assert.equal(result.ok, true);
  assert.equal(result.reportedState, 'on');
  assert.equal(result.simulated, true);
  assert.match(result.message, /^SIMULATED/);

  const probe = await simulationAdapter.probe(device);
  assert.equal(probe.reportedState, 'on');
  assert.equal(probe.simulated, true);
  assert.match(probe.message, /^SIMULATED/);
});

test("a never-commanded simulated device probes as 'unknown', not 'off'", async () => {
  resetSimulation();
  const probe = await simulationAdapter.probe(deviceFixture({ deviceId: 'DEV-NEVER' }));
  assert.equal(probe.reportedState, 'unknown');
  assert.notEqual(probe.reportedState, 'off');
});

test('failure injection makes apply() return ok:false and leaves the simulated state alone', async () => {
  resetSimulation();
  const device = deviceFixture({ deviceId: 'DEV-FAILS' });

  await simulationAdapter.apply(device, 'on', {});
  setSimulatedFailure('DEV-FAILS', true);

  const failed = await simulationAdapter.apply(device, 'off', {});
  assert.equal(failed.ok, false);
  assert.match(failed.message, /^SIMULATED failure/);

  setSimulatedFailure('DEV-FAILS', false);
  const probe = await simulationAdapter.probe(device);
  // Still 'on': the refused command did not change anything.
  assert.equal(probe.reportedState, 'on');
  resetSimulation();
});

test('validateAdapterResult refuses a malformed or inconsistent success', () => {
  assert.equal(validateAdapterResult(undefined, 'on').valid, false);
  assert.equal(validateAdapterResult({}, 'on').valid, false);
  // A declared failure is a valid result; it just is not a success.
  assert.equal(validateAdapterResult({ ok: false }, 'on').valid, true);
  // Claims success but reports the wrong state → rejected, so the caller does
  // not record a change nobody confirmed.
  assert.equal(validateAdapterResult({ ok: true, reportedState: 'off' }, 'on').valid, false);
  assert.equal(validateAdapterResult({ ok: true, reportedState: 'unknown' }, 'on').valid, false);
  assert.equal(validateAdapterResult({ ok: true, reportedState: 'on' }, 'on').valid, true);
});

// ════════════════════════════════════════════════════════════════
// Energy arithmetic
// ════════════════════════════════════════════════════════════════

test('energyKwh is exactly watts × (seconds/3600) / 1000', () => {
  // 100 W for one hour = 0.1 kWh.
  assert.equal(energyKwh(100, 3600), 0.1);
  // 1000 W for one hour = 1 kWh.
  assert.equal(energyKwh(1000, 3600), 1);
  // 60 W for 30 minutes = 0.03 kWh.
  assert.ok(Math.abs(energyKwh(60, 1800) - 0.03) < 1e-12);
  // 108 W for 8 hours = 0.864 kWh.
  assert.ok(Math.abs(energyKwh(108, 8 * 3600) - 0.864) < 1e-12);

  // No NaN escapes from a misconfigured device.
  for (const [w, s] of [[0, 3600], [100, 0], [-5, 3600], [NaN, 10], [100, NaN], ['x', 'y']]) {
    assert.equal(energyKwh(w, s), 0);
  }
});

test('onSecondsFromHistory handles a state that began before the window', () => {
  const start = NOW;
  const end = NOW + 3600_000;
  const transitions = [
    // Switched on well before the window opened.
    { changedAt: new Date(NOW - 7200_000), toState: 'on', confirmed: true },
    // Switched off half way through it.
    { changedAt: new Date(NOW + 1800_000), toState: 'off', confirmed: true },
  ];

  // Counted from the WINDOW START, not from the transition two hours earlier.
  assert.equal(onSecondsFromHistory(transitions, start, end), 1800);
});

test('onSecondsFromHistory closes an interval still open at the window end', () => {
  const start = NOW;
  const end = NOW + 3600_000;
  const transitions = [
    { changedAt: new Date(NOW + 1800_000), toState: 'on', confirmed: true },
  ];
  // Closed at windowEnd, not at "now" and not dropped.
  assert.equal(onSecondsFromHistory(transitions, start, end), 1800);
});

test('onSecondsFromHistory excludes unconfirmed rows and unknown states', () => {
  const start = NOW;
  const end = NOW + 3600_000;

  // A command that FAILED must not bill the room for an hour.
  assert.equal(
    onSecondsFromHistory(
      [{ changedAt: new Date(NOW + 1000), toState: 'on', confirmed: false }],
      start,
      end
    ),
    0
  );
  // 'unknown' is not 'on' and not 'off' — it contributes nothing.
  assert.equal(
    onSecondsFromHistory(
      [{ changedAt: new Date(NOW - 1000), toState: 'unknown', confirmed: true }],
      start,
      end
    ),
    0
  );
  assert.equal(onSecondsFromHistory([], start, end), 0);
  assert.equal(onSecondsFromHistory(null, start, end), 0);
  // A nonsense window yields 0 rather than a negative duration.
  assert.equal(onSecondsFromHistory([], end, start), 0);
});

test('hasUsableHistory distinguishes "device was off" from "nothing is known"', () => {
  const start = NOW;
  const end = NOW + 3600_000;

  assert.equal(hasUsableHistory([], start, end).usable, false);
  assert.equal(
    hasUsableHistory([{ changedAt: new Date(NOW + 1000), toState: 'on', confirmed: false }], start, end)
      .usable,
    false
  );
  assert.equal(
    hasUsableHistory([{ changedAt: new Date(NOW + 1000), toState: 'on', confirmed: true }], start, end)
      .usable,
    true
  );
});

test('the baseline is pro-rated for the window and never claims more hours than elapsed', () => {
  // 100 W × 12 h = 1.2 kWh for a full day.
  assert.ok(Math.abs(baselineKwh({ watts: 100, baselineHoursPerDay: 12, windowHours: 24 }) - 1.2) < 1e-12);
  // Half a day gets half the baseline.
  assert.ok(Math.abs(baselineKwh({ watts: 100, baselineHoursPerDay: 12, windowHours: 12 }) - 0.6) < 1e-12);
  // A 2-hour window cannot be compared against 12 baseline hours: the
  // baseline is capped at the window, so it is 100 W × 1 h here.
  assert.ok(Math.abs(baselineKwh({ watts: 100, baselineHoursPerDay: 12, windowHours: 2 }) - 0.1) < 1e-12);
  // An unconfigured rating produces no baseline rather than a guess.
  assert.equal(baselineKwh({ watts: 0, baselineHoursPerDay: 12, windowHours: 24 }), 0);
});

test('savingsKwh is clamped at zero', () => {
  // Compared with a tolerance, in the same style as the baseline test above.
  // savingsKwh returns the full-precision subtraction (1.2 - 0.4 is
  // 0.7999999999999999 in IEEE-754 binary), and that is deliberate:
  // services/energyService.js rounds for presentation with roundKwh() on every
  // figure it returns, so the arithmetic here must not pre-round.
  assert.ok(Math.abs(savingsKwh(1.2, 0.4) - 0.8) < 1e-12, 'ordinary saving');
  // The CLAMP, by contrast, is an exact boundary: ran LONGER than the baseline
  // means zero saved, not a negative saving and not a near-zero.
  assert.equal(savingsKwh(0.4, 1.2), 0);
  assert.equal(savingsKwh(NaN, 1), 0);
});

test('savingsPercent returns NULL when the baseline is 0 — no misleading percentage', () => {
  assert.equal(savingsPercent(0, 0), null);
  assert.equal(savingsPercent(0, 5), null);
  assert.equal(savingsPercent(-1, 0), null);
  assert.equal(savingsPercent(NaN, 0), null);
  assert.equal(savingsPercent(1, NaN), null);

  // With a real baseline it is an ordinary percentage, clamped to [0, 100].
  assert.equal(savingsPercent(1, 0.25), 75);
  assert.equal(savingsPercent(1, 0), 100);
  assert.equal(savingsPercent(1, 2), 0);
});

test('windowHours is floored at zero', () => {
  assert.equal(windowHours(NOW, NOW + 3600_000), 1);
  assert.equal(windowHours(NOW + 3600_000, NOW), 0);
  assert.equal(windowHours('nope', NOW), 0);
});

// ════════════════════════════════════════════════════════════════
// Structural guarantees
// ════════════════════════════════════════════════════════════════

test('automationRules.js and energyRules.js import NOTHING, so they are testable without Mongo', () => {
  for (const file of ['automationRules.js', 'energyRules.js']) {
    const source = readSrc('services', file);
    assert.equal(
      /^\s*import\s/m.test(source),
      false,
      `services/${file} must not import anything — it is the dependency-free rules module`
    );
    assert.equal(/require\(/.test(source), false, `services/${file} must not require anything`);
  }
});

test('every mutating device route requires the admin role as well as auth', () => {
  const source = readSrc('routes', 'deviceRoutes.js');
  const mutations = [...source.matchAll(/router\.(post|put|patch|delete)\s*\(([\s\S]*?)\);/g)];

  assert.ok(
    mutations.length >= 6,
    'expected the create/update/delete/command/control-mode/override/probe routes'
  );
  for (const [, method, body] of mutations) {
    assert.match(body, /requireAuth/, `${method} device route must require auth`);
    assert.match(
      body,
      /requireRole\('admin'\)/,
      `${method} device route must require the admin role — these switch a device`
    );
  }

  // The command route specifically, since it is the one that switches things.
  const command = /router\.post\(\s*\n?\s*'\/:id\/command',([\s\S]*?)\);/.exec(source);
  assert.ok(command, 'POST /:id/command must be registered');
  assert.match(command[1], /requireRole\('admin'\)/);
  assert.match(command[1], /validate\(commandSchema\)/);
});

test('every mutating automation route requires the admin role as well as auth', () => {
  const source = readSrc('routes', 'automationRoutes.js');
  const mutations = [...source.matchAll(/router\.(post|put|patch|delete)\s*\(([\s\S]*?)\);/g)];

  assert.ok(mutations.length >= 6, 'expected create/update/delete/enable/disable/evaluate');
  for (const [, method, body] of mutations) {
    assert.match(body, /requireAuth/, `${method} automation route must require auth`);
    assert.match(
      body,
      /requireRole\('admin'\)/,
      `${method} automation route must require the admin role`
    );
  }

  assert.match(source, /router\.post\('\/rules\/:id\/enable',\s*requireAuth,\s*requireRole\('admin'\)/);
  assert.match(source, /router\.post\('\/rules\/:id\/disable',\s*requireAuth,\s*requireRole\('admin'\)/);
});

test('the energy router exposes GET only — energy figures are derived, never submitted', () => {
  const source = readSrc('routes', 'energyRoutes.js')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => !line.startsWith('//') && !line.startsWith('*'))
    .join('\n');

  const methods = [...source.matchAll(/router\.(get|post|put|patch|delete)\s*\(/g)].map((m) => m[1]);
  assert.ok(methods.length > 0, 'the energy router must register routes');
  assert.deepEqual([...new Set(methods)], ['get']);
});

test('the Device and AutomationRule schemas default to off', () => {
  const device = readSrc('models', 'Device.js');
  // controlMode 'disabled' and reportedState 'unknown' are the two defaults
  // that keep this feature from switching anything it was not asked to.
  assert.match(device, /enum: \['automatic', 'manual', 'disabled'\][\s\S]{0,80}default: 'disabled'/);
  assert.match(device, /enum: \['on', 'off', 'unknown'\][\s\S]{0,80}default: 'unknown'/);

  const rule = readSrc('models', 'AutomationRule.js');
  assert.match(rule, /enabled: \{ type: Boolean, default: false/);
  assert.match(rule, /onUnavailableOccupancy[\s\S]{0,200}default: 'suspend'/);
});

test('deviceService only records a confirmed state change, and never syncIndexes', () => {
  const source = readSrc('services', 'deviceService.js');
  // The success path is the only place reportedState is assigned from an
  // adapter result, and it sits after the `if (!result.ok)` early return.
  const failureIndex = source.indexOf('if (!result.ok)');
  const assignIndex = source.indexOf('device.reportedState = result.reportedState');
  assert.ok(failureIndex > 0, 'the failure path must exist');
  assert.ok(assignIndex > failureIndex, 'reportedState must only be assigned after the failure return');
  assert.match(source, /type: 'device_failure'/);

  const db = readSrc('config', 'db.js');
  assert.equal(/\.syncIndexes\(\)/.test(db), false, 'db.js must never call syncIndexes()');
  assert.match(db, /export function getDeviceAutomationIndexState/);
});
