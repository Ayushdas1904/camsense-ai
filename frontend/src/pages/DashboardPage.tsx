import type { LucideIcon } from 'lucide-react';
import {
  Cctv,
  Users,
  Bell,
  UserX,
  CalendarCheck,
  Zap,
  Activity,
  Database,
  Server,
} from 'lucide-react';
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
import { useSystemHealth } from '@/hooks/useSystemHealth';

/**
 * Dashboard shell.
 *
 * The KPI tiles are future-ready placeholders (value "—" + the review that
 * will wire them to real data) — deliberately NOT fake numbers, per the
 * development philosophy (§23). The System Health panel, by contrast, shows
 * real data fetched from the backend.
 */
interface StatDef {
  label: string;
  icon: LucideIcon;
  review: 1 | 2 | 3;
}

const stats: StatDef[] = [
  { label: 'Active Cameras', icon: Cctv, review: 1 },
  { label: 'People Detected', icon: Users, review: 1 },
  { label: 'Security Alerts', icon: Bell, review: 1 },
  { label: 'Unknown Persons', icon: UserX, review: 2 },
  { label: 'Attendance Today', icon: CalendarCheck, review: 2 },
  { label: 'Energy Saved', icon: Zap, review: 3 },
];

function StatTile({ def }: { def: StatDef }) {
  return (
    <Card>
      <CardBody className="flex items-start justify-between">
        <div>
          <p className="text-xs text-content-muted">{def.label}</p>
          <p className="mt-2 text-2xl font-semibold text-content-faint">—</p>
          <p className="mt-1 text-[10px] uppercase tracking-wide text-content-faint">
            Review {def.review}
          </p>
        </div>
        <div className="rounded-lg bg-raised p-2 text-content-muted">
          <def.icon className="h-5 w-5" />
        </div>
      </CardBody>
    </Card>
  );
}

export function DashboardPage() {
  const { data, status, error, reload } = useSystemHealth();

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="What is happening right now, what is dangerous, and what needs action."
        action={<Badge tone="info">Foundation</Badge>}
      />

      {/* KPI tiles — future-ready, wired to real data in later reviews. */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        {stats.map((s) => (
          <StatTile key={s.label} def={s} />
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Real data: system health from the backend. */}
        <Card className="lg:col-span-1">
          <CardHeader title="System Health" description="Live backend & database status" />
          <CardBody>
            {status === 'loading' && <LoadingState message="Checking services…" />}
            {status === 'error' && <ErrorState message={error ?? undefined} onRetry={reload} />}
            {status === 'success' && data && (
              <ul className="space-y-3">
                <HealthRow icon={Server} label="Backend API">
                  <StatusIndicator status="online" label="Operational" />
                </HealthRow>
                <HealthRow icon={Database} label="Database">
                  <StatusIndicator
                    status={data.database.status === 'connected' ? 'online' : 'error'}
                    label={data.database.status === 'connected' ? 'Connected' : 'Disconnected'}
                  />
                </HealthRow>
                <HealthRow icon={Activity} label="AI Engine">
                  <StatusIndicator status="offline" label="Review 1" />
                </HealthRow>
                <li className="pt-2 text-xs text-content-faint">
                  Uptime {Math.floor(data.uptimeSeconds / 60)}m · {data.environment}
                </li>
              </ul>
            )}
          </CardBody>
        </Card>

        {/* Placeholder region for future live-event feed (Review 1). */}
        <Card className="lg:col-span-2">
          <CardHeader
            title="Recent Security Events"
            description="AI-generated events will appear here"
            action={<Badge tone="info">Review 1</Badge>}
          />
          <CardBody>
            <div className="py-10 text-center text-sm text-content-muted">
              Live detection events from the AI pipeline will stream in once
              camera management and detection land in Review 1.
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function HealthRow({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-center justify-between">
      <span className="flex items-center gap-2 text-sm text-content-muted">
        <Icon className="h-4 w-4" />
        {label}
      </span>
      {children}
    </li>
  );
}
