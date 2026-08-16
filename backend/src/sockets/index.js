import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * Real-time gateway (Socket.IO).
 *
 * Realizes the EVENT → WEBSOCKET → DASHBOARD leg. The backend emits these
 * events when significant things happen; the frontend subscribes and updates
 * live without a page refresh.
 */
export const SocketEvents = {
  DETECTION_NEW: 'detection:new',
  ALERT_NEW: 'alert:new',
  ALERT_UPDATED: 'alert:updated',
  CAMERA_STATUS: 'camera:status',
  DASHBOARD_UPDATE: 'dashboard:update',
};

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

export function getIO() {
  if (!io) throw new Error('Socket.IO has not been initialised yet');
  return io;
}

/** Safe emit — no-op if the gateway isn't up yet (e.g. during scripts/tests). */
export function emit(event, payload) {
  if (io) io.emit(event, payload);
}
