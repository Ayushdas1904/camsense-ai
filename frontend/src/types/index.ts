/**
 * Shared application types. Mirrors the backend's data contract so the app is
 * fully typed end to end.
 */

export type UserRole = 'admin' | 'operator' | 'viewer';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  createdAt?: string;
  updatedAt?: string;
}

export interface AuthSession {
  user: User;
  token: string;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiErrorBody {
  success: false;
  error: { message: string; details?: unknown };
}

export type ViewStatus = 'idle' | 'loading' | 'success' | 'empty' | 'error';

export interface BackendHealth {
  service: string;
  status: string;
  environment: string;
  uptimeSeconds: number;
  database: { status: string };
  timestamp: string;
}

// ── Review 1 ─────────────────────────────────────────────────

export type CameraMode = 'demo' | 'real';
export type CameraStatus = 'online' | 'offline' | 'connecting' | 'error';

export interface Camera {
  _id: string;
  cameraId: string;
  name: string;
  location: string;
  streamUrl: string;
  mode: CameraMode;
  status: CameraStatus;
  aiEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CameraInput {
  cameraId: string;
  name: string;
  location?: string;
  streamUrl?: string;
  mode: CameraMode;
  aiEnabled: boolean;
}

export type DetectionType = 'human' | 'weapon' | 'face' | 'other';

export interface Detection {
  _id: string;
  cameraId: string;
  type: DetectionType;
  class: string;
  confidence: number;
  boundingBox?: number[];
  source: 'demo' | 'real';
  timestamp: string;
}

export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertStatus = 'new' | 'acknowledged' | 'resolved';

export interface Alert {
  id: string;
  type: string;
  severity: AlertSeverity;
  cameraId: string;
  cameraName?: string;
  objectClass?: string;
  confidence?: number;
  message: string;
  snapshot?: string;
  status: AlertStatus;
  timestamp: string;
}

export interface DetectorStatus {
  key: string;
  label: string;
  status: 'active' | 'unavailable' | 'demo';
}

export interface AiStatus {
  reachable?: boolean;
  mode: CameraMode;
  model_loaded: boolean;
  detectors: DetectorStatus[];
}

export interface DashboardStats {
  totalCameras: number;
  activeCameras: number;
  peopleDetectedToday: number;
  weaponsDetectedToday: number;
  newAlerts: number;
  totalAlerts: number;
  ai: AiStatus;
}

export interface StreamStats {
  camera_id: string;
  running: boolean;
  mode: CameraMode;
  fps: number;
  inference_ms: number;
  people: number;
  weapons: number;
  model_loaded: boolean;
}

export interface RecentEvent {
  kind: 'alert' | 'detection';
  id: string;
  severity: AlertSeverity;
  title: string;
  cameraName: string;
  timestamp: string;
}

/** Socket event payloads (must match backend sockets/index.js). */
export interface DetectionEventPayload {
  id: string;
  cameraId: string;
  cameraName: string;
  type: DetectionType;
  class: string;
  confidence: number;
  source: 'demo' | 'real';
  timestamp: string;
}
