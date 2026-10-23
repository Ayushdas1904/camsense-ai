import { useCallback, useEffect, useState } from 'react';
import { ShieldAlert, Bell, CheckCircle2, Eye, ScanFace } from 'lucide-react';
import {
  PageHeader,
  Card,
  CardBody,
  Button,
  Badge,
  Select,
  Modal,
  LoadingState,
  EmptyState,
  ErrorState,
} from '@/components/ui';
import { alertService } from '@/services/alertService';
import { useSocketEvent } from '@/hooks/useSocketEvent';
import { SocketEvents } from '@/services/socket';
import { assetUrl } from '@/utils/assetUrl';
import { formatDateTime } from '@/utils/format';
import type { Alert, AlertSeverity, AlertStatus, ViewStatus } from '@/types';

const severityTone: Record<AlertSeverity, 'critical' | 'warning' | 'info'> = {
  critical: 'critical',
  warning: 'warning',
  info: 'info',
};

const statusTone: Record<AlertStatus, 'neutral' | 'safe' | 'warning'> = {
  new: 'warning',
  acknowledged: 'neutral',
  resolved: 'safe',
};

/**
 * Review 2 added the 'unknown_identity' category. The older 'unknown_person'
 * value is still accepted by the backend enum for already-stored documents, so
 * both map to the same operator-facing label.
 */
const alertTypeLabel: Record<string, string> = {
  weapon: 'Weapon',
  unknown_identity: 'Unknown identity',
  unknown_person: 'Unknown identity',
  intrusion: 'Intrusion',
  camera_offline: 'Camera offline',
  system: 'System',
};

function typeLabel(type: string): string {
  return alertTypeLabel[type] ?? type.replace(/_/g, ' ');
}

function isUnknownIdentity(type: string): boolean {
  return type === 'unknown_identity' || type === 'unknown_person';
}

/** The caveat an operator must see on every unmatched-face alert. */
const UNKNOWN_IDENTITY_CAVEAT =
  'An unknown identity means the system could not confidently match this face to a registered ' +
  'person. It is not proof of malicious intent or that the person is unauthorized — review the ' +
  'snapshot and decide.';

export function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [status, setStatus] = useState<ViewStatus>('loading');
  const [statusFilter, setStatusFilter] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');
  const [selected, setSelected] = useState<Alert | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const { items } = await alertService.list({
        status: statusFilter || undefined,
        severity: severityFilter || undefined,
        limit: 100,
      });
      setAlerts(items);
      setStatus(items.length === 0 ? 'empty' : 'success');
    } catch {
      setStatus('error');
    }
  }, [statusFilter, severityFilter]);

  useEffect(() => {
    load();
  }, [load]);

  // Live: new alerts appear at the top; status changes update in place.
  useSocketEvent<Alert>(SocketEvents.ALERT_NEW, (alert) => {
    setAlerts((prev) => [alert, ...prev.filter((a) => a.id !== alert.id)]);
  });
  useSocketEvent<Alert>(SocketEvents.ALERT_UPDATED, (alert) => {
    setAlerts((prev) => prev.map((a) => (a.id === alert.id ? { ...a, ...alert } : a)));
  });

  async function changeStatus(alert: Alert, next: AlertStatus) {
    setUpdatingId(alert.id);
    try {
      const updated = await alertService.updateStatus(alert.id, next);
      setAlerts((prev) => prev.map((a) => (a.id === alert.id ? updated : a)));
      if (selected?.id === alert.id) setSelected(updated);
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Alerts"
        description="Security alerts generated from AI detections."
        action={
          <div className="flex gap-2">
            <div className="w-36">
              <Select
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value)}
                options={[
                  { value: '', label: 'All severities' },
                  { value: 'critical', label: 'Critical' },
                  { value: 'warning', label: 'Warning' },
                  { value: 'info', label: 'Info' },
                ]}
              />
            </div>
            <div className="w-36">
              <Select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                options={[
                  { value: '', label: 'All statuses' },
                  { value: 'new', label: 'New' },
                  { value: 'acknowledged', label: 'Acknowledged' },
                  { value: 'resolved', label: 'Resolved' },
                ]}
              />
            </div>
          </div>
        }
      />

      {status === 'loading' && <LoadingState message="Loading alerts…" />}
      {status === 'error' && <ErrorState onRetry={load} />}
      {status === 'empty' && (
        <Card>
          <CardBody>
            <EmptyState
              icon={<Bell className="h-6 w-6" />}
              title="No alerts"
              description="Security alerts will appear here as the AI detects significant events."
            />
          </CardBody>
        </Card>
      )}

      {status === 'success' && (
        <Card>
          <div className="divide-y divide-border">
            {alerts.map((alert) => (
              <div key={alert.id} className="flex items-center gap-4 px-5 py-3.5">
                <div
                  className={`rounded-lg p-2 ${
                    alert.severity === 'critical'
                      ? 'bg-critical/10 text-critical'
                      : alert.severity === 'warning'
                        ? 'bg-warning/10 text-warning'
                        : 'bg-info/10 text-info'
                  }`}
                >
                  {isUnknownIdentity(alert.type) ? (
                    <ScanFace className="h-4 w-4" />
                  ) : (
                    <ShieldAlert className="h-4 w-4" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-content">{alert.message}</p>
                  <p className="text-xs text-content-faint">
                    {alert.cameraName} · {formatDateTime(alert.timestamp)}
                  </p>
                </div>

                <Badge tone="neutral">{typeLabel(alert.type)}</Badge>
                <Badge tone={severityTone[alert.severity]}>{alert.severity.toUpperCase()}</Badge>
                <Badge tone={statusTone[alert.status]}>{alert.status}</Badge>

                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setSelected(alert)}>
                    <Eye className="h-4 w-4" />
                  </Button>
                  {alert.status === 'new' && (
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={updatingId === alert.id}
                      onClick={() => changeStatus(alert, 'acknowledged')}
                    >
                      Acknowledge
                    </Button>
                  )}
                  {alert.status !== 'resolved' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={updatingId === alert.id}
                      onClick={() => changeStatus(alert, 'resolved')}
                    >
                      <CheckCircle2 className="h-4 w-4 text-safe" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <AlertDetailModal
        alert={selected}
        onClose={() => setSelected(null)}
        onChangeStatus={changeStatus}
        updating={!!updatingId}
      />
    </div>
  );
}

function AlertDetailModal({
  alert,
  onClose,
  onChangeStatus,
  updating,
}: {
  alert: Alert | null;
  onClose: () => void;
  onChangeStatus: (a: Alert, s: AlertStatus) => void;
  updating: boolean;
}) {
  if (!alert) return null;
  const snapshot = assetUrl(alert.snapshot);
  const unknownIdentity = isUnknownIdentity(alert.type);

  return (
    <Modal
      open={!!alert}
      onClose={onClose}
      title="Alert Detail"
      footer={
        <>
          {alert.status === 'new' && (
            <Button variant="secondary" size="sm" loading={updating} onClick={() => onChangeStatus(alert, 'acknowledged')}>
              Acknowledge
            </Button>
          )}
          {alert.status !== 'resolved' && (
            <Button size="sm" loading={updating} onClick={() => onChangeStatus(alert, 'resolved')}>
              Resolve
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral">{typeLabel(alert.type)}</Badge>
          <Badge tone={severityTone[alert.severity]}>{alert.severity.toUpperCase()}</Badge>
          <Badge tone={statusTone[alert.status]}>{alert.status}</Badge>
        </div>
        <p className="text-sm text-content">{alert.message}</p>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <Field label="Camera" value={alert.cameraName || alert.cameraId} />
          <Field label="Alert type" value={typeLabel(alert.type)} />
          {unknownIdentity ? (
            // Recognition status, in the operator's language. No name is shown,
            // because an unmatched face has no confirmed identity to show.
            <Field label="Recognition status" value="Unmatched face — no registered identity met the threshold" />
          ) : (
            <Field label="Object" value={alert.objectClass || '—'} />
          )}
          {/*
            Explicitly "Detection confidence": the object detector's score. A
            face-recognition similarity is a different measurement and is never
            rendered in this field — the backend deliberately leaves `confidence`
            undefined on unknown-identity alerts.
          */}
          <Field
            label="Detection confidence"
            value={alert.confidence ? `${Math.round(alert.confidence * 100)}%` : '—'}
          />
          <Field label="Time" value={formatDateTime(alert.timestamp)} />
        </dl>

        {unknownIdentity && (
          <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            {UNKNOWN_IDENTITY_CAVEAT}
          </p>
        )}

        {snapshot && (
          <div>
            <p className="mb-1.5 text-xs text-content-muted">Snapshot evidence</p>
            <img src={snapshot} alt="Detection snapshot" className="w-full rounded-lg border border-border" />
          </div>
        )}
      </div>
    </Modal>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-content-faint">{label}</dt>
      <dd className="text-content">{value}</dd>
    </div>
  );
}
