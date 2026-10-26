import { apiClient } from './apiClient';
import type { ApiSuccess, BackendHealth, SystemHealth } from '@/types';

/**
 * Service health.
 *
 * `liveness()` is the shallow unauthenticated probe: it reports only that the
 * backend process is up and whether its database connection is open.
 *
 * `components()` is the honest per-component report the dashboard panel needs.
 * The distinction matters: the backend answering a request proves exactly one
 * thing — that the backend is up. Everything else in the components payload is
 * probed, counted or read from the component that owns the state, so the AI
 * model and the recognition subsystem each report for themselves and a
 * component whose state cannot be determined comes back as 'unknown' with a
 * reason rather than 'ok'.
 */
export const healthService = {
  async liveness(): Promise<BackendHealth> {
    const { data } = await apiClient.get<ApiSuccess<BackendHealth>>('/health');
    return data.data;
  },

  async components(): Promise<SystemHealth> {
    const { data } = await apiClient.get<ApiSuccess<SystemHealth>>('/health/components');
    return data.data;
  },
};
