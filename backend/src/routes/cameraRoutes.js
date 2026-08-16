import { Router } from 'express';
import { requireAuth, requireAuthQueryOrHeader } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  listCameras,
  getCamera,
  createCamera,
  updateCamera,
  deleteCamera,
  setMonitoring,
  getMonitoringStats,
  triggerDemoWeapon,
  streamCamera,
  cameraSchema,
  cameraUpdateSchema,
} from '../controllers/cameraController.js';

const router = Router();

// MJPEG stream for <img> — token may come via ?token= (no header possible).
router.get('/:id/stream', requireAuthQueryOrHeader, streamCamera);

// Everything else requires a normal Bearer token.
router.get('/', requireAuth, listCameras);
router.post('/', requireAuth, validate(cameraSchema), createCamera);
router.get('/:id/stats', requireAuth, getMonitoringStats);
router.post('/:id/monitor', requireAuth, setMonitoring);
router.post('/:id/demo-weapon', requireAuth, triggerDemoWeapon);
router.get('/:id', requireAuth, getCamera);
router.put('/:id', requireAuth, validate(cameraUpdateSchema), updateCamera);
router.delete('/:id', requireAuth, deleteCamera);

export default router;
