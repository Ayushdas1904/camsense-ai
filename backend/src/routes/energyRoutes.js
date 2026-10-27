import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  getEnergyByDevice,
  getEnergyByRoom,
  getEnergyHistory,
  getEnergySummary,
  getEnergyTrend,
} from '../controllers/energyController.js';

/**
 * Energy analytics (Review 3) — GET ONLY, on purpose.
 *
 * There is deliberately no write route and nothing to write: every figure is
 * derived on request from confirmed DeviceStateHistory transitions and each
 * device's configured power rating. A client cannot assert an energy figure,
 * in the same way it cannot assert attendance or a headcount.
 *
 * Reads require requireAuth. The history endpoint is paginated and hard-capped
 * in the service (ENERGY_HISTORY_MAX_LIMIT), so no query string can produce an
 * unbounded read.
 *
 * Do not add a write route to this file.
 */
const router = Router();

router.get('/summary', requireAuth, getEnergySummary);
router.get('/history', requireAuth, getEnergyHistory);
router.get('/by-room', requireAuth, getEnergyByRoom);
router.get('/by-device', requireAuth, getEnergyByDevice);
router.get('/trend', requireAuth, getEnergyTrend);

export default router;
