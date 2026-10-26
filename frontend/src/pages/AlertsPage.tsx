import { useCallback, useEffect, useState } from 'react';
import { ShieldAlert, Bell, CheckCircle2, Eye, ScanFace } from 'lucide-react';
import {
  PageHeader,
  Card,
  CardBody,
  Button,
  Badge,
  Input,
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
 *
 * Review 3 adds the occupancy, device, automation, AI-service and camera
 * categories ADDITIVELY — every pre-existing entry is unchanged.
 */
const alertTypeLabel: Record<string, string> = {
  weapon: 'Weapon',
  unknown_identity: 'Unknown identity',
  unknown_person: 'Unknown identity',
  intrusion: 'Intrusion',
  camera_offline: 'Camera offline',
  system: 'System',
  // Review 3.
  occupancy_warning: 'Occupancy warning',
  capacity_exceeded: 'Capacity exceeded',
  device_failure: 'Device failure',
  automation_failure: 'Automation failure',
  ai_service_failure: 'AI service failure',
  camera_unavailable: 'Camera unavailable',
};

/**
 * The category filter. Built from the label map so a new category is added in
 * one place. 'unknown_person' is deliberately absent as a filter option — it
 * is a legacy stored value, not a category an operator should have to choose
 * between alongside the identical 'unknown_identity'.
 */
const categoryOptions = [
  { value: '', label: 'All categories' },
  ...Object.keys(alertTypeLabel)
    .filter((type) => type !== 'unknown_person')
    .map((type) => ({ value: type, label: alertTypeLabel[type] })),
];

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

/**
 * The caveat on an occupancy or capacity alert. Severity comes from the
 * configured rule and the event type — the backend raises these at 'warning',
 * never 'critical', because a crowded room is an operational condition rather
 * than a security incident.
 */
const OCCUPANCY_CAVEAT =
  'A capacity condition is derived from an estimated headcount against a configured capacity. ' +
  'The count is a lower bound from the detection pipeline, not a turnstile reading.';

export function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [status, setStatus] = useState<ViewStatus>('loading');
  const [statusFilter, setStatusFilter] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [fromFilter, setFromFilter] = useState('');
  const [toFilter, setToFilter] = useState('');
  const [selected, setSelected] = useState<Alert | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const { items } = await alertService.list({
        status: statusFilter || undefined,
        severity: severityFilter || undefined,
        type: categoryFilter || undefined,
        // A date input gives 'YYYY-MM-DD'; the backend parses it defensively
        // and an unparseable value narrows nothing rather than erroring.
        from: fromFilter || undefined,
        to: toFilter || undefined,
        limit: 100,
      });
      setAlerts(items);
      setStatus(items.length === 0 ? 'empty' : 'success');
    } catch {
      setStatus('error');
    }
  }, [statusFilter, severityFilter, categoryFilter, fromFilter, toFilter]);

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
        description="Security and operational alerts generated from AI detections, occupancy and device activity."
      />

      {/*
        Filters. Each control has a visible label (the Select/Input components
        render one and wire htmlFor to the field's name), so none of them is a
        control whose purpose has to be guessed.
      */}
      <Card className="mb-4">
        <CardBody className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Select
            label="Category"
            name="alertCategory"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            options={categoryOptions}
          />
          <Select
            label="Severity"
            name="alertSeverity"
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            options={[
              { value: '', label: 'All severities' },
              { value: 'critical', label: 'Critical' },
              { value: 'warning', label: 'Warning' },
              { value: 'info', label: 'Info' },
            ]}
          />
          <Select
            label="Status"
            name="alertStatus"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            options={[
              { value: '', label: 'All statuses' },
              { value: 'new', label: 'New' },
              { value: 'acknowledged', label: 'Acknowledged' },
              { value: 'resolved', label: 'Resolved' },
            ]}
          />
          <Input
            label="From"
            name="alertFrom"
            type="date"
            value={fromFilter}
            onChange={(e) => setFromFilter(e.target.value)}
          />
          <Input
            label="To"
            name="alertTo"
            type="date"
            value={toFilter}
            onChange={(e) => setToFilter(e.target.value)}
          />
        </CardBody>
      </Card>

      {status === 'loading' && <LoadingState message="Loading alerts…" />}
      {status === 'error' && <ErrorState onRetry={load} />}
      {status === 'empty' && (
        <Card>
          <CardBody>
            <EmptyState
              icon={<Bell className="h-6 w-6" />}
              title="No alerts match these filters"
              description="Alerts appear here as the AI detects significant events, as rooms reach their configured capacity, and as device commands or automation rules fail. Clear the filters above to see everything."
            />
          </CardBody>
        </Card>
      )}

      {status === 'success' && (
        <Card>
          <div className="divide-y divide-border">
            {alerts.map((alert) => (
              <div key={alert.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
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

                <div className="min-w-[12rem] flex-1">
                  <p className="truncate text-sm text-content">{alert.message}</p>
                  <p className="truncate text-xs text-content-faint">
                    {/*
                      Review 3 alerts reference a room or a device rather than a
                      camera. Showing whichever reference the alert actually
                      carries avoids a row that reads "undefined".
                    */}
                    {alert.roomName || alert.deviceName || alert.cameraName || alert.cameraId} ·{' '}
                    {formatDateTime(alert.timestamp)}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="neutral">{typeLabel(alert.type)}</Badge>
                  <Badge tone={severityTone[alert.severity]}>{alert.severity.toUpperCase()}</Badge>
                  <Badge tone={statusTone[alert.status]}>{alert.status}</Badge>
                  {alert.deviceSimulated && <Badge tone="warning">SIMULATED</Badge>}
                </div>

                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="View alert detail"
                    onClick={() => setSelected(alert)}
                  >
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
                      aria-label="Resolve alert"
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
  const occupancyAlert =
    alert.type === 'occupancy_warning' || alert.type === 'capacity_exceeded';

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
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <Field label="Camera" value={alert.cameraName || alert.cameraId || '—'} />
          <Field label="Alert type" value={typeLabel(alert.type)} />
          {/* Review 3 references, shown only when the alert carries them. */}
          {alert.roomId && <Field label="Room" value={alert.roomName || alert.roomId} />}
          {alert.deviceId && (
            <Field
              label="Device"
              value={`${alert.deviceName || alert.deviceId}${
                alert.deviceSimulated ? ' (SIMULATED)' : ''
              }`}
            />
          )}
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

        {occupancyAlert && (
          <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            {OCCUPANCY_CAVEAT}
          </p>
        )}

        {alert.type === 'device_failure' && (
          <p className="rounded-lg border border-critical/30 bg-critical/10 px-3 py-2 text-xs text-critical">
            The device did not confirm the command, so its state was left unchanged. Nothing was
            switched. The full attempt, including the adapter&apos;s message, is in that
            device&apos;s action history on the Occupancy &amp; Energy page.
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
