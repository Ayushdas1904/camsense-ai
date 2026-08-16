import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getDashboardStats, getRecentEvents } from '../controllers/dashboardController.js';

const router = Router();

router.get('/stats', requireAuth, getDashboardStats);
router.get('/recent-events', requireAuth, getRecentEvents);

export default router;
