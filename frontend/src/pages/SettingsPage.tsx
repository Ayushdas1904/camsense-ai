import { PageHeader, Card, CardHeader, CardBody, Badge, StatusIndicator } from '@/components/ui';
import { useAppSelector } from '@/hooks/redux';

/**
 * Settings. The account panel shows real authenticated-user data; system and
 * detection-mode controls are marked as future-ready (wired in later reviews).
 */
export function SettingsPage() {
  const user = useAppSelector((s) => s.auth.user);

  return (
    <div>
      <PageHeader title="Settings" description="Account and system configuration." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Account" description="Your operator profile" />
          <CardBody>
            <dl className="space-y-3 text-sm">
              <Row label="Name" value={user?.name ?? '—'} />
              <Row label="Email" value={user?.email ?? '—'} />
              <Row label="Role" value={<span className="capitalize">{user?.role ?? '—'}</span>} />
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Detection Mode"
            description="DEMO vs REAL camera processing"
            action={<Badge tone="info">Review 1</Badge>}
          />
          <CardBody>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-content">Current mode</p>
                <p className="text-xs text-content-muted">
                  Switch between sample video and live camera streams.
                </p>
              </div>
              <StatusIndicator status="ai" label="DEMO" />
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-border pb-2 last:border-0">
      <dt className="text-content-muted">{label}</dt>
      <dd className="text-content">{value}</dd>
    </div>
  );
}
