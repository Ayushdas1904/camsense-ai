import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';
import { isProduction } from '../config/env.js';

/**
 * Central error handler. Every route error ends up here, so client responses
 * have a single, consistent shape:  { success: false, error: { message, ... } }
 *
 * Raw stack traces are logged for developers but never sent to clients.
 */
// eslint-disable-next-line no-unused-vars -- Express requires the 4-arg signature
export function errorHandler(err, req, res, next) {
  let error = err;

  // Normalize common non-ApiError failures into ApiError.
  if (!(error instanceof ApiError)) {
    if (error?.name === 'ValidationError') {
      error = ApiError.badRequest('Validation failed', error.message);
    } else if (error?.name === 'CastError') {
      error = ApiError.badRequest('Invalid identifier');
    } else if (error?.code === 11000) {
      error = ApiError.conflict('A record with those details already exists');
    } else if (error?.name === 'JsonWebTokenError' || error?.name === 'TokenExpiredError') {
      error = ApiError.unauthorized('Invalid or expired session');
    } else {
      error = ApiError.internal(error?.message || 'Unexpected error');
    }
  }

  if (error.statusCode >= 500) {
    logger.error(`${req.method} ${req.originalUrl}`, err?.stack || err);
  } else {
    logger.warn(`${req.method} ${req.originalUrl} -> ${error.statusCode}: ${error.message}`);
  }

  res.status(error.statusCode).json({
    success: false,
    error: {
      message: error.message,
      details: error.details,
      // Stack only in non-production, and only for server errors.
      ...(!isProduction && error.statusCode >= 500 ? { stack: err?.stack } : {}),
    },
  });
}
