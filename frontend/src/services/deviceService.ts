import { apiClient } from './apiClient';
import type {
  AdapterHealth,
  ApiSuccess,
  Device,
  DeviceCommandResult,
  DeviceControlMode,
  DeviceInput,
  DeviceStateHistoryRow,
} from '@/types';

interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}

interface DeviceList extends Paged<Device> {
  /** Carried so the UI can state plainly how many of these are simulated. */
  simulatedCount: number;
}

/**
 * Device management and manual control.
 *
 * EVERY MUTATION HERE REQUIRES THE ADMIN ROLE on the backend, including
 * `command`. Issuing a command is the act of switching something, so the UI
 * must gate these controls on the signed-in user's role rather than letting a
 * viewer discover the restriction through a 403.
 *
 * `command` is the one method whose failure is not an exception to swallow: the
 * backend answers HTTP 502 when the adapter did not confirm, and axios turns
 * that into a rejection carrying the backend's message. A caller MUST surface
 * that as a failure and must NOT redraw the device as switched — the device's
 * reportedState is deliberately unchanged in that case.
 */
export const deviceService = {
  async list(
    params: { roomId?: string; type?: string; controlMode?: string; active?: string; limit?: number } = {}
  ): Promise<DeviceList> {
    const { data } = await apiClient.get<ApiSuccess<DeviceList>>('/devices', { params });
    return data.data;
  },

  async get(id: string): Promise<Device> {
    const { data } = await apiClient.get<ApiSuccess<Device>>(`/devices/${id}`);
    return data.data;
  },

  /** Admin only. The backend rejects a roomId that does not resolve. */
  async create(input: DeviceInput): Promise<Device> {
    const { data } = await apiClient.post<ApiSuccess<Device>>('/devices', input);
    return data.data;
  },

  /** Admin only. */
  async update(id: string, input: Partial<DeviceInput>): Promise<Device> {
    const { data } = await apiClient.put<ApiSuccess<Device>>(`/devices/${id}`, input);
    return data.data;
  },

  /** Admin only. The device's state history is retained so energy stays reproducible. */
  async remove(id: string): Promise<void> {
    await apiClient.delete(`/devices/${id}`);
  },

  /**
   * Admin only. Issues a manual on/off command.
   *
   * With `override: true` (the backend default) the operator's choice is
   * protected for `overrideMinutes`, so automation records 'skipped_override'
   * instead of immediately undoing it. With `override: false` it is a one-off
   * nudge automation may correct at its next evaluation.
   *
   * REJECTS with the backend's message when the adapter did not confirm.
   */
  async command(
    id: string,
    body: { state: 'on' | 'off'; override?: boolean; overrideMinutes?: number; reason?: string }
  ): Promise<DeviceCommandResult> {
    const { data } = await apiClient.post<ApiSuccess<DeviceCommandResult>>(
      `/devices/${id}/command`,
      body
    );
    return data.data;
  },

  /** Admin only. Safe transition between automatic / manual / disabled. */
  async setControlMode(id: string, controlMode: DeviceControlMode): Promise<Device> {
    const { data } = await apiClient.post<ApiSuccess<Device>>(`/devices/${id}/control-mode`, {
      controlMode,
    });
    return data.data;
  },

  /**
   * Admin only. Returns the device to automatic control.
   *
   * Switches NOTHING. The device stays where the operator left it until
   * automation decides otherwise on the strength of a usable occupancy figure.
   */
  async clearOverride(id: string): Promise<{ device: Device; note: string }> {
    const { data } = await apiClient.delete<ApiSuccess<{ device: Device; note: string }>>(
      `/devices/${id}/override`
    );
    return data.data;
  },

  /** Admin only. Reads the adapter's view of the device. */
  async probe(id: string): Promise<{ ok: boolean; message: string; device: Device }> {
    const { data } = await apiClient.post<
      ApiSuccess<{ ok: boolean; message: string; device: Device }>
    >(`/devices/${id}/probe`);
    return data.data;
  },

  /**
   * Paginated action history, including the FAILED attempts (each carrying
   * `confirmed: false`), because "this device has refused three commands in a
   * row" is the most useful thing this view can tell an operator.
   */
  async history(
    id: string,
    params: { from?: string; to?: string; limit?: number; page?: number } = {}
  ): Promise<Paged<DeviceStateHistoryRow>> {
    const { data } = await apiClient.get<ApiSuccess<Paged<DeviceStateHistoryRow>>>(
      `/devices/${id}/history`,
      { params }
    );
    return data.data;
  },

  /**
   * Which adapters exist and which actually work.
   *
   * Read this instead of hardcoding an adapter dropdown: it states in plain
   * language that only the simulation adapter is implemented, so the UI never
   * implies hardware support this project does not have.
   */
  async adapters(): Promise<AdapterHealth> {
    const { data } = await apiClient.get<ApiSuccess<AdapterHealth>>('/devices/adapters');
    return data.data;
  },
};
