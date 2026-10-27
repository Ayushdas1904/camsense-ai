import { io, type Socket } from 'socket.io-client';

/**
 * Single shared Socket.IO connection. The realtime server is the backend
 * origin (API base URL minus the trailing /api). Components subscribe via the
 * useSocketEvent hook rather than touching this directly.
 */
const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5050/api';
const SOCKET_URL = API_BASE.replace(/\/api\/?$/, '');

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_URL, {
      autoConnect: true,
      transports: ['websocket', 'polling'],
    });
  }
  return socket;
}

/** Socket event names — must match the backend SocketEvents. */
export const SocketEvents = {
  DETECTION_NEW: 'detection:new',
  ALERT_NEW: 'alert:new',
  ALERT_UPDATED: 'alert:updated',
  CAMERA_STATUS: 'camera:status',
  DASHBOARD_UPDATE: 'dashboard:update',
  // Review 2 · face recognition / attendance.
  PERSON_RECOGNIZED: 'person:recognized',
  IDENTITY_UNKNOWN: 'identity:unknown',
  ATTENDANCE_MARKED: 'attendance:marked',
  RECOGNITION_STATUS: 'recognition:status',
  // Review 3 · occupancy / devices / automation / energy.
  OCCUPANCY_UPDATE: 'occupancy:update',
  ROOM_STATUS: 'room:status',
  DEVICE_STATE: 'device:state',
  AUTOMATION_ACTION: 'automation:action',
  ENERGY_UPDATE: 'energy:update',
} as const;
