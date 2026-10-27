import { apiClient } from './apiClient';
import type {
  ApiSuccess,
  OccupancyCurrent,
  OccupancyReading,
  OccupancySummary,
  Room,
  RoomInput,
} from '@/types';

interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
  maxLimit?: number;
}

/**
 * Rooms / zones and occupancy. Follows the shape of dashboardService: one
 * exported object per area, every call going through the shared apiClient.
 *
 * THERE IS DELIBERATELY NO WRITE METHOD FOR AN OCCUPANCY FIGURE. Occupancy is
 * AI-produced data and the only path into persisted state is the backend's
 * shared-secret route POST /api/ai/occupancy, which a browser cannot reach.
 * The room CRUD below is configuration, not measurement, and the backend
 * requires the admin role for each of those three mutations.
 *
 * `count` on every Room is `number | null`. Null means the figure is not
 * trustworthy (camera unavailable, or a reading past the staleness window) and
 * it MUST NOT be coerced to 0 by a caller.
 */
export const roomService = {
  async list(params: { search?: string; active?: string; limit?: number } = {}): Promise<Paged<Room>> {
    const { data } = await apiClient.get<ApiSuccess<Paged<Room>>>('/rooms', { params });
    return data.data;
  },

  async get(id: string): Promise<Room> {
    const { data } = await apiClient.get<ApiSuccess<Room>>(`/rooms/${id}`);
    return data.data;
  },

  /** Admin only. The backend rejects a cameraId that does not resolve. */
  async create(input: RoomInput): Promise<Room> {
    const { data } = await apiClient.post<ApiSuccess<Room>>('/rooms', input);
    return data.data;
  },

  /** Admin only. */
  async update(id: string, input: Partial<RoomInput>): Promise<Room> {
    const { data } = await apiClient.put<ApiSuccess<Room>>(`/rooms/${id}`, input);
    return data.data;
  },

  /**
   * Admin only. The occupancy HISTORY is retained either way — deleting a room
   * is a configuration change and must not destroy recorded measurements.
   */
  async remove(id: string): Promise<void> {
    await apiClient.delete(`/rooms/${id}`);
  },
};

export const occupancyService = {
  /** Current occupancy for every active room, re-derived at read time. */
  async current(): Promise<OccupancyCurrent> {
    const { data } = await apiClient.get<ApiSuccess<OccupancyCurrent>>('/occupancy/current');
    return data.data;
  },

  /** Paginated and date-filtered. The page size is hard-capped by the backend. */
  async history(
    params: { roomId?: string; from?: string; to?: string; limit?: number; page?: number } = {}
  ): Promise<Paged<OccupancyReading>> {
    const { data } = await apiClient.get<ApiSuccess<Paged<OccupancyReading>>>(
      '/occupancy/history',
      { params }
    );
    return data.data;
  },

  async summary(): Promise<OccupancySummary> {
    const { data } = await apiClient.get<ApiSuccess<OccupancySummary>>('/occupancy/summary');
    return data.data;
  },
};
