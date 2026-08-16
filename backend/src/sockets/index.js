import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * Real-time gateway (Socket.IO).
 *
 * Wired at the foundation level so real-time events can be emitted from
 * anywhere via `getIO().emit(...)` in later reviews (weapon detected,
 * unknown person, attendance marked, camera offline, etc.). No business
 * events are emitted yet — only connection lifecycle logging.
 */
let io = null;

export function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: env.clientOrigins, credentials: true },
  });

  io.on('connection', (socket) => {
    logger.debug(`Socket connected: ${socket.id}`);
    socket.on('disconnect', () => logger.debug(`Socket disconnected: ${socket.id}`));
  });

  logger.info('Socket.IO gateway ready');
  return io;
}

/** Accessor for emitting events elsewhere in the app. */
export function getIO() {
  if (!io) {
    throw new Error('Socket.IO has not been initialised yet');
  }
  return io;
}
