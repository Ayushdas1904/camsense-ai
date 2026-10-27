import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  getCurrentOccupancy,
  getOccupancyHistory,
  getOccupancySummary,
} from '../controllers/occupancyController.js';

/**
 * Occupancy (Review 3) — GET ONLY, on purpose.
 *
 * There is deliberately NO POST/PUT/PATCH/DELETE here. Occupancy figures are
 * AI-produced data, so they are created exclusively by the trusted
 * service-to-service leg POST /api/ai/occupancy (requireInternalSecret). An
 * authenticated browser client can never submit a headcount, in exactly the
 * same way it can never submit attendance.
 *
 * Do not add a write route to this file.
 */
const router = Router();

router.get('/current', requireAuth, getCurrentOccupancy);
router.get('/summary', requireAuth, getOccupancySummary);
// Paginated and date-filtered; the page size is hard-capped in the service.
router.get('/history', requireAuth, getOccupancyHistory);

export default router;
