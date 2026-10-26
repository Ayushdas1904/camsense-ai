import type {
  AutomationDecision,
  ComponentStatus,
  DeviceState,
  OccupancyStatus,
} from '@/types';

/**
 * Presentation helpers shared by the Occupancy & Energy page, the Analytics
 * page and the Dashboard's Review 3 panels. Kept in one place so the same
 * condition is never shown with two different colours on two pages.
 *
 * WORDING IS NOT DEFINED HERE. Occupancy responses ship `statusLabel` and
 * `statusLabels`, and the automation log ships a human-readable `reason`, so
 * the UI renders the backend's own wording. Only the colour mapping and the
 * numeric no-data rendering live here.
 */

/** Tone for an occupancy status. The two no-data states are never 'safe'. */
export function occupancyStatusTone(
  status: OccupancyStatus
): 'neutral' | 'safe' | 'critical' | 'warning' | 'info' {
  switch (status) {
    case 'occupied':
      return 'info';
    case 'unoccupied':
      return 'safe';
    case 'near_capacity':
      return 'warning';
    case 'capacity_exceeded':
      return 'critical';
    case 'camera_unavailable':
    case 'stale':
      // Deliberately 'neutral', not 'safe'. An unreadable camera is an absence
      // of information, and colouring it green would read as "all clear".
      return 'neutral';
    default:
      return 'neutral';
  }
}

/** True for the two statuses whose count is always null. */
export function isOccupancyUnknown(status: OccupancyStatus): boolean {
  return status === 'camera_unavailable' || status === 'stale';
}

/**
 * Renders an occupancy count for display.
 *
 * THE ONE RULE THIS WHOLE FILE EXISTS FOR: a null count renders as an em-dash,
 * NEVER as 0. The backend returns null when a figure is not trustworthy, and
 * turning that into a 0 would tell the operator a room full of people is
 * empty. Every count on every Review 3 surface goes through here.
 */
export function renderCount(count: number | null | undefined): string {
  return count === null || count === undefined ? '—' : String(count);
}

/** Renders an optional numeric KPI; null means "could not be determined". */
export function renderNumber(value: number | null | undefined, suffix = ''): string {
  return value === null || value === undefined ? '—' : `${value}${suffix}`;
}

/** Tone for a device's REPORTED state. 'unknown' is never shown as 'off'. */
export function deviceStateTone(state: DeviceState): 'neutral' | 'safe' | 'warning' | 'info' {
  if (state === 'on') return 'info';
  if (state === 'off') return 'neutral';
  // Nothing has ever been confirmed for this device.
  return 'warning';
}

export function deviceStateLabel(state: DeviceState): string {
  if (state === 'on') return 'ON';
  if (state === 'off') return 'OFF';
  return 'UNKNOWN';
}

/**
 * Operator-facing label for an automation decision.
 *
 * All eight values are mapped, including every skip. The engine's own `reason`
 * string is always rendered next to this label — the label is the category,
 * the reason is the explanation.
 */
export const automationDecisionLabel: Record<AutomationDecision, string> = {
  switch_on: 'Switched on',
  switch_off: 'Switched off',
  no_change: 'No change needed',
  skipped_stale_data: 'Skipped — occupancy data unusable',
  skipped_override: 'Skipped — manual override active',
  skipped_schedule: 'Skipped — outside allowed hours',
  skipped_cooldown: 'Skipped — command cooldown',
  command_failed: 'Command failed',
};

/** Tone for an automation decision. A skip is informational, not a success. */
export function automationDecisionTone(
  decision: AutomationDecision
): 'neutral' | 'safe' | 'critical' | 'warning' | 'info' {
  switch (decision) {
    case 'switch_on':
    case 'switch_off':
      return 'safe';
    case 'command_failed':
      return 'critical';
    case 'skipped_stale_data':
      // The fail-safe firing. Worth the operator's attention: automation
      // deliberately did nothing because it could not trust the data.
      return 'warning';
    case 'skipped_override':
    case 'skipped_schedule':
    case 'skipped_cooldown':
      return 'info';
    case 'no_change':
    default:
      return 'neutral';
  }
}

/**
 * Maps a component health status onto the StatusIndicator vocabulary.
 *
 * 'simulation' maps to 'warning', not 'online': the simulation adapter
 * responding is not evidence that hardware is connected, and a green dot would
 * claim exactly that. 'unknown' also maps to 'warning' rather than 'offline',
 * because "we could not determine this" is not "this is down".
 */
export function componentStatusIndicator(
  status: ComponentStatus
): 'online' | 'offline' | 'warning' | 'error' {
  switch (status) {
    case 'ok':
      return 'online';
    case 'down':
      return 'error';
    case 'degraded':
    case 'simulation':
    case 'unknown':
      return 'warning';
    default:
      return 'warning';
  }
}

export const componentStatusLabel: Record<ComponentStatus, string> = {
  ok: 'OK',
  degraded: 'Degraded',
  down: 'Down',
  simulation: 'Simulation',
  unknown: 'Unknown',
};

/** Human-readable duration for an on-interval or an override remainder. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total}s`;
  const mins = Math.floor(total / 60);
  if (mins < 60) return `${mins}m ${total % 60}s`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  return `${Math.floor(hrs / 24)}d ${hrs % 24}h`;
}
