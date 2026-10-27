import { apiClient } from './apiClient';
import type { Alert, AlertStatus, ApiSuccess } from '@/types';

interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}

/**
 * Alerts.
 *
 * The filter parameters are ADDITIVE: `status` and `severity` behave exactly
 * as they always did, and every Review 3 parameter is optional, so a caller
 * that sends none gets the same result set it always did. The acknowledge /
 * resolve call and the alert payload shape are unchanged.
 */
export const alertService = {
  async list(
    params: {
      status?: string;
      severity?: string;
      /** Alert category. The backend also accepts it as `category`. */
      type?: string;
      cameraId?: string;
      roomId?: string;
      deviceId?: string;
      /** ISO timestamps. A malformed value narrows nothing rather than erroring. */
      from?: string;
      to?: string;
      limit?: number;
      page?: number;
    } = {}
  ): Promise<Paged<Alert>> {
    const { data } = await apiClient.get<ApiSuccess<Paged<Alert>>>('/alerts', { params });
    return data.data;
  },

  async get(id: string): Promise<Alert> {
    const { data } = await apiClient.get<ApiSuccess<Alert>>(`/alerts/${id}`);
    return data.data;
  },

  async updateStatus(id: string, status: AlertStatus): Promise<Alert> {
    const { data } = await apiClient.patch<ApiSuccess<Alert>>(`/alerts/${id}/status`, { status });
    return data.data;
  },
};
