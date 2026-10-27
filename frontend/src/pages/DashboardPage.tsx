import { useCallback, useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Cctv,
  Users,
  Bell,
  Activity,
  ShieldAlert,
  Cpu,
  UserRound,
  UserCheck,
  ScanFace,
  DoorOpen,
  Lightbulb,
  Zap,
  CheckCircle2,
  HeartPulse,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  PageHeader,
  Card,
  CardHeader,
  CardBody,
  Badge,
  StatusIndicator,
  Button,
  LoadingState,
  EmptyState,
  ErrorState,
} from '@/components/ui';
import { dashboardService } from '@/services/dashboardService';
import { alertService } from '@/services/alertService';
import { healthService } from '@/services/healthService';
import { occupancyService } from '@/services/occupancyService';
import { useSocketEvent } from '@/hooks/useSocketEvent';
import { SocketEvents } from '@/services/socket';
import { timeAgo } from '@/utils/format';
import {
  componentStatusIndicator,
  componentStatusLabel,
  isOccupancyUnknown,
  occupancyStatusTone,
  renderCount,
  renderNumber,
} from '@/utils/review3';
import type {
  DashboardStats,
  RecentEvent,
  Alert,
  DetectionEventPayload,
  Room,
  SystemHealth,
  ViewStatus,
} from '@/types';

/**
 * ═══ DASHBOARD — all three reviews in one view ═══
 *
 * Ordered by the priority the brief sets out, top to bottom:
 *
 *   1. Critical alerts
 *   2. Camera and AI-service status
 *   3. Current occupancy and capacity warnings
 *   4. Recent detection and recognition activity
 *   5. Device automation status
 *   6. Energy analytics
 *
 * Every KPI is computed by the backend over persisted documents
 * (dashboardService.computeDashboardStats). Nothing on this page is
 * recomputed in the browser from a partial page of rows, and nothing is
 * hardcoded.
 *
 * ═══ TWO THINGS THIS PAGE REFUSES TO DO ═══
 *
 * IT DOES NOT TURN "UNKNOWN" INTO A NUMBER. The Review 3 counters are
 * `number | null`, where null means the backend could not determine the
 * figure. Those render as an em-dash through renderNumber/renderCount. The
 * Review 1 and Review 2 counters keep their original `?? 0` rendering, because
 * those are plain counts the backend always produces.
 *
 * IT DOES NOT INFER COMPONENT HEALTH FROM ITS OWN SUCCESS. The service-health
 * panel is driven by GET /api/health/components, where the AI service, the
 * detection model and the recognition subsystem are probed independently. A
 * loaded backend never colours the AI model green, and the simulation adapter
 * reports 'simulation' rather than 'ok'.
 */
export function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [events, setEvents] = useState<RecentEvent[]>([]);
  const [criticalAlerts, setCriticalAlerts] = useState<Alert[]>([]);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [status, setStatus] = useState<ViewStatus>('loading');

  const load = useCallback(async () => {
    setStatus('loading');
    setHealthError(null);
    try {
      const [s, e] = await Promise.all([
        dashboardService.stats(),
        dashboardService.recentEvents(12),
      ]);
      setStats(s);
      setEvents(e);
      setStatus('success');
    } catch {
      setStatus('error');
      return;
    }

    // The Review 3 panels are loaded separately and settled independently, so
    // a fault in occupancy, health or the alert filter degrades that panel
    // alone and leaves the Review 1 and Review 2 cards intact.
    const [alertsRes, healthRes, roomsRes] = await Promise.allSettled([
      alertService.list({ severity: 'critical', status: 'new', limit: 5 }),
      healthService.components(),
      occupancyService.current(),
    ]);
    if (alertsRes.status === 'fulfilled') setCriticalAlerts(alertsRes.value.items);
    if (healthRes.status === 'fulfilled') setHealth(healthRes.value);
    else
      setHealthError(
        (healthRes.reason as { message?: string } | null)?.message ??
          'The component health report could not be read.'
      );
    if (roomsRes.status === 'fulfilled') setRooms(roomsRes.value.items);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useSocketEvent<DashboardStats>(SocketEvents.DASHBOARD_UPDATE, (s) =>
    setStats((prev) => (prev ? { ...prev, ...s } : prev))
  );
  useSocketEvent<Alert>(SocketEvents.ALERT_NEW, (a) => {
    setEvents((prev) => {
      const event: RecentEvent = { kind: 'alert', id: a.id, severity: a.severity, title: a.message, cameraName: a.cameraName || a.cameraId, timestamp: a.timestamp };
      return [event, ...prev].slice(0, 12);
    });
    // Keep the critical-alert panel live without a re-fetch.
    if (a.severity === 'critical' && a.status === 'new') {
      setCriticalAlerts((prev) => [a, ...prev.filter((x) => x.id !== a.id)].slice(0, 5));
    }
  });
  useSocketEvent<Alert>(SocketEvents.ALERT_UPDATED, (a) => {
    // Acknowledged or resolved elsewhere — drop it from the "needs action" panel.
    setCriticalAlerts((prev) =>
      a.status === 'new'
        ? prev.map((x) => (x.id === a.id ? a : x))
        : prev.filter((x) => x.id !== a.id)
    );
  });
  useSocketEvent<DetectionEventPayload>(SocketEvents.DETECTION_NEW, (d) =>
    setEvents((prev) => {
      const event: RecentEvent = { kind: 'detection', id: d.id, severity: d.type === 'weapon' ? 'critical' : 'info', title: `${d.class} detected`, cameraName: d.cameraName, timestamp: d.timestamp };
      return [event, ...prev].slice(0, 12);
    })
  );
  useSocketEvent<Room>(SocketEvents.OCCUPANCY_UPDATE, (room) =>
    setRooms((prev) => {
      const exists = prev.some((r) => r.roomId === room.roomId);
      return exists ? prev.map((r) => (r.roomId === room.roomId ? room : r)) : [...prev, room];
    })
  );
  /** Socket.IO reconnect: re-read the authoritative REST state, don't guess. */
  useSocketEvent<unknown>('connect', () => {
    load();
  });

  if (status === 'loading') return <LoadingState message="Loading dashboard…" />;
  if (status === 'error') return <ErrorState message="Unable to retrieve dashboard data." onRetry={load} />;

  const aiOperational = stats?.ai?.reachable && stats?.ai?.model_loaded;
  const capacityWarnings = rooms.filter(
    (room) => room.status === 'near_capacity' || room.status === 'capacity_exceeded'
  );
  const unavailableRooms = rooms.filter((room) => isOccupancyUnknown(room.status));
  const simulationInUse = health?.simulationInUse || (stats?.devicesSimulated ?? 0) > 0;

  /**
   * Capacity warnings = near capacity + over capacity.
   *
   * Added only when at least one of the two is a real number. Adding them with
   * `?? 0` would turn two undeterminable figures into a confident "0 warnings",
   * which is precisely the kind of false reassurance this dashboard must not
   * produce.
   */
  const nearCapacity = stats?.roomsNearCapacity;
  const overCapacity = stats?.roomsCapacityExceeded;
  const capacityWarningCount =
    nearCapacity == null && overCapacity == null
      ? null
      : (nearCapacity ?? 0) + (overCapacity ?? 0);

  /** Null (or absent) means the baseline is 0, so no percentage is meaningful. */
  const savingsPercent = stats?.energySavingsPercentToday;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Live overview of cameras, detections, identities, occupancy and energy."
        action={
          <div className="flex flex-wrap items-center gap-2">
            {simulationInUse && <Badge tone="warning">SIMULATED DEVICES</Badge>}
            <Badge tone={aiOperational ? 'safe' : 'warning'}>
              {aiOperational ? 'AI Operational' : 'AI Degraded'}
            </Badge>
          </div>
        }
      />

      {/* ═══ 1 · CRITICAL ALERTS ════════════════════════════════ */}
      <Card>
        <CardHeader
          title="Critical Alerts"
          description="Unresolved alerts at critical severity. These need action first."
          action={
            <Link to="/alerts">
              <Button variant="secondary" size="sm">
                All alerts
              </Button>
            </Link>
          }
        />
        <CardBody>
          {criticalAlerts.length === 0 ? (
            <div className="flex items-center gap-3 text-sm text-content-muted">
              <span className="rounded-lg bg-safe/10 p-2 text-safe">
                <CheckCircle2 className="h-4 w-4" />
              </span>
              <span>
                No unresolved critical alerts.{' '}
                {renderNumber(stats?.newAlerts ?? 0)} new alert(s) at other severities.
              </span>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {criticalAlerts.map((alert) => (
                <li key={alert.id} className="flex items-center gap-3 py-2.5">
                  <span className="rounded-lg bg-critical/10 p-2 text-critical">
                    <ShieldAlert className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-content">{alert.message}</p>
                    <p className="text-xs text-content-faint">
                      {alert.cameraName || alert.roomName || alert.deviceName || alert.cameraId} ·{' '}
                      {timeAgo(alert.timestamp)}
                    </p>
                  </div>
                  <Badge tone="critical">{alert.type.replace(/_/g, ' ')}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {/* ═══ 2 · CAMERA AND AI-SERVICE STATUS ═══════════════════ */}
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile icon={Cctv} label="Active Cameras" value={`${stats?.activeCameras ?? 0}`} sub={`of ${stats?.totalCameras ?? 0} total`} />
        <StatTile icon={Users} label="People Detected (today)" value={`${stats?.peopleDetectedToday ?? 0}`} />
        <StatTile icon={Bell} label="Open Alerts" value={`${stats?.newAlerts ?? 0}`} sub={`${stats?.totalAlerts ?? 0} total`} tone={stats?.newAlerts ? 'critical' : undefined} />
        <StatTile icon={Cpu} label="AI Status" value={aiOperational ? 'Operational' : 'Degraded'} tone={aiOperational ? 'safe' : 'warning'} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Detector readiness, straight from the AI service. */}
        <Card>
          <CardHeader title="AI Detectors" description="Reported by the AI service itself" />
          <CardBody className="space-y-2.5">
            {stats?.ai?.reachable ? (
              stats.ai.detectors.map((d) => (
                <div key={d.key} className="flex items-center justify-between text-sm">
                  <span className="text-content-muted">{d.label}</span>
                  {/*
                    Review 2 widened the detector status vocabulary. ACTIVE is
                    shown only for a genuinely operational service; 'error' is
                    surfaced as an error rather than flattened to unavailable.
                  */}
                  <StatusIndicator
                    status={
                      d.status === 'active'
                        ? 'ai'
                        : d.status === 'demo'
                          ? 'warning'
                          : d.status === 'error'
                            ? 'error'
                            : 'offline'
                    }
                    label={
                      d.status === 'active'
                        ? 'Active'
                        : d.status === 'demo'
                          ? 'Demo'
                          : d.status === 'error'
                            ? 'Error'
                            : d.status === 'inactive'
                              ? 'Inactive'
                              : 'Unavailable'
                    }
                  />
                </div>
              ))
            ) : (
              <p className="py-4 text-center text-sm text-content-muted">
                AI service unavailable. Video monitoring controls remain accessible.
              </p>
            )}
          </CardBody>
        </Card>

        {/* The genuine per-component health report. */}
        <Card className="lg:col-span-2">
          <CardHeader
            title="Service Health"
            description="Each component reports for itself — the backend responding proves only that the backend is up."
            action={
              health ? (
                <Badge
                  tone={
                    health.overall === 'ok'
                      ? 'safe'
                      : health.overall === 'down'
                        ? 'critical'
                        : 'warning'
                  }
                >
                  {componentStatusLabel[health.overall]}
                </Badge>
              ) : undefined
            }
          />
          <CardBody>
            {healthError ? (
              <ErrorState message={healthError} onRetry={load} />
            ) : !health ? (
              <LoadingState message="Probing components…" />
            ) : (
              <>
                <ul className="space-y-2.5">
                  {health.components.map((component) => (
                    <li key={component.key} className="text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-content-muted">{component.label}</span>
                        <StatusIndicator
                          status={componentStatusIndicator(component.status)}
                          label={componentStatusLabel[component.status]}
                        />
                      </div>
                      {/* The backend's own plain-language reason, verbatim. */}
                      <p className="mt-0.5 text-xs text-content-faint">{component.detail}</p>
                    </li>
                  ))}
                </ul>
                <p className="mt-4 flex items-start gap-2 rounded-lg border border-border bg-raised px-3 py-2 text-xs text-content-muted">
                  <HeartPulse className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{health.overallNote}</span>
                </p>
              </>
            )}
          </CardBody>
        </Card>
      </div>

      {/* ═══ 3 · OCCUPANCY AND CAPACITY ═════════════════════════ */}
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          icon={DoorOpen}
          label="Rooms Monitored"
          value={renderNumber(stats?.roomsMonitored)}
          sub={`of ${renderNumber(stats?.roomsTotal)} configured`}
        />
        <StatTile
          icon={Users}
          label="People in Rooms"
          value={renderNumber(stats?.totalOccupants)}
          sub={
            (stats?.roomsWithoutOccupancyData ?? 0) > 0
              ? `${stats?.roomsWithoutOccupancyData} room(s) excluded — no usable figure`
              : 'Trustworthy counts only'
          }
        />
        <StatTile
          icon={ShieldAlert}
          label="Capacity Warnings"
          value={renderNumber(capacityWarningCount)}
          sub={`${renderNumber(overCapacity)} over capacity`}
          tone={
            (overCapacity ?? 0) > 0
              ? 'critical'
              : (nearCapacity ?? 0) > 0
                ? 'warning'
                : undefined
          }
        />
        <StatTile
          icon={Cctv}
          label="Occupancy Unavailable"
          value={renderNumber(stats?.roomsOccupancyUnavailable)}
          sub="Counted separately — not treated as empty"
          tone={(stats?.roomsOccupancyUnavailable ?? 0) > 0 ? 'warning' : undefined}
        />
      </div>

      {(capacityWarnings.length > 0 || unavailableRooms.length > 0) && (
        <Card className="mt-4">
          <CardHeader
            title="Rooms Needing Attention"
            description="Capacity conditions and rooms whose occupancy cannot be determined."
            action={
              <Link to="/energy">
                <Button variant="secondary" size="sm">
                  Occupancy &amp; Energy
                </Button>
              </Link>
            }
          />
          <CardBody>
            <ul className="divide-y divide-border">
              {[...capacityWarnings, ...unavailableRooms].map((room) => (
                <li key={room.roomId} className="flex flex-wrap items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-content">{room.name}</p>
                    <p className="text-xs text-content-faint">
                      {/* Em-dash, never 0, for a room with no usable figure. */}
                      {renderCount(room.count)}
                      {room.capacity > 0 ? ` of ${room.capacity}` : ''} ·{' '}
                      {room.lastUpdatedAt
                        ? `last successful update ${timeAgo(room.lastUpdatedAt)}`
                        : 'never reported'}
                    </p>
                  </div>
                  <Badge tone={occupancyStatusTone(room.status)}>{room.statusLabel}</Badge>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {/* ═══ 4 · DETECTION AND RECOGNITION ACTIVITY ═════════════ */}
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatTile
          icon={UserRound}
          label="Registered People"
          value={`${stats?.totalPeople ?? 0}`}
          sub={`${stats?.recognitionEnabledPeople ?? 0} with recognition enabled`}
        />
        <StatTile
          icon={UserCheck}
          label="Present Today"
          value={`${stats?.presentToday ?? 0}`}
          tone={stats?.presentToday ? 'safe' : undefined}
        />
        <StatTile
          icon={ScanFace}
          label="Unknown Identities (today)"
          value={`${stats?.unknownIdentitiesToday ?? 0}`}
          sub="Faces not matched to a registered person"
          tone={stats?.unknownIdentitiesToday ? 'warning' : undefined}
        />
      </div>

      <Card className="mt-4">
        <CardHeader title="Recent Security Events" description="Live feed of alerts and detections" />
        <CardBody>
          {events.length === 0 ? (
            <EmptyState
              icon={<Activity className="h-6 w-6" />}
              title="No events yet"
              description="Start a camera on Live Monitoring to generate detections."
            />
          ) : (
            <ul className="divide-y divide-border">
              {events.map((e) => (
                <li key={`${e.kind}-${e.id}`} className="flex items-center gap-3 py-2.5">
                  <span
                    className={`rounded-md p-1.5 ${
                      e.severity === 'critical'
                        ? 'bg-critical/10 text-critical'
                        : e.severity === 'warning'
                          ? 'bg-warning/10 text-warning'
                          : 'bg-info/10 text-info'
                    }`}
                  >
                    {e.severity === 'critical' ? <ShieldAlert className="h-3.5 w-3.5" /> : <Activity className="h-3.5 w-3.5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-content">{e.title}</p>
                    <p className="text-xs text-content-faint">{e.cameraName}</p>
                  </div>
                  <span className="text-xs text-content-faint">{timeAgo(e.timestamp)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {/* ═══ 5 · DEVICE AUTOMATION STATUS ═══════════════════════ */}
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          icon={Lightbulb}
          label="Devices Reported On"
          value={renderNumber(stats?.devicesOn)}
          sub={`of ${renderNumber(stats?.devicesTotal)} · ${renderNumber(stats?.devicesUnknownState)} never confirmed`}
        />
        <StatTile
          icon={Cpu}
          label="Simulated Devices"
          value={renderNumber(stats?.devicesSimulated)}
          sub="No physical hardware is controlled"
          tone={(stats?.devicesSimulated ?? 0) > 0 ? 'warning' : undefined}
        />
        <StatTile
          icon={Zap}
          label="Automation Rules Enabled"
          value={renderNumber(stats?.automationRulesEnabled)}
          sub={`${renderNumber(stats?.devicesAutomatic)} device(s) in automatic mode`}
        />
        <StatTile
          icon={Activity}
          label="Automation Actions Today"
          value={renderNumber(stats?.automationActionsToday)}
          sub={`${renderNumber(stats?.automationSkippedStaleToday)} skipped — occupancy unusable`}
          tone={(stats?.automationFailuresToday ?? 0) > 0 ? 'critical' : undefined}
        />
      </div>

      {/* ═══ 6 · ENERGY ANALYTICS ═══════════════════════════════ */}
      <Card className="mt-6">
        <CardHeader
          title="Energy Today"
          description="Estimated from configured power ratings against the operator-set baseline — not measured."
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="info">ESTIMATED</Badge>
              {stats?.energySimulated && <Badge tone="warning">SIMULATED</Badge>}
              <Link to="/analytics">
                <Button variant="secondary" size="sm">
                  Analytics
                </Button>
              </Link>
            </div>
          }
        />
        <CardBody>
          {stats?.energyInsufficientData ? (
            <EmptyState
              icon={<Zap className="h-6 w-6" />}
              title="Not enough data to estimate energy yet"
              description="Register a device with a configured power rating and switch it on and off (manually or through automation) so there is an interval to measure. The Occupancy & Energy page lists exactly what is missing."
            />
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <EnergyFigure
                  label="Estimated consumed"
                  value={`${renderNumber(stats?.energyKwhToday)} kWh`}
                />
                <EnergyFigure
                  label="Estimated saved vs baseline"
                  value={`${renderNumber(stats?.energySavedKwhToday)} kWh`}
                  tone="safe"
                />
                <EnergyFigure
                  label="Estimated savings"
                  // Null means the baseline is 0 and no percentage is
                  // meaningful. It must not render as 0%.
                  value={
                    savingsPercent === null || savingsPercent === undefined
                      ? 'Not enough configuration'
                      : `${savingsPercent}%`
                  }
                  small={savingsPercent === null || savingsPercent === undefined}
                />
              </div>
              {stats?.energyBaselineHoursPerDay != null && (
                <p className="mt-4 rounded-lg border border-border bg-raised px-3 py-2 text-xs text-content-muted">
                  <strong>Baseline:</strong> each device is assumed to have run{' '}
                  {stats.energyBaselineHoursPerDay} hour(s) per day without occupancy-based
                  switching. That assumption (ENERGY_BASELINE_HOURS_PER_DAY) is the only reason a
                  savings figure can be quoted, and it is not a measurement. The full wording is on
                  the Occupancy &amp; Energy page.
                </p>
              )}
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub?: string;
  tone?: 'safe' | 'critical' | 'warning';
}) {
  const valueColor =
    tone === 'critical' ? 'text-critical' : tone === 'warning' ? 'text-warning' : tone === 'safe' ? 'text-safe' : 'text-content';
  return (
    <Card>
      <CardBody className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-xs text-content-muted">{label}</p>
          <p className={`mt-2 text-2xl font-semibold ${valueColor}`}>{value}</p>
          {sub && <p className="mt-1 text-[11px] text-content-faint">{sub}</p>}
        </div>
        <div className="rounded-lg bg-raised p-2 text-content-muted">
          <Icon className="h-5 w-5" />
        </div>
      </CardBody>
    </Card>
  );
}

/**
 * A figure shown INSIDE an existing card (the energy block), so it is a plain
 * block rather than another Card — nesting cards would double the border and
 * break the page's visual rhythm.
 */
function EnergyFigure({
  label,
  value,
  tone,
  small = false,
}: {
  label: string;
  value: string;
  tone?: 'safe';
  small?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-content-muted">{label}</p>
      <p
        className={`mt-1.5 font-semibold ${small ? 'text-sm' : 'text-2xl'} ${
          tone === 'safe' ? 'text-safe' : 'text-content'
        }`}
      >
        {value}
      </p>
    </div>
  );
}
