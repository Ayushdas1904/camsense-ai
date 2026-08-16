import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { User } from '../models/User.js';
import { env } from '../config/env.js';
import { logger } from './logger.js';

/**
 * One-off script (`npm run seed`) that creates the initial admin account from
 * the SEED_ADMIN_* environment variables. Idempotent: skips if the email exists.
 */
async function seedAdmin() {
  await connectDatabase();

  const { name, email, password } = env.seedAdmin;
  const existing = await User.findOne({ email });

  if (existing) {
    logger.info(`Admin already exists: ${email} — nothing to do`);
  } else {
    const user = new User({ name, email, role: 'admin' });
    await user.setPassword(password);
    await user.save();
    logger.info(`Created admin account: ${email}`);
    logger.warn('Change the seeded password after first login.');
  }

  await disconnectDatabase();
  process.exit(0);
}

seedAdmin().catch((error) => {
  logger.error('Seed failed', error.message);
  process.exit(1);
});
