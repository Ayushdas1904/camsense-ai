/**
 * Shared application types. Mirrors the backend's data contract so the app is
 * fully typed end to end. Add types here as new API resources are implemented.
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

/** Standard success envelope from the backend: { success, data }. */
export interface ApiSuccess<T> {
  success: true;
  data: T;
}

/** Standard error envelope from the backend: { success:false, error }. */
export interface ApiErrorBody {
  success: false;
  error: {
    message: string;
    details?: unknown;
  };
}

/** UI-level status used by loading/empty/error components. */
export type ViewStatus = 'idle' | 'loading' | 'success' | 'empty' | 'error';

export interface BackendHealth {
  service: string;
  status: string;
  environment: string;
  uptimeSeconds: number;
  database: { status: string };
  timestamp: string;
}
