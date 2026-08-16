import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireInternalSecret } from '../middleware/internalAuth.js';
import { ingest, getAiStatus } from '../controllers/aiController.js';

const router = Router();

// Service-to-service: the AI service posts detections here (shared secret).
router.post('/ingest', requireInternalSecret, ingest);

// Operator-facing: AI system status for the dashboard panel (JWT).
router.get('/status', requireAuth, getAiStatus);

export default router;
