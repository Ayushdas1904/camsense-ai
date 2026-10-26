/**
 * Pure decision rules for Review 3 occupancy.
 *
 * Deliberately DEPENDENCY-FREE, exactly like services/identityRules.js: this
 * module imports nothing — no mongoose, no env, no logger. Every rule is a
 * pure function of its arguments, which is what makes the behaviour that
 * actually matters (status derivation, the never-report-0-for-unknown rule,
 * change-based persistence, multi-camera aggregation) unit-testable with
 * node:test and no live MongoDB and no AI service.
 *
 * occupancyService.js holds the I/O; the judgement lives here.
 */

/**
 * The six occupancy statuses, and the labels the UI shows for them.
 *
 * Exported as data so the frontend, the schema enums and any test all read the
 * same list instead of three copies drifting apart.
 */
export const OCCUPANCY_STATUSES = [
  'occupied',
  'unoccupied',
  'near_capacity',
  'capacity_exceeded',
  'camera_unavailable',
  'stale',
];

export const OCCUPANCY_STATUS_LABELS = {
  occupied: 'Occupied',
  unoccupied: 'Unoccupied',
  near_capacity: 'Near Capacity',
  capacity_exceeded: 'Capacity Exceeded',
  camera_unavailable: 'Camera Unavailable',
  stale: 'Occupancy Data Stale',
};

/** Whether a value is a usable, non-negative, whole headcount. */
export function isValidCount(count) {
  return (
    typeof count === 'number' &&
    Number.isFinite(count) &&
    Number.isInteger(count) &&
    count >= 0
  );
}

/**
 * Aggregates the per-camera counts of ONE room into a single figure.
 *
 * TAKES THE MAXIMUM. NEVER THE SUM. This is the single most important rule in
 * the module, so it is spelled out:
 *
 *   This project implements NO cross-camera re-identification. The AI service's
 *   person tracks are per-camera and transient, so when two cameras cover the
 *   same room, one person standing in the overlap is tracked independently by
 *   both and there is no way to know the two tracks are the same human.
 *   ADDING the two counts would therefore report two people where there is
 *   one, and the error grows with the overlap. The maximum is a documented
 *   LOWER BOUND on the true headcount — possibly an undercount when the
 *   cameras see genuinely different parts of the room, but never a fabricated
 *   overcount, and never a number the system cannot justify.
 *
 *   For an accurate count, give a room one camera that covers it. Several
 *   cameras are supported for coverage, not for additive counting.
 *
 * Cameras whose figure is unavailable are IGNORED rather than treated as 0 — a
 * camera we cannot read contributes no information, not a count of nobody.
 *
 * @param {Array<{count?: number|null, available?: boolean}>} perCameraCounts
 * @returns {{ count: number|null, available: boolean, usableCameras: number,
 *             totalCameras: number, aggregation: 'max' }}
 */
export function aggregateRoomCount(perCameraCounts) {
  const entries = Array.isArray(perCameraCounts) ? perCameraCounts : [];
  const usable = entries.filter(
    (entry) => entry && entry.available !== false && isValidCount(entry.count)
  );

  if (usable.length === 0) {
    // No camera produced a trustworthy figure. null, not 0.
    return {
      count: null,
      available: false,
      usableCameras: 0,
      totalCameras: entries.length,
      aggregation: 'max',
    };
  }

  const count = usable.reduce((max, entry) => (entry.count > max ? entry.count : max), 0);
  return {
    count,
    available: true,
    usableCameras: usable.length,
    totalCameras: entries.length,
    aggregation: 'max',
  };
}

/**
 * Whether an occupancy figure may be used for a decision (a displayed count,
 * a capacity alert, or — in a later Review 3 feature — switching a device).
 *
 * Three independent reasons it may not be:
 *   1. the measurement was not available (model missing, capture failing)
 *   2. the count itself is not a valid non-negative integer
 *   3. the measurement is OLDER than `staleAfterSec`
 *
 * Rule 3 is the one that matters for safety: a figure that stopped updating
 * five minutes ago is not evidence about the room now, and it must never be
 * mistaken for a current reading of an empty room.
 */
export function isOccupancyUsable({
  count,
  available,
  lastUpdatedAt,
  now = Date.now(),
  staleAfterSec = 30,
} = {}) {
  if (available === false) return { usable: false, reason: 'camera_unavailable' };
  if (!isValidCount(count)) return { usable: false, reason: 'no_measurement' };

  const at = lastUpdatedAt === null || lastUpdatedAt === undefined ? null : Number(new Date(lastUpdatedAt));
  if (at === null || !Number.isFinite(at)) return { usable: false, reason: 'no_measurement' };

  const ageSec = (Number(now) - at) / 1000;
  const limit = Number(staleAfterSec);
  if (Number.isFinite(limit) && limit > 0 && ageSec > limit) {
    return { usable: false, reason: 'stale', ageSec };
  }
  return { usable: true, reason: 'measured', ageSec };
}

/**
 * Derives the room's occupancy status, and the count that may be reported
 * alongside it.
 *
 * ORDER MATTERS, and the unavailability checks come FIRST:
 *
 *   camera_unavailable — the figure could not be measured at all.
 *   stale              — it was measured, but too long ago to mean anything.
 *   capacity_exceeded  — a trustworthy count is above the configured capacity.
 *   near_capacity      — a trustworthy count has reached capacity × ratio.
 *   occupied           — a trustworthy count is at or above the threshold.
 *   unoccupied         — a trustworthy count is below the threshold.
 *
 * THE RULE THIS FUNCTION EXISTS TO ENFORCE: for `camera_unavailable` and
 * `stale`, the returned `count` is **null**, NOT 0. Reporting 0 would state
 * that the room is empty, which is a claim the system cannot make from a
 * camera it cannot read or a reading it cannot trust. Everything downstream —
 * the dashboard, the history, and the automation engine in a later Review 3
 * feature — relies on that distinction, because treating "unknown" as "empty"
 * is what would switch the lights off on a room full of people.
 *
 * Capacity-derived statuses are skipped entirely when `capacity` is 0 or
 * unset: a ratio of an unknown capacity is meaningless, so such a room only
 * ever reports occupied/unoccupied.
 *
 * `monitoringEnabled: false` is reported as `camera_unavailable` with a
 * `monitoring_disabled` reason — the room is deliberately not being measured,
 * so the honest answer is still "no current figure", never "empty".
 *
 * @returns {{ status: string, count: number|null, available: boolean,
 *             reason: string, label: string, ageSec: number|null }}
 */
export function deriveOccupancyStatus({
  count,
  capacity = 0,
  available = true,
  lastUpdatedAt = null,
  now = Date.now(),
  staleAfterSec = 30,
  monitoringEnabled = true,
  nearCapacityRatio = 0.8,
  occupancyThreshold = 1,
} = {}) {
  const decide = (status, reason, reportedCount, ageSec = null) => ({
    status,
    count: reportedCount,
    available: status !== 'camera_unavailable' && status !== 'stale',
    reason,
    label: OCCUPANCY_STATUS_LABELS[status],
    ageSec,
  });

  if (monitoringEnabled === false) {
    return decide('camera_unavailable', 'monitoring_disabled', null);
  }

  const usable = isOccupancyUsable({ count, available, lastUpdatedAt, now, staleAfterSec });
  if (!usable.usable) {
    // null, never 0 — see the note above.
    if (usable.reason === 'stale') {
      return decide('stale', 'stale', null, usable.ageSec ?? null);
    }
    return decide('camera_unavailable', usable.reason, null, usable.ageSec ?? null);
  }

  const cap = Number(capacity);
  const hasCapacity = Number.isFinite(cap) && cap > 0;
  const threshold = Number.isFinite(Number(occupancyThreshold))
    ? Number(occupancyThreshold)
    : 1;

  if (hasCapacity && count > cap) {
    return decide('capacity_exceeded', 'above_capacity', count, usable.ageSec ?? null);
  }

  if (hasCapacity) {
    const ratio = Number(nearCapacityRatio);
    const nearLimit = Number.isFinite(ratio) && ratio > 0 ? cap * ratio : null;
    if (nearLimit !== null && count >= nearLimit && count > 0) {
      return decide('near_capacity', 'near_capacity', count, usable.ageSec ?? null);
    }
  }

  if (count >= Math.max(threshold, 1)) {
    return decide('occupied', 'above_threshold', count, usable.ageSec ?? null);
  }
  return decide('unoccupied', 'below_threshold', count, usable.ageSec ?? null);
}

/**
 * Whether this reading should be written to the occupancy HISTORY.
 *
 * The AI service reports every few seconds per camera, and the camera worker
 * measures every processed frame. Persisting all of that would add thousands
 * of near-identical rows per hour with no analytical value, so persistence is
 * CHANGE-BASED **plus** SAMPLED:
 *
 *   • the count changed                        → write (that is the event)
 *   • the status changed                       → write (occupied↔unoccupied,
 *                                                 or a camera going dark)
 *   • the availability flag changed            → write
 *   • nothing changed, but `minIntervalSec`
 *     has elapsed since the last write         → write (a heartbeat, so a
 *                                                 steady room still produces a
 *                                                 readable history)
 *   • nothing changed and the interval has
 *     not elapsed                              → SKIP
 *
 * The first reading for a room always writes, because `lastPersistedAt` is
 * null. Consecutive identical frames therefore produce exactly one row, which
 * is the property the acceptance criterion asks for.
 *
 * @param {{ count?: number|null, status?: string, available?: boolean }} previous
 * @param {{ count?: number|null, status?: string, available?: boolean }} next
 * @returns {{ persist: boolean, reason: string }}
 */
export function shouldPersistReading({
  previous = null,
  next = null,
  lastPersistedAt = null,
  now = Date.now(),
  minIntervalSec = 60,
} = {}) {
  if (!next) return { persist: false, reason: 'no_reading' };

  if (!previous || lastPersistedAt === null || lastPersistedAt === undefined) {
    return { persist: true, reason: 'first_reading' };
  }

  const prevCount = previous.count === undefined ? null : previous.count;
  const nextCount = next.count === undefined ? null : next.count;
  if (prevCount !== nextCount) return { persist: true, reason: 'count_changed' };
  if (previous.status !== next.status) return { persist: true, reason: 'status_changed' };
  if (Boolean(previous.available) !== Boolean(next.available)) {
    return { persist: true, reason: 'availability_changed' };
  }

  const at = Number(new Date(lastPersistedAt));
  if (!Number.isFinite(at)) return { persist: true, reason: 'first_reading' };
  const elapsedSec = (Number(now) - at) / 1000;
  const interval = Number(minIntervalSec);
  if (Number.isFinite(interval) && elapsedSec >= interval) {
    return { persist: true, reason: 'sampling_interval' };
  }

  return { persist: false, reason: 'unchanged_within_interval' };
}

/**
 * Whether an occupancy/capacity ALERT may be raised for this room right now.
 *
 * Two gates, mirroring the Review 1/2 cooldown pattern:
 *   • only `near_capacity` and `capacity_exceeded` are alertable at all — an
 *     ordinary occupied or unoccupied room is not an incident, and an
 *     unavailable or stale reading is a DATA problem, not a crowding one, so
 *     it must not raise a capacity alert on evidence it does not have
 *   • the same room does not alert again inside `cooldownSec`, so one busy
 *     room produces one alert rather than one per report
 *
 * @returns {{ raise: boolean, reason: string, severity: string|null }}
 */
export function shouldRaiseOccupancyAlert({
  status,
  previousStatus = null,
  lastAlertAt = null,
  now = Date.now(),
  cooldownSec = 300,
} = {}) {
  if (status !== 'near_capacity' && status !== 'capacity_exceeded') {
    return { raise: false, reason: 'not_alertable', severity: null };
  }

  // 'warning', not 'critical', for BOTH. A crowded room is an operational
  // condition that someone should look at; it is not a weapon sighting, and
  // ranking it alongside one would devalue the critical tier.
  const severity = 'warning';

  if (lastAlertAt !== null && lastAlertAt !== undefined) {
    const at = Number(new Date(lastAlertAt));
    const cooldownMs = (Number(cooldownSec) || 0) * 1000;
    if (Number.isFinite(at) && Number(now) - at < cooldownMs) {
      // An ESCALATION from near_capacity to capacity_exceeded is worth an
      // alert even inside the cooldown — it is a different, worse condition,
      // not a repeat of the same one.
      if (!(previousStatus === 'near_capacity' && status === 'capacity_exceeded')) {
        return { raise: false, reason: 'cooldown', severity };
      }
    }
  }

  return { raise: true, reason: status, severity };
}

/**
 * Clamps a history page request into a bounded query.
 *
 * Every historical read goes through this, so there is no path to an unbounded
 * query: a missing, zero, negative, non-numeric or absurdly large `limit` all
 * collapse to something between 1 and `maxLimit`.
 */
export function normalizeHistoryPaging({ limit, page, maxLimit = 500 } = {}) {
  const hardMax = Math.max(1, Number(maxLimit) || 500);
  const requested = Number(limit);
  const perPage = Number.isFinite(requested) && requested > 0
    ? Math.min(Math.floor(requested), hardMax)
    : Math.min(50, hardMax);

  const requestedPage = Number(page);
  const currentPage = Number.isFinite(requestedPage) && requestedPage > 0
    ? Math.floor(requestedPage)
    : 1;

  return { perPage, page: currentPage, skip: (currentPage - 1) * perPage, maxLimit: hardMax };
}

/**
 * Parses an inclusive-from / exclusive-to date range out of raw query values.
 *
 * Invalid dates are DROPPED rather than coerced, so `?from=banana` narrows
 * nothing instead of producing an `Invalid Date` that silently matches no
 * documents (or, worse, reaches Mongo as an operator object).
 */
export function parseDateRange({ from, to } = {}) {
  const range = {};
  const parse = (value) => {
    if (value === undefined || value === null || typeof value === 'object') return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  };
  const start = parse(from);
  const end = parse(to);
  if (start) range.$gte = start;
  if (end) range.$lte = end;
  return Object.keys(range).length > 0 ? range : null;
}
