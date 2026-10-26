import { asyncHandler } from '../utils/asyncHandler.js';
import { byDevice, byRoom, history, summary, trend } from '../services/energyService.js';

/**
 * Energy consumption and savings analytics (Review 3) — READ ONLY.
 *
 * There is no write route here, and there is nothing to write: every figure is
 * DERIVED on request from confirmed DeviceStateHistory transitions and each
 * device's configured power rating. Nothing is random, nothing is hardcoded,
 * and no endpoint fabricates a series to make a chart look populated.
 *
 * EVERY RESPONSE CARRIES ITS OWN CAVEATS, as fields rather than as
 * documentation, so a client cannot render a figure without them:
 *   • `estimated: true`      — always. There is no power meter in this
 *                              project; energy is a configured wattage times a
 *                              measured duration.
 *   • `simulated: true`      — when any contributing device was driven by the
 *                              simulation adapter, i.e. when the durations are
 *                              real elapsed time but no hardware was switched.
 *   • `baseline: { hoursPerDay, description, source }`
 *                            — the declared assumption a saving is measured
 *                              against. A savings figure without it is
 *                              meaningless, so it travels with every payload.
 *   • `insufficientData` + `requires`
 *                            — when a window cannot be computed, instead of a
 *                              0 that reads like a measurement of an idle
 *                              device. `requires` names what is missing.
 *
 * All reads require requireAuth. The history endpoints are paginated with a
 * hard maximum (ENERGY_HISTORY_MAX_LIMIT), so no request can produce an
 * unbounded query.
 */

/** GET /api/energy/summary — one day, per device plus totals and automation. */
export const getEnergySummary = asyncHandler(async (req, res) => {
  const date = typeof req.query.date === 'string' ? req.query.date : undefined;
  const roomId = typeof req.query.roomId === 'string' ? req.query.roomId : undefined;
  res.json({ success: true, data: await summary({ date, roomId }) });
});

/** GET /api/energy/history — the recorded intervals behind the summary. */
export const getEnergyHistory = asyncHandler(async (req, res) => {
  const { from, to, roomId, deviceId, limit, page } = req.query;
  res.json({ success: true, data: await history({ from, to, roomId, deviceId, limit, page }) });
});

/** GET /api/energy/by-room — room-level rollup over an explicit window. */
export const getEnergyByRoom = asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  res.json({ success: true, data: await byRoom({ from, to }) });
});

/** GET /api/energy/by-device — device-level rollup over an explicit window. */
export const getEnergyByDevice = asyncHandler(async (req, res) => {
  const { from, to, roomId } = req.query;
  res.json({ success: true, data: await byDevice({ from, to, roomId }) });
});

/**
 * GET /api/energy/trend — daily totals from the EnergySummary rollup.
 *
 * Reads the rollup cache rather than replaying months of transitions. Returns
 * `insufficientData: true` with an explanation until at least one COMPLETED
 * day has been rolled up; a partial day is deliberately never rolled up,
 * because it would be wrong the moment it was written and would then be served
 * as a finished day.
 */
export const getEnergyTrend = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await trend({ days: req.query.days }) });
});
