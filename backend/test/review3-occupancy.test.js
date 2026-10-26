/**
 * Review 3 — occupancy decision rules.
 *
 * Imports services/occupancyRules.js directly. That module imports NOTHING —
 * no mongoose, no env, no logger — so these tests need no MongoDB, no AI
 * service and no model weights, exactly like the Review 2 identityRules tests.
 *
 * The properties asserted here are the ones the feature turns on:
 *   • an unavailable or stale reading reports count NULL, never 0;
 *   • a multi-camera room aggregates with MAX, never a sum;
 *   • consecutive identical readings are persisted once, not per frame;
 *   • history paging is always bounded.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OCCUPANCY_STATUSES,
  OCCUPANCY_STATUS_LABELS,
  aggregateRoomCount,
  deriveOccupancyStatus,
  isOccupancyUsable,
  isValidCount,
  normalizeHistoryPaging,
  parseDateRange,
  shouldPersistReading,
  shouldRaiseOccupancyAlert,
} from '../src/services/occupancyRules.js';

const NOW = Date.UTC(2026, 0, 15, 10, 0, 0);
const fresh = new Date(NOW - 1000); // measured one second ago

// ── Status derivation ─────────────────────────────────────────────

test('deriveOccupancyStatus returns only the six documented statuses', () => {
  const cases = [
    { count: 0, capacity: 10, available: true, lastUpdatedAt: fresh },
    { count: 3, capacity: 10, available: true, lastUpdatedAt: fresh },
    { count: 8, capacity: 10, available: true, lastUpdatedAt: fresh },
    { count: 12, capacity: 10, available: true, lastUpdatedAt: fresh },
    { count: null, capacity: 10, available: false, lastUpdatedAt: null },
    { count: 4, capacity: 10, available: true, lastUpdatedAt: new Date(NOW - 600000) },
  ];

  for (const input of cases) {
    const result = deriveOccupancyStatus({ ...input, now: NOW, staleAfterSec: 30 });
    assert.ok(
      OCCUPANCY_STATUSES.includes(result.status),
      `unexpected status ${result.status}`
    );
    assert.equal(result.label, OCCUPANCY_STATUS_LABELS[result.status]);
  }
});

test('a camera that cannot be read reports a NULL count, never 0', () => {
  const result = deriveOccupancyStatus({
    count: null,
    capacity: 10,
    available: false,
    lastUpdatedAt: null,
    now: NOW,
  });

  assert.equal(result.status, 'camera_unavailable');
  assert.equal(result.count, null);
  assert.notEqual(result.count, 0);
  assert.equal(result.available, false);
});

test('a last-known count is NOT reported as 0 when availability is lost', () => {
  // The worker keeps its last count; the backend must still refuse to present
  // it as current, and must not substitute 0 for it either.
  const result = deriveOccupancyStatus({
    count: 7,
    capacity: 10,
    available: false,
    lastUpdatedAt: fresh,
    now: NOW,
  });

  assert.equal(result.status, 'camera_unavailable');
  assert.equal(result.count, null);
});

test('a reading older than the staleness window becomes stale with a null count', () => {
  const result = deriveOccupancyStatus({
    count: 5,
    capacity: 10,
    available: true,
    lastUpdatedAt: new Date(NOW - 31000),
    now: NOW,
    staleAfterSec: 30,
  });

  assert.equal(result.status, 'stale');
  assert.equal(result.count, null);
  assert.equal(result.available, false);
});

test('monitoring disabled is unavailable, not unoccupied', () => {
  const result = deriveOccupancyStatus({
    count: 0,
    capacity: 10,
    available: true,
    lastUpdatedAt: fresh,
    now: NOW,
    monitoringEnabled: false,
  });

  assert.equal(result.status, 'camera_unavailable');
  assert.equal(result.reason, 'monitoring_disabled');
  assert.equal(result.count, null);
});

test('a measured zero IS unoccupied — the honest empty-room case', () => {
  const result = deriveOccupancyStatus({
    count: 0,
    capacity: 10,
    available: true,
    lastUpdatedAt: fresh,
    now: NOW,
  });

  assert.equal(result.status, 'unoccupied');
  assert.equal(result.count, 0);
  assert.equal(result.available, true);
});

test('capacity statuses are derived from capacity and the near-capacity ratio', () => {
  const base = { capacity: 10, available: true, lastUpdatedAt: fresh, now: NOW };

  assert.equal(deriveOccupancyStatus({ ...base, count: 11 }).status, 'capacity_exceeded');
  assert.equal(deriveOccupancyStatus({ ...base, count: 8 }).status, 'near_capacity');
  assert.equal(deriveOccupancyStatus({ ...base, count: 3 }).status, 'occupied');
  assert.equal(deriveOccupancyStatus({ ...base, count: 0 }).status, 'unoccupied');
});

test('a room with no configured capacity never reports a capacity status', () => {
  const base = { capacity: 0, available: true, lastUpdatedAt: fresh, now: NOW };

  assert.equal(deriveOccupancyStatus({ ...base, count: 500 }).status, 'occupied');
  assert.equal(deriveOccupancyStatus({ ...base, count: 0 }).status, 'unoccupied');
});

test('the occupancy threshold decides occupied vs unoccupied', () => {
  const base = { capacity: 0, available: true, lastUpdatedAt: fresh, now: NOW };

  assert.equal(
    deriveOccupancyStatus({ ...base, count: 2, occupancyThreshold: 3 }).status,
    'unoccupied'
  );
  assert.equal(
    deriveOccupancyStatus({ ...base, count: 3, occupancyThreshold: 3 }).status,
    'occupied'
  );
});

// ── Aggregation ───────────────────────────────────────────────────

test('a multi-camera room aggregates with MAX, never a sum', () => {
  const result = aggregateRoomCount([
    { cameraId: 'CAM-01', count: 4, available: true },
    { cameraId: 'CAM-02', count: 3, available: true },
  ]);

  assert.equal(result.count, 4);
  assert.notEqual(result.count, 7, 'summing would double-count anyone in the overlap');
  assert.equal(result.aggregation, 'max');
  assert.equal(result.available, true);
  assert.equal(result.usableCameras, 2);
});

test('an unavailable camera contributes nothing — it is not counted as zero', () => {
  const result = aggregateRoomCount([
    { cameraId: 'CAM-01', count: 5, available: true },
    { cameraId: 'CAM-02', count: null, available: false },
  ]);

  assert.equal(result.count, 5);
  assert.equal(result.available, true);
  assert.equal(result.usableCameras, 1);
  assert.equal(result.totalCameras, 2);
});

test('a room whose every camera is unavailable aggregates to null, not 0', () => {
  for (const cameras of [
    [],
    [{ cameraId: 'CAM-01', count: null, available: false }],
    [{ cameraId: 'CAM-01', count: 3, available: false }],
  ]) {
    const result = aggregateRoomCount(cameras);
    assert.equal(result.count, null);
    assert.equal(result.available, false);
  }
});

test('a non-integer or negative count is not a usable measurement', () => {
  assert.equal(isValidCount(2), true);
  assert.equal(isValidCount(0), true);
  for (const bad of [-1, 1.5, '2', null, undefined, NaN, Infinity, {}]) {
    assert.equal(isValidCount(bad), false, `${String(bad)} must not be a usable count`);
  }
});

// ── Usability ─────────────────────────────────────────────────────

test('isOccupancyUsable names the reason a figure cannot be used', () => {
  assert.deepEqual(
    isOccupancyUsable({ count: 2, available: false, lastUpdatedAt: fresh, now: NOW }).reason,
    'camera_unavailable'
  );
  assert.equal(
    isOccupancyUsable({ count: null, available: true, lastUpdatedAt: fresh, now: NOW }).reason,
    'no_measurement'
  );
  assert.equal(
    isOccupancyUsable({ count: 2, available: true, lastUpdatedAt: null, now: NOW }).reason,
    'no_measurement'
  );
  assert.equal(
    isOccupancyUsable({
      count: 2,
      available: true,
      lastUpdatedAt: new Date(NOW - 60000),
      now: NOW,
      staleAfterSec: 30,
    }).reason,
    'stale'
  );
  assert.equal(
    isOccupancyUsable({ count: 2, available: true, lastUpdatedAt: fresh, now: NOW }).usable,
    true
  );
});

// ── Persistence ───────────────────────────────────────────────────

test('the first reading for a room always persists', () => {
  const decision = shouldPersistReading({
    previous: null,
    next: { count: 3, status: 'occupied', available: true },
    lastPersistedAt: null,
    now: NOW,
  });

  assert.equal(decision.persist, true);
  assert.equal(decision.reason, 'first_reading');
});

test('consecutive identical readings are NOT persisted per frame', () => {
  const reading = { count: 3, status: 'occupied', available: true };

  // Simulate many reports arriving a second apart with nothing changing.
  let writes = 0;
  const lastPersistedAt = NOW;
  for (let i = 1; i <= 30; i += 1) {
    const decision = shouldPersistReading({
      previous: reading,
      next: reading,
      lastPersistedAt,
      now: NOW + i * 1000,
      minIntervalSec: 60,
    });
    if (decision.persist) writes += 1;
  }

  assert.equal(writes, 0, 'an unchanged reading inside the interval must not be written');
});

test('a changed count, status or availability persists immediately', () => {
  const previous = { count: 3, status: 'occupied', available: true };
  const common = { previous, lastPersistedAt: NOW, now: NOW + 1000, minIntervalSec: 60 };

  assert.equal(
    shouldPersistReading({ ...common, next: { ...previous, count: 4 } }).reason,
    'count_changed'
  );
  assert.equal(
    shouldPersistReading({ ...common, next: { ...previous, status: 'near_capacity' } }).reason,
    'status_changed'
  );
  assert.equal(
    shouldPersistReading({ ...common, next: { ...previous, available: false } }).reason,
    'availability_changed'
  );
});

test('an unchanged reading still persists once the sampling interval elapses', () => {
  const reading = { count: 3, status: 'occupied', available: true };
  const decision = shouldPersistReading({
    previous: reading,
    next: reading,
    lastPersistedAt: NOW,
    now: NOW + 61000,
    minIntervalSec: 60,
  });

  assert.equal(decision.persist, true);
  assert.equal(decision.reason, 'sampling_interval');
});

// ── Alerting ──────────────────────────────────────────────────────

test('only crowding conditions are alertable, and never as critical', () => {
  for (const status of ['occupied', 'unoccupied', 'camera_unavailable', 'stale']) {
    const decision = shouldRaiseOccupancyAlert({ status, now: NOW });
    assert.equal(decision.raise, false, `${status} must not raise a capacity alert`);
  }

  for (const status of ['near_capacity', 'capacity_exceeded']) {
    const decision = shouldRaiseOccupancyAlert({ status, now: NOW });
    assert.equal(decision.raise, true);
    assert.equal(decision.severity, 'warning');
    assert.notEqual(decision.severity, 'critical');
  }
});

test('the per-room alert cooldown suppresses a repeat of the same condition', () => {
  const decision = shouldRaiseOccupancyAlert({
    status: 'near_capacity',
    previousStatus: 'near_capacity',
    lastAlertAt: new Date(NOW - 60000),
    now: NOW,
    cooldownSec: 300,
  });

  assert.equal(decision.raise, false);
  assert.equal(decision.reason, 'cooldown');
});

test('an escalation to capacity exceeded is alerted even inside the cooldown', () => {
  const decision = shouldRaiseOccupancyAlert({
    status: 'capacity_exceeded',
    previousStatus: 'near_capacity',
    lastAlertAt: new Date(NOW - 60000),
    now: NOW,
    cooldownSec: 300,
  });

  assert.equal(decision.raise, true);
});

// ── Bounded history queries ───────────────────────────────────────

test('history paging is always bounded, whatever the caller asks for', () => {
  assert.equal(normalizeHistoryPaging({ limit: 100000, maxLimit: 500 }).perPage, 500);
  assert.equal(normalizeHistoryPaging({ limit: 0, maxLimit: 500 }).perPage, 50);
  assert.equal(normalizeHistoryPaging({ limit: -5, maxLimit: 500 }).perPage, 50);
  assert.equal(normalizeHistoryPaging({ limit: 'all', maxLimit: 500 }).perPage, 50);
  assert.equal(normalizeHistoryPaging({ limit: undefined, maxLimit: 500 }).perPage, 50);
  assert.equal(normalizeHistoryPaging({ limit: 25, maxLimit: 500 }).perPage, 25);

  const paged = normalizeHistoryPaging({ limit: 10, page: 3, maxLimit: 500 });
  assert.equal(paged.skip, 20);
  assert.equal(paged.page, 3);

  // A nonsense page never produces a negative skip.
  assert.equal(normalizeHistoryPaging({ limit: 10, page: -2 }).skip, 0);
});

test('an unparseable date narrows nothing instead of reaching Mongo', () => {
  assert.equal(parseDateRange({ from: 'banana' }), null);
  assert.equal(parseDateRange({}), null);
  // An object from `?from[$gt]=x` must be dropped, not passed through.
  assert.equal(parseDateRange({ from: { $gt: '2026-01-01' } }), null);

  const range = parseDateRange({ from: '2026-01-01', to: '2026-01-31' });
  assert.ok(range.$gte instanceof Date);
  assert.ok(range.$lte instanceof Date);
});
