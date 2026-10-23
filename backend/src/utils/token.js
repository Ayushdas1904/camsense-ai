import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

/**
 * JWT helpers. The signing secret and expiry come from env config only —
 * never hardcoded. Keeping sign/verify here means the token shape is defined
 * in exactly one place.
 */
export function signAuthToken(payload) {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn });
}

export function verifyAuthToken(token) {
  const payload = jwt.verify(token, env.jwtSecret);
  // A NARROWED token must never be accepted as a session credential. The
  // asset token below carries `scope`, is handed out in image URLs, and must
  // buy nothing except image reads — so anything carrying a scope claim is
  // rejected here, where full API access is being granted.
  if (payload && payload.scope) {
    const err = new Error('Token is not a session token');
    err.name = 'JsonWebTokenError';
    throw err;
  }
  return payload;
}

/** The scope claim that marks a token as usable for stored images ONLY. */
export const ASSET_TOKEN_SCOPE = 'uploads';

/**
 * Mints a NARROWED token for the authenticated `/uploads` image mount.
 *
 * An `<img>` tag cannot send an Authorization header, so an image URL has to
 * carry its credential as a query parameter — where it lands in browser
 * history, devtools, and any fronting proxy's access log. Putting the ordinary
 * session token there meant handing out a credential valid for the WHOLE API
 * for as long as the session lasts (`JWT_EXPIRES_IN`, default 7d).
 *
 * This token is the same mechanism (this backend's own JWT, same secret, same
 * verifier) with two restrictions, so nothing new is invented:
 *   • `scope: 'uploads'` — rejected by every route except the asset mount;
 *   • `ASSET_TOKEN_EXPIRES_IN` (default 1d) rather than the session lifetime.
 *
 * It conveys no role and authorizes no mutation.
 */
export function signAssetToken(userId) {
  return jwt.sign({ sub: String(userId), scope: ASSET_TOKEN_SCOPE }, env.jwtSecret, {
    expiresIn: env.assetTokenExpiresIn,
  });
}

/**
 * Verifies an asset token and REQUIRES the narrowed scope.
 *
 * A full session token presented here is rejected: accepting one would restore
 * exactly the exposure this split exists to remove (a whole-API credential in
 * an image URL). Throws on an invalid, expired, or wrongly-scoped token.
 */
export function verifyAssetToken(token) {
  const payload = jwt.verify(token, env.jwtSecret);
  if (!payload || payload.scope !== ASSET_TOKEN_SCOPE) {
    const err = new Error('Token is not scoped for asset access');
    err.name = 'JsonWebTokenError';
    throw err;
  }
  return payload;
}
