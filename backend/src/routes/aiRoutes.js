import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireInternalSecret } from '../middleware/internalAuth.js';
import {
  ingest,
  ingestRecognitionResults,
  listFaceEmbeddings,
  getAiStatus,
} from '../controllers/aiController.js';

const router = Router();

// Service-to-service: the AI service posts detections here (shared secret).
router.post('/ingest', requireInternalSecret, ingest);

// Service-to-service (Review 2): the AI service posts face-recognition results
// here. This is the ONLY write path for recognition events and attendance —
// there is no equivalent client-facing route, by design.
router.post('/recognition', requireInternalSecret, ingestRecognitionResults);

// Service-to-service (Review 2): the AI service's identity cache reads the
// enrolled embeddings here. THE ONLY ENDPOINT IN THIS API THAT EMITS
// EMBEDDINGS — shared-secret gated and never exposed to the browser. (The AI
// service's own POST /api/faces/register also returns a vector, for storage,
// and is gated by the same secret.)
router.get('/face-embeddings', requireInternalSecret, listFaceEmbeddings);

// Operator-facing: AI system status for the dashboard panel (JWT).
router.get('/status', requireAuth, getAiStatus);

export default router;
