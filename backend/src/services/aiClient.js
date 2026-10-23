import { Readable } from 'node:stream';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';

/**
 * Thin client for the Python AI service. The backend is the ONLY thing that
 * talks to the AI service — the frontend never does. All AI calls funnel
 * through here so the base URL, timeouts, and failure handling live in one place.
 *
 * AUTHENTICATION: the AI service now requires the shared service secret
 * (`x-ai-secret`) on every route except its `/api/health` liveness probe —
 * including the face endpoints, because `/api/faces/register` returns a face
 * embedding. The header is attached centrally in aiFetch (and explicitly in
 * proxyStream, which bypasses it), so there is exactly one place the credential
 * is read. It never leaves the server: the browser calls the backend, and the
 * backend calls the AI service.
 *
 * Uses the built-in fetch (Node 18+) — no extra HTTP dependency.
 */
const AI = env.aiServiceUrl;

/** The service credential the AI service verifies. Server-side only. */
function serviceHeaders(extra = {}) {
  return { 'x-ai-secret': env.aiIngestSecret, ...extra };
}

/**
 * Fails fast, with the variable named, when the shared secret is not set.
 *
 * Neither side ships a default value (a default could not match the other
 * side's, so a half-configured deployment would 401 every call and look like
 * an outage). Unset means every AI call is refused here, with the one piece of
 * information the operator needs — and never with a secret value in the text.
 */
function assertServiceCredential() {
  if (!env.aiIngestSecret) {
    throw ApiError.internal(
      'AI_INGEST_SECRET is not set, so the backend cannot authenticate to the AI service. ' +
        "Set it in backend/.env to the same value as the AI service's " +
        'AI_SERVICE_INGEST_SECRET and restart both services.'
    );
  }
}

/**
 * @param {object}   [opts]
 * @param {number}   [opts.timeoutMs]
 * @param {number[]} [opts.tolerateStatuses] HTTP statuses returned to the
 *   caller as-is instead of being converted into an ApiError. Used by the face
 *   endpoints, where a 503 is a meaningful "models not loaded" answer the
 *   caller must relay honestly rather than a generic failure. Defaults to none,
 *   so existing Review 1 behaviour is unchanged.
 */
async function aiFetch(pathname, options = {}, { timeoutMs = 6000, tolerateStatuses = [] } = {}) {
  assertServiceCredential();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${AI}${pathname}`, {
      ...options,
      headers: serviceHeaders(options.headers),
      signal: controller.signal,
    });
    if (!res.ok) {
      if (tolerateStatuses.includes(res.status)) return res;
      const body = await res.text().catch(() => '');
      if (res.status === 401 || res.status === 403) {
        // Misconfiguration, not an outage — say so, without echoing either value.
        throw ApiError.internal(
          'The AI service rejected our service credentials. AI_INGEST_SECRET (backend) must ' +
            'equal AI_SERVICE_INGEST_SECRET (ai-service).'
        );
      }
      throw ApiError.internal(`AI service error (${res.status}): ${body.slice(0, 200)}`);
    }
    return res;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    logger.warn(`AI service unreachable: ${err.message}`);
    // A dedicated status so controllers can return a friendly "AI unavailable".
    throw new ApiError(503, 'AI detection is temporarily unavailable.');
  } finally {
    clearTimeout(timer);
  }
}

export const aiClient = {
  async getStatus() {
    const res = await aiFetch('/api/status');
    return res.json();
  },

  async startStream({ cameraId, source, mode }) {
    const res = await aiFetch('/api/stream/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ camera_id: cameraId, source, mode }),
    });
    return res.json();
  },

  async stopStream(cameraId) {
    const res = await aiFetch(`/api/stream/${encodeURIComponent(cameraId)}/stop`, { method: 'POST' });
    return res.json();
  },

  async getStats(cameraId) {
    const res = await aiFetch(`/api/stream/${encodeURIComponent(cameraId)}/stats`);
    return res.json();
  },

  async triggerDemoWeapon(cameraId) {
    const res = await aiFetch(`/api/stream/${encodeURIComponent(cameraId)}/demo-weapon`, {
      method: 'POST',
    });
    return res.json();
  },

  /**
   * Proxies the AI service's MJPEG stream to the given Express response.
   * Keeps the architecture rule intact (frontend → backend → AI service) for
   * the video feed too.
   */
  async proxyStream(cameraId, res) {
    assertServiceCredential();
    const upstream = await fetch(`${AI}/api/stream/${encodeURIComponent(cameraId)}`, {
      // This call bypasses aiFetch (it streams rather than buffering), so the
      // service credential is attached explicitly here.
      headers: serviceHeaders(),
    });
    if (!upstream.ok || !upstream.body) {
      throw new ApiError(502, 'Camera stream is not available.');
    }
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'multipart/x-mixed-replace; boundary=frame');
    res.setHeader('Cache-Control', 'no-cache');
    Readable.fromWeb(upstream.body).pipe(res);
  },

  // ── Review 2 · face recognition ───────────────────────────────

  /**
   * Enrolls one registration photograph and returns the structured result
   * (status / message / embedding / embedding_dim / embedding_model / bbox).
   *
   * The response carries biometric data and is service-to-service only — the
   * caller stores the embedding in a protected field and never relays it to
   * the browser.
   *
   * A longer timeout than the other calls because the very first request may
   * initialise the ONNX models. A 503 from the AI service means "models not
   * loaded" and is normalised into a structured RECOGNITION_UNAVAILABLE result
   * so the caller can report it honestly instead of marking the person
   * recognition-ready.
   *
   * @param {{ image: string }} payload base64 data URL of the photograph
   */
  async registerFace({ image }) {
    const res = await aiFetch(
      '/api/faces/register',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image }),
      },
      { timeoutMs: 15000, tolerateStatuses: [503] }
    );
    if (res.status === 503) {
      const body = await res.json().catch(() => ({}));
      return {
        status: 'RECOGNITION_UNAVAILABLE',
        message:
          body?.detail ||
          'Face recognition is unavailable: the recognition model is not loaded.',
        faces_detected: 0,
      };
    }
    return res.json();
  },

  /**
   * Tells the AI service to drop and re-fetch its enrolled-identity cache.
   * Called after a person is created, edited, toggled, or deleted so a removed
   * or disabled identity stops being matchable immediately.
   */
  async refreshFaceCache() {
    const res = await aiFetch('/api/faces/cache/refresh', { method: 'POST' });
    return res.json();
  },

  /** Honest readiness of the recognition subsystem (models + identity cache). */
  async getFaceStatus() {
    const res = await aiFetch('/api/faces/status');
    return res.json();
  },
};
