import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { signAssetToken, signAuthToken } from '../utils/token.js';

/**
 * Auth business logic, kept separate from HTTP concerns.
 * Controllers translate HTTP <-> these functions; these functions own the rules.
 */

export async function registerUser({ name, email, password, role }) {
  const existing = await User.findOne({ email });
  if (existing) {
    throw ApiError.conflict('An account with that email already exists');
  }

  const user = new User({ name, email, role });
  await user.setPassword(password);
  await user.save();

  return issueSession(user);
}

export async function loginUser({ email, password }) {
  // passwordHash is select:false, so explicitly include it for verification.
  const user = await User.findOne({ email }).select('+passwordHash');
  if (!user) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  const valid = await user.verifyPassword(password);
  if (!valid) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  return issueSession(user);
}

/**
 * Builds the standard session payload.
 *
 * `token` is the API session credential (Authorization header). `assetToken` is
 * a separate, narrowed credential the frontend puts in `/uploads` image URLs:
 * an <img> cannot send a header, and a URL-borne credential leaks into browser
 * history and proxy logs, so it is scoped to image reads and expires sooner.
 * Neither token is a biometric payload and neither conveys an embedding.
 */
function issueSession(user) {
  const token = signAuthToken({ sub: user._id.toString(), role: user.role });
  return {
    user: user.toPublicJSON(),
    token,
    assetToken: signAssetToken(user._id.toString()),
  };
}
