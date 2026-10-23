import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import {
  CalendarCheck,
  Users,
  UserCheck,
  UserMinus,
  Percent,
  Search,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
} from 'lucide-react';
import {
  PageHeader,
  Card,
  CardBody,
  CardHeader,
  Button,
  Badge,
  Input,
  Select,
  Modal,
  LoadingState,
  EmptyState,
  ErrorState,
} from '@/components/ui';
import { attendanceService } from '@/services/attendanceService';
import { peopleService } from '@/services/peopleService';
import { useSocketEvent } from '@/hooks/useSocketEvent';
import { SocketEvents } from '@/services/socket';
import { formatDateTime } from '@/utils/format';
import type {
  AttendanceMarkedPayload,
  AttendanceRecord,
  AttendanceSummary,
  Person,
  ViewStatus,
} from '@/types';
import { personCategoryLabel } from '@/types';

/**
 * Attendance — the daily register produced by confirmed face recognition.
 *
 * HONESTY RULES THIS PAGE FOLLOWS:
 *  - All four summary tiles come from GET /api/attendance/summary. They are
 *    never computed from the rows on screen (which are one page of a filtered
 *    query) and never hardcoded.
 *  - Rows come from GET /api/attendance. No attendance record is fabricated.
 *  - Only confirmed identity matches produce records; the backend enforces that
 *    and there is no client-facing attendance write route at all.
 *  - `similarity` shown in the detail modal is a face-embedding cosine
 *    similarity, labelled as such. It is not an object-detection confidence.
 *
 * Attendance session policy: one record per person per calendar date, enforced
 * by a unique database index on { personId, date }.
 */

const PER_PAGE = 25;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Local calendar date, matching the backend's attendance session key. */
function todayKey(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

const statusFilterOptions = [
  { value: '', label: 'All statuses' },
  { value: 'present', label: 'Present' },
  { value: 'late', label: 'Late' },
  { value: 'absent', label: 'Absent' },
];

export function AttendancePage() {
  const [summary, setSummary] = useState<AttendanceSummary | null>(null);
  const [summaryStatus, setSummaryStatus] = useState<ViewStatus>('loading');

  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [listStatus, setListStatus] = useState<ViewStatus>('loading');
  const [listError, setListError] = useState<string | null>(null);

  const [date, setDate] = useState(todayKey());
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [personId, setPersonId] = useState('');
  const [department, setDepartment] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [people, setPeople] = useState<Person[]>([]);
  const [selected, setSelected] = useState<AttendanceRecord | null>(null);

  const dateValid = date === '' || DATE_PATTERN.test(date);
  const filtersActive = !!(search || personId || department || statusFilter);

  // Debounced search.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  // People power the person and department filter options. The options are
  // derived from real person records, never from a hardcoded list.
  useEffect(() => {
    peopleService
      .list({ limit: 200, active: true })
      .then((result) => setPeople(result.items))
      .catch(() => setPeople([]));
  }, []);

  const departments = useMemo(
    () => [...new Set(people.map((p) => p.department).filter((d) => !!d))].sort(),
    [people]
  );

  const loadSummary = useCallback(async () => {
    if (!dateValid) return;
    setSummaryStatus('loading');
    try {
      setSummary(await attendanceService.summary({ date: date || undefined, limit: 10 }));
      setSummaryStatus('success');
    } catch {
      setSummaryStatus('error');
    }
  }, [date, dateValid]);

  const loadList = useCallback(async () => {
    if (!dateValid) return;
    setListStatus('loading');
    setListError(null);
    try {
      const result = await attendanceService.list({
        date: date || undefined,
        search: search || undefined,
        personId: personId || undefined,
        department: department || undefined,
        status: statusFilter || undefined,
        page,
        limit: PER_PAGE,
      });
      setRecords(result.items);
      setTotal(result.total);
      setListStatus(result.items.length === 0 ? 'empty' : 'success');
    } catch (err) {
      setListError((err as { message?: string }).message ?? 'Unable to load attendance.');
      setListStatus('error');
    }
  }, [date, dateValid, search, personId, department, statusFilter, page]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  /**
   * Live updates are SUPPLEMENTARY to database persistence, not a replacement
   * for it: a client that was disconnected simply re-fetches on mount (the
   * loadList/loadSummary effects above), so no record can be missed by having
   * missed an event.
   */
  useSocketEvent<AttendanceMarkedPayload>(SocketEvents.ATTENDANCE_MARKED, (payload) => {
    if (date && payload.date !== date) return;
    const record: AttendanceRecord = {
      id: payload.id,
      personId: payload.personId,
      personName: payload.personName,
      // Not carried on the socket payload; the next refresh fills these in.
      category: null,
      department: null,
      photo: null,
      cameraId: payload.cameraId,
      cameraName: payload.cameraName ?? payload.cameraId,
      date: payload.date,
      sessionKey: payload.date,
      firstSeen: payload.firstSeen,
      lastSeen: payload.lastSeen,
      status: payload.status,
      source: payload.source,
      recognitionEventId: null,
      similarity: payload.similarity,
      createdAt: payload.firstSeen,
    };
    setRecords((prev) => [record, ...prev.filter((r) => r.id !== record.id)]);
    setTotal((prev) => prev + 1);
    setListStatus('success');
    // Keep the tiles truthful: re-read them from the backend rather than
    // incrementing a count locally.
    loadSummary();
  });

  const totalPages = useMemo(() => Math.max(Math.ceil(total / PER_PAGE), 1), [total]);

  function clearFilters() {
    setSearchInput('');
    setSearch('');
    setPersonId('');
    setDepartment('');
    setStatusFilter('');
    setPage(1);
  }

  return (
    <div>
      <PageHeader
        title="Attendance"
        description="One record per person per day, created only from a confirmed face match."
        action={
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<RefreshCw className="h-4 w-4" />}
            onClick={() => {
              loadSummary();
              loadList();
            }}
          >
            Refresh
          </Button>
        }
      />

      {/* Summary — every figure read straight from the backend summary endpoint. */}
      {summaryStatus === 'error' ? (
        <Card className="mb-4">
          <CardBody>
            <ErrorState message="Unable to load the attendance summary." onRetry={loadSummary} />
          </CardBody>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <SummaryTile
            icon={Users}
            label="Total registered people"
            value={summaryStatus === 'loading' ? '—' : `${summary?.totalRegistered ?? 0}`}
          />
          <SummaryTile
            icon={UserCheck}
            label="Present today"
            value={summaryStatus === 'loading' ? '—' : `${summary?.presentToday ?? 0}`}
            tone="safe"
          />
          <SummaryTile
            icon={UserMinus}
            label="Not yet marked present"
            value={summaryStatus === 'loading' ? '—' : `${summary?.notMarked ?? 0}`}
          />
          <SummaryTile
            icon={Percent}
            label="Attendance percentage"
            value={summaryStatus === 'loading' ? '—' : `${summary?.attendancePercentage ?? 0}%`}
            sub={summary ? `for ${summary.date}` : undefined}
          />
        </div>
      )}

      <Card className="mb-4 mt-4">
        <CardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Input
            label="Date"
            name="attendance-date"
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setPage(1);
            }}
          />
          <Input
            label="Search"
            name="attendance-search"
            placeholder="Name or person ID"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <Select
            label="Person"
            name="attendance-person"
            value={personId}
            onChange={(e) => {
              setPersonId(e.target.value);
              setPage(1);
            }}
            options={[
              { value: '', label: 'All people' },
              ...people.map((p) => ({
                value: p.personId,
                label: `${p.name} (${p.personId})`,
              })),
            ]}
          />
          <Select
            label="Department"
            name="attendance-department"
            value={department}
            onChange={(e) => {
              setDepartment(e.target.value);
              setPage(1);
            }}
            options={[
              { value: '', label: 'All departments' },
              ...departments.map((d) => ({ value: d, label: d })),
            ]}
          />
          <Select
            label="Status"
            name="attendance-status"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            options={statusFilterOptions}
          />
        </CardBody>
      </Card>

      {!dateValid && (
        <Card>
          <CardBody>
            <EmptyState
              icon={<CalendarCheck className="h-6 w-6" />}
              title="That date is not valid"
              description="Enter a date as YYYY-MM-DD, or clear the field to see every session."
              action={
                <Button variant="secondary" size="sm" onClick={() => setDate(todayKey())}>
                  Use today
                </Button>
              }
            />
          </CardBody>
        </Card>
      )}

      {dateValid && listStatus === 'loading' && <LoadingState message="Loading attendance…" />}
      {dateValid && listStatus === 'error' && (
        <ErrorState message={listError ?? undefined} onRetry={loadList} />
      )}

      {dateValid && listStatus === 'empty' && (
        <Card>
          <CardBody>
            {filtersActive ? (
              <EmptyState
                icon={<Search className="h-6 w-6" />}
                title="No results match your search"
                description="No attendance record matches the current filters. Try a different term or clear the filters."
                action={
                  <Button variant="secondary" size="sm" onClick={clearFilters}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={<CalendarCheck className="h-6 w-6" />}
                title="No attendance records"
                description={
                  date
                    ? `Nothing has been recorded for ${date}. Records appear here when a registered person is confidently recognized by a camera.`
                    : 'Records appear here when a registered person is confidently recognized by a camera.'
                }
              />
            )}
          </CardBody>
        </Card>
      )}

      {dateValid && listStatus === 'success' && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Attendance records for the selected filters</caption>
              <thead>
                <tr className="border-b border-border text-xs text-content-muted">
                  <th scope="col" className="px-5 py-3 font-medium">
                    Person
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Person ID
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Category
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Department
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    First Seen
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Camera
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {records.map((record) => (
                  <tr
                    key={record.id}
                    tabIndex={0}
                    role="button"
                    aria-label={`Open attendance detail for ${record.personName}`}
                    className="cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand/40 hover:bg-raised"
                    onClick={() => setSelected(record)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelected(record);
                      }
                    }}
                  >
                    <td className="px-5 py-3 text-content">{record.personName}</td>
                    <td className="px-5 py-3 font-mono text-xs text-content-muted">
                      {record.personId}
                    </td>
                    <td className="px-5 py-3 text-content-muted">
                      {record.category ? personCategoryLabel[record.category] : '—'}
                    </td>
                    <td className="px-5 py-3 text-content-muted">{record.department || '—'}</td>
                    <td className="px-5 py-3 text-content-muted">
                      {formatDateTime(record.firstSeen)}
                    </td>
                    <td className="px-5 py-3 text-content-muted">
                      {record.cameraName || record.cameraId || '—'}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1.5">
                        <Badge tone={record.status === 'absent' ? 'neutral' : 'safe'}>
                          {record.status}
                        </Badge>
                        {record.source === 'demo' && <Badge tone="info">DEMO</Badge>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between border-t border-border px-5 py-3 text-xs text-content-muted">
            <span>
              {total} {total === 1 ? 'record' : 'records'} · page {page} of {totalPages}
            </span>
            <div className="flex gap-1">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                aria-label="Previous page"
                onClick={() => setPage((p) => Math.max(p - 1, 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= totalPages}
                aria-label="Next page"
                onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </Card>
      )}

      {summary && summaryStatus === 'success' && (
        <Card className="mt-4">
          <CardHeader
            title="Recognition enrolment"
            description="How many active people can currently be matched"
          />
          <CardBody className="text-sm text-content-muted">
            {summary.recognitionReadyPeople} of {summary.totalRegistered} active people have a
            registered face and recognition enabled. Anyone else cannot be recognized and therefore
            cannot be marked present automatically.
          </CardBody>
        </Card>
      )}

      <AttendanceDetailModal record={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function AttendanceDetailModal({
  record,
  onClose,
}: {
  record: AttendanceRecord | null;
  onClose: () => void;
}) {
  if (!record) return null;
  return (
    <Modal open={!!record} onClose={onClose} title="Attendance detail">
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Badge tone={record.status === 'absent' ? 'neutral' : 'safe'}>{record.status}</Badge>
          <Badge tone="neutral">source: {record.source}</Badge>
          {record.source === 'demo' && <Badge tone="info">DEMO DATA</Badge>}
        </div>

        <dl className="grid grid-cols-2 gap-3 text-sm">
          <Field label="Person" value={record.personName} />
          <Field label="Person ID" value={record.personId} />
          <Field
            label="Category"
            value={record.category ? personCategoryLabel[record.category] : '—'}
          />
          <Field label="Department" value={record.department || '—'} />
          <Field label="Session date" value={record.date} />
          <Field label="Camera" value={record.cameraName || record.cameraId || '—'} />
          <Field label="First seen" value={formatDateTime(record.firstSeen)} />
          <Field
            label="Last seen"
            value={record.lastSeen ? formatDateTime(record.lastSeen) : '—'}
          />
          {/* Labelled explicitly: this is a face-embedding similarity, which is
              a different measurement from an object-detection confidence. */}
          <Field
            label="Face similarity at match"
            value={record.similarity !== null ? record.similarity.toFixed(3) : '—'}
          />
        </dl>

        <p className="text-xs text-content-faint">
          Face similarity is a cosine distance between embeddings, not a probability and not an
          object-detection confidence.
        </p>

        <Link
          to={`/people/${record.personId}`}
          className="inline-block text-sm text-brand hover:underline"
        >
          Open person detail →
        </Link>
      </div>
    </Modal>
  );
}

function SummaryTile({
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
  tone?: 'safe' | 'warning';
}) {
  const valueColor =
    tone === 'safe' ? 'text-safe' : tone === 'warning' ? 'text-warning' : 'text-content';
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

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-content-faint">{label}</dt>
      <dd className="text-content">{value}</dd>
    </div>
  );
}
