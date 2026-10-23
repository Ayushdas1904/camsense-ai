import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, ScanFace, Users, CalendarCheck, ShieldAlert } from 'lucide-react';
import {
  PageHeader,
  Card,
  CardHeader,
  CardBody,
  Button,
  Badge,
  LoadingState,
  EmptyState,
  ErrorState,
  useToast,
} from '@/components/ui';
import { PersonFormModal } from '@/components/PersonFormModal';
import { FaceRegistrationStep } from '@/components/FaceRegistrationStep';
import { peopleService } from '@/services/peopleService';
import { attendanceService } from '@/services/attendanceService';
import { assetUrl } from '@/utils/assetUrl';
import { formatDateTime } from '@/utils/format';
import type { AttendanceRecord, Person, PersonInput, ViewStatus } from '@/types';
import { personCategoryLabel } from '@/types';

/**
 * Person detail — profile, recognition readiness and recent attendance.
 *
 * Nothing on this page is fabricated: the profile comes from GET /api/people/:id
 * and the history from GET /api/attendance filtered to this person.
 *
 * A face embedding is never requested, displayed or logged. Readiness is shown
 * from the backend's derived flags, and when the person cannot be recognized the
 * reason is stated explicitly rather than hidden behind a generic badge.
 */
export function PersonDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const [person, setPerson] = useState<Person | null>(null);
  const [status, setStatus] = useState<ViewStatus>('loading');
  const [error, setError] = useState<string | null>(null);

  const [history, setHistory] = useState<AttendanceRecord[]>([]);
  const [historyStatus, setHistoryStatus] = useState<ViewStatus>('loading');

  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [faceOpen, setFaceOpen] = useState(false);
  const [togglingRecognition, setTogglingRecognition] = useState(false);

  const load = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      const loaded = await peopleService.get(id);
      setPerson(loaded);
      setStatus('success');
    } catch (err) {
      setError((err as { message?: string }).message ?? 'Unable to load this person.');
      setStatus('error');
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const loadHistory = useCallback(async (personId: string) => {
    setHistoryStatus('loading');
    try {
      const result = await attendanceService.list({ personId, limit: 10 });
      setHistory(result.items);
      setHistoryStatus(result.items.length === 0 ? 'empty' : 'success');
    } catch {
      setHistoryStatus('error');
    }
  }, []);

  useEffect(() => {
    if (person?.personId) loadHistory(person.personId);
  }, [person?.personId, loadHistory]);

  async function handleSubmit(input: PersonInput) {
    if (!person) return;
    setSaving(true);
    setFormError(null);
    try {
      const updated = await peopleService.update(person.id, input);
      setPerson(updated);
      setEditOpen(false);
      toast.success(`${updated.name} updated.`);
    } catch (err) {
      setFormError((err as { message?: string }).message ?? 'Could not save this person.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleRecognition() {
    if (!person) return;
    setTogglingRecognition(true);
    try {
      const updated = await peopleService.setRecognition(person.id, !person.recognitionEnabled);
      setPerson(updated);
      toast.success(
        updated.recognitionEnabled
          ? `Recognition enabled for ${updated.name}.`
          : `Recognition disabled for ${updated.name}. They will no longer be matched.`
      );
    } catch (err) {
      toast.error((err as { message?: string }).message ?? 'Could not update recognition.');
    } finally {
      setTogglingRecognition(false);
    }
  }

  if (status === 'loading') return <LoadingState message="Loading person…" />;
  if (status === 'error' || !person) {
    return (
      <div>
        <PageHeader title="Person" />
        <ErrorState message={error ?? undefined} onRetry={load} />
      </div>
    );
  }

  const photo = assetUrl(person.photo ?? undefined);
  const readiness = person.recognitionReady
    ? { tone: 'safe' as const, label: 'Recognition ready' }
    : { tone: 'warning' as const, label: 'Not recognition ready' };

  // Why this person cannot be recognized, stated plainly.
  const blockers: string[] = [];
  if (!person.active) blockers.push('This record is deactivated, so the person is not matched.');
  if (!person.faceRegistered)
    blockers.push(
      'No valid face embedding exists yet. Register a photograph containing one clearly visible face.'
    );
  if (!person.recognitionEnabled)
    blockers.push('Recognition is switched off for this person. Enable it to allow matching.');

  return (
    <div>
      <PageHeader
        title={person.name}
        description={`Person ID ${person.personId}`}
        action={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<ArrowLeft className="h-4 w-4" />}
              onClick={() => navigate('/people')}
            >
              Back to People
            </Button>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Pencil className="h-4 w-4" />}
              onClick={() => {
                setFormError(null);
                setEditOpen(true);
              }}
            >
              Edit
            </Button>
            <Button
              size="sm"
              leftIcon={<ScanFace className="h-4 w-4" />}
              onClick={() => setFaceOpen(true)}
            >
              {person.faceRegistered ? 'Replace photograph' : 'Register face'}
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Profile" />
          <CardBody className="space-y-4">
            <div className="flex items-center gap-4">
              {photo ? (
                <img
                  src={photo}
                  alt={`Registration photograph of ${person.name}`}
                  className="h-20 w-20 rounded-lg border border-border object-cover"
                />
              ) : (
                <span
                  className="flex h-20 w-20 items-center justify-center rounded-lg border border-border bg-raised text-content-faint"
                  aria-hidden="true"
                >
                  <Users className="h-7 w-7" />
                </span>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-content">{person.name}</p>
                <p className="font-mono text-xs text-content-faint">{person.personId}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <Badge tone="info">{personCategoryLabel[person.category]}</Badge>
                  {!person.active && <Badge tone="neutral">Deactivated</Badge>}
                </div>
              </div>
            </div>

            <dl className="space-y-2.5 text-sm">
              <Field label="Email" value={person.email || '—'} />
              <Field label="Department" value={person.department || '—'} />
              <Field label="Role" value={person.role || '—'} />
              <Field
                label="Registered"
                value={person.registeredAt ? formatDateTime(person.registeredAt) : '—'}
              />
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Recognition" description="Readiness for face matching" />
          <CardBody className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-content-muted">Status</span>
              <Badge tone={readiness.tone}>{readiness.label}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-content-muted">Face enrolled</span>
              <span className="text-content">{person.faceRegistered ? 'Yes' : 'No'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-content-muted">Recognition enabled</span>
              <span className="text-content">{person.recognitionEnabled ? 'Yes' : 'No'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-content-muted">Enrolled on</span>
              <span className="text-content">
                {person.faceRegisteredAt ? formatDateTime(person.faceRegisteredAt) : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-content-muted">Model</span>
              <span className="text-content">{person.embeddingModel || '—'}</span>
            </div>

            {blockers.length > 0 && (
              <div className="space-y-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs">
                <p className="flex items-center gap-2 font-medium text-warning">
                  <ShieldAlert className="h-4 w-4" aria-hidden="true" />
                  This person cannot be recognized
                </p>
                <ul className="list-disc space-y-1 pl-4 text-content-muted">
                  {blockers.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Button
                variant="secondary"
                size="sm"
                loading={togglingRecognition}
                onClick={toggleRecognition}
              >
                {person.recognitionEnabled ? 'Disable recognition' : 'Enable recognition'}
              </Button>
              {!person.faceRegistered && (
                <Button
                  size="sm"
                  leftIcon={<ScanFace className="h-4 w-4" />}
                  onClick={() => setFaceOpen(true)}
                >
                  Register face
                </Button>
              )}
            </div>

            <p className="text-xs text-content-faint">
              Face data is stored by the backend in a protected field. It is never sent to this
              interface — only the readiness flags above are.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Recent attendance"
            description="From recorded attendance only"
            action={
              <Link to="/attendance" className="text-xs text-brand hover:underline">
                View all
              </Link>
            }
          />
          <CardBody>
            {historyStatus === 'loading' && <LoadingState message="Loading attendance…" />}
            {historyStatus === 'error' && <ErrorState message="Unable to load attendance." />}
            {historyStatus === 'empty' && (
              <EmptyState
                icon={<CalendarCheck className="h-6 w-6" />}
                title="No attendance yet"
                description="Attendance appears here once this person is confidently recognized by a camera."
              />
            )}
            {historyStatus === 'success' && (
              <ul className="divide-y divide-border">
                {history.map((record) => (
                  <li key={record.id} className="flex items-center justify-between py-2.5 text-xs">
                    <div className="min-w-0">
                      <p className="text-content">{record.date}</p>
                      <p className="truncate text-content-faint">
                        {record.cameraName || record.cameraId || 'Unknown camera'} ·{' '}
                        {formatDateTime(record.firstSeen)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {record.source === 'demo' && <Badge tone="info">DEMO</Badge>}
                      <Badge tone={record.status === 'absent' ? 'neutral' : 'safe'}>
                        {record.status}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <PersonFormModal
        open={editOpen}
        person={person}
        saving={saving}
        error={formError}
        onSubmit={handleSubmit}
        onClose={() => setEditOpen(false)}
      />

      <FaceRegistrationStep
        open={faceOpen}
        person={person}
        onClose={() => setFaceOpen(false)}
        onRegistered={(updated) => setPerson(updated)}
      />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-content-muted">{label}</dt>
      <dd className="min-w-0 truncate text-content">{value}</dd>
    </div>
  );
}
