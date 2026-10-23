import { apiClient } from './apiClient';
import type { ApiSuccess, AttendanceRecord, AttendanceSummary } from '@/types';

interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}

export interface AttendanceQuery {
  date?: string;
  personId?: string;
  cameraId?: string;
  department?: string;
  category?: string;
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
}

/**
 * Attendance API surface (Review 2) — READ ONLY by design.
 *
 * There is deliberately no create/update method here, because the backend
 * exposes no client-facing attendance write route: records are produced only by
 * the trusted recognition workflow behind the shared-secret AI ingest endpoint.
 * Do not add a write method to this file.
 */
export const attendanceService = {
  async list(params: AttendanceQuery = {}): Promise<Paged<AttendanceRecord>> {
    const { data } = await apiClient.get<ApiSuccess<Paged<AttendanceRecord>>>('/attendance', {
      params,
    });
    return data.data;
  },

  /**
   * Session summary. Every figure is counted by the backend over persisted
   * documents — the UI renders them as-is and never recomputes them from a
   * partial page of rows.
   */
  async summary(params: { date?: string; limit?: number } = {}): Promise<AttendanceSummary> {
    const { data } = await apiClient.get<ApiSuccess<AttendanceSummary>>('/attendance/summary', {
      params,
    });
    return data.data;
  },

  async get(id: string): Promise<AttendanceRecord> {
    const { data } = await apiClient.get<ApiSuccess<AttendanceRecord>>(`/attendance/${id}`);
    return data.data;
  },
};
