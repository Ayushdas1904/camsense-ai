import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Modal, Input, Select, Button } from '@/components/ui';
import type { Camera, Room, RoomInput } from '@/types';

/**
 * Create/Edit room (monitored zone) form.
 *
 * Follows PersonFormModal exactly: the presence of `room` switches it to edit
 * mode, the parent owns the API call, and field-level validation lives in an
 * exported pure function so it can be reasoned about (and later tested)
 * independently of the component. Client-side validation is a courtesy for
 * fast feedback — the backend's zod schema, its uniqueness check and its
 * camera-existence check are authoritative, and a server rejection arrives
 * through `error`.
 *
 * ONE THING WORTH SAYING IN THE FORM ITSELF: a room may reference several
 * cameras, but their counts are aggregated with a MAX and never a sum, because
 * this project has no cross-camera re-identification. Summing would
 * double-count anyone standing in the overlap. The note below the camera
 * picker says so, so an operator does not configure two cameras expecting
 * their counts to add up.
 */
const EMPTY: RoomInput = {
  roomId: '',
  name: '',
  description: '',
  cameraIds: [],
  capacity: 0,
  occupancyThreshold: 1,
  nearCapacityRatio: 0.8,
  monitoringEnabled: true,
};

type FieldErrors = Partial<
  Record<'roomId' | 'name' | 'capacity' | 'occupancyThreshold' | 'cameraIds', string>
>;

export function validateRoomInput(form: RoomInput): FieldErrors {
  const errors: FieldErrors = {};

  const roomId = form.roomId.trim();
  if (!roomId) {
    errors.roomId = 'Room ID is required.';
  } else if (roomId.length > 40) {
    errors.roomId = 'Room ID must be 40 characters or fewer.';
  } else if (/\s/.test(roomId)) {
    errors.roomId = 'Room ID cannot contain spaces.';
  }

  const name = form.name.trim();
  if (!name) {
    errors.name = 'Room name is required.';
  } else if (name.length > 80) {
    errors.name = 'Name must be 80 characters or fewer.';
  }

  if (!Number.isInteger(form.capacity) || form.capacity < 0) {
    errors.capacity = 'Capacity must be a whole number of 0 or more.';
  }

  if (!Number.isInteger(form.occupancyThreshold) || form.occupancyThreshold < 0) {
    errors.occupancyThreshold = 'Threshold must be a whole number of 0 or more.';
  } else if (form.capacity > 0 && form.occupancyThreshold > form.capacity) {
    errors.occupancyThreshold =
      'Threshold is above the capacity, so the room could never be below it.';
  }

  if (form.cameraIds.length > 16) {
    errors.cameraIds = 'A room may reference at most 16 cameras.';
  }

  return errors;
}

export function RoomFormModal({
  open,
  room,
  cameras,
  saving,
  error,
  onSubmit,
  onClose,
}: {
  open: boolean;
  room?: Room | null;
  /** The real camera inventory. A room cannot reference a camera that is not here. */
  cameras: Camera[];
  saving: boolean;
  error?: string | null;
  onSubmit: (input: RoomInput) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<RoomInput>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});

  useEffect(() => {
    setErrors({});
    if (room) {
      setForm({
        roomId: room.roomId,
        name: room.name,
        description: room.description,
        cameraIds: [...room.cameraIds],
        capacity: room.capacity,
        occupancyThreshold: room.occupancyThreshold,
        nearCapacityRatio: room.nearCapacityRatio,
        monitoringEnabled: room.monitoringEnabled,
      });
    } else {
      setForm(EMPTY);
    }
  }, [room, open]);

  const set = <K extends keyof RoomInput>(key: K, value: RoomInput[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => {
      const next = { ...e };
      delete next[key as keyof FieldErrors];
      return next;
    });
  };

  function toggleCamera(cameraId: string) {
    setForm((f) => ({
      ...f,
      cameraIds: f.cameraIds.includes(cameraId)
        ? f.cameraIds.filter((id) => id !== cameraId)
        : [...f.cameraIds, cameraId],
    }));
    setErrors((e) => {
      const next = { ...e };
      delete next.cameraIds;
      return next;
    });
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const found = validateRoomInput(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    onSubmit({
      ...form,
      roomId: form.roomId.trim(),
      name: form.name.trim(),
      description: (form.description ?? '').trim(),
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={room ? 'Edit Room' : 'Add Room'}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSubmit} loading={saving} disabled={saving}>
            {room ? 'Save changes' : 'Create room'}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Room ID *"
            name="roomId"
            placeholder="ROOM-01"
            value={form.roomId}
            onChange={(e) => set('roomId', e.target.value)}
            error={errors.roomId}
            disabled={!!room}
            required
          />
          <Input
            label="Room name *"
            name="name"
            placeholder="Main Lab"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            error={errors.name}
            required
          />
        </div>

        <Input
          label="Description (optional)"
          name="description"
          placeholder="Ground floor, east wing"
          value={form.description ?? ''}
          onChange={(e) => set('description', e.target.value)}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Capacity (0 = not configured)"
            name="capacity"
            type="number"
            min={0}
            value={form.capacity}
            onChange={(e) => set('capacity', Number(e.target.value))}
            error={errors.capacity}
          />
          <Input
            label="Occupancy threshold"
            name="occupancyThreshold"
            type="number"
            min={0}
            value={form.occupancyThreshold}
            onChange={(e) => set('occupancyThreshold', Number(e.target.value))}
            error={errors.occupancyThreshold}
          />
        </div>
        <p className="text-xs text-content-faint">
          A capacity of 0 means capacity is not configured, and the Near Capacity / Capacity
          Exceeded statuses are then skipped rather than computed against a guess. The threshold
          is the count above which the room counts as occupied.
        </p>

        <div>
          <span className="mb-1.5 block text-xs font-medium text-content-muted">
            Cameras monitoring this room
          </span>
          {cameras.length === 0 ? (
            <p className="rounded-lg border border-border bg-raised px-3 py-2 text-xs text-content-muted">
              No cameras are configured yet. Add one under Cameras first — a room pointing at a
              camera that does not exist would sit at “Camera Unavailable” with no explanation.
            </p>
          ) : (
            <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-lg border border-border p-2">
              {cameras.map((camera) => (
                <label
                  key={camera.cameraId}
                  htmlFor={`room-camera-${camera.cameraId}`}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-content hover:bg-raised"
                >
                  <input
                    id={`room-camera-${camera.cameraId}`}
                    name={`room-camera-${camera.cameraId}`}
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded border-border"
                    checked={form.cameraIds.includes(camera.cameraId)}
                    onChange={() => toggleCamera(camera.cameraId)}
                  />
                  <span className="flex-1 truncate">
                    {camera.name}{' '}
                    <span className="text-content-faint">({camera.cameraId})</span>
                  </span>
                  {camera.mode === 'demo' && (
                    <span className="rounded border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                      DEMO
                    </span>
                  )}
                </label>
              ))}
            </div>
          )}
          {errors.cameraIds && <p className="mt-1 text-xs text-critical">{errors.cameraIds}</p>}
          <p className="mt-1.5 text-xs text-content-faint">
            With more than one camera the room&apos;s count is the <strong>maximum</strong> across
            them, never the sum: this project has no cross-camera re-identification, so adding the
            counts would double-count anyone visible to two cameras. The maximum is a documented
            lower bound.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select
            label="Monitoring"
            name="monitoringEnabled"
            value={form.monitoringEnabled ? 'true' : 'false'}
            onChange={(e) => set('monitoringEnabled', e.target.value === 'true')}
            options={[
              { value: 'true', label: 'Enabled' },
              { value: 'false', label: 'Disabled' },
            ]}
          />
          <Input
            label="Near-capacity ratio (0–1)"
            name="nearCapacityRatio"
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={form.nearCapacityRatio ?? 0.8}
            onChange={(e) => set('nearCapacityRatio', Number(e.target.value))}
          />
        </div>

        {error && (
          <p className="rounded-lg border border-critical/30 bg-critical/10 px-3 py-2 text-xs text-critical">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
