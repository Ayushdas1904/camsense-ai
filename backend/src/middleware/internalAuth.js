import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * Guards service-to-service endpoints (AI service → backend ingest) with a
 * shared secret. This is deliberately NOT user-JWT auth: the AI service is a
 * trusted internal peer, not a logged-in operator.
 */
export function requireInternalSecret(req, _res, next) {
  const secret = req.headers['x-ai-secret'];
  if (!secret || secret !== env.aiIngestSecret) {
    return next(ApiError.unauthorized('Invalid internal service credentials'));
  }
  next();
}
