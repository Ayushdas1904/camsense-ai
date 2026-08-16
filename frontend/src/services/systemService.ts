import { apiClient } from './apiClient';
import type { ApiSuccess, BackendHealth } from '@/types';

/**
 * System/health API. Used by the dashboard to show real backend + database
 * status instead of a hardcoded "online" indicator.
 */
export const systemService = {
  async health(): Promise<BackendHealth> {
    const { data } = await apiClient.get<ApiSuccess<BackendHealth>>('/health');
    return data.data;
  },
};
