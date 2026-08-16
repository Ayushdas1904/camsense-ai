import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { listDetections, getDetection } from '../controllers/detectionController.js';

const router = Router();

router.get('/', requireAuth, listDetections);
router.get('/:id', requireAuth, getDetection);

export default router;
