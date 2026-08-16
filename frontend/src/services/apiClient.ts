import axios, { AxiosError } from 'axios';
import { tokenStorage } from '@/utils/storage';
import type { ApiErrorBody } from '@/types';

/**
 * Centralized Axios instance — the single door through which the app talks to
 * the backend. Components never call fetch/axios directly; they use the
 * per-resource services that wrap this client.
 *
 * Responsibilities:
 *  - inject the auth token on every request
 *  - normalize backend errors into a consistent { message } shape
 *  - handle 401 by clearing the session
 */
const baseURL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';

export const apiClient = axios.create({
  baseURL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15000,
});

apiClient.interceptors.request.use((config) => {
  const token = tokenStorage.get();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/** A normalized, human-readable error the UI can display directly. */
export interface NormalizedError {
  message: string;
  status?: number;
  details?: unknown;
}

apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ApiErrorBody>) => {
    // Session expired/invalid — clear token so the app redirects to login.
    if (error.response?.status === 401) {
      tokenStorage.clear();
    }

    const normalized: NormalizedError = {
      message:
        error.response?.data?.error?.message ||
        (error.code === 'ERR_NETWORK'
          ? 'Cannot reach the server. Please check your connection.'
          : 'Something went wrong. Please try again.'),
      status: error.response?.status,
      details: error.response?.data?.error?.details,
    };

    return Promise.reject(normalized);
  }
);
