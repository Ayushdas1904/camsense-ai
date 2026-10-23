import { timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * Guards service-to-service endpoints (AI service → backend ingest) with a
 * shared secret. This is deliberately NOT user-JWT auth: the AI service is a
 * trusted internal peer, not a logged-in operator.
 *
 * FAILS CLOSED. If no secret is configured at all, every request is rejected
 * rather than admitted — an unconfigured service is locked, never open. The
 * comparison verifies the value (in constant time), it does not merely check
 * that a header is present.
 */
function secretsMatch(provided, expected) {
  const a = Buffer.from(String(provided ?? ''), 'utf8');
  const b = Buffer.from(String(expected), 'utf8');
  // timingSafeEqual throws on a length mismatch, which is itself observable;
  // comparing lengths first is the standard way to use it.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function requireInternalSecret(req, _res, next) {
  const expected = (env.aiIngestSecret || '').trim();
  if (!expected) {
    return next(
      ApiError.internal(
        'AI_INGEST_SECRET is not configured, so service-to-service requests cannot be ' +
          'authenticated and are all rejected. Set it to the same value as the AI ' +
          "service's AI_SERVICE_INGEST_SECRET and restart."
      )
    );
  }

  const secret = req.headers['x-ai-secret'];
  if (!secret || !secretsMatch(secret, expected)) {
    return next(ApiError.unauthorized('Invalid internal service credentials'));
  }
  next();
}
