import { apiClient } from './apiClient';
import type { Alert, AlertStatus, ApiSuccess } from '@/types';

interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}

export const alertService = {
  async list(params: { status?: string; severity?: string; limit?: number } = {}): Promise<Paged<Alert>> {
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
