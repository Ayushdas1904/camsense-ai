import { asyncHandler } from '../utils/asyncHandler.js';
import { listCurrent, listHistory, roomSummary } from '../services/occupancyService.js';
import { OCCUPANCY_STATUS_LABELS } from '../services/occupancyRules.js';

/**
 * Occupancy reporting (Review 3) — READ ONLY.
 *
 * THERE IS DELIBERATELY NO CLIENT-FACING WRITE ROUTE OF ANY KIND IN THIS
 * CONTROLLER, for the same reason Review 2's attendance controller has none:
 * occupancy is AI-produced data, so the only way it becomes persisted state is
 * the service-to-service leg POST /api/ai/occupancy, gated by the
 * `x-ai-secret` shared secret. An authenticated browser client cannot assert a
 * headcount.
 *
 * Every number returned here is computed from persisted state. Nothing is
 * hardcoded, nothing is random, and a figure that cannot be trusted is
 * returned as `count: null` with a `camera_unavailable`/`stale` status rather
 * than as 0.
 */

export const getCurrentOccupancy = asyncHandler(async (_req, res) => {
  const current = await listCurrent();
  res.json({
    success: true,
    data: {
      ...current,
      // Shipped with the payload so the UI renders the same wording the
      // backend reasons about, instead of maintaining its own copy.
      statusLabels: OCCUPANCY_STATUS_LABELS,
    },
  });
});

/**
 * GET /api/occupancy/history — paginated and date-filtered.
 *
 * Pagination is MANDATORY and the page size is hard-capped by
 * OCCUPANCY_HISTORY_MAX_LIMIT inside the service, so no query string can
 * produce an unbounded read.
 */
export const getOccupancyHistory = asyncHandler(async (req, res) => {
  const { roomId, from, to, limit, page } = req.query;
  const history = await listHistory({ roomId, from, to, limit, page });
  res.json({ success: true, data: history });
});

export const getOccupancySummary = asyncHandler(async (_req, res) => {
  const summary = await roomSummary();
  res.json({ success: true, data: { ...summary, statusLabels: OCCUPANCY_STATUS_LABELS } });
});
