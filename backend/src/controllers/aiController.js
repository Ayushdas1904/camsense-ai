import { asyncHandler } from '../utils/asyncHandler.js';
import { ingestDetections } from '../services/eventService.js';
import { ingestRecognition } from '../services/recognitionService.js';
import { ingestOccupancy } from '../services/occupancyService.js';
import { listEnabledEmbeddings } from '../services/personService.js';
import { aiClient } from '../services/aiClient.js';
import { emit, SocketEvents } from '../sockets/index.js';
import { logger } from '../utils/logger.js';

/**
 * Ingest endpoint called by the AI service (service-to-service).
 * Protected by the shared-secret middleware, NOT user JWT.
 */
export const ingest = asyncHandler(async (req, res) => {
  const result = await ingestDetections(req.body);
  res.json({ success: true, data: result });
});

/**
 * Recognition ingest (Review 2), called by the AI service only
 * (service-to-service, shared secret).
 *
 * This is the ONLY way a recognition result becomes persisted state — an
 * attendance record, a recognition event, or an unknown-identity alert. The
 * service it delegates to re-verifies every claimed identity against the
 * backend's own person records and threshold rather than trusting the AI
 * service's verdict.
 */
export const ingestRecognitionResults = asyncHandler(async (req, res) => {
  const result = await ingestRecognition(req.body);
  res.json({ success: true, data: result });
});

/**
 * Occupancy ingest (Review 3), called by the AI service only
 * (service-to-service, shared secret).
 *
 * THIS IS THE ONLY WRITE PATH FOR OCCUPANCY DATA. There is no client-facing
 * equivalent — no POST /api/occupancy — by design, exactly as with recognition
 * and attendance: a headcount is AI-produced data, and an authenticated
 * browser client must not be able to assert one.
 *
 * The service it delegates to re-checks the camera against this backend's own
 * records and applies this backend's own staleness and capacity rules rather
 * than trusting the AI service's interpretation. A report that says the figure
 * is unavailable is RECORDED as unavailable with a null count — never as zero
 * occupants.
 */
export const ingestOccupancyReport = asyncHandler(async (req, res) => {
  const result = await ingestOccupancy(req.body);
  res.json({ success: true, data: result });
});

/**
 * Enrolled face embeddings for the AI service's identity cache.
 *
 * THIS IS THE ONLY ENDPOINT IN THIS API THAT EMITS FACE EMBEDDINGS.
 * It is service-to-service, gated by the `x-ai-secret` shared secret
 * (requireInternalSecret), and is never exposed to the browser: the frontend
 * has no credential for it, and no browser-facing route returns an embedding
 * (every person payload goes through serializePerson, which whitelists fields).
 *
 * One endpoint on the AI service also returns a vector —
 * POST /api/faces/register, which hands a newly generated embedding back for
 * storage — and it is gated by the same shared secret. Those two
 * service-to-service endpoints are the complete set.
 *
 * The payload is pre-filtered to people who are active, recognition-enabled,
 * and hold a dimension-consistent vector. The AI service replaces its cache
 * wholesale from this response, so a disabled or deleted identity stops being
 * matchable as soon as the cache refreshes.
 */
export const listFaceEmbeddings = asyncHandler(async (_req, res) => {
  const items = await listEnabledEmbeddings();
  res.json({ success: true, data: { items, total: items.length } });
});

/**
 * Last observed recognition availability, so a CHANGE can be broadcast to
 * connected clients instead of them having to poll. Only transitions are
 * emitted, and the value reported is whatever the AI service actually said.
 */
let lastRecognitionAvailable = null;

/**
 * Proxies AI system status for the operator's "AI System" panel.
 *
 * Extended ADDITIVELY in Review 2 with the recognition subsystem's own state
 * (models loaded, identity-cache size, threshold). Degrades gracefully: if the
 * recognition status cannot be fetched, the rest of the panel still renders and
 * recognition is honestly reported as unavailable rather than assumed active.
 */
export const getAiStatus = asyncHandler(async (_req, res) => {
  const status = await aiClient.getStatus();

  let recognition = null;
  try {
    recognition = await aiClient.getFaceStatus();
  } catch (err) {
    logger.warn(`Recognition status unavailable: ${err.message}`);
    recognition = {
      reachable: false,
      detector_available: false,
      embedder_available: false,
      last_error: 'The recognition status endpoint could not be reached.',
    };
  }

  const available = Boolean(recognition?.detector_available && recognition?.embedder_available);
  if (available !== lastRecognitionAvailable) {
    lastRecognitionAvailable = available;
    emit(SocketEvents.RECOGNITION_STATUS, {
      available,
      detectorAvailable: Boolean(recognition?.detector_available),
      embedderAvailable: Boolean(recognition?.embedder_available),
      cacheLoaded: Boolean(recognition?.cache_loaded),
      cacheSize: recognition?.cache_size ?? null,
      // True when the AI service's identity set is past its TTL and matching
      // is failing closed, so the panel does not show a healthy recognition
      // leg while no match can actually be made.
      cacheStale: Boolean(recognition?.cache_stale),
      lastError: recognition?.last_error ?? null,
      timestamp: new Date(),
    });
  }

  res.json({
    success: true,
    data: {
      ...status,
      recognition,
      // The attendance leg is this backend: if it can answer this request, it
      // can record attendance. Reported as a service state so the operator's
      // status panel can list it alongside the AI detectors.
      attendanceService: {
        status: 'active',
        note: 'Attendance records are created only from re-verified recognition results.',
      },
    },
  });
});
