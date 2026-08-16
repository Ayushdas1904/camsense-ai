import { asyncHandler } from '../utils/asyncHandler.js';
import { ingestDetections } from '../services/eventService.js';
import { aiClient } from '../services/aiClient.js';

/**
 * Ingest endpoint called by the AI service (service-to-service).
 * Protected by the shared-secret middleware, NOT user JWT.
 */
export const ingest = asyncHandler(async (req, res) => {
  const result = await ingestDetections(req.body);
  res.json({ success: true, data: result });
});

/** Proxies AI system status for the operator's "AI System" panel. */
export const getAiStatus = asyncHandler(async (_req, res) => {
  const status = await aiClient.getStatus();
  res.json({ success: true, data: status });
});
