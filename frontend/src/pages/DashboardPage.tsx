import { useCallback, useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Cctv, Users, Bell, Activity, ShieldAlert, Cpu } from 'lucide-react';
import {
  PageHeader,
  Card,
  CardHeader,
  CardBody,
  Badge,
  StatusIndicator,
  LoadingState,
  ErrorState,
} from '@/components/ui';
import { dashboardService } from '@/services/dashboardService';
import { useSocketEvent } from '@/hooks/useSocketEvent';
import { SocketEvents } from '@/services/socket';
import { timeAgo } from '@/utils/format';
import type { DashboardStats, RecentEvent, Alert, DetectionEventPayload, ViewStatus } from '@/types';

/**
 * Dashboard — answers "what's happening, what's dangerous, what needs action".
 * All KPIs come from the backend (real DB state); the feed and stats update
 * live over Socket.IO.
 */
export function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [events, setEvents] = useState<RecentEvent[]>([]);
  const [status, setStatus] = useState<ViewStatus>('loading');

  const load = useCallback(async () => {
    setStatus('loading');
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
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useSocketEvent<DashboardStats>(SocketEvents.DASHBOARD_UPDATE, (s) =>
    setStats((prev) => (prev ? { ...prev, ...s } : prev))
  );
  useSocketEvent<Alert>(SocketEvents.ALERT_NEW, (a) =>
    setEvents((prev) => {
      const event: RecentEvent = { kind: 'alert', id: a.id, severity: a.severity, title: a.message, cameraName: a.cameraName || a.cameraId, timestamp: a.timestamp };
      return [event, ...prev].slice(0, 12);
    })
  );
  useSocketEvent<DetectionEventPayload>(SocketEvents.DETECTION_NEW, (d) =>
    setEvents((prev) => {
      const event: RecentEvent = { kind: 'detection', id: d.id, severity: d.type === 'weapon' ? 'critical' : 'info', title: `${d.class} detected`, cameraName: d.cameraName, timestamp: d.timestamp };
      return [event, ...prev].slice(0, 12);
    })
  );

  if (status === 'loading') return <LoadingState message="Loading dashboard…" />;
  if (status === 'error') return <ErrorState message="Unable to retrieve dashboard data." onRetry={load} />;

  const aiOperational = stats?.ai?.reachable && stats?.ai?.model_loaded;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Live overview of cameras, detections and security alerts."
        action={<Badge tone={aiOperational ? 'safe' : 'warning'}>{aiOperational ? 'AI Operational' : 'AI Degraded'}</Badge>}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile icon={Cctv} label="Active Cameras" value={`${stats?.activeCameras ?? 0}`} sub={`of ${stats?.totalCameras ?? 0} total`} />
        <StatTile icon={Users} label="People Detected (today)" value={`${stats?.peopleDetectedToday ?? 0}`} />
        <StatTile icon={Bell} label="Open Alerts" value={`${stats?.newAlerts ?? 0}`} sub={`${stats?.totalAlerts ?? 0} total`} tone={stats?.newAlerts ? 'critical' : undefined} />
        <StatTile icon={Cpu} label="AI Status" value={aiOperational ? 'Operational' : 'Degraded'} tone={aiOperational ? 'safe' : 'warning'} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* AI system status */}
        <Card>
          <CardHeader title="AI System" description="Detector readiness" />
          <CardBody className="space-y-2.5">
            {stats?.ai?.reachable ? (
              stats.ai.detectors.map((d) => (
                <div key={d.key} className="flex items-center justify-between text-sm">
                  <span className="text-content-muted">{d.label}</span>
                  <StatusIndicator
                    status={d.status === 'active' ? 'ai' : d.status === 'demo' ? 'warning' : 'offline'}
                    label={d.status === 'active' ? 'Active' : d.status === 'demo' ? 'Demo' : 'Unavailable'}
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

        {/* Recent security events */}
        <Card className="lg:col-span-2">
          <CardHeader title="Recent Security Events" description="Live feed" />
          <CardBody>
            {events.length === 0 ? (
              <p className="py-8 text-center text-sm text-content-muted">
                No events yet. Start a camera on Live Monitoring to generate detections.
              </p>
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
      </div>
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
        <div>
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
