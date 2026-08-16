import { apiClient } from './apiClient';
import { tokenStorage } from '@/utils/storage';
import type { ApiSuccess, Camera, CameraInput, StreamStats } from '@/types';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5050/api';

/**
 * Camera API surface. All camera HTTP lives here — components never call the
 * client directly.
 */
export const cameraService = {
  async list(): Promise<Camera[]> {
    const { data } = await apiClient.get<ApiSuccess<Camera[]>>('/cameras');
    return data.data;
  },

  async get(id: string): Promise<Camera> {
    const { data } = await apiClient.get<ApiSuccess<Camera>>(`/cameras/${id}`);
    return data.data;
  },

  async create(input: CameraInput): Promise<Camera> {
    const { data } = await apiClient.post<ApiSuccess<Camera>>('/cameras', input);
    return data.data;
  },

  async update(id: string, input: Partial<CameraInput>): Promise<Camera> {
    const { data } = await apiClient.put<ApiSuccess<Camera>>(`/cameras/${id}`, input);
    return data.data;
  },

  async remove(id: string): Promise<void> {
    await apiClient.delete(`/cameras/${id}`);
  },

  async startMonitoring(id: string): Promise<void> {
    await apiClient.post(`/cameras/${id}/monitor`, { action: 'start' });
  },

  async stopMonitoring(id: string): Promise<void> {
    await apiClient.post(`/cameras/${id}/monitor`, { action: 'stop' });
  },

  async stats(id: string): Promise<StreamStats> {
    const { data } = await apiClient.get<ApiSuccess<StreamStats>>(`/cameras/${id}/stats`);
    return data.data;
  },

  async triggerDemoWeapon(id: string): Promise<void> {
    await apiClient.post(`/cameras/${id}/demo-weapon`);
  },

  /**
   * Direct URL for the MJPEG stream, for use as an <img> src. Includes the auth
   * token as a query param because <img> can't send an Authorization header;
   * the backend's stream route accepts it there (and only there).
   */
  streamUrl(id: string): string {
    const token = tokenStorage.get() ?? '';
    return `${API_BASE}/cameras/${id}/stream?token=${encodeURIComponent(token)}&t=${Date.now()}`;
  },
};
