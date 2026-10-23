import { ApiError } from '../utils/ApiError.js';
import { verifyAssetToken, verifyAuthToken } from '../utils/token.js';
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
 * Guards the stored-image mount (`/uploads`): detection snapshots, cropped
 * unknown-face snapshots, and enrolled people's registration portraits.
 *
 * Two accepted credentials, and the difference matters:
 *
 *   • `Authorization: Bearer <session token>` — the ordinary session, used by
 *     anything that can set a header.
 *   • `?token=<asset token>` — for `<img>` tags, which cannot. This MUST be a
 *     token minted by `signAssetToken`: scoped to asset access and
 *     short(er)-lived. A full session token in the query string is REJECTED,
 *     because an image URL leaks into browser history, devtools and any
 *     fronting proxy's log, and a leaked credential there must not be usable
 *     against the rest of the API.
 *
 * Either way the user is loaded, so a deleted account loses access
 * immediately. Anonymous callers get 401 — nothing here is a public asset.
 */
export const requireAssetAccess = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) {
    await authenticate(header.slice(7), req);
    return next();
  }

  const token = typeof req.query.token === 'string' ? req.query.token : null;
  if (!token) throw ApiError.unauthorized('Authentication required');

  let payload;
  try {
    payload = verifyAssetToken(token);
  } catch {
    // Covers an invalid signature, an expired token, AND a valid session token
    // presented here — which is deliberately not enough.
    throw ApiError.unauthorized('Invalid or expired image access token');
  }

  const user = await User.findById(payload.sub);
  if (!user) throw ApiError.unauthorized('Account no longer exists');
  req.user = user;
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
