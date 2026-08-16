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
  return jwt.verify(token, env.jwtSecret);
}
