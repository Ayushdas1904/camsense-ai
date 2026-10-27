import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Modal, Input, Select, Button } from '@/components/ui';
import type {
  AutomationRule,
  AutomationRuleInput,
  AutomationUnavailablePolicy,
  Device,
  Room,
} from '@/types';

/**
 * Create/Edit automation rule form.
 *
 * ═══ THE SAFETY POSTURE THIS FORM HAS TO MAKE VISIBLE ═══
 *
 * A rule is created DISABLED. Nothing is evaluated until an administrator
 * enables it, and even then it only acts on devices whose control mode is
 * 'automatic'. The form says so rather than leaving the operator to discover
 * it from a dashboard that silently does nothing.
 *
 * `onUnavailableOccupancy` defaults to 'suspend', and the form explains what
 * each value does in full. Neither value ever switches a device on unusable
 * data — 'suspend' records 'skipped_stale_data' and issues no command, and
 * 'leave_as_is' also issues no command. There is deliberately no option that
 * treats a dark camera as an empty room, because absent data is not evidence
 * that nobody is there.
 *
 * Follows PersonFormModal: edit mode when `rule` is present, the parent owns
 * the API call, validation is an exported pure function.
 */
const HOUR_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const EMPTY: AutomationRuleInput = {
  ruleId: '',
  name: '',
  description: '',
  roomId: '',
  deviceIds: [],
  // Deliberately false. A rule that switched things on the moment it was
  // created would be the wrong behaviour to ship.
  enabled: false,
  occupancyThreshold: 1,
  unoccupiedForSec: 300,
  switchOffDelaySec: 0,
  switchOnDelaySec: 0,
  allowedHours: { start: '', end: '' },
  commandCooldownSec: 60,
  onUnavailableOccupancy: 'suspend',
  manualOverrideMinutes: 30,
};

type FieldErrors = Partial<
  Record<
    | 'ruleId'
    | 'name'
    | 'roomId'
    | 'deviceIds'
    | 'occupancyThreshold'
    | 'unoccupiedForSec'
    | 'allowedHours',
    string
  >
>;

export function validateAutomationRuleInput(form: AutomationRuleInput): FieldErrors {
  const errors: FieldErrors = {};

  const ruleId = form.ruleId.trim();
  if (!ruleId) {
    errors.ruleId = 'Rule ID is required.';
  } else if (ruleId.length > 40) {
    errors.ruleId = 'Rule ID must be 40 characters or fewer.';
  } else if (/\s/.test(ruleId)) {
    errors.ruleId = 'Rule ID cannot contain spaces.';
  }

  const name = form.name.trim();
  if (!name) {
    errors.name = 'Rule name is required.';
  } else if (name.length > 80) {
    errors.name = 'Name must be 80 characters or fewer.';
  }

  if (!form.roomId.trim()) errors.roomId = 'Choose the room this rule watches.';

  if (form.deviceIds.length === 0) {
    errors.deviceIds = 'Select at least one device, or the rule has nothing to switch.';
  } else if (form.deviceIds.length > 32) {
    errors.deviceIds = 'A rule may control at most 32 devices.';
  }

  if (!Number.isInteger(form.occupancyThreshold) || form.occupancyThreshold < 0) {
    errors.occupancyThreshold = 'Threshold must be a whole number of 0 or more.';
  }

  if (
    !Number.isInteger(form.unoccupiedForSec) ||
    form.unoccupiedForSec < 0 ||
    form.unoccupiedForSec > 86400
  ) {
    errors.unoccupiedForSec = 'Enter a whole number of seconds between 0 and 86400.';
  }

  const { start, end } = form.allowedHours;
  const startSet = start !== '';
  const endSet = end !== '';
  if (startSet !== endSet) {
    errors.allowedHours = 'Set both the start and the end, or leave both blank for “always”.';
  } else if (startSet && (!HOUR_PATTERN.test(start) || !HOUR_PATTERN.test(end))) {
    errors.allowedHours = 'Use 24-hour HH:MM, for example 08:00 and 20:00.';
  }

  return errors;
}

export function AutomationRuleFormModal({
  open,
  rule,
  rooms,
  devices,
  saving,
  error,
  onSubmit,
  onClose,
}: {
  open: boolean;
  rule?: AutomationRule | null;
  rooms: Room[];
  /** Real devices. The backend rejects a deviceId that does not resolve. */
  devices: Device[];
  saving: boolean;
  error?: string | null;
  onSubmit: (input: AutomationRuleInput) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<AutomationRuleInput>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});

  useEffect(() => {
    setErrors({});
    if (rule) {
      setForm({
        ruleId: rule.ruleId,
        name: rule.name,
        description: rule.description,
        roomId: rule.roomId,
        deviceIds: [...rule.deviceIds],
        enabled: rule.enabled,
        occupancyThreshold: rule.occupancyThreshold,
        unoccupiedForSec: rule.unoccupiedForSec,
        switchOffDelaySec: rule.switchOffDelaySec,
        switchOnDelaySec: rule.switchOnDelaySec,
        allowedHours: { ...rule.allowedHours },
        commandCooldownSec: rule.commandCooldownSec,
        onUnavailableOccupancy: rule.onUnavailableOccupancy,
        manualOverrideMinutes: rule.manualOverrideMinutes,
      });
    } else {
      setForm({ ...EMPTY, roomId: rooms[0]?.roomId ?? '' });
    }
  }, [rule, open, rooms]);

  const set = <K extends keyof AutomationRuleInput>(key: K, value: AutomationRuleInput[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => {
      const next = { ...e };
      delete next[key as keyof FieldErrors];
      return next;
    });
  };

  function toggleDevice(deviceId: string) {
    setForm((f) => ({
      ...f,
      deviceIds: f.deviceIds.includes(deviceId)
        ? f.deviceIds.filter((id) => id !== deviceId)
        : [...f.deviceIds, deviceId],
    }));
    setErrors((e) => {
      const next = { ...e };
      delete next.deviceIds;
      return next;
    });
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const found = validateAutomationRuleInput(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    onSubmit({
      ...form,
      ruleId: form.ruleId.trim(),
      name: form.name.trim(),
      description: (form.description ?? '').trim(),
      roomId: form.roomId.trim(),
    });
  }

  // Only devices in the selected room can usefully be controlled by the rule.
  const roomDevices = devices.filter((device) => device.roomId === form.roomId);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={rule ? 'Edit Automation Rule' : 'Add Automation Rule'}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSubmit} loading={saving} disabled={saving}>
            {rule ? 'Save changes' : 'Create rule (disabled)'}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Rule ID *"
            name="ruleId"
            placeholder="RULE-LAB-01"
            value={form.ruleId}
            onChange={(e) => set('ruleId', e.target.value)}
            error={errors.ruleId}
            disabled={!!rule}
            required
          />
          <Input
            label="Rule name *"
            name="name"
            placeholder="Lab lights follow occupancy"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            error={errors.name}
            required
          />
        </div>

        <Input
          label="Description (optional)"
          name="description"
          placeholder="Switch the lab lights and fan with occupancy during working hours"
          value={form.description ?? ''}
          onChange={(e) => set('description', e.target.value)}
        />

        {rooms.length === 0 ? (
          <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            No rooms are configured. Create a room first — a rule watches a room&apos;s occupancy,
            so it needs one to exist.
          </p>
        ) : (
          <Select
            label="Room this rule watches *"
            name="roomId"
            value={form.roomId}
            onChange={(e) => set('roomId', e.target.value)}
            options={rooms.map((room) => ({
              value: room.roomId,
              label: `${room.name} (${room.roomId})`,
            }))}
          />
        )}

        <div>
          <span className="mb-1.5 block text-xs font-medium text-content-muted">
            Devices this rule controls *
          </span>
          {roomDevices.length === 0 ? (
            <p className="rounded-lg border border-border bg-raised px-3 py-2 text-xs text-content-muted">
              No devices are registered in this room yet. Register a light or a fan under Devices
              first.
            </p>
          ) : (
            <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-lg border border-border p-2">
              {roomDevices.map((device) => (
                <label
                  key={device.deviceId}
                  htmlFor={`rule-device-${device.deviceId}`}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-content hover:bg-raised"
                >
                  <input
                    id={`rule-device-${device.deviceId}`}
                    name={`rule-device-${device.deviceId}`}
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded border-border"
                    checked={form.deviceIds.includes(device.deviceId)}
                    onChange={() => toggleDevice(device.deviceId)}
                  />
                  <span className="flex-1 truncate">
                    {device.name}{' '}
                    <span className="text-content-faint">
                      ({device.type}, {device.controlMode})
                    </span>
                  </span>
                  {device.simulated && (
                    <span className="rounded border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                      SIMULATED
                    </span>
                  )}
                </label>
              ))}
            </div>
          )}
          {errors.deviceIds && <p className="mt-1 text-xs text-critical">{errors.deviceIds}</p>}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Occupancy threshold (switch on above this count)"
            name="occupancyThreshold"
            type="number"
            min={0}
            value={form.occupancyThreshold}
            onChange={(e) => set('occupancyThreshold', Number(e.target.value))}
            error={errors.occupancyThreshold}
          />
          <Input
            label="Unoccupied for (seconds) before switching off"
            name="unoccupiedForSec"
            type="number"
            min={0}
            max={86400}
            value={form.unoccupiedForSec}
            onChange={(e) => set('unoccupiedForSec', Number(e.target.value))}
            error={errors.unoccupiedForSec}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Input
            label="Switch-on delay (s)"
            name="switchOnDelaySec"
            type="number"
            min={0}
            max={86400}
            value={form.switchOnDelaySec}
            onChange={(e) => set('switchOnDelaySec', Number(e.target.value))}
          />
          <Input
            label="Switch-off delay (s)"
            name="switchOffDelaySec"
            type="number"
            min={0}
            max={86400}
            value={form.switchOffDelaySec}
            onChange={(e) => set('switchOffDelaySec', Number(e.target.value))}
          />
          <Input
            label="Command cooldown (s)"
            name="commandCooldownSec"
            type="number"
            min={0}
            max={86400}
            value={form.commandCooldownSec}
            onChange={(e) => set('commandCooldownSec', Number(e.target.value))}
          />
        </div>
        <p className="text-xs text-content-faint">
          The cooldown, together with the “already in the desired state” check, is what stops a
          device being flapped on and off.
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Input
            label="Allowed from (HH:MM)"
            name="allowedHoursStart"
            placeholder="08:00"
            value={form.allowedHours.start}
            onChange={(e) => set('allowedHours', { ...form.allowedHours, start: e.target.value })}
          />
          <Input
            label="Allowed until (HH:MM)"
            name="allowedHoursEnd"
            placeholder="20:00"
            value={form.allowedHours.end}
            onChange={(e) => set('allowedHours', { ...form.allowedHours, end: e.target.value })}
          />
          <Input
            label="Manual override (minutes)"
            name="manualOverrideMinutes"
            type="number"
            min={1}
            max={1440}
            value={form.manualOverrideMinutes}
            onChange={(e) => set('manualOverrideMinutes', Number(e.target.value))}
          />
        </div>
        {errors.allowedHours && <p className="text-xs text-critical">{errors.allowedHours}</p>}
        <p className="text-xs text-content-faint">
          Leave both hour fields blank for “always allowed”. An end earlier than the start wraps
          past midnight. While a manual override is unexpired the rule records
          <em> skipped — manual override active</em> and issues no command, so an operator action
          is never immediately undone.
        </p>

        <Select
          label="When occupancy data is unavailable or stale"
          name="onUnavailableOccupancy"
          value={form.onUnavailableOccupancy}
          onChange={(e) =>
            set('onUnavailableOccupancy', e.target.value as AutomationUnavailablePolicy)
          }
          options={[
            { value: 'suspend', label: 'Suspend automatic switching (recommended)' },
            { value: 'leave_as_is', label: 'Leave devices as they are (explicit policy)' },
          ]}
        />
        <p className="rounded-lg border border-border bg-raised px-3 py-2 text-xs text-content-muted">
          Neither option ever switches a device on unusable data. Unavailable or stale occupancy is
          <strong> not</strong> evidence that a room is empty, so there is deliberately no setting
          that treats a dark camera as an unoccupied room. Every suspended evaluation is written
          to the automation history with its reason, so a suspended rule is never silent.
        </p>

        {!rule && (
          <p className="rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-xs text-info">
            The rule will be created <strong>disabled</strong>. Enable it, and set each device to
            Automatic control, before it can switch anything — two separate opt-ins.
          </p>
        )}

        {error && (
          <p className="rounded-lg border border-critical/30 bg-critical/10 px-3 py-2 text-xs text-critical">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
