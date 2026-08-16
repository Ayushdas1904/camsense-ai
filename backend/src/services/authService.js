import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { signAuthToken } from '../utils/token.js';

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

/** Builds the standard { user, token } session payload. */
function issueSession(user) {
  const token = signAuthToken({ sub: user._id.toString(), role: user.role });
  return { user: user.toPublicJSON(), token };
}
