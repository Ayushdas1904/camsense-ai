import mongoose from 'mongoose';
import { asyncHandler } from '../utils/asyncHandler.js';
import { env } from '../config/env.js';

const MONGO_STATES = ['disconnected', 'connected', 'connecting', 'disconnecting'];

/**
 * Health check for the application backend.
 * Reports process uptime and database connectivity so the frontend (and any
 * future monitoring) can show real system-health status, not a hardcoded "OK".
 */
export const getHealth = asyncHandler(async (_req, res) => {
  const dbState = MONGO_STATES[mongoose.connection.readyState] || 'unknown';

  res.status(200).json({
    success: true,
    data: {
      service: 'camsense-backend',
      status: 'ok',
      environment: env.nodeEnv,
      uptimeSeconds: Math.round(process.uptime()),
      database: { status: dbState },
      timestamp: new Date().toISOString(),
    },
  });
});
