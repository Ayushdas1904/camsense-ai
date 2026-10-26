import { Camera } from '../models/Camera.js';
import { Detection } from '../models/Detection.js';
import { Alert } from '../models/Alert.js';
import { Person } from '../models/Person.js';
import { Attendance } from '../models/Attendance.js';
import { RecognitionEvent } from '../models/RecognitionEvent.js';
import { Device } from '../models/Device.js';
import { AutomationRule } from '../models/AutomationRule.js';
import { AutomationLog } from '../models/AutomationLog.js';
import { attendanceDateKey } from './identityRules.js';
import { roomSummary } from './occupancyService.js';
import { summary as energySummary } from './energyService.js';
import { logger } from '../utils/logger.js';

/**
 * Computes the dashboard KPIs from real database state (never hardcoded).
 * Reused by both the REST endpoint and the socket "dashboard:update" push.
 *
 * Review 2 added the identity/attendance counters ADDITIVELY — the existing
 * keys are unchanged, because the frontend DashboardStats type and the
 * dashboard:update socket payload both consume this shape.
 *
 * Review 3 extends it the SAME WAY, for the same reason: every pre-existing
 * key is still produced with the same name and meaning, and the new occupancy,
 * device, automation and energy counters sit alongside them. Nothing was
 * removed or renamed.
 *
 * TWO HONESTY RULES CARRIED THROUGH FROM THE REVIEW 3 SERVICES:
 *
 *   1. Rooms whose occupancy cannot be trusted are counted in their OWN
 *      bucket (`roomsOccupancyUnavailable`), never folded into "unoccupied".
 *      occupancyService.roomSummary() already keeps that separation; this
 *      function must not undo it by adding the buckets together.
 *   2. The energy figures come from energyService.summary(), the same function
 *      the Energy page calls, so the dashboard and the Energy page cannot
 *      disagree. When the energy window is insufficient the figures are
 *      reported as **null**, not 0 — a 0 would read as "we measured no
 *      consumption" when the truth is "nothing has been recorded yet".
 *
 * Each Review 3 group is loaded inside its own try/catch. A fault in the
 * occupancy, device or energy layer degrades its own counters to null and
 * leaves every Review 1 and Review 2 KPI intact, so the dashboard never goes
 * blank because an optional subsystem misbehaved.
 */
export async function computeDashboardStats() {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const today = attendanceDateKey();

  const [
    totalCameras,
    activeCameras,
    peopleToday,
    weaponsToday,
    newAlerts,
    totalAlerts,
    totalPeople,
    recognitionEnabledPeople,
    presentToday,
    unknownIdentitiesToday,
  ] = await Promise.all([
    Camera.countDocuments({}),
    Camera.countDocuments({ status: 'online' }),
    Detection.countDocuments({ type: 'human', timestamp: { $gte: startOfDay } }),
    Detection.countDocuments({ type: 'weapon', timestamp: { $gte: startOfDay } }),
    Alert.countDocuments({ status: 'new' }),
    Alert.countDocuments({}),
    // ── Review 2 counters, each a real count over persisted documents ──
    Person.countDocuments({ active: true }),
    Person.countDocuments({ active: true, recognitionEnabled: true }),
    Attendance.countDocuments({ date: today, status: { $in: ['present', 'late'] } }),
    RecognitionEvent.countDocuments({
      status: 'unknown',
      timestamp: { $gte: startOfDay },
    }),
  ]);

  // ── Review 3 · occupancy ───────────────────────────────────────
  // Derived through the same roomSummary() the Occupancy page reads, so the
  // two views cannot disagree, and it re-derives each room's status at read
  // time (turning a room whose camera went dark into 'stale' with a null
  // count rather than serving a figure that was true ten minutes ago).
  let occupancy = null;
  try {
    occupancy = await roomSummary();
  } catch (err) {
    logger.warn(`Dashboard occupancy counters unavailable: ${err.message}`);
  }

  // ── Review 3 · devices and automation ──────────────────────────
  let devices = null;
  try {
    const rows = await Device.find({ active: true }).select(
      'reportedState connectionStatus controlMode simulated'
    );
    devices = {
      total: rows.length,
      // Only a CONFIRMED 'on' counts. 'unknown' is not 'off'.
      on: rows.filter((d) => d.reportedState === 'on').length,
      off: rows.filter((d) => d.reportedState === 'off').length,
      unknown: rows.filter((d) => (d.reportedState ?? 'unknown') === 'unknown').length,
      simulated: rows.filter((d) => d.simulated !== false).length,
      offline: rows.filter((d) => d.connectionStatus === 'offline').length,
      automatic: rows.filter((d) => d.controlMode === 'automatic').length,
    };
  } catch (err) {
    logger.warn(`Dashboard device counters unavailable: ${err.message}`);
  }

  let automation = null;
  try {
    const [rulesEnabled, actionsToday, skippedToday, failuresToday] = await Promise.all([
      AutomationRule.countDocuments({ enabled: true, active: true }),
      // Only the decisions that actually changed something.
      AutomationLog.countDocuments({
        decision: { $in: ['switch_on', 'switch_off'] },
        outcome: 'applied',
        evaluatedAt: { $gte: startOfDay },
      }),
      // The fail-safe firing. Surfaced because a day with many of these is a
      // day where automation deliberately did nothing.
      AutomationLog.countDocuments({
        decision: 'skipped_stale_data',
        evaluatedAt: { $gte: startOfDay },
      }),
      AutomationLog.countDocuments({
        decision: 'command_failed',
        evaluatedAt: { $gte: startOfDay },
      }),
    ]);
    automation = { rulesEnabled, actionsToday, skippedToday, failuresToday };
  } catch (err) {
    logger.warn(`Dashboard automation counters unavailable: ${err.message}`);
  }

  // ── Review 3 · energy ──────────────────────────────────────────
  // The SAME function the Energy page calls. Null, never 0, when the day
  // cannot be computed.
  let energy = null;
  try {
    const result = await energySummary({});
    energy = {
      kwhToday: result.insufficientData ? null : result.totals.energyKwh,
      savedKwhToday: result.insufficientData ? null : result.totals.savedKwh,
      savingsPercentToday: result.insufficientData ? null : result.totals.savingsPercent,
      estimated: true,
      simulated: Boolean(result.simulated),
      insufficientData: Boolean(result.insufficientData),
      baselineHoursPerDay: result.baseline?.hoursPerDay ?? null,
    };
  } catch (err) {
    logger.warn(`Dashboard energy counters unavailable: ${err.message}`);
  }

  return {
    totalCameras,
    activeCameras,
    peopleDetectedToday: peopleToday,
    weaponsDetectedToday: weaponsToday,
    newAlerts,
    totalAlerts,
    // Review 2 (additive).
    totalPeople,
    recognitionEnabledPeople,
    presentToday,
    unknownIdentitiesToday,
    // ── Review 3 (additive) ──────────────────────────────────────
    // null means "could not be determined", which is NOT the same as 0.
    roomsMonitored: occupancy?.monitoredRooms ?? null,
    roomsTotal: occupancy?.totalRooms ?? null,
    roomsOccupied: occupancy?.occupiedRooms ?? null,
    roomsNearCapacity: occupancy?.nearCapacityRooms ?? null,
    roomsCapacityExceeded: occupancy?.capacityExceededRooms ?? null,
    // Its own bucket on purpose — an outage is never read as an empty building.
    roomsOccupancyUnavailable: occupancy?.unavailableRooms ?? null,
    // Trustworthy counts only, with how many rooms are missing from the sum.
    totalOccupants: occupancy?.totalOccupants ?? null,
    roomsWithoutOccupancyData: occupancy?.roomsWithoutData ?? null,

    devicesTotal: devices?.total ?? null,
    devicesOn: devices?.on ?? null,
    devicesUnknownState: devices?.unknown ?? null,
    devicesSimulated: devices?.simulated ?? null,
    devicesOffline: devices?.offline ?? null,
    devicesAutomatic: devices?.automatic ?? null,

    automationRulesEnabled: automation?.rulesEnabled ?? null,
    automationActionsToday: automation?.actionsToday ?? null,
    automationSkippedStaleToday: automation?.skippedToday ?? null,
    automationFailuresToday: automation?.failuresToday ?? null,

    energyKwhToday: energy?.kwhToday ?? null,
    energySavedKwhToday: energy?.savedKwhToday ?? null,
    energySavingsPercentToday: energy?.savingsPercentToday ?? null,
    // Always true when a figure is present: there is no power meter here.
    energyEstimated: energy ? energy.estimated : null,
    energySimulated: energy ? energy.simulated : null,
    energyInsufficientData: energy ? energy.insufficientData : null,
    energyBaselineHoursPerDay: energy?.baselineHoursPerDay ?? null,
  };
}
