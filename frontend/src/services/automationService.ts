import { apiClient } from './apiClient';
import type {
  ApiSuccess,
  AutomationEngineHealth,
  AutomationLog,
  AutomationRule,
  AutomationRuleInput,
} from '@/types';

interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
  maxLimit?: number;
}

interface RuleList extends Paged<AutomationRule> {
  enabledCount: number;
  engine: AutomationEngineHealth;
}

interface HistoryList extends Paged<AutomationLog> {
  engine: AutomationEngineHealth;
}

/**
 * Automation rules and execution history.
 *
 * EVERY RULE CHANGE REQUIRES THE ADMIN ROLE on the backend — create, update,
 * delete, enable, disable and evaluate. A rule decides when a device is
 * switched, so editing one is equivalent to being allowed to switch it.
 *
 * TWO THINGS THE UI MUST NOT HIDE:
 *   • A new rule is created DISABLED, and a rule only acts on devices whose
 *     control mode is 'automatic'. Those are two separate opt-ins, and the
 *     enable response reports how many of the rule's devices are actually in
 *     automatic mode so an operator finds out here rather than from a silent
 *     dashboard.
 *   • `history` INCLUDES the skipped decisions. A rule that refused to act
 *     because the occupancy figure was stale is the most important row this
 *     endpoint returns; filtering skips out would make a suspended rule
 *     indistinguishable from one that was never evaluated.
 */
export const automationService = {
  async listRules(
    params: { roomId?: string; enabled?: string; limit?: number; page?: number } = {}
  ): Promise<RuleList> {
    const { data } = await apiClient.get<ApiSuccess<RuleList>>('/automation/rules', { params });
    return data.data;
  },

  async getRule(id: string): Promise<AutomationRule> {
    const { data } = await apiClient.get<ApiSuccess<AutomationRule>>(`/automation/rules/${id}`);
    return data.data;
  },

  /** Admin only. Created DISABLED unless `enabled` is explicitly true. */
  async createRule(input: AutomationRuleInput): Promise<AutomationRule> {
    const { data } = await apiClient.post<ApiSuccess<AutomationRule>>('/automation/rules', input);
    return data.data;
  },

  /** Admin only. */
  async updateRule(id: string, input: Partial<AutomationRuleInput>): Promise<AutomationRule> {
    const { data } = await apiClient.put<ApiSuccess<AutomationRule>>(
      `/automation/rules/${id}`,
      input
    );
    return data.data;
  },

  /** Admin only. Execution history is retained so past decisions stay auditable. */
  async removeRule(id: string): Promise<void> {
    await apiClient.delete(`/automation/rules/${id}`);
  },

  /** Admin only. Switches nothing by itself. */
  async enableRule(id: string): Promise<AutomationRule> {
    const { data } = await apiClient.post<ApiSuccess<AutomationRule>>(
      `/automation/rules/${id}/enable`
    );
    return data.data;
  },

  /** Admin only. Leaves every device exactly where it is. */
  async disableRule(id: string): Promise<AutomationRule> {
    const { data } = await apiClient.post<ApiSuccess<AutomationRule>>(
      `/automation/rules/${id}/disable`
    );
    return data.data;
  },

  /**
   * Admin only. Runs the rule's room once, now.
   *
   * Useful for a demonstration: it makes the engine's decision visible
   * immediately instead of waiting up to a tick interval, and it takes no
   * shortcuts — a stale occupancy figure produces 'skipped_stale_data' here
   * exactly as it would on the tick.
   */
  async evaluateRule(id: string): Promise<Record<string, unknown>> {
    const { data } = await apiClient.post<ApiSuccess<Record<string, unknown>>>(
      `/automation/rules/${id}/evaluate`
    );
    return data.data;
  },

  /** Paginated, hard-capped, and INCLUDES the skipped decisions. */
  async history(
    params: {
      roomId?: string;
      deviceId?: string;
      ruleId?: string;
      decision?: string;
      from?: string;
      to?: string;
      limit?: number;
      page?: number;
    } = {}
  ): Promise<HistoryList> {
    const { data } = await apiClient.get<ApiSuccess<HistoryList>>('/automation/history', {
      params,
    });
    return data.data;
  },

  /** What the engine is actually doing — last tick, last error, enabled rules. */
  async health(): Promise<AutomationEngineHealth> {
    const { data } = await apiClient.get<ApiSuccess<AutomationEngineHealth>>(
      '/automation/health'
    );
    return data.data;
  },
};
