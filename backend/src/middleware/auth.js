import { ApiError } from '../utils/ApiError.js';
import { verifyAuthToken } from '../utils/token.js';
import { User } from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/**
 * Protects routes with JWT auth. Reads the bearer token, verifies it, loads the
 * user, and attaches it to req.user. Downstream handlers can then trust req.user.
 */
async function authenticate(token, req) {
  if (!token) throw ApiError.unauthorized('Authentication required');
  const payload = verifyAuthToken(token);
  const user = await User.findById(payload.sub);
  if (!user) throw ApiError.unauthorized('Account no longer exists');
  req.user = user;
}

export const requireAuth = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  await authenticate(token, req);
  next();
});

/**
 * Auth variant that also accepts a `?token=` query param. Needed for the MJPEG
 * stream served into an <img> tag, which cannot send an Authorization header.
 * Used only on the stream route.
 */
export const requireAuthQueryOrHeader = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.token || null;
  await authenticate(token, req);
  next();
});

/**
 * Role-based authorization. Use after requireAuth:
 *   router.get('/', requireAuth, requireRole('admin'), handler)
 *
 * Built now so Review 2/3 can add operator/viewer roles without new plumbing.
 */
export const requireRole = (...allowedRoles) =>
  (req, _res, next) => {
    if (!req.user) {
      return next(ApiError.unauthorized());
    }
    if (!allowedRoles.includes(req.user.role)) {
      return next(ApiError.forbidden());
    }
    next();
  };
