import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

/**
 * Establishes the MongoDB connection.
 *
 * The rest of the app never calls mongoose.connect directly — it goes through
 * here so connection options, logging, and retry policy live in one place.
 */
export async function connectDatabase() {
  mongoose.set('strictQuery', true);

  mongoose.connection.on('connected', () => {
    logger.info('MongoDB connected');
  });
  mongoose.connection.on('error', (err) => {
    logger.error('MongoDB connection error', err.message);
  });
  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected');
  });

  await mongoose.connect(env.mongoUri);
  return mongoose.connection;
}

export async function disconnectDatabase() {
  await mongoose.connection.close();
}
