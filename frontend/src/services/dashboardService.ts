import { apiClient } from './apiClient';
import type { ApiSuccess, DashboardStats, Detection, RecentEvent } from '@/types';

interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}

export const dashboardService = {
  async stats(): Promise<DashboardStats> {
    const { data } = await apiClient.get<ApiSuccess<DashboardStats>>('/dashboard/stats');
    return data.data;
  },

  async recentEvents(limit = 10): Promise<RecentEvent[]> {
    const { data } = await apiClient.get<ApiSuccess<RecentEvent[]>>('/dashboard/recent-events', {
      params: { limit },
    });
    return data.data;
  },
};

export const detectionService = {
  async list(params: { cameraId?: string; type?: string; limit?: number } = {}): Promise<Paged<Detection>> {
    const { data } = await apiClient.get<ApiSuccess<Paged<Detection>>>('/detections', { params });
    return data.data;
  },
};
