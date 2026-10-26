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
  // ── Review 2 · face recognition / attendance ────────────────
  // Payloads carry ONLY ids, names, similarity, bbox, status and a snapshot
  // URL reference. Never a face embedding and never raw image data.
  PERSON_RECOGNIZED: 'person:recognized',
  IDENTITY_UNKNOWN: 'identity:unknown',
  ATTENDANCE_MARKED: 'attendance:marked',
  RECOGNITION_STATUS: 'recognition:status',
  // ── Review 3 · occupancy ────────────────────────────────────
  // OCCUPANCY_UPDATE carries one room's current count/status/availability.
  // The count is NULL — never 0 — when the figure is unavailable or stale, so
  // a client cannot render an unreadable camera as an empty room.
  OCCUPANCY_UPDATE: 'occupancy:update',
  // ROOM_STATUS carries a room's status TRANSITION (previous → current), for
  // clients that only care about changes rather than every refresh.
  ROOM_STATUS: 'room:status',
  // ── Review 3 · devices, automation, energy ──────────────────
  // DEVICE_STATE carries one device's full serialized state after a command,
  // a probe or a mode change. It ALWAYS carries `simulated` and `adapterType`
  // so a client cannot render a simulated device as physical hardware, and a
  // FAILED command is emitted with `commandFailed: true` and the device's
  // UNCHANGED reported state — the event never claims a change that the
  // adapter did not confirm.
  DEVICE_STATE: 'device:state',
  // AUTOMATION_ACTION carries one automation decision, INCLUDING the skipped
  // ones ('skipped_stale_data', 'skipped_override', ...). A rule that refused
  // to act because the occupancy data could not be trusted is the most
  // important thing to surface live, so it is emitted like any other decision.
  AUTOMATION_ACTION: 'automation:action',
  // ENERGY_UPDATE signals that the derived energy figures are worth
  // re-fetching (currently emitted after a daily rollup). It carries no
  // figures itself, so a client always reads them from the API with their
  // `estimated`/`simulated`/`baseline` caveats attached.
  ENERGY_UPDATE: 'energy:update',
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
