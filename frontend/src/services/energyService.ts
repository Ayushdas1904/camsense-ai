import { apiClient } from './apiClient';
import type {
  ApiSuccess,
  EnergyByDevice,
  EnergyByRoom,
  EnergyHistory,
  EnergySummary,
  EnergyTrend,
} from '@/types';

/**
 * Energy consumption and savings analytics — READ ONLY.
 *
 * There is no write method and nothing to write: every figure is derived on
 * request from CONFIRMED device-state transitions and each device's CONFIGURED
 * power rating. No endpoint fabricates a series to make a chart look
 * populated.
 *
 * ═══ WHAT A CALLER MUST RENDER ═══
 *
 * Every response carries its own caveats as FIELDS, so a UI cannot display a
 * figure without them:
 *
 *   estimated: true   — always. There is no power meter in this project.
 *   simulated         — true when a contributing device was driven by the
 *                       simulation adapter: the durations are real elapsed
 *                       time, but no hardware was switched.
 *   baseline          — { hoursPerDay, description, source }. The declared
 *                       assumption a saving is measured against. Render
 *                       `description` NEXT TO any savings figure.
 *   insufficientData  — with a `requires` array naming what is missing. Render
 *                       `requires` as the empty-state text rather than drawing
 *                       a zero that reads like a measurement of an idle device.
 *
 * `savingsPercent` is `number | null`. Null means the baseline is 0 and no
 * percentage is meaningful — render "not enough configuration", never 0%.
 */
export const energyService = {
  /** One day, per device plus totals and the day's automation activity. */
  async summary(params: { date?: string; roomId?: string } = {}): Promise<EnergySummary> {
    const { data } = await apiClient.get<ApiSuccess<EnergySummary>>('/energy/summary', {
      params,
    });
    return data.data;
  },

  /**
   * The recorded intervals behind the summary — the raw evidence.
   *
   * Unconfirmed rows are INCLUDED but flagged `confirmed: false` and contribute
   * 0 kWh, so an operator can see that a command failed while the arithmetic
   * still ignores it. Paginated and hard-capped by the backend.
   */
  async history(
    params: {
      from?: string;
      to?: string;
      roomId?: string;
      deviceId?: string;
      limit?: number;
      page?: number;
    } = {}
  ): Promise<EnergyHistory> {
    const { data } = await apiClient.get<ApiSuccess<EnergyHistory>>('/energy/history', {
      params,
    });
    return data.data;
  },

  /** Room-level rollup over an explicit window (default: the last 7 days). */
  async byRoom(params: { from?: string; to?: string } = {}): Promise<EnergyByRoom> {
    const { data } = await apiClient.get<ApiSuccess<EnergyByRoom>>('/energy/by-room', { params });
    return data.data;
  },

  /** Device-level rollup over an explicit window (default: the last 7 days). */
  async byDevice(
    params: { from?: string; to?: string; roomId?: string } = {}
  ): Promise<EnergyByDevice> {
    const { data } = await apiClient.get<ApiSuccess<EnergyByDevice>>('/energy/by-device', {
      params,
    });
    return data.data;
  },

  /**
   * Daily totals from the completed-day rollup, for the weekly/monthly trend.
   *
   * Returns `insufficientData: true` until at least one FULL day has been
   * rolled up — a partial day is deliberately never rolled up, because it
   * would be wrong the moment it was written and would then be served as a
   * finished day. An empty trend on a fresh system is therefore expected, and
   * the `requires` message is what to show instead of a flat line at zero.
   */
  async trend(params: { days?: number } = {}): Promise<EnergyTrend> {
    const { data } = await apiClient.get<ApiSuccess<EnergyTrend>>('/energy/trend', { params });
    return data.data;
  },
};
