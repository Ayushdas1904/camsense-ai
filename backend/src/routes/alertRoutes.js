import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  listAlerts,
  getAlert,
  updateAlertStatus,
  alertStatusSchema,
} from '../controllers/alertController.js';

const router = Router();

router.get('/', requireAuth, listAlerts);
router.get('/:id', requireAuth, getAlert);
router.patch('/:id/status', requireAuth, validate(alertStatusSchema), updateAlertStatus);

export default router;
