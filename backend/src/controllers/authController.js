import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler.js';
import { signAssetToken } from '../utils/token.js';
import * as authService from '../services/authService.js';

export const loginSchema = z.object({
  email: z.string().email('A valid email is required'),
  password: z.string().min(1, 'Password is required'),
});

export const registerSchema = z.object({
  name: z.string().min(2, 'Name is too short'),
  email: z.string().email('A valid email is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  role: z.enum(['admin', 'operator', 'viewer']).optional(),
});

export const register = asyncHandler(async (req, res) => {
  const session = await authService.registerUser(req.body);
  res.status(201).json({ success: true, data: session });
});

export const login = asyncHandler(async (req, res) => {
  const session = await authService.loginUser(req.body);
  res.status(200).json({ success: true, data: session });
});

/**
 * With stateless JWTs there is nothing to invalidate server-side for the
 * foundation; the client discards the token. This endpoint exists so the
 * contract is stable when server-side token revocation is added later.
 */
export const logout = asyncHandler(async (_req, res) => {
  res.status(200).json({ success: true, data: { message: 'Logged out' } });
});

/**
 * Returns the currently authenticated user (requires requireAuth), plus a
 * freshly minted asset token.
 *
 * The frontend calls this on every boot to restore the session, so handing the
 * asset token back here means `/uploads` images work immediately after a
 * reload without a second round trip — and without putting the session token
 * itself in an image URL.
 */
export const me = asyncHandler(async (req, res) => {
  res.status(200).json({
    success: true,
    data: {
      user: req.user.toPublicJSON(),
      assetToken: signAssetToken(req.user._id.toString()),
    },
  });
});
