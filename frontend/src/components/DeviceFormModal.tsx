import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Modal, Input, Select, Button } from '@/components/ui';
import type {
  AdapterHealth,
  Device,
  DeviceAdapterType,
  DeviceControlMode,
  DeviceInput,
  DeviceType,
  Room,
} from '@/types';

/**
 * Register/Edit device form.
 *
 * TWO DELIBERATE HONESTY CHOICES IN THIS FORM:
 *
 * 1. THE ADAPTER DROPDOWN IS BUILT FROM GET /api/devices/adapters, not from a
 *    hardcoded list. The backend states which adapters are actually
 *    implemented, and an unimplemented one is labelled "not implemented" right
 *    in the option text. There is no MQTT, ESP32 or relay integration in this
 *    project, so offering one as if it worked would be a lie the operator
 *    would only discover when a command was refused.
 *
 * 2. THE POWER RATING IS LABELLED AS A CONFIGURED ESTIMATE. It is the only
 *    thing that turns a measured on-duration into a kWh figure, and there is
 *    no power meter anywhere in this system. A rating of 0 means "not
 *    configured", and the device then contributes no energy figure at all
 *    rather than a guessed one.
 *
 * Follows PersonFormModal: edit mode when `device` is present, the parent owns
 * the API call, and validation is an exported pure function.
 */
const EMPTY: DeviceInput = {
  deviceId: '',
  name: '',
  roomId: '',
  type: 'light',
  // 'disabled' by default, matching the backend: automation is opt-in per device.
  controlMode: 'disabled',
  adapterType: 'simulation',
  powerRatingWatts: 0,
};

type FieldErrors = Partial<
  Record<'deviceId' | 'name' | 'roomId' | 'powerRatingWatts', string>
>;

export function validateDeviceInput(form: DeviceInput): FieldErrors {
  const errors: FieldErrors = {};

  const deviceId = form.deviceId.trim();
  if (!deviceId) {
    errors.deviceId = 'Device ID is required.';
  } else if (deviceId.length > 40) {
    errors.deviceId = 'Device ID must be 40 characters or fewer.';
  } else if (/\s/.test(deviceId)) {
    errors.deviceId = 'Device ID cannot contain spaces.';
  }

  const name = form.name.trim();
  if (!name) {
    errors.name = 'Device name is required.';
  } else if (name.length > 80) {
    errors.name = 'Name must be 80 characters or fewer.';
  }

  if (!form.roomId.trim()) {
    errors.roomId = 'Choose the room this device belongs to.';
  }

  if (
    !Number.isFinite(form.powerRatingWatts) ||
    form.powerRatingWatts < 0 ||
    form.powerRatingWatts > 10000
  ) {
    errors.powerRatingWatts = 'Enter a wattage between 0 and 10000 (0 = not configured).';
  }

  return errors;
}

export function DeviceFormModal({
  open,
  device,
  rooms,
  adapters,
  saving,
  error,
  onSubmit,
  onClose,
}: {
  open: boolean;
  device?: Device | null;
  /** Real rooms. The backend rejects a roomId that does not resolve. */
  rooms: Room[];
  /** From GET /api/devices/adapters — which adapters actually work. */
  adapters: AdapterHealth | null;
  saving: boolean;
  error?: string | null;
  onSubmit: (input: DeviceInput) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<DeviceInput>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});

  useEffect(() => {
    setErrors({});
    if (device) {
      setForm({
        deviceId: device.deviceId,
        name: device.name,
        roomId: device.roomId,
        type: device.type,
        controlMode: device.controlMode,
        adapterType: device.adapterType,
        powerRatingWatts: device.powerRatingWatts,
      });
    } else {
      setForm({ ...EMPTY, roomId: rooms[0]?.roomId ?? '' });
    }
  }, [device, open, rooms]);

  const set = <K extends keyof DeviceInput>(key: K, value: DeviceInput[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => {
      const next = { ...e };
      delete next[key as keyof FieldErrors];
      return next;
    });
  };

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const found = validateDeviceInput(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    onSubmit({
      ...form,
      deviceId: form.deviceId.trim(),
      name: form.name.trim(),
      roomId: form.roomId.trim(),
    });
  }

  // Built from the backend's statement of fact, never hardcoded.
  const adapterOptions = (adapters?.adapters ?? [{ type: 'simulation', implemented: true, simulated: true, label: 'Simulation' }]).map(
    (adapter) => ({
      value: adapter.type,
      label: adapter.implemented
        ? `${adapter.label}${adapter.simulated ? ' (simulated — no hardware)' : ''}`
        : `${adapter.label} — NOT IMPLEMENTED, commands will be refused`,
    })
  );

  const selectedAdapter = adapters?.adapters.find((a) => a.type === form.adapterType);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={device ? 'Edit Device' : 'Register Device'}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSubmit} loading={saving} disabled={saving}>
            {device ? 'Save changes' : 'Register device'}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Device ID *"
            name="deviceId"
            placeholder="DEV-LIGHT-01"
            value={form.deviceId}
            onChange={(e) => set('deviceId', e.target.value)}
            error={errors.deviceId}
            disabled={!!device}
            required
          />
          <Input
            label="Device name *"
            name="name"
            placeholder="Lab ceiling lights"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            error={errors.name}
            required
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {rooms.length === 0 ? (
            <Input
              label="Room *"
              name="roomId"
              value=""
              onChange={() => undefined}
              error="Create a room first — a device in a room that does not exist could never be automated."
              disabled
            />
          ) : (
            <Select
              label="Room *"
              name="roomId"
              value={form.roomId}
              onChange={(e) => set('roomId', e.target.value)}
              options={rooms.map((room) => ({
                value: room.roomId,
                label: `${room.name} (${room.roomId})`,
              }))}
            />
          )}
          <Select
            label="Device type"
            name="type"
            value={form.type}
            onChange={(e) => set('type', e.target.value as DeviceType)}
            options={[
              { value: 'light', label: 'Light' },
              { value: 'fan', label: 'Fan' },
            ]}
          />
        </div>
        {errors.roomId && rooms.length > 0 && (
          <p className="text-xs text-critical">{errors.roomId}</p>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select
            label="Control mode"
            name="controlMode"
            value={form.controlMode}
            onChange={(e) => set('controlMode', e.target.value as DeviceControlMode)}
            options={[
              { value: 'disabled', label: 'Disabled (no automation)' },
              { value: 'manual', label: 'Manual only' },
              { value: 'automatic', label: 'Automatic (automation may switch it)' },
            ]}
          />
          <Select
            label="Adapter"
            name="adapterType"
            value={form.adapterType}
            onChange={(e) => set('adapterType', e.target.value as DeviceAdapterType)}
            options={adapterOptions}
          />
        </div>
        <p className="text-xs text-content-faint">
          A device is only switched by automation when its control mode is <em>Automatic</em>{' '}
          <strong>and</strong> an enabled rule covers it — two separate opt-ins, so nothing
          switches by accident.
        </p>
        {selectedAdapter && !selectedAdapter.implemented && (
          <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            The <strong>{selectedAdapter.label}</strong> adapter is not implemented in this
            project. The device can be saved so its configuration is ready, but every command to
            it will be refused with a clear error rather than silently simulated.
          </p>
        )}

        <Input
          label="Configured power rating (watts) — an estimate, not a measurement"
          name="powerRatingWatts"
          type="number"
          min={0}
          max={10000}
          value={form.powerRatingWatts}
          onChange={(e) => set('powerRatingWatts', Number(e.target.value))}
          error={errors.powerRatingWatts}
        />
        <p className="text-xs text-content-faint">
          There is no power meter in this system. Every kWh figure is this configured wattage
          multiplied by a measured on-duration, so changing it changes every energy report. A
          rating of 0 means “not configured”, and the device then contributes no energy figure at
          all rather than a guessed one.
        </p>

        {error && (
          <p className="rounded-lg border border-critical/30 bg-critical/10 px-3 py-2 text-xs text-critical">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
