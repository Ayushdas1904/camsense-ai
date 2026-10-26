import { useCallback, useEffect, useState } from 'react';
import {
  Zap,
  DoorOpen,
  Lightbulb,
  Fan,
  Cpu,
  Plus,
  Pencil,
  Trash2,
  Power,
  PowerOff,
  RotateCcw,
  PlayCircle,
  AlertTriangle,
  Activity,
} from 'lucide-react';
import {
  PageHeader,
  Card,
  CardHeader,
  CardBody,
  Button,
  Badge,
  Select,
  LoadingState,
  EmptyState,
  ErrorState,
  ConfirmDialog,
  useToast,
} from '@/components/ui';
import { RoomFormModal } from '@/components/RoomFormModal';
import { DeviceFormModal } from '@/components/DeviceFormModal';
import { AutomationRuleFormModal } from '@/components/AutomationRuleFormModal';
import { occupancyService, roomService } from '@/services/occupancyService';
import { deviceService } from '@/services/deviceService';
import { automationService } from '@/services/automationService';
import { energyService } from '@/services/energyService';
import { cameraService } from '@/services/cameraService';
import { useSocketEvent } from '@/hooks/useSocketEvent';
import { useAppSelector } from '@/hooks/redux';
import { SocketEvents } from '@/services/socket';
import { formatDateTime, timeAgo } from '@/utils/format';
import {
  automationDecisionLabel,
  automationDecisionTone,
  deviceStateLabel,
  deviceStateTone,
  formatDuration,
  isOccupancyUnknown,
  occupancyStatusTone,
  renderCount,
} from '@/utils/review3';
import type {
  AdapterHealth,
  AutomationEngineHealth,
  AutomationLog,
  AutomationRule,
  AutomationRuleInput,
  Camera,
  Device,
  DeviceInput,
  DeviceStatePayload,
  EnergySummary,
  Room,
  RoomInput,
  RoomStatusPayload,
  ViewStatus,
} from '@/types';

/**
 * ═══ OCCUPANCY & ENERGY (Review 3) ═══
 *
 * Every number, badge and label on this page comes from a documented backend
 * endpoint:
 *
 *   GET /api/occupancy/current    room counts, statuses, last successful update
 *   GET /api/rooms                room configuration (the admin panel)
 *   GET /api/devices              devices, reported vs desired state, overrides
 *   GET /api/devices/adapters     which adapters are actually implemented
 *   GET /api/automation/rules     rules + the engine's own health
 *   GET /api/automation/history   every decision, INCLUDING the skips
 *   GET /api/energy/summary       today's estimated consumption and savings
 *   GET /api/cameras              the real camera inventory, for the room form
 *
 * There is no random value, no hardcoded success metric and no placeholder
 * series anywhere below.
 *
 * ═══ THE FOUR HONESTY RULES THIS PAGE ENFORCES ═══
 *
 * 1. A ROOM WHOSE FIGURE IS NOT TRUSTWORTHY NEVER SHOWS 0. The backend sends
 *    `count: null` with a 'camera_unavailable' or 'stale' status; every count
 *    is rendered through renderCount(), which prints an em-dash for null. A 0
 *    would tell the operator a room full of people is empty.
 *
 * 2. EVERY SIMULATED DEVICE IS BADGED SIMULATED, and the adapter panel relays
 *    the backend's plain-language statement that only the simulation adapter
 *    is implemented. Nothing here claims physical hardware was switched.
 *
 * 3. A FAILED COMMAND IS SHOWN AS A FAILURE. `device:state` for a refused
 *    command carries `commandFailed: true` and the UNCHANGED reportedState, so
 *    the row is patched with that unchanged state and the failure is surfaced
 *    from `lastCommand.outcome`. The device is never redrawn as switched.
 *
 * 4. SAVINGS ARE SHOWN WITH THEIR BASELINE. The baseline description travels
 *    inside every energy response and is rendered next to the figure, the
 *    estimated/simulated labels are always visible, and a null savingsPercent
 *    renders as "not enough configuration" rather than 0%.
 *
 * RECONNECTION: the socket subscriptions are an optimisation, not the source of
 * truth. A reconnecting client RE-FETCHES everything from the REST API (see the
 * 'connect' subscription), because events that arrived while the socket was
 * down are gone and patching from a partial stream would leave the page
 * confidently wrong.
 */
export function EnergyPage() {
  const user = useAppSelector((s) => s.auth.user);
  const isAdmin = user?.role === 'admin';
  const toast = useToast();

  const [status, setStatus] = useState<ViewStatus>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);

  const [rooms, setRooms] = useState<Room[]>([]);
  const [statusLabels, setStatusLabels] = useState<Record<string, string>>({});
  const [allRooms, setAllRooms] = useState<Room[]>([]);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [adapters, setAdapters] = useState<AdapterHealth | null>(null);
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [engine, setEngine] = useState<AutomationEngineHealth | null>(null);
  const [activity, setActivity] = useState<AutomationLog[]>([]);
  const [energy, setEnergy] = useState<EnergySummary | null>(null);

  // Modal / mutation state.
  const [roomModalOpen, setRoomModalOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [roomFormError, setRoomFormError] = useState<string | null>(null);
  const [deletingRoom, setDeletingRoom] = useState<Room | null>(null);

  const [deviceModalOpen, setDeviceModalOpen] = useState(false);
  const [editingDevice, setEditingDevice] = useState<Device | null>(null);
  const [deviceFormError, setDeviceFormError] = useState<string | null>(null);
  const [deletingDevice, setDeletingDevice] = useState<Device | null>(null);

  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<AutomationRule | null>(null);
  const [ruleFormError, setRuleFormError] = useState<string | null>(null);
  const [deletingRule, setDeletingRule] = useState<AutomationRule | null>(null);

  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  /**
   * Loads every section from the REST API.
   *
   * Each area is settled independently (Promise.allSettled) so one failing
   * subsystem degrades to its own error state instead of blanking the page —
   * an operator who cannot read the energy figures should still be able to see
   * the room occupancy and switch a device.
   */
  const load = useCallback(async () => {
    setStatus('loading');
    setLoadError(null);
    const [
      currentRes,
      roomsRes,
      camerasRes,
      devicesRes,
      adaptersRes,
      rulesRes,
      activityRes,
      energyRes,
    ] = await Promise.allSettled([
      occupancyService.current(),
      roomService.list({ limit: 200 }),
      cameraService.list(),
      deviceService.list({ limit: 200 }),
      deviceService.adapters(),
      automationService.listRules({ limit: 100 }),
      automationService.history({ limit: 25 }),
      energyService.summary(),
    ]);

    if (currentRes.status === 'fulfilled') {
      setRooms(currentRes.value.items);
      setStatusLabels(currentRes.value.statusLabels ?? {});
    }
    if (roomsRes.status === 'fulfilled') setAllRooms(roomsRes.value.items);
    if (camerasRes.status === 'fulfilled') setCameras(camerasRes.value);
    if (devicesRes.status === 'fulfilled') setDevices(devicesRes.value.items);
    if (adaptersRes.status === 'fulfilled') setAdapters(adaptersRes.value);
    if (rulesRes.status === 'fulfilled') {
      setRules(rulesRes.value.items);
      setEngine(rulesRes.value.engine ?? null);
    }
    if (activityRes.status === 'fulfilled') setActivity(activityRes.value.items);
    if (energyRes.status === 'fulfilled') setEnergy(energyRes.value);

    // Only a total failure is a page-level error: if nothing could be read the
    // most likely cause is the backend being down, and a dozen identical
    // section errors would just be noise.
    const everythingFailed = [
      currentRes,
      roomsRes,
      devicesRes,
      rulesRes,
      energyRes,
    ].every((result) => result.status === 'rejected');

    if (everythingFailed) {
      const reason = currentRes.status === 'rejected' ? currentRes.reason : null;
      setLoadError(
        (reason as { message?: string } | null)?.message ??
          'Unable to reach the backend. Occupancy, devices, automation and energy are all unavailable.'
      );
      setStatus('error');
      return;
    }
    setStatus('success');
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // ── Realtime, as an optimisation over the REST state ───────────
  useSocketEvent<Room>(SocketEvents.OCCUPANCY_UPDATE, (room) => {
    setRooms((prev) => {
      const exists = prev.some((r) => r.roomId === room.roomId);
      return exists ? prev.map((r) => (r.roomId === room.roomId ? room : r)) : [...prev, room];
    });
  });

  useSocketEvent<RoomStatusPayload>(SocketEvents.ROOM_STATUS, (payload) => {
    // Patches only the fields this event actually carries. `count` is null for
    // an unavailable or stale room and is stored as null, not as 0.
    setRooms((prev) =>
      prev.map((room) =>
        room.roomId === payload.roomId
          ? {
              ...room,
              status: payload.status,
              statusLabel: payload.statusLabel,
              count: payload.count,
              available: payload.available,
            }
          : room
      )
    );
  });

  useSocketEvent<DeviceStatePayload>(SocketEvents.DEVICE_STATE, (device) => {
    // A failed command arrives here too, carrying commandFailed: true and the
    // UNCHANGED reportedState. Replacing the row with this payload is therefore
    // still correct — it does not redraw the device as switched — and
    // lastCommand.outcome === 'failed' is what the row renders.
    setDevices((prev) =>
      prev.map((d) => (d.deviceId === device.deviceId ? { ...d, ...device } : d))
    );
  });

  useSocketEvent<AutomationLog>(SocketEvents.AUTOMATION_ACTION, (log) => {
    setActivity((prev) => [log, ...prev.filter((row) => row.id !== log.id)].slice(0, 25));
  });

  /**
   * Socket.IO's own reconnect event. A client that was disconnected missed
   * every event in the gap, so it re-reads the authoritative REST state rather
   * than carrying on from a stale snapshot.
   */
  useSocketEvent<unknown>('connect', () => {
    load();
  });

  // ── Room mutations (admin only) ────────────────────────────────
  async function submitRoom(input: RoomInput) {
    setSaving(true);
    setRoomFormError(null);
    try {
      if (editingRoom) {
        await roomService.update(editingRoom.roomId, input);
        toast.success(`Room ${input.name} updated.`);
      } else {
        await roomService.create(input);
        toast.success(`Room ${input.name} created.`);
      }
      setRoomModalOpen(false);
      setEditingRoom(null);
      await load();
    } catch (err) {
      setRoomFormError((err as { message?: string }).message ?? 'Could not save this room.');
    } finally {
      setSaving(false);
    }
  }

  async function confirmDeleteRoom() {
    if (!deletingRoom) return;
    setSaving(true);
    try {
      await roomService.remove(deletingRoom.roomId);
      toast.success(
        `Room ${deletingRoom.name} deleted. Its occupancy history was retained.`
      );
      setDeletingRoom(null);
      await load();
    } catch (err) {
      toast.error((err as { message?: string }).message ?? 'Could not delete this room.');
    } finally {
      setSaving(false);
    }
  }

  // ── Device mutations (admin only) ──────────────────────────────
  async function submitDevice(input: DeviceInput) {
    setSaving(true);
    setDeviceFormError(null);
    try {
      if (editingDevice) {
        await deviceService.update(editingDevice.deviceId, input);
        toast.success(`Device ${input.name} updated.`);
      } else {
        await deviceService.create(input);
        toast.success(`Device ${input.name} registered.`);
      }
      setDeviceModalOpen(false);
      setEditingDevice(null);
      await load();
    } catch (err) {
      setDeviceFormError((err as { message?: string }).message ?? 'Could not save this device.');
    } finally {
      setSaving(false);
    }
  }

  async function confirmDeleteDevice() {
    if (!deletingDevice) return;
    setSaving(true);
    try {
      await deviceService.remove(deletingDevice.deviceId);
      toast.success(
        `Device ${deletingDevice.name} deleted. Its state history was retained so past energy ` +
          'figures stay reproducible.'
      );
      setDeletingDevice(null);
      await load();
    } catch (err) {
      toast.error((err as { message?: string }).message ?? 'Could not delete this device.');
    } finally {
      setSaving(false);
    }
  }

  async function sendCommand(device: Device, state: 'on' | 'off', override: boolean) {
    setBusyId(device.deviceId);
    try {
      const result = await deviceService.command(device.deviceId, { state, override });
      setDevices((prev) =>
        prev.map((d) => (d.deviceId === device.deviceId ? result.device : d))
      );
      toast.success(
        `${device.name}: ${result.message}` +
          (override && result.override?.expiresAt
            ? ` Override holds until ${formatDateTime(result.override.expiresAt)}.`
            : '')
      );
    } catch (err) {
      // HTTP 502 from the backend: the adapter did not confirm, so the device
      // state was left exactly as it was. Reported as a failure, never as a
      // change.
      toast.error(
        (err as { message?: string }).message ??
          `${device.name} did not confirm the command. Its state is unchanged.`
      );
      // Re-read the device so the row shows the recorded failure outcome.
      try {
        const fresh = await deviceService.get(device.deviceId);
        setDevices((prev) => prev.map((d) => (d.deviceId === fresh.deviceId ? fresh : d)));
      } catch {
        // Nothing more to do; the toast already told the operator.
      }
    } finally {
      setBusyId(null);
    }
  }

  async function changeControlMode(device: Device, mode: Device['controlMode']) {
    setBusyId(device.deviceId);
    try {
      const updated = await deviceService.setControlMode(device.deviceId, mode);
      setDevices((prev) => prev.map((d) => (d.deviceId === updated.deviceId ? updated : d)));
      toast.success(`${device.name} control mode set to ${mode}.`);
    } catch (err) {
      toast.error((err as { message?: string }).message ?? 'Could not change the control mode.');
    } finally {
      setBusyId(null);
    }
  }

  async function clearOverride(device: Device) {
    setBusyId(device.deviceId);
    try {
      const result = await deviceService.clearOverride(device.deviceId);
      setDevices((prev) =>
        prev.map((d) => (d.deviceId === result.device.deviceId ? result.device : d))
      );
      toast.info(result.note);
    } catch (err) {
      toast.error((err as { message?: string }).message ?? 'Could not clear the override.');
    } finally {
      setBusyId(null);
    }
  }

  // ── Automation mutations (admin only) ──────────────────────────
  async function submitRule(input: AutomationRuleInput) {
    setSaving(true);
    setRuleFormError(null);
    try {
      if (editingRule) {
        await automationService.updateRule(editingRule.ruleId, input);
        toast.success(`Rule ${input.name} updated.`);
      } else {
        const created = await automationService.createRule(input);
        toast.success(created.note ?? `Rule ${input.name} created (disabled).`);
      }
      setRuleModalOpen(false);
      setEditingRule(null);
      await load();
    } catch (err) {
      setRuleFormError((err as { message?: string }).message ?? 'Could not save this rule.');
    } finally {
      setSaving(false);
    }
  }

  async function confirmDeleteRule() {
    if (!deletingRule) return;
    setSaving(true);
    try {
      await automationService.removeRule(deletingRule.ruleId);
      toast.success(
        `Rule ${deletingRule.name} deleted. Its execution history was retained so past ` +
          'decisions stay auditable.'
      );
      setDeletingRule(null);
      await load();
    } catch (err) {
      toast.error((err as { message?: string }).message ?? 'Could not delete this rule.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleRule(rule: AutomationRule) {
    setBusyId(rule.ruleId);
    try {
      const updated = rule.enabled
        ? await automationService.disableRule(rule.ruleId)
        : await automationService.enableRule(rule.ruleId);
      setRules((prev) => prev.map((r) => (r.ruleId === updated.ruleId ? updated : r)));
      // The backend's own note: it reports how many of the rule's devices are
      // actually in automatic mode, so an operator finds out here rather than
      // from a dashboard that silently does nothing.
      if (updated.note) toast.info(updated.note);
      else toast.success(`Rule ${rule.name} ${updated.enabled ? 'enabled' : 'disabled'}.`);
    } catch (err) {
      toast.error((err as { message?: string }).message ?? 'Could not change this rule.');
    } finally {
      setBusyId(null);
    }
  }

  async function evaluateRule(rule: AutomationRule) {
    setBusyId(rule.ruleId);
    try {
      await automationService.evaluateRule(rule.ruleId);
      const refreshed = await automationService.history({ limit: 25 });
      setActivity(refreshed.items);
      setEngine(refreshed.engine ?? null);
      toast.info(
        'Evaluated now. Every decision, including any skip, was written to the activity log below.'
      );
    } catch (err) {
      toast.error((err as { message?: string }).message ?? 'Could not evaluate this rule.');
    } finally {
      setBusyId(null);
    }
  }

  if (status === 'loading') return <LoadingState message="Loading occupancy and energy…" />;
  if (status === 'error') {
    return <ErrorState message={loadError ?? undefined} onRetry={load} />;
  }

  const simulatedDevices = devices.filter((device) => device.simulated).length;

  return (
    <div>
      <PageHeader
        title="Occupancy & Energy"
        description="Room occupancy from the detection pipeline, device control, and occupancy-driven energy optimization."
        action={
          <div className="flex flex-wrap items-center gap-2">
            {simulatedDevices > 0 && (
              <Badge tone="warning">
                {simulatedDevices} SIMULATED DEVICE{simulatedDevices === 1 ? '' : 'S'}
              </Badge>
            )}
            <Button variant="secondary" size="sm" leftIcon={<RotateCcw className="h-4 w-4" />} onClick={load}>
              Refresh
            </Button>
          </div>
        }
      />

      {/* ── (e) Energy summary, first because it is the headline ── */}
      <EnergySummaryStrip energy={energy} />

      {/* ── (a) Room occupancy ──────────────────────────────────── */}
      <Card className="mt-6">
        <CardHeader
          title="Room Occupancy"
          description="Distinct people counted by the detection pipeline, not a sum of per-frame detections."
          action={
            isAdmin ? (
              <Button
                size="sm"
                leftIcon={<Plus className="h-4 w-4" />}
                onClick={() => {
                  setEditingRoom(null);
                  setRoomFormError(null);
                  setRoomModalOpen(true);
                }}
              >
                Add room
              </Button>
            ) : undefined
          }
        />
        <CardBody>
          {rooms.length === 0 ? (
            <EmptyState
              icon={<DoorOpen className="h-6 w-6" />}
              title="No monitored rooms"
              description={
                isAdmin
                  ? 'Add a room and assign one or more cameras to it. Occupancy is then derived from those cameras’ human detections.'
                  : 'No rooms have been configured yet. An administrator can add one.'
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {rooms.map((room) => (
                <RoomOccupancyCard
                  key={room.roomId}
                  room={room}
                  statusLabels={statusLabels}
                  isAdmin={isAdmin}
                  onEdit={() => {
                    setEditingRoom(room);
                    setRoomFormError(null);
                    setRoomModalOpen(true);
                  }}
                  onDelete={() => setDeletingRoom(room)}
                />
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* ── (b) Rooms admin panel ───────────────────────────────── */}
      {isAdmin && allRooms.some((room) => !room.active) && (
        <Card className="mt-6">
          <CardHeader
            title="Deactivated Rooms"
            description="Not monitored and excluded from the occupancy list. Their history is retained."
          />
          <CardBody className="space-y-2">
            {allRooms
              .filter((room) => !room.active)
              .map((room) => (
                <div
                  key={room.roomId}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2"
                >
                  <span className="flex-1 truncate text-sm text-content">
                    {room.name}{' '}
                    <span className="text-content-faint">({room.roomId})</span>
                  </span>
                  <Badge tone="neutral">Inactive</Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditingRoom(room);
                      setRoomFormError(null);
                      setRoomModalOpen(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                </div>
              ))}
          </CardBody>
        </Card>
      )}

      {/* ── (c) Devices ─────────────────────────────────────────── */}
      <Card className="mt-6">
        <CardHeader
          title="Devices"
          description="Reported vs desired state, control mode and manual override. Reported state only moves when the adapter confirms it."
          action={
            isAdmin ? (
              <Button
                size="sm"
                leftIcon={<Plus className="h-4 w-4" />}
                onClick={() => {
                  setEditingDevice(null);
                  setDeviceFormError(null);
                  setDeviceModalOpen(true);
                }}
              >
                Register device
              </Button>
            ) : undefined
          }
        />
        <CardBody>
          {adapters?.note && (
            <p className="mb-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
              <Cpu className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{adapters.note}</span>
            </p>
          )}

          {devices.length === 0 ? (
            <EmptyState
              icon={<Lightbulb className="h-6 w-6" />}
              title="No devices registered"
              description={
                isAdmin
                  ? 'Register a light or a fan, assign it to a room, and set its configured power rating so its energy can be estimated. `npm run seed:devices` creates two clearly labelled simulated devices for a demonstration.'
                  : 'No devices have been registered yet. An administrator can register one.'
              }
            />
          ) : (
            <div className="space-y-3">
              {devices.map((device) => (
                <DeviceRow
                  key={device.deviceId}
                  device={device}
                  roomName={
                    allRooms.find((room) => room.roomId === device.roomId)?.name ?? device.roomId
                  }
                  isAdmin={isAdmin}
                  busy={busyId === device.deviceId}
                  onCommand={sendCommand}
                  onControlMode={changeControlMode}
                  onClearOverride={clearOverride}
                  onEdit={() => {
                    setEditingDevice(device);
                    setDeviceFormError(null);
                    setDeviceModalOpen(true);
                  }}
                  onDelete={() => setDeletingDevice(device)}
                />
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* ── (d) Automation rules + activity ─────────────────────── */}
      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Automation Rules"
            description="A rule only acts when it is enabled AND the device is in automatic control mode."
            action={
              isAdmin ? (
                <Button
                  size="sm"
                  leftIcon={<Plus className="h-4 w-4" />}
                  onClick={() => {
                    setEditingRule(null);
                    setRuleFormError(null);
                    setRuleModalOpen(true);
                  }}
                >
                  Add rule
                </Button>
              ) : undefined
            }
          />
          <CardBody>
            {engine && (
              <p className="mb-4 rounded-lg border border-border bg-raised px-3 py-2 text-xs text-content-muted">
                Engine {engine.running ? 'running' : 'NOT running'}, tick every{' '}
                {engine.tickIntervalSec}s
                {engine.lastTickAt ? `, last tick ${timeAgo(engine.lastTickAt)}` : ', no tick yet'}.
                {engine.lastError && (
                  <span className="mt-1 block text-critical">
                    Last error: {engine.lastError}
                  </span>
                )}
              </p>
            )}

            {rules.length === 0 ? (
              <EmptyState
                icon={<Zap className="h-6 w-6" />}
                title="No automation rules"
                description={
                  isAdmin
                    ? 'Add a rule to switch a room’s devices with its occupancy. A new rule is created disabled, so nothing changes until you enable it.'
                    : 'No automation rules have been configured yet.'
                }
              />
            ) : (
              <div className="space-y-3">
                {rules.map((rule) => (
                  <RuleRow
                    key={rule.ruleId}
                    rule={rule}
                    roomName={
                      allRooms.find((room) => room.roomId === rule.roomId)?.name ?? rule.roomId
                    }
                    isAdmin={isAdmin}
                    busy={busyId === rule.ruleId}
                    onToggle={() => toggleRule(rule)}
                    onEvaluate={() => evaluateRule(rule)}
                    onEdit={() => {
                      setEditingRule(rule);
                      setRuleFormError(null);
                      setRuleModalOpen(true);
                    }}
                    onDelete={() => setDeletingRule(rule)}
                  />
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        <AutomationActivityPanel activity={activity} />
      </div>

      {/* ── Modals and confirmations ────────────────────────────── */}
      <RoomFormModal
        open={roomModalOpen}
        room={editingRoom}
        cameras={cameras}
        saving={saving}
        error={roomFormError}
        onSubmit={submitRoom}
        onClose={() => {
          setRoomModalOpen(false);
          setEditingRoom(null);
        }}
      />
      <ConfirmDialog
        open={!!deletingRoom}
        title="Delete room?"
        message={
          deletingRoom
            ? `Delete “${deletingRoom.name}” (${deletingRoom.roomId})? Its recorded occupancy history is retained, but the room will stop being monitored and any automation rule watching it will no longer run.`
            : ''
        }
        confirmLabel="Delete room"
        danger
        loading={saving}
        onConfirm={confirmDeleteRoom}
        onCancel={() => setDeletingRoom(null)}
      />

      <DeviceFormModal
        open={deviceModalOpen}
        device={editingDevice}
        rooms={allRooms.filter((room) => room.active)}
        adapters={adapters}
        saving={saving}
        error={deviceFormError}
        onSubmit={submitDevice}
        onClose={() => {
          setDeviceModalOpen(false);
          setEditingDevice(null);
        }}
      />
      <ConfirmDialog
        open={!!deletingDevice}
        title="Delete device?"
        message={
          deletingDevice
            ? `Delete “${deletingDevice.name}” (${deletingDevice.deviceId})? It will be removed from every automation rule. Its state history is deliberately retained so past energy figures stay reproducible.`
            : ''
        }
        confirmLabel="Delete device"
        danger
        loading={saving}
        onConfirm={confirmDeleteDevice}
        onCancel={() => setDeletingDevice(null)}
      />

      <AutomationRuleFormModal
        open={ruleModalOpen}
        rule={editingRule}
        rooms={allRooms.filter((room) => room.active)}
        devices={devices}
        saving={saving}
        error={ruleFormError}
        onSubmit={submitRule}
        onClose={() => {
          setRuleModalOpen(false);
          setEditingRule(null);
        }}
      />
      <ConfirmDialog
        open={!!deletingRule}
        title="Delete automation rule?"
        message={
          deletingRule
            ? `Delete “${deletingRule.name}” (${deletingRule.ruleId})? No device will be switched as a result. Its execution history is retained so past automation decisions stay auditable.`
            : ''
        }
        confirmLabel="Delete rule"
        danger
        loading={saving}
        onConfirm={confirmDeleteRule}
        onCancel={() => setDeletingRule(null)}
      />
    </div>
  );
}

/**
 * (e) Energy summary strip.
 *
 * The baseline description is rendered NEXT TO the savings figure, because a
 * saving quoted without its baseline is meaningless. The estimated/simulated
 * labels are always visible, and a null savingsPercent renders as "not enough
 * configuration" rather than 0%.
 */
function EnergySummaryStrip({ energy }: { energy: EnergySummary | null }) {
  if (!energy) {
    return (
      <Card>
        <CardHeader title="Energy Today" description="Estimated from configured power ratings." />
        <CardBody>
          <ErrorState message="The energy figures could not be read. Occupancy and device control are unaffected." />
        </CardBody>
      </Card>
    );
  }

  const { totals, baseline, automation } = energy;

  return (
    <Card>
      <CardHeader
        title="Energy Today"
        description={`${energy.date} · estimated from configured power ratings, not measured`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="info">ESTIMATED</Badge>
            {energy.simulated && <Badge tone="warning">SIMULATED</Badge>}
            {energy.window.partialDay && <Badge tone="neutral">Day in progress</Badge>}
          </div>
        }
      />
      <CardBody>
        {energy.insufficientData ? (
          <EmptyState
            icon={<Zap className="h-6 w-6" />}
            title="Not enough data to estimate energy yet"
            description={
              energy.requires?.join(' · ') ??
              'No confirmed device state has been recorded for this window.'
            }
          />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Figure label="Estimated consumed" value={`${totals.energyKwh} kWh`} />
              <Figure
                label="Estimated saved vs baseline"
                value={`${totals.savedKwh} kWh`}
                tone="safe"
              />
              <Figure
                label="Estimated savings"
                // NULL means the baseline is 0 and no percentage is meaningful.
                value={
                  totals.savingsPercent === null
                    ? 'Not enough configuration'
                    : `${totals.savingsPercent}%`
                }
                small={totals.savingsPercent === null}
              />
              <Figure
                label="Devices behind these figures"
                value={`${totals.contributingDevices} of ${totals.devices}`}
                sub={
                  totals.devicesWithoutData > 0
                    ? `${totals.devicesWithoutData} excluded for want of data or a power rating`
                    : undefined
                }
              />
            </div>

            <p className="mt-4 rounded-lg border border-border bg-raised px-3 py-2 text-xs text-content-muted">
              <strong>Baseline ({baseline.source}):</strong> {baseline.description}
            </p>

            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <Badge tone="safe">{automation.switchedOff} automated switch-off(s)</Badge>
              <Badge tone="safe">{automation.switchedOn} automated switch-on(s)</Badge>
              <Badge tone={automation.skippedStaleData > 0 ? 'warning' : 'neutral'}>
                {automation.skippedStaleData} skipped — occupancy unusable
              </Badge>
              <Badge tone={automation.failures > 0 ? 'critical' : 'neutral'}>
                {automation.failures} failed command(s)
              </Badge>
            </div>
            {automation.skippedStaleData > 0 && (
              <p className="mt-2 text-xs text-content-faint">
                Automation deliberately did nothing on {automation.skippedStaleData} evaluation(s)
                because it could not trust the occupancy figure, so today&apos;s savings cover less
                time than the day itself.
              </p>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}

function Figure({
  label,
  value,
  sub,
  tone,
  small = false,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'safe' | 'warning' | 'critical';
  small?: boolean;
}) {
  const color =
    tone === 'safe'
      ? 'text-safe'
      : tone === 'warning'
        ? 'text-warning'
        : tone === 'critical'
          ? 'text-critical'
          : 'text-content';
  return (
    <div>
      <p className="text-xs text-content-muted">{label}</p>
      <p className={`mt-1.5 font-semibold ${small ? 'text-sm' : 'text-2xl'} ${color}`}>{value}</p>
      {sub && <p className="mt-1 text-[11px] text-content-faint">{sub}</p>}
    </div>
  );
}

/**
 * (a) One room's current occupancy.
 *
 * A stale or unavailable room renders its status and an em-dash. There is no
 * code path here that can print 0 for a room whose figure is unknown: the
 * count goes through renderCount(), and the capacity bar is suppressed
 * entirely when the count is null so an empty bar cannot imply emptiness.
 */
function RoomOccupancyCard({
  room,
  statusLabels,
  isAdmin,
  onEdit,
  onDelete,
}: {
  room: Room;
  statusLabels: Record<string, string>;
  isAdmin: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const unknown = isOccupancyUnknown(room.status) || room.count === null;
  // The backend's wording, from the payload. No local label map.
  const label = room.statusLabel || statusLabels[room.status] || room.status;

  return (
    <div className="rounded-xl border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-content">{room.name}</p>
          <p className="truncate text-xs text-content-faint">
            {room.roomId}
            {room.cameraIds.length > 0 && ` · ${room.cameraIds.length} camera(s)`}
          </p>
        </div>
        <Badge tone={occupancyStatusTone(room.status)}>{label}</Badge>
      </div>

      <div className="mt-4 flex items-end gap-2">
        <span
          className={`text-3xl font-semibold ${unknown ? 'text-content-faint' : 'text-content'}`}
        >
          {renderCount(room.count)}
        </span>
        <span className="pb-1 text-xs text-content-muted">
          {room.capacity > 0 ? `of ${room.capacity} capacity` : 'capacity not configured'}
        </span>
      </div>

      {unknown ? (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-warning">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            No usable figure. This is <strong>not</strong> a count of zero — the camera could not
            be read or the last reading is older than {room.staleAfterSec}s.
          </span>
        </p>
      ) : (
        room.capacity > 0 && (
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-raised">
            <div
              className={`h-full rounded-full ${
                room.status === 'capacity_exceeded'
                  ? 'bg-critical'
                  : room.status === 'near_capacity'
                    ? 'bg-warning'
                    : 'bg-info'
              }`}
              style={{
                width: `${Math.min(100, Math.round(((room.count ?? 0) / room.capacity) * 100))}%`,
              }}
            />
          </div>
        )
      )}

      <dl className="mt-3 space-y-1 text-xs">
        <div className="flex justify-between gap-2">
          <dt className="text-content-faint">Last successful update</dt>
          <dd className="text-content-muted">
            {room.lastUpdatedAt ? timeAgo(room.lastUpdatedAt) : 'never'}
          </dd>
        </div>
        {room.lastUpdatedAt && (
          <div className="flex justify-between gap-2">
            <dt className="text-content-faint">Measured at</dt>
            <dd className="text-content-muted">{formatDateTime(room.lastUpdatedAt)}</dd>
          </div>
        )}
        <div className="flex justify-between gap-2">
          <dt className="text-content-faint">Monitoring</dt>
          <dd className="text-content-muted">{room.monitoringEnabled ? 'enabled' : 'disabled'}</dd>
        </div>
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {room.source === 'demo' && <Badge tone="warning">DEMO SOURCE</Badge>}
        {isAdmin && (
          <>
            <Button variant="ghost" size="sm" onClick={onEdit} aria-label={`Edit ${room.name}`}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onDelete}
              aria-label={`Delete ${room.name}`}
            >
              <Trash2 className="h-4 w-4 text-critical" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * (c) One device row.
 *
 * A SIMULATED badge is unconditional wherever the device is simulated, the
 * reported state is distinguished from the desired state, and the last command
 * is shown with its OUTCOME — a failure reads as a failure, not as a change.
 */
function DeviceRow({
  device,
  roomName,
  isAdmin,
  busy,
  onCommand,
  onControlMode,
  onClearOverride,
  onEdit,
  onDelete,
}: {
  device: Device;
  roomName: string;
  isAdmin: boolean;
  busy: boolean;
  onCommand: (device: Device, state: 'on' | 'off', override: boolean) => void;
  onControlMode: (device: Device, mode: Device['controlMode']) => void;
  onClearOverride: (device: Device) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const failed = device.lastCommand?.outcome === 'failed';
  const Icon = device.type === 'fan' ? Fan : Lightbulb;

  return (
    <div className="rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="rounded-lg bg-raised p-2 text-content-muted">
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-content">{device.name}</p>
            <p className="truncate text-xs text-content-faint">
              {device.deviceId} · {roomName} · {device.type}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Mandatory, wherever a simulated device appears. */}
          {device.simulated && <Badge tone="warning">SIMULATED</Badge>}
          {!device.adapterImplemented && (
            <Badge tone="critical">ADAPTER NOT IMPLEMENTED</Badge>
          )}
          <Badge tone={deviceStateTone(device.reportedState)}>
            Reported {deviceStateLabel(device.reportedState)}
          </Badge>
          {device.desiredState && device.desiredState !== device.reportedState && (
            <Badge tone="neutral">Desired {device.desiredState.toUpperCase()}</Badge>
          )}
          <Badge tone={device.controlMode === 'automatic' ? 'info' : 'neutral'}>
            {device.controlMode}
          </Badge>
          {!device.powerRatingConfigured && (
            <Badge tone="neutral">No power rating</Badge>
          )}
        </div>
      </div>

      {device.reportedState === 'unknown' && (
        <p className="mt-3 text-xs text-content-faint">
          No adapter has ever confirmed a state for this device. “Unknown” is the honest value —
          it is not the same as off.
        </p>
      )}

      {device.override.active && (
        <p className="mt-3 rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-xs text-info">
          Manual override active: held at{' '}
          <strong>{device.override.state?.toUpperCase()}</strong> for another{' '}
          {formatDuration(device.override.remainingSec)}
          {device.override.expiresAt && ` (until ${formatDateTime(device.override.expiresAt)})`}.
          Automation records “skipped — manual override active” and issues no command until then.
        </p>
      )}

      {device.lastCommand?.issuedAt && (
        <p
          className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
            failed
              ? 'border-critical/30 bg-critical/10 text-critical'
              : 'border-border bg-raised text-content-muted'
          }`}
        >
          Last command: {device.lastCommand.state?.toUpperCase() ?? '—'} ·{' '}
          {formatDateTime(device.lastCommand.issuedAt)} ·{' '}
          <strong>{device.lastCommand.outcome ?? 'unknown outcome'}</strong>
          {failed && ' — the device state was left unchanged.'}
          {device.lastCommand.message && <span className="block">{device.lastCommand.message}</span>}
        </p>
      )}

      {isAdmin ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            loading={busy}
            leftIcon={<Power className="h-4 w-4" />}
            onClick={() => onCommand(device, 'on', true)}
          >
            Turn on
          </Button>
          <Button
            variant="secondary"
            size="sm"
            loading={busy}
            leftIcon={<PowerOff className="h-4 w-4" />}
            onClick={() => onCommand(device, 'off', true)}
          >
            Turn off
          </Button>
          {device.override.active && (
            <Button variant="ghost" size="sm" loading={busy} onClick={() => onClearOverride(device)}>
              Clear override
            </Button>
          )}
          <div className="w-44">
            <Select
              label="Control mode"
              name={`control-mode-${device.deviceId}`}
              value={device.controlMode}
              disabled={busy}
              onChange={(e) => onControlMode(device, e.target.value as Device['controlMode'])}
              options={[
                { value: 'disabled', label: 'Disabled' },
                { value: 'manual', label: 'Manual only' },
                { value: 'automatic', label: 'Automatic' },
              ]}
            />
          </div>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={onEdit} aria-label={`Edit ${device.name}`}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete} aria-label={`Delete ${device.name}`}>
            <Trash2 className="h-4 w-4 text-critical" />
          </Button>
        </div>
      ) : (
        <p className="mt-3 text-xs text-content-faint">
          Switching a device, changing its control mode and clearing an override all require the
          administrator role.
        </p>
      )}
    </div>
  );
}

/** (d) One automation rule, with its safety posture visible. */
function RuleRow({
  rule,
  roomName,
  isAdmin,
  busy,
  onToggle,
  onEvaluate,
  onEdit,
  onDelete,
}: {
  rule: AutomationRule;
  roomName: string;
  isAdmin: boolean;
  busy: boolean;
  onToggle: () => void;
  onEvaluate: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-content">{rule.name}</p>
          <p className="truncate text-xs text-content-faint">
            {rule.ruleId} · {roomName} · {rule.deviceIds.length} device(s)
          </p>
        </div>
        <Badge tone={rule.enabled ? 'safe' : 'neutral'}>
          {rule.enabled ? 'Enabled' : 'Disabled'}
        </Badge>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <div className="flex justify-between gap-2">
          <dt className="text-content-faint">Switch on above</dt>
          <dd className="text-content-muted">{rule.occupancyThreshold}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-content-faint">Unoccupied for</dt>
          <dd className="text-content-muted">{formatDuration(rule.unoccupiedForSec)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-content-faint">Command cooldown</dt>
          <dd className="text-content-muted">{formatDuration(rule.commandCooldownSec)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-content-faint">Allowed hours</dt>
          <dd className="text-content-muted">
            {rule.allowedHours.start && rule.allowedHours.end
              ? `${rule.allowedHours.start}–${rule.allowedHours.end}`
              : 'always'}
          </dd>
        </div>
      </dl>

      {/* The backend's own prose about the fail-safe. */}
      <p className="mt-3 rounded-lg border border-border bg-raised px-3 py-2 text-xs text-content-muted">
        {rule.unavailableDataBehaviour}
      </p>

      {isAdmin && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            variant={rule.enabled ? 'secondary' : 'primary'}
            size="sm"
            loading={busy}
            onClick={onToggle}
          >
            {rule.enabled ? 'Disable' : 'Enable'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            loading={busy}
            leftIcon={<PlayCircle className="h-4 w-4" />}
            onClick={onEvaluate}
          >
            Evaluate now
          </Button>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={onEdit} aria-label={`Edit ${rule.name}`}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete} aria-label={`Delete ${rule.name}`}>
            <Trash2 className="h-4 w-4 text-critical" />
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * (d) Recent automation activity — INCLUDING THE SKIPPED DECISIONS.
 *
 * This is the point of the panel. A rule that refused to act because the
 * occupancy figure was stale is the most important row here: without it, a
 * suspended rule is indistinguishable from one that was never evaluated. Each
 * row shows the decision category, the engine's own human-readable reason, and
 * the occupancy figure the decision was made on — which is rendered as an
 * em-dash when it was null, never as 0.
 */
function AutomationActivityPanel({ activity }: { activity: AutomationLog[] }) {
  const skipped = activity.filter((row) => row.decision.startsWith('skipped_')).length;

  return (
    <Card>
      <CardHeader
        title="Automation Activity"
        description="Every evaluation, including the decisions that deliberately did nothing."
        action={
          skipped > 0 ? <Badge tone="warning">{skipped} skipped</Badge> : undefined
        }
      />
      <CardBody>
        {activity.length === 0 ? (
          <EmptyState
            icon={<Activity className="h-6 w-6" />}
            title="No automation decisions recorded yet"
            description="Enable a rule and set its devices to automatic control. Every evaluation after that — including the ones that skip — is recorded here."
          />
        ) : (
          <ul className="divide-y divide-border">
            {activity.map((row) => (
              <li key={row.id} className="py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={automationDecisionTone(row.decision)}>
                    {automationDecisionLabel[row.decision] ?? row.decision}
                  </Badge>
                  {row.deviceId && (
                    <span className="text-xs text-content-muted">{row.deviceId}</span>
                  )}
                  {row.roomId && (
                    <span className="text-xs text-content-faint">{row.roomId}</span>
                  )}
                  <span className="ml-auto text-xs text-content-faint">
                    {timeAgo(row.evaluatedAt)}
                  </span>
                </div>
                {/* The engine's own wording, rendered verbatim. */}
                <p className="mt-1 text-xs text-content-muted">{row.reason}</p>
                <p className="mt-0.5 text-[11px] text-content-faint">
                  Occupancy at decision time: {renderCount(row.occupancyCount)}
                  {row.occupancyStatus ? ` (${row.occupancyStatus.replace(/_/g, ' ')})` : ''} ·
                  outcome {row.outcome}
                  {row.adapterMessage ? ` · ${row.adapterMessage}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
