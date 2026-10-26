import { Device } from '../models/Device.js';
import { DeviceStateHistory } from '../models/DeviceStateHistory.js';
import { AutomationLog } from '../models/AutomationLog.js';
import { EnergySummary } from '../models/EnergyRecord.js';
import { env } from '../config/env.js';
import { emit, SocketEvents } from '../sockets/index.js';
import { logger } from '../utils/logger.js';
import { attendanceDateKey } from './identityRules.js';
import { normalizeHistoryPaging, parseDateRange } from './occupancyRules.js';
import {
  baselineKwh,
  energyKwh,
  hasUsableHistory,
  onSecondsFromHistory,
  roundKwh,
  savingsKwh,
  savingsPercent,
  windowHours,
} from './energyRules.js';

/**
 * Energy consumption and savings analytics (Review 3).
 *
 * ═══ WHERE EVERY NUMBER COMES FROM ═══
 *
 * There are exactly two inputs, and nothing else:
 *
 *   1. CONFIRMED DeviceStateHistory transitions — the recorded on/off
 *      intervals. `confirmed: false` rows are EXCLUDED: those record commands
 *      that failed, and counting them would bill a room for electricity a
 *      device never used.
 *   2. Each device's configured `powerRatingWatts`.
 *
 * There is no random data anywhere in this file, no hardcoded success metric,
 * and no placeholder series. A window with nothing in it returns
 * `insufficientData: true` and a `requires` message naming what is missing,
 * because a 0 would look like a measurement of an idle device rather than an
 * absence of data.
 *
 * ═══ WHAT THE FIGURES ARE ═══
 *
 * ESTIMATES. This project has no power meter; energy is a configured wattage
 * multiplied by a measured duration, so every response carries
 * `estimated: true`, and `simulated: true` whenever a contributing device was
 * driven by the simulation adapter — in which case the durations are real
 * elapsed time but no hardware was ever switched. Savings are quoted against
 * an explicit, operator-set baseline (env.energy.baselineHoursPerDay), and the
 * baseline travels inside every response together with a description of what
 * it assumes. `savingsPercent` is null when the baseline is 0, so no
 * misleading percentage is ever produced.
 *
 * The arithmetic itself lives in the dependency-free services/energyRules.js;
 * this module is only the I/O and the aggregation around it.
 */

/** The baseline block attached to every response. Stated, never implied. */
function baselineBlock(hours = env.energy.baselineHoursPerDay) {
  return {
    hoursPerDay: hours,
    description:
      `Baseline assumption: each device would have run ${hours} hour(s) per day under its ` +
      'configured operating schedule with NO occupancy-based switching. This is an ' +
      'operator-set assumption (ENERGY_BASELINE_HOURS_PER_DAY), not a measurement, and it ' +
      'is the only reason a savings figure can be quoted. Savings are baseline minus ' +
      'estimated actual consumption, clamped at zero and pro-rated for windows shorter ' +
      'than a day.',
    source: 'ENERGY_BASELINE_HOURS_PER_DAY',
  };
}

/** Local day boundaries for a 'YYYY-MM-DD' key (or today when absent). */
function dayWindow(dateKey) {
  const key = typeof dateKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateKey)
    ? dateKey
    : attendanceDateKey(new Date());
  const [year, month, day] = key.split('-').map(Number);
  const start = new Date(year, month - 1, day, 0, 0, 0, 0);
  const endOfDay = new Date(year, month - 1, day, 23, 59, 59, 999);
  const now = new Date();
  // A day in progress ends NOW, not at midnight — otherwise an open 'on'
  // interval would be closed at a future instant and overstate consumption.
  const end = endOfDay > now ? now : endOfDay;
  return { key, start, end, partial: endOfDay > now };
}

/**
 * Loads the confirmed transitions needed to evaluate one device's window.
 *
 * BOUNDED BY CONSTRUCTION, two queries rather than one open-ended scan:
 *   • the single newest transition at or before windowStart, which establishes
 *     the state the device was already in; plus
 *   • the transitions inside the window, hard-capped at
 *     env.energy.historyMaxLimit.
 * A naive `changedAt <= windowEnd` query would grow without limit as the
 * system runs.
 */
async function transitionsForWindow(deviceId, windowStart, windowEnd) {
  const [priorRows, windowRows] = await Promise.all([
    DeviceStateHistory.find({
      deviceId,
      confirmed: true,
      changedAt: { $lte: windowStart },
    })
      .sort({ changedAt: -1 })
      .limit(1)
      .select('changedAt toState confirmed'),
    DeviceStateHistory.find({
      deviceId,
      confirmed: true,
      changedAt: { $gt: windowStart, $lte: windowEnd },
    })
      .sort({ changedAt: 1 })
      .limit(env.energy.historyMaxLimit)
      .select('changedAt toState confirmed'),
  ]);

  return [...priorRows, ...windowRows].map((row) => ({
    changedAt: row.changedAt,
    toState: row.toState,
    confirmed: row.confirmed,
  }));
}

/**
 * Computes one device's figures for one window.
 *
 * Returns `insufficientData: true` — never a zero dressed up as a measurement
 * — when the device has no confirmed history covering the window, or when its
 * power rating is unconfigured (0), with a `requires` message saying which.
 */
async function deviceWindowFigures(device, start, end, hoursPerDay) {
  const transitions = await transitionsForWindow(device.deviceId, start, end);
  const usable = hasUsableHistory(transitions, start, end);
  const hours = windowHours(start, end);

  const requires = [];
  if (!usable.usable) {
    requires.push(
      usable.reason === 'no_confirmed_state_changes'
        ? `no confirmed on/off transitions have been recorded for ${device.deviceId} yet — ` +
          'switch it on and off (manually or through automation) so there is an interval ' +
          'to measure'
        : `${device.deviceId}'s recorded history starts after this window`
    );
  }
  if (!(device.powerRatingWatts > 0)) {
    requires.push(
      `${device.deviceId} has no configured power rating — set powerRatingWatts so its ` +
        'energy can be estimated'
    );
  }

  const onSeconds = usable.usable ? onSecondsFromHistory(transitions, start, end) : 0;
  const actualKwh = energyKwh(device.powerRatingWatts, onSeconds);
  const baseline = baselineKwh({
    watts: device.powerRatingWatts,
    baselineHoursPerDay: hoursPerDay,
    windowHours: hours,
  });
  const saved = savingsKwh(baseline, actualKwh);

  return {
    deviceId: device.deviceId,
    name: device.name,
    roomId: device.roomId,
    type: device.type,
    // Carried so the UI can label a simulated device's figures as simulated.
    simulated: device.simulated !== false,
    adapterType: device.adapterType ?? 'simulation',
    powerRatingWatts: device.powerRatingWatts ?? 0,
    powerRatingConfigured: (device.powerRatingWatts ?? 0) > 0,
    reportedState: device.reportedState ?? 'unknown',
    onSeconds: Math.round(onSeconds),
    onHours: roundKwh(onSeconds / 3600, 2),
    energyKwh: roundKwh(actualKwh),
    baselineKwh: roundKwh(baseline),
    savedKwh: roundKwh(saved),
    // null when the baseline is 0 — never a fabricated percentage.
    savingsPercent: savingsPercent(baseline, actualKwh),
    // ALWAYS true: configured wattage × measured duration, not a meter read.
    estimated: true,
    insufficientData: requires.length > 0,
    requires: requires.length > 0 ? requires : null,
    transitionsConsidered: transitions.length,
  };
}

/** Totals a set of per-device figures, honestly. */
function totalsFor(deviceFigures) {
  const contributing = deviceFigures.filter((row) => !row.insufficientData);
  const totalKwh = contributing.reduce((sum, row) => sum + row.energyKwh, 0);
  const totalBaseline = contributing.reduce((sum, row) => sum + row.baselineKwh, 0);
  const totalSaved = contributing.reduce((sum, row) => sum + row.savedKwh, 0);

  return {
    devices: deviceFigures.length,
    // How many devices are actually behind the total, so it is never presented
    // as covering more than it does.
    contributingDevices: contributing.length,
    devicesWithoutData: deviceFigures.length - contributing.length,
    onSeconds: contributing.reduce((sum, row) => sum + row.onSeconds, 0),
    energyKwh: roundKwh(totalKwh),
    baselineKwh: roundKwh(totalBaseline),
    savedKwh: roundKwh(totalSaved),
    savingsPercent: savingsPercent(totalBaseline, totalKwh),
    estimated: true,
    simulated: deviceFigures.some((row) => row.simulated),
  };
}

/**
 * GET /api/energy/summary — one day, per device plus totals.
 *
 * Also reports the automation activity for the day, because "0.4 kWh saved" is
 * only interpretable next to "4 automated switch-offs, 2 skipped because the
 * occupancy data was stale".
 */
export async function summary({ date, roomId } = {}) {
  const window = dayWindow(date);
  const hoursPerDay = env.energy.baselineHoursPerDay;

  const filter = { active: true };
  if (typeof roomId === 'string' && roomId.trim()) filter.roomId = roomId.trim();
  const devices = await Device.find(filter).sort({ roomId: 1, name: 1 });

  if (devices.length === 0) {
    return {
      date: window.key,
      window: { from: window.start, to: window.end, partialDay: window.partial },
      baseline: baselineBlock(hoursPerDay),
      estimated: true,
      simulated: false,
      insufficientData: true,
      requires: [
        'no devices are configured — register a light or a fan (and set its power rating) ' +
          'before energy can be estimated. `npm run seed:devices` creates two clearly ' +
          'labelled simulated devices for the demo.',
      ],
      devices: [],
      totals: totalsFor([]),
      automation: { switchedOn: 0, switchedOff: 0, skippedStaleData: 0, failures: 0, total: 0 },
    };
  }

  const deviceFigures = [];
  for (const device of devices) {
    deviceFigures.push(
      await deviceWindowFigures(device, window.start, window.end, hoursPerDay)
    );
  }

  const automationCounts = await automationActivity(window.start, window.end, filter.roomId);
  const totals = totalsFor(deviceFigures);
  const allInsufficient = deviceFigures.every((row) => row.insufficientData);

  return {
    date: window.key,
    window: { from: window.start, to: window.end, partialDay: window.partial },
    baseline: baselineBlock(hoursPerDay),
    estimated: true,
    simulated: totals.simulated,
    // Explicit, with the reasons, rather than a zero that reads as a result.
    insufficientData: allInsufficient,
    requires: allInsufficient
      ? [...new Set(deviceFigures.flatMap((row) => row.requires ?? []))]
      : null,
    devices: deviceFigures,
    totals,
    automation: automationCounts,
  };
}

/** Automation decision counts for a window — the context a saving needs. */
async function automationActivity(start, end, roomId = null) {
  const filter = { evaluatedAt: { $gte: start, $lte: end } };
  if (roomId) filter.roomId = roomId;

  const rows = await AutomationLog.aggregate([
    { $match: filter },
    { $group: { _id: '$decision', count: { $sum: 1 } } },
  ]);
  const byDecision = Object.fromEntries(rows.map((row) => [row._id, row.count]));

  return {
    switchedOn: byDecision.switch_on ?? 0,
    switchedOff: byDecision.switch_off ?? 0,
    noChange: byDecision.no_change ?? 0,
    // The fail-safe firing. Surfaced at the top level because a day with many
    // of these is a day whose energy figures cover less than it looks.
    skippedStaleData: byDecision.skipped_stale_data ?? 0,
    skippedOverride: byDecision.skipped_override ?? 0,
    skippedSchedule: byDecision.skipped_schedule ?? 0,
    skippedCooldown: byDecision.skipped_cooldown ?? 0,
    failures: byDecision.command_failed ?? 0,
    total: rows.reduce((sum, row) => sum + row.count, 0),
  };
}

/**
 * GET /api/energy/history — paginated device-state intervals with their
 * estimated energy.
 *
 * This is the raw evidence behind the summary: one row per recorded
 * transition, with the configured wattage and the resulting kWh for the
 * interval it opened. Pagination is MANDATORY and hard-capped
 * (ENERGY_HISTORY_MAX_LIMIT), so no request produces an unbounded read.
 *
 * Unconfirmed rows are INCLUDED here but flagged `confirmed: false` and
 * contribute `energyKwh: 0` — the operator should be able to see that a
 * command failed, while the arithmetic still ignores it.
 */
export async function history({ from, to, roomId, deviceId, limit, page } = {}) {
  const paging = normalizeHistoryPaging({
    limit,
    page,
    maxLimit: env.energy.historyMaxLimit,
  });

  const filter = {};
  if (typeof roomId === 'string' && roomId.trim()) filter.roomId = roomId.trim();
  if (typeof deviceId === 'string' && deviceId.trim()) filter.deviceId = deviceId.trim();
  const range = parseDateRange({ from, to });
  if (range) filter.changedAt = range;

  const [rows, total] = await Promise.all([
    DeviceStateHistory.find(filter)
      .sort({ changedAt: -1 })
      .skip(paging.skip)
      .limit(paging.perPage),
    DeviceStateHistory.countDocuments(filter),
  ]);

  const deviceIds = [...new Set(rows.map((row) => row.deviceId))];
  const devices = await Device.find({ deviceId: { $in: deviceIds } }).select(
    'deviceId name powerRatingWatts simulated adapterType'
  );
  const byDeviceId = new Map(devices.map((device) => [device.deviceId, device]));

  return {
    items: rows.map((row) => {
      const device = byDeviceId.get(row.deviceId);
      const watts = device?.powerRatingWatts ?? 0;
      // Only a CONFIRMED 'on' interval of known length carries energy.
      const countable = row.confirmed === true && row.toState === 'on';
      const kwh = countable ? energyKwh(watts, row.durationSec ?? 0) : 0;
      return {
        id: row._id.toString(),
        deviceId: row.deviceId,
        deviceName: device?.name ?? row.deviceId,
        roomId: row.roomId ?? null,
        fromState: row.fromState,
        toState: row.toState,
        changedAt: row.changedAt,
        trigger: row.trigger,
        reason: row.reason,
        ruleId: row.ruleId ?? null,
        confirmed: row.confirmed,
        adapterMessage: row.adapterMessage ?? null,
        // null while the interval is still open.
        durationSec: row.durationSec ?? null,
        powerRatingWatts: watts,
        energyKwh: roundKwh(kwh),
        // Explains a zero without the reader having to infer it.
        energyCountedReason: countable
          ? row.durationSec == null
            ? 'interval_still_open'
            : 'counted'
          : row.confirmed === true
            ? 'off_interval'
            : 'command_not_confirmed',
        simulated: device?.simulated !== false,
        estimated: true,
      };
    }),
    total,
    page: paging.page,
    perPage: paging.perPage,
    maxLimit: paging.maxLimit,
    baseline: baselineBlock(),
    estimated: true,
  };
}

/** Resolves an explicit [from, to] window, defaulting to the last 7 days. */
function explicitWindow(from, to) {
  const range = parseDateRange({ from, to });
  const end = range?.$lte ?? new Date();
  const start =
    range?.$gte ?? new Date(Number(end) - 7 * 24 * 60 * 60 * 1000);
  return { start, end };
}

/** GET /api/energy/by-room — room-level rollup over an explicit window. */
export async function byRoom({ from, to } = {}) {
  const { start, end } = explicitWindow(from, to);
  const hoursPerDay = env.energy.baselineHoursPerDay;
  const devices = await Device.find({ active: true }).sort({ roomId: 1, name: 1 });

  const figures = [];
  for (const device of devices) {
    figures.push(await deviceWindowFigures(device, start, end, hoursPerDay));
  }

  const byRoomId = new Map();
  for (const row of figures) {
    const bucket = byRoomId.get(row.roomId) ?? [];
    bucket.push(row);
    byRoomId.set(row.roomId, bucket);
  }

  const rooms = [...byRoomId.entries()].map(([roomId, rows]) => ({
    roomId,
    ...totalsFor(rows),
    devices: rows.map((row) => ({
      deviceId: row.deviceId,
      name: row.name,
      energyKwh: row.energyKwh,
      savedKwh: row.savedKwh,
      simulated: row.simulated,
      insufficientData: row.insufficientData,
    })),
  }));

  return {
    window: { from: start, to: end, hours: roundKwh(windowHours(start, end), 2) },
    baseline: baselineBlock(hoursPerDay),
    estimated: true,
    simulated: figures.some((row) => row.simulated),
    insufficientData: figures.length === 0 || figures.every((row) => row.insufficientData),
    requires:
      figures.length === 0
        ? ['no devices are configured — register a device and set its power rating']
        : figures.every((row) => row.insufficientData)
          ? [...new Set(figures.flatMap((row) => row.requires ?? []))]
          : null,
    rooms,
    totals: totalsFor(figures),
  };
}

/** GET /api/energy/by-device — device-level rollup over an explicit window. */
export async function byDevice({ from, to, roomId } = {}) {
  const { start, end } = explicitWindow(from, to);
  const hoursPerDay = env.energy.baselineHoursPerDay;

  const filter = { active: true };
  if (typeof roomId === 'string' && roomId.trim()) filter.roomId = roomId.trim();
  const devices = await Device.find(filter).sort({ roomId: 1, name: 1 });

  const figures = [];
  for (const device of devices) {
    figures.push(await deviceWindowFigures(device, start, end, hoursPerDay));
  }

  return {
    window: { from: start, to: end, hours: roundKwh(windowHours(start, end), 2) },
    baseline: baselineBlock(hoursPerDay),
    estimated: true,
    simulated: figures.some((row) => row.simulated),
    insufficientData: figures.length === 0 || figures.every((row) => row.insufficientData),
    requires:
      figures.length === 0
        ? ['no devices are configured — register a device and set its power rating']
        : figures.every((row) => row.insufficientData)
          ? [...new Set(figures.flatMap((row) => row.requires ?? []))]
          : null,
    devices: figures,
    totals: totalsFor(figures),
  };
}

/**
 * Rolls one completed day's figures into EnergySummary.
 *
 * A CACHE, NOT A SOURCE OF TRUTH: everything here is recomputed from
 * DeviceStateHistory, and the rollup exists only so a weekly or monthly trend
 * does not have to replay months of transitions. IDEMPOTENT — an upsert on the
 * unique { date, deviceId } key, so re-running it recomputes rather than
 * duplicating, and deleting the collection loses nothing.
 *
 * Called from the automation tick wiring (server startup) for YESTERDAY, never
 * for a day in progress: a partial day's row would be wrong the moment it was
 * written and would then be served as a finished day.
 */
export async function rollupDay(dateKey) {
  const window = dayWindow(dateKey);
  if (window.partial) {
    return { skipped: true, reason: 'day_in_progress', date: window.key };
  }

  const hoursPerDay = env.energy.baselineHoursPerDay;
  const devices = await Device.find({}).sort({ deviceId: 1 });
  let written = 0;

  for (const device of devices) {
    const figures = await deviceWindowFigures(device, window.start, window.end, hoursPerDay);
    if (figures.insufficientData && figures.onSeconds === 0) continue;

    await EnergySummary.updateOne(
      { date: window.key, deviceId: device.deviceId },
      {
        $set: {
          roomId: device.roomId,
          onSeconds: figures.onSeconds,
          powerRatingWatts: figures.powerRatingWatts,
          energyKwh: figures.energyKwh,
          baselineKwh: figures.baselineKwh,
          savedKwh: figures.savedKwh,
          baselineHoursPerDay: hoursPerDay,
          estimated: true,
          simulated: figures.simulated,
        },
        $setOnInsert: { date: window.key, deviceId: device.deviceId },
      },
      { upsert: true }
    );
    written += 1;
  }

  if (written > 0) {
    logger.info(`Energy rollup for ${window.key}: ${written} device day(s) upserted.`);
    emit(SocketEvents.ENERGY_UPDATE, { date: window.key, devices: written, estimated: true });
  }
  return { skipped: false, date: window.key, devices: written };
}

/**
 * Daily trend from the EnergySummary rollup, for weekly/monthly charts.
 *
 * Reads the cache rather than replaying history, and returns an explicit
 * `insufficientData` with the reason when the rollup has not run yet — an
 * empty chart with "run for a day to see a trend" is more useful than a flat
 * line at zero.
 */
export async function trend({ days = 7 } = {}) {
  const limit = Math.min(Math.max(Number(days) || 7, 1), 90);
  const rows = await EnergySummary.find({})
    .sort({ date: -1 })
    .limit(limit * 50)
    .select('date deviceId roomId energyKwh baselineKwh savedKwh simulated');

  const byDate = new Map();
  for (const row of rows) {
    const bucket = byDate.get(row.date) ?? {
      date: row.date,
      energyKwh: 0,
      baselineKwh: 0,
      savedKwh: 0,
      devices: 0,
      simulated: false,
    };
    bucket.energyKwh += row.energyKwh;
    bucket.baselineKwh += row.baselineKwh;
    bucket.savedKwh += row.savedKwh;
    bucket.devices += 1;
    bucket.simulated = bucket.simulated || row.simulated;
    byDate.set(row.date, bucket);
  }

  const dailyTotals = [...byDate.values()]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(-limit)
    .map((day) => ({
      ...day,
      energyKwh: roundKwh(day.energyKwh),
      baselineKwh: roundKwh(day.baselineKwh),
      savedKwh: roundKwh(day.savedKwh),
      savingsPercent: savingsPercent(day.baselineKwh, day.energyKwh),
      estimated: true,
    }));

  return {
    days: dailyTotals,
    baseline: baselineBlock(),
    estimated: true,
    insufficientData: dailyTotals.length === 0,
    requires: dailyTotals.length === 0
      ? [
          'no completed day has been rolled up yet — the trend needs at least one full day ' +
            'of recorded device state. Today\'s figures are available from ' +
            'GET /api/energy/summary in the meantime.',
        ]
      : null,
  };
}
