import { Room } from '../models/Room.js';
import { RoomOccupancyState } from '../models/RoomOccupancyState.js';
import { OccupancyReading } from '../models/Occupancy.js';
import { Camera } from '../models/Camera.js';
import { Alert } from '../models/Alert.js';
import { env } from '../config/env.js';
import { getOccupancyIndexState } from '../config/db.js';
import { emit, SocketEvents } from '../sockets/index.js';
import { logger } from '../utils/logger.js';
import { ApiError } from '../utils/ApiError.js';
import { onOccupancyUpdated } from './automationEngine.js';
import {
  aggregateRoomCount,
  deriveOccupancyStatus,
  isValidCount,
  normalizeHistoryPaging,
  parseDateRange,
  shouldPersistReading,
  shouldRaiseOccupancyAlert,
  OCCUPANCY_STATUS_LABELS,
} from './occupancyRules.js';

/**
 * Occupancy monitoring (Review 3).
 *
 * THE BACKEND IS THE TRUST BOUNDARY, exactly as it is for Review 2
 * recognition. The AI service reports a headcount; this service decides what
 * that means. It re-checks the camera against its own records, applies its own
 * staleness window and its own capacity rules, and stores only what it can
 * justify. There is deliberately NO client-facing write path — the only way a
 * figure becomes persisted state is POST /api/ai/occupancy, gated by the
 * `x-ai-secret` shared secret.
 *
 * THE RULE THE WHOLE FEATURE TURNS ON: an unavailable or stale figure is
 * stored and emitted with a count of **null**, never 0. A camera that cannot
 * be read is not an empty room, and conflating the two would both mislead the
 * operator and (in the later automation feature) switch the lights off on a
 * room full of people.
 */

/**
 * Per-camera reports, newest only, keyed by cameraId.
 *
 * In memory rather than in the database because it is a transient input, not a
 * record: the AI service re-reports every few seconds, so the cost of losing
 * this on restart is one report interval. Bounded by the number of configured
 * cameras.
 */
const latestByCamera = new Map();

/** Clears the in-memory per-camera cache (used by tests and by seeding). */
export function resetOccupancyCacheForTests() {
  latestByCamera.clear();
}

function perCameraFor(cameraIds, now) {
  return cameraIds.map((cameraId) => {
    const report = latestByCamera.get(cameraId);
    if (!report) {
      // Never reported: unknown, which is NOT the same as zero occupants.
      return { cameraId, count: null, available: false, reportedAt: null, ageSec: null };
    }
    const ageSec = (now - Number(report.reportedAt)) / 1000;
    // A per-camera report that has itself gone stale stops contributing, so a
    // camera that silently stopped reporting cannot keep a room looking busy
    // (or looking empty) on a figure nobody is updating.
    const fresh = ageSec <= env.occupancy.staleAfterSec;
    return {
      cameraId,
      count: report.count,
      available: Boolean(report.available) && fresh && isValidCount(report.count),
      reportedAt: new Date(report.reportedAt),
      ageSec,
      source: report.source,
    };
  });
}

/**
 * Ingests one occupancy report from the AI service.
 *
 * Validation, in order:
 *   1. `cameraId` is present and resolves to a REAL Camera record. An
 *      unknown camera id is rejected — the backend does not invent cameras
 *      from whatever the AI service happens to send.
 *   2. `count` is either null (explicitly "not measured") or a non-negative
 *      integer. A float, a negative number or a string is rejected rather
 *      than coerced.
 *   3. every ACTIVE room whose `cameraIds` contains this camera is updated.
 *      A camera belonging to no room is ACCEPTED and ignored — that is a
 *      normal configuration, not an error, so it is logged at debug level and
 *      the request still succeeds.
 *
 * @returns {{ accepted: boolean, rooms: number, persisted: number, alerts: number }}
 */
export async function ingestOccupancy(payload = {}) {
  const { cameraId, count = null, available = false, mode = 'demo' } = payload;

  if (!cameraId || typeof cameraId !== 'string') {
    throw ApiError.badRequest('cameraId is required');
  }
  if (count !== null && count !== undefined && !isValidCount(count)) {
    throw ApiError.badRequest('count must be null or a non-negative integer');
  }

  const camera = await Camera.findOne({ cameraId }).select('cameraId name mode');
  if (!camera) {
    // The trust boundary: the AI service does not get to name a camera this
    // backend has never heard of.
    throw ApiError.notFound(`Unknown camera: ${cameraId}`);
  }

  const now = Date.now();
  const normalizedCount = count === undefined ? null : count;
  latestByCamera.set(cameraId, {
    count: normalizedCount,
    // Availability is only believed when a usable count came with it.
    available: Boolean(available) && isValidCount(normalizedCount),
    reportedAt: now,
    source: camera.mode === 'real' && mode === 'real' ? 'real' : 'demo',
  });

  const rooms = await Room.find({ cameraIds: cameraId, active: true });
  if (rooms.length === 0) {
    logger.debug(
      `Occupancy report for ${cameraId} belongs to no active room — accepted and ignored.`
    );
    return { accepted: true, rooms: 0, persisted: 0, alerts: 0 };
  }

  // Occupancy WRITES require the verified unique indexes (see
  // config/db.js → ensureOccupancyIndexes). Without them, concurrent reports
  // can create two "current state" documents for one room. Refusing the write
  // is the honest failure mode and leaves every other feature running.
  const indexState = getOccupancyIndexState();
  if (!indexState.verified) {
    logger.warn(
      `Occupancy report for ${cameraId} NOT persisted: the occupancy indexes are ` +
        `unverified (${indexState.error || 'see startup log'}).`
    );
    return { accepted: true, rooms: rooms.length, persisted: 0, alerts: 0, blocked: true };
  }

  let persisted = 0;
  let alerts = 0;
  for (const room of rooms) {
    // One room's failure must not abandon the others in the same report.
    try {
      const result = await updateRoomState(room, now);
      if (result.persisted) persisted += 1;
      if (result.alerted) alerts += 1;
    } catch (err) {
      logger.warn(`Occupancy update failed for room ${room.roomId}: ${err.message}`);
    }
  }

  return { accepted: true, rooms: rooms.length, persisted, alerts };
}

/** Recomputes, stores and broadcasts one room's current occupancy. */
async function updateRoomState(room, now) {
  const perCamera = perCameraFor(room.cameraIds || [], now);
  const aggregate = aggregateRoomCount(perCamera);

  // The freshest per-camera measurement is what the staleness window is
  // measured against.
  const measuredAt = perCamera
    .filter((entry) => entry.available && entry.reportedAt)
    .reduce((latest, entry) => {
      const at = Number(entry.reportedAt);
      return at > latest ? at : latest;
    }, 0);

  const derived = deriveOccupancyStatus({
    count: aggregate.count,
    capacity: room.capacity,
    available: aggregate.available,
    lastUpdatedAt: measuredAt > 0 ? new Date(measuredAt) : null,
    now,
    staleAfterSec: env.occupancy.staleAfterSec,
    monitoringEnabled: room.monitoringEnabled !== false,
    nearCapacityRatio:
      typeof room.nearCapacityRatio === 'number'
        ? room.nearCapacityRatio
        : env.occupancy.nearCapacityRatio,
    occupancyThreshold: room.occupancyThreshold,
  });

  const previous = await RoomOccupancyState.findOne({ roomId: room.roomId });
  const source = perCamera.some((entry) => entry.source === 'real') ? 'real' : 'demo';

  const next = {
    // null, never 0, when the figure is not trustworthy — deriveOccupancyStatus
    // is the single place that decision is made.
    count: derived.count,
    capacity: room.capacity || 0,
    status: derived.status,
    available: derived.available,
    source,
    cameras: perCamera.map((entry) => ({
      cameraId: entry.cameraId,
      count: entry.count,
      available: entry.available,
      reportedAt: entry.reportedAt,
    })),
    // Only a SUCCESSFUL measurement moves this forward, so staleness keeps
    // ageing while unavailable reports continue to arrive.
    lastUpdatedAt: derived.available
      ? new Date(measuredAt || now)
      : previous?.lastUpdatedAt ?? null,
    lastReportAt: new Date(now),
    dataQuality: derived.reason,
  };

  const state = await RoomOccupancyState.findOneAndUpdate(
    { roomId: room.roomId },
    { $set: next, $setOnInsert: { roomId: room.roomId } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  // ── History: change-based + sampled, never once per report ──
  const lastReading = await OccupancyReading.findOne({ roomId: room.roomId })
    .sort({ timestamp: -1 })
    .select('count status available timestamp');

  const decision = shouldPersistReading({
    previous: lastReading
      ? {
          count: lastReading.count ?? null,
          status: lastReading.status,
          available: lastReading.available,
        }
      : null,
    next: { count: next.count, status: next.status, available: next.available },
    lastPersistedAt: lastReading?.timestamp ?? null,
    now,
    minIntervalSec: env.occupancy.minPersistIntervalSec,
  });

  let persistedReading = false;
  if (decision.persist) {
    await OccupancyReading.create({
      roomId: room.roomId,
      // One camera → record which one; several → the figure is an aggregate,
      // so no single camera owns it.
      cameraId: room.cameraIds?.length === 1 ? room.cameraIds[0] : null,
      count: next.count,
      capacity: next.capacity,
      status: next.status,
      available: next.available,
      source,
      trackedIds: (room.cameraIds || []).slice(),
      metadata: {
        perCamera: next.cameras,
        aggregation: aggregate.aggregation,
        reportedAt: new Date(now),
      },
      dataQuality: `${derived.reason}:${decision.reason}`,
      timestamp: new Date(now),
    });
    persistedReading = true;
  }

  // ── Alerts: only crowding conditions, and only on real evidence ──
  let alerted = false;
  const alertDecision = shouldRaiseOccupancyAlert({
    status: next.status,
    previousStatus: previous?.status ?? null,
    lastAlertAt: previous?.lastAlertAt ?? null,
    now,
    cooldownSec: env.occupancy.capacityAlertCooldownSec,
  });

  if (alertDecision.raise) {
    const message =
      next.status === 'capacity_exceeded'
        ? `${room.name} is over capacity (${next.count} of ${next.capacity})`
        : `${room.name} is near capacity (${next.count} of ${next.capacity})`;
    const alert = await Alert.create({
      type: next.status === 'capacity_exceeded' ? 'capacity_exceeded' : 'occupancy_warning',
      // 'warning', not 'critical': a crowded room is an operational condition,
      // not a weapon sighting.
      severity: alertDecision.severity,
      roomId: room.roomId,
      cameraId: room.cameraIds?.length === 1 ? room.cameraIds[0] : undefined,
      message,
      status: 'new',
      timestamp: new Date(now),
    });
    await RoomOccupancyState.updateOne(
      { roomId: room.roomId },
      { $set: { lastAlertAt: new Date(now) } }
    );
    emit(SocketEvents.ALERT_NEW, {
      id: alert._id.toString(),
      type: alert.type,
      severity: alert.severity,
      roomId: room.roomId,
      roomName: room.name,
      cameraId: alert.cameraId ?? null,
      message: alert.message,
      status: alert.status,
      timestamp: alert.timestamp,
    });
    alerted = true;
  }

  const serialized = serializeRoomState(room, state ?? next);
  emit(SocketEvents.OCCUPANCY_UPDATE, serialized);
  if ((previous?.status ?? null) !== next.status) {
    emit(SocketEvents.ROOM_STATUS, {
      roomId: room.roomId,
      roomName: room.name,
      previousStatus: previous?.status ?? null,
      status: next.status,
      statusLabel: OCCUPANCY_STATUS_LABELS[next.status],
      count: next.count,
      available: next.available,
      timestamp: new Date(now),
    });
  }

  // ── Hand off to the automation engine ───────────────────────
  // A DIRECT FUNCTION CALL, not a queue, a polling timer or a second process.
  // The engine re-derives the status itself (so it sees 'stale' rather than
  // the stored status) and swallows its own errors, so an automation fault can
  // never fail an occupancy ingest — losing the headcount because a light
  // would not switch would be the wrong trade.
  await onOccupancyUpdated(room.roomId);

  return { persisted: persistedReading, alerted };
}

/**
 * Client-facing shape of a room's current occupancy.
 *
 * `count` is null whenever the figure is not trustworthy, and `statusLabel`
 * carries the operator-facing wording, so no client has to re-derive either.
 */
export function serializeRoomState(room, state) {
  const status = state?.status ?? 'camera_unavailable';
  const available = Boolean(state?.available);
  return {
    roomId: room.roomId,
    name: room.name,
    description: room.description || '',
    cameraIds: room.cameraIds || [],
    capacity: room.capacity || 0,
    occupancyThreshold: room.occupancyThreshold ?? 1,
    nearCapacityRatio: room.nearCapacityRatio ?? env.occupancy.nearCapacityRatio,
    monitoringEnabled: room.monitoringEnabled !== false,
    active: room.active !== false,
    // NULL, not 0, when unavailable or stale.
    count: available ? state?.count ?? null : null,
    status,
    statusLabel: OCCUPANCY_STATUS_LABELS[status] ?? status,
    available,
    source: state?.source ?? null,
    cameras: state?.cameras ?? [],
    lastUpdatedAt: state?.lastUpdatedAt ?? null,
    lastReportAt: state?.lastReportAt ?? null,
    dataQuality: state?.dataQuality ?? 'no_data',
    staleAfterSec: env.occupancy.staleAfterSec,
  };
}

/**
 * Current occupancy for every active room.
 *
 * Bounded by the number of configured rooms, and re-derives the status at READ
 * time rather than trusting the stored one. That matters: a room whose camera
 * stopped reporting ten minutes ago has a stored status of "occupied" that was
 * true when it was written, and would still be served as current if it were
 * read back verbatim. Re-deriving turns it into 'stale' with a null count.
 */
export async function listCurrent() {
  const rooms = await Room.find({ active: true }).sort({ name: 1 });
  if (rooms.length === 0) return { items: [], total: 0 };

  const states = await RoomOccupancyState.find({
    roomId: { $in: rooms.map((room) => room.roomId) },
  });
  const stateByRoom = new Map(states.map((state) => [state.roomId, state]));
  const now = Date.now();

  const items = rooms.map((room) => {
    const stored = stateByRoom.get(room.roomId);
    const derived = deriveOccupancyStatus({
      count: stored?.count ?? null,
      capacity: room.capacity,
      available: Boolean(stored?.available),
      lastUpdatedAt: stored?.lastUpdatedAt ?? null,
      now,
      staleAfterSec: env.occupancy.staleAfterSec,
      monitoringEnabled: room.monitoringEnabled !== false,
      nearCapacityRatio:
        typeof room.nearCapacityRatio === 'number'
          ? room.nearCapacityRatio
          : env.occupancy.nearCapacityRatio,
      occupancyThreshold: room.occupancyThreshold,
    });

    return serializeRoomState(room, {
      count: derived.count,
      status: derived.status,
      available: derived.available,
      source: stored?.source ?? null,
      cameras: stored?.cameras ?? [],
      lastUpdatedAt: stored?.lastUpdatedAt ?? null,
      lastReportAt: stored?.lastReportAt ?? null,
      dataQuality: derived.reason,
    });
  });

  return { items, total: items.length };
}

/**
 * Paginated, date-filtered occupancy history.
 *
 * PAGINATION IS MANDATORY and the page size is hard-capped by
 * `env.occupancy.historyMaxLimit` — there is no code path here that can issue
 * an unbounded query, however the caller phrases the request. The date range is
 * parsed defensively, so `?from=banana` narrows nothing instead of reaching
 * Mongo as an operator object.
 */
export async function listHistory({ roomId, from, to, limit, page } = {}) {
  const paging = normalizeHistoryPaging({
    limit,
    page,
    maxLimit: env.occupancy.historyMaxLimit,
  });

  const filter = {};
  // Coerced, not trusted: `?roomId[$ne]=x` must not become a Mongo operator.
  if (typeof roomId === 'string' && roomId.trim() !== '') filter.roomId = roomId.trim();
  const range = parseDateRange({ from, to });
  if (range) filter.timestamp = range;

  const [records, total] = await Promise.all([
    OccupancyReading.find(filter)
      .sort({ timestamp: -1 })
      .skip(paging.skip)
      .limit(paging.perPage),
    OccupancyReading.countDocuments(filter),
  ]);

  // One bulk lookup for display names — never one query per row.
  const roomIds = [...new Set(records.map((record) => record.roomId))];
  const rooms = await Room.find({ roomId: { $in: roomIds } }).select('roomId name');
  const nameById = new Map(rooms.map((room) => [room.roomId, room.name]));

  return {
    items: records.map((record) => ({
      id: record._id.toString(),
      roomId: record.roomId,
      // Falls back to the raw id if the room was deleted, so history stays
      // readable.
      roomName: nameById.get(record.roomId) || record.roomId,
      cameraId: record.cameraId ?? null,
      // Null means "not measured", not "empty".
      count: record.count ?? null,
      capacity: record.capacity ?? 0,
      status: record.status,
      statusLabel: OCCUPANCY_STATUS_LABELS[record.status] ?? record.status,
      available: record.available,
      source: record.source,
      dataQuality: record.dataQuality,
      perCamera: record.metadata?.perCamera ?? [],
      aggregation: record.metadata?.aggregation ?? 'max',
      timestamp: record.timestamp,
    })),
    total,
    page: paging.page,
    perPage: paging.perPage,
    maxLimit: paging.maxLimit,
  };
}

/**
 * Room-level occupancy summary for the dashboard.
 *
 * Every figure is a real count over persisted state. Rooms whose figure is not
 * trustworthy are counted SEPARATELY as `unavailableRooms` rather than being
 * folded into `unoccupiedRooms`, so an outage can never be read as an empty
 * building. `totalOccupants` likewise sums only trustworthy counts and reports
 * how many rooms it could not include.
 */
export async function roomSummary() {
  const { items } = await listCurrent();

  const counted = items.filter((item) => item.available && isValidCount(item.count));
  const unavailable = items.filter((item) => !item.available);

  return {
    totalRooms: items.length,
    monitoredRooms: items.filter((item) => item.monitoringEnabled).length,
    occupiedRooms: items.filter(
      (item) =>
        item.status === 'occupied' ||
        item.status === 'near_capacity' ||
        item.status === 'capacity_exceeded'
    ).length,
    unoccupiedRooms: items.filter((item) => item.status === 'unoccupied').length,
    nearCapacityRooms: items.filter((item) => item.status === 'near_capacity').length,
    capacityExceededRooms: items.filter((item) => item.status === 'capacity_exceeded').length,
    // Deliberately its own bucket — not merged into unoccupiedRooms.
    unavailableRooms: unavailable.length,
    staleRooms: items.filter((item) => item.status === 'stale').length,
    // Sum of the counts that can be justified, plus how many rooms are missing
    // from it, so the number is never presented as a whole-building total it
    // is not.
    totalOccupants: counted.reduce((sum, item) => sum + item.count, 0),
    roomsWithoutData: items.length - counted.length,
    totalCapacity: items.reduce((sum, item) => sum + (item.capacity || 0), 0),
    rooms: items,
  };
}
