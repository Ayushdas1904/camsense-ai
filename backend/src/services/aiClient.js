import { Readable } from 'node:stream';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';

/**
 * Thin client for the Python AI service. The backend is the ONLY thing that
 * talks to the AI service — the frontend never does. All AI calls funnel
 * through here so the base URL, timeouts, and failure handling live in one place.
 *
 * Uses the built-in fetch (Node 18+) — no extra HTTP dependency.
 */
const AI = env.aiServiceUrl;

async function aiFetch(pathname, options = {}, { timeoutMs = 6000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${AI}${pathname}`, { ...options, signal: controller.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
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
    const upstream = await fetch(`${AI}/api/stream/${encodeURIComponent(cameraId)}`);
    if (!upstream.ok || !upstream.body) {
      throw new ApiError(502, 'Camera stream is not available.');
    }
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'multipart/x-mixed-replace; boundary=frame');
    res.setHeader('Cache-Control', 'no-cache');
    Readable.fromWeb(upstream.body).pipe(res);
  },
};
