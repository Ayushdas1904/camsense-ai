import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  Pencil,
  Trash2,
  Eye,
  ScanFace,
  Search,
  Users,
  ToggleLeft,
  ToggleRight,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import {
  PageHeader,
  Card,
  CardBody,
  Button,
  Badge,
  Input,
  Select,
  Modal,
  ConfirmDialog,
  LoadingState,
  EmptyState,
  ErrorState,
  useToast,
} from '@/components/ui';
import { PersonFormModal } from '@/components/PersonFormModal';
import { FaceRegistrationStep } from '@/components/FaceRegistrationStep';
import { peopleService } from '@/services/peopleService';
import { assetUrl } from '@/utils/assetUrl';
import type { Person, PersonInput, ViewStatus } from '@/types';
import { personCategoryLabel } from '@/types';

/**
 * People — person management for face recognition and attendance.
 *
 * Every row comes from GET /api/people. No person record is hardcoded here,
 * and no recognition statistic is computed client-side.
 *
 * Recognition readiness is driven by the backend's derived booleans
 * (`recognitionReady`, `faceRegistered`). The frontend never sees, requests or
 * stores a face embedding — the Person type has no such field.
 */

const PER_PAGE = 25;

const categoryFilterOptions = [
  { value: '', label: 'All categories' },
  ...(Object.keys(personCategoryLabel) as Array<keyof typeof personCategoryLabel>).map((key) => ({
    value: key,
    label: personCategoryLabel[key],
  })),
];

const recognitionFilterOptions = [
  { value: '', label: 'Recognition: any' },
  { value: 'true', label: 'Recognition enabled' },
  { value: 'false', label: 'Recognition disabled' },
];

const activeFilterOptions = [
  { value: '', label: 'All records' },
  { value: 'true', label: 'Active only' },
  { value: 'false', label: 'Deactivated only' },
];

/** The three readiness states an operator needs to tell apart. */
function recognitionBadge(person: Person) {
  if (!person.active) return { tone: 'neutral' as const, label: 'Deactivated' };
  if (!person.faceRegistered) return { tone: 'warning' as const, label: 'No face enrolled' };
  if (!person.recognitionEnabled) return { tone: 'neutral' as const, label: 'Recognition off' };
  return { tone: 'safe' as const, label: 'Recognition ready' };
}

export function PeoplePage() {
  const navigate = useNavigate();
  const toast = useToast();

  const [people, setPeople] = useState<Person[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<ViewStatus>('loading');
  const [error, setError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [recognition, setRecognition] = useState('');
  const [active, setActive] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Person | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [faceTarget, setFaceTarget] = useState<Person | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Person | null>(null);
  const [hardDeleteTarget, setHardDeleteTarget] = useState<Person | null>(null);
  const [removing, setRemoving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const filtersActive = !!(search || category || recognition || active);

  // Debounce the search box so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const load = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      const result = await peopleService.list({
        search: search || undefined,
        category: category || undefined,
        recognitionEnabled: recognition ? recognition === 'true' : undefined,
        active: active ? active === 'true' : undefined,
        page,
        limit: PER_PAGE,
      });
      setPeople(result.items);
      setTotal(result.total);
      setStatus(result.items.length === 0 ? 'empty' : 'success');
    } catch (err) {
      setError((err as { message?: string }).message ?? 'Unable to load people.');
      setStatus('error');
    }
  }, [search, category, recognition, active, page]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPages = useMemo(() => Math.max(Math.ceil(total / PER_PAGE), 1), [total]);

  async function handleSubmit(input: PersonInput) {
    setSaving(true);
    setFormError(null);
    try {
      if (editing) {
        await peopleService.update(editing.id, input);
        toast.success(`${input.name} updated.`);
      } else {
        const created = await peopleService.create(input);
        toast.success(`${created.name} registered. Add a photograph to enable recognition.`);
      }
      setFormOpen(false);
      setEditing(null);
      await load();
    } catch (err) {
      setFormError((err as { message?: string }).message ?? 'Could not save this person.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleRecognition(person: Person) {
    setBusyId(person.id);
    try {
      const updated = await peopleService.setRecognition(person.id, !person.recognitionEnabled);
      setPeople((prev) => prev.map((p) => (p.id === person.id ? updated : p)));
      toast.success(
        updated.recognitionEnabled
          ? `Recognition enabled for ${updated.name}.`
          : `Recognition disabled for ${updated.name}. They will no longer be matched.`
      );
    } catch (err) {
      toast.error((err as { message?: string }).message ?? 'Could not update recognition.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeactivate() {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      await peopleService.remove(removeTarget.id, { deactivate: true });
      toast.success(`${removeTarget.name} deactivated. Attendance history is kept.`);
      setRemoveTarget(null);
      await load();
    } catch (err) {
      toast.error((err as { message?: string }).message ?? 'Could not deactivate this person.');
    } finally {
      setRemoving(false);
    }
  }

  async function handleHardDelete() {
    if (!hardDeleteTarget) return;
    setRemoving(true);
    try {
      await peopleService.remove(hardDeleteTarget.id);
      toast.success(`${hardDeleteTarget.name} and their stored face data were deleted.`);
      setHardDeleteTarget(null);
      await load();
    } catch (err) {
      toast.error((err as { message?: string }).message ?? 'Could not delete this person.');
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="People"
        description="Register individuals so the system can recognize them and mark attendance."
        action={
          <Button
            leftIcon={<Plus className="h-4 w-4" />}
            onClick={() => {
              setEditing(null);
              setFormError(null);
              setFormOpen(true);
            }}
          >
            Register Person
          </Button>
        }
      />

      <Card className="mb-4">
        <CardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            label="Search"
            name="people-search"
            placeholder="Name, person ID or email"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <Select
            label="Category"
            name="people-category"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(1);
            }}
            options={categoryFilterOptions}
          />
          <Select
            label="Recognition"
            name="people-recognition"
            value={recognition}
            onChange={(e) => {
              setRecognition(e.target.value);
              setPage(1);
            }}
            options={recognitionFilterOptions}
          />
          <Select
            label="Record status"
            name="people-active"
            value={active}
            onChange={(e) => {
              setActive(e.target.value);
              setPage(1);
            }}
            options={activeFilterOptions}
          />
        </CardBody>
      </Card>

      {status === 'loading' && <LoadingState message="Loading people…" />}
      {status === 'error' && <ErrorState message={error ?? undefined} onRetry={load} />}

      {status === 'empty' && (
        <Card>
          <CardBody>
            {filtersActive ? (
              <EmptyState
                icon={<Search className="h-6 w-6" />}
                title="No results match your search"
                description="No person matches the current search and filters. Try a different term or clear the filters."
                action={
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setSearchInput('');
                      setSearch('');
                      setCategory('');
                      setRecognition('');
                      setActive('');
                      setPage(1);
                    }}
                  >
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={<Users className="h-6 w-6" />}
                title="No people registered yet"
                description="Register a person, then add a registration photograph so the system can recognize them."
                action={
                  <Button
                    size="sm"
                    leftIcon={<Plus className="h-4 w-4" />}
                    onClick={() => {
                      setEditing(null);
                      setFormError(null);
                      setFormOpen(true);
                    }}
                  >
                    Register Person
                  </Button>
                }
              />
            )}
          </CardBody>
        </Card>
      )}

      {status === 'success' && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Registered people and their recognition status</caption>
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
                    Recognition
                  </th>
                  <th scope="col" className="px-5 py-3 text-right font-medium">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {people.map((person) => {
                  const badge = recognitionBadge(person);
                  const photo = assetUrl(person.photo ?? undefined);
                  return (
                    <tr key={person.id}>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          {photo ? (
                            <img
                              src={photo}
                              alt={`Registration photograph of ${person.name}`}
                              className="h-9 w-9 rounded-full border border-border object-cover"
                            />
                          ) : (
                            <span
                              className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-raised text-content-faint"
                              aria-hidden="true"
                            >
                              <Users className="h-4 w-4" />
                            </span>
                          )}
                          <div className="min-w-0">
                            <p className="truncate font-medium text-content">{person.name}</p>
                            {person.email && (
                              <p className="truncate text-xs text-content-faint">{person.email}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3 font-mono text-xs text-content-muted">
                        {person.personId}
                      </td>
                      <td className="px-5 py-3 text-content-muted">
                        {personCategoryLabel[person.category]}
                      </td>
                      <td className="px-5 py-3 text-content-muted">{person.department || '—'}</td>
                      <td className="px-5 py-3">
                        <Badge tone={badge.tone}>{badge.label}</Badge>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`View details for ${person.name}`}
                            title="View details"
                            onClick={() => navigate(`/people/${person.id}`)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Register a face for ${person.name}`}
                            title="Register face photograph"
                            onClick={() => setFaceTarget(person)}
                          >
                            <ScanFace className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Edit ${person.name}`}
                            title="Edit person"
                            onClick={() => {
                              setEditing(person);
                              setFormError(null);
                              setFormOpen(true);
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            loading={busyId === person.id}
                            aria-label={
                              person.recognitionEnabled
                                ? `Disable recognition for ${person.name}`
                                : `Enable recognition for ${person.name}`
                            }
                            title={
                              person.recognitionEnabled ? 'Disable recognition' : 'Enable recognition'
                            }
                            onClick={() => toggleRecognition(person)}
                          >
                            {person.recognitionEnabled ? (
                              <ToggleRight className="h-4 w-4 text-safe" />
                            ) : (
                              <ToggleLeft className="h-4 w-4 text-content-faint" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Remove ${person.name}`}
                            title="Deactivate or delete"
                            onClick={() => setRemoveTarget(person)}
                          >
                            <Trash2 className="h-4 w-4 text-critical" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between border-t border-border px-5 py-3 text-xs text-content-muted">
            <span>
              {total} {total === 1 ? 'person' : 'people'} · page {page} of {totalPages}
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

      <PersonFormModal
        open={formOpen}
        person={editing}
        saving={saving}
        error={formError}
        onSubmit={handleSubmit}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
      />

      <FaceRegistrationStep
        open={!!faceTarget}
        person={faceTarget}
        onClose={() => setFaceTarget(null)}
        onRegistered={(updated) => {
          setPeople((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
        }}
      />

      {/*
        A deactivate-vs-delete choice needs two confirm actions, which the
        single-action ConfirmDialog cannot express — so this composes the same
        Modal + Button primitives ConfirmDialog is built from. The irreversible
        path then goes through the real ConfirmDialog below.
      */}
      <Modal
        open={!!removeTarget}
        onClose={() => setRemoveTarget(null)}
        title="Remove person"
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setRemoveTarget(null)}
              disabled={removing}
            >
              Cancel
            </Button>
            <Button variant="secondary" size="sm" loading={removing} onClick={handleDeactivate}>
              Deactivate
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={removing}
              onClick={() => {
                setHardDeleteTarget(removeTarget);
                setRemoveTarget(null);
              }}
            >
              Delete permanently
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-content-muted">
          <p>
            <span className="text-content">{removeTarget?.name}</span> ({removeTarget?.personId})
          </p>
          <p>
            <span className="text-content">Deactivate</span> keeps the attendance history readable
            and makes the person unmatchable. This can be undone.
          </p>
          <p>
            <span className="text-content">Delete permanently</span> removes the person record, the
            stored face data and the registration photograph. This cannot be undone.
          </p>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!hardDeleteTarget}
        title="Delete person permanently"
        message={`Permanently delete ${hardDeleteTarget?.name ?? ''} (${
          hardDeleteTarget?.personId ?? ''
        }), their stored face data and their registration photograph? This cannot be undone.`}
        confirmLabel="Delete permanently"
        danger
        loading={removing}
        onConfirm={handleHardDelete}
        onCancel={() => setHardDeleteTarget(null)}
      />
    </div>
  );
}
