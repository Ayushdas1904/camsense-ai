import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  listRecognitionEvents,
  getRecognitionEvent,
} from '../controllers/recognitionEventController.js';

/**
 * Recognition events (Review 2) — GET ONLY, on purpose.
 *
 * Events are created exclusively by the trusted recognition workflow behind
 * POST /api/ai/recognition (requireInternalSecret). Do not add a write route
 * here: a client must never be able to assert that a recognition happened, or
 * that a face matched a registered identity.
 */
const router = Router();

router.get('/', requireAuth, listRecognitionEvents);
router.get('/:id', requireAuth, getRecognitionEvent);

export default router;
