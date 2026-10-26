import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { Room } from '../models/Room.js';
import { RoomOccupancyState } from '../models/RoomOccupancyState.js';
import { Camera } from '../models/Camera.js';
import { escapeRegex, toQueryString } from '../services/identityRules.js';
import { serializeRoomState } from '../services/occupancyService.js';
import { logger } from '../utils/logger.js';

/**
 * Room / monitored-zone management (Review 3).
 *
 * AUTHORIZATION POLICY — the same shape Review 2 used for people:
 *   Reads require requireAuth only, so any signed-in operator can see the
 *   rooms and their current occupancy.
 *   Every MUTATION additionally requires requireRole('admin'). Creating,
 *   editing and deleting a room is an administrative act: a room's capacity
 *   and threshold decide when a capacity alert fires and (in the later Review
 *   3 features) when a device is switched, so an operator must not be able to
 *   change them.
 *
 * CAMERA VALIDATION: a `cameraIds` entry that does not resolve to a real
 * Camera record is REJECTED with the offending ids named. A room pointing at a
 * camera that does not exist would silently never receive a report and would
 * sit at "Camera Unavailable" with no explanation.
 */

const cameraIdsSchema = z
  .array(z.string().min(1).max(40))
  .max(16, 'A room may reference at most 16 cameras')
  .optional()
  .default([]);

export const roomSchema = z.object({
  roomId: z.string().min(1, 'Room ID is required').max(40),
  name: z.string().min(1, 'Name is required').max(80),
  description: z.string().max(300).optional().default(''),
  cameraIds: cameraIdsSchema,
  // 0 means "capacity not configured" — capacity statuses are then skipped
  // rather than computed against a guess.
  capacity: z.number().int().min(0).max(100000).optional().default(0),
  occupancyThreshold: z.number().int().min(0).max(100000).optional().default(1),
  nearCapacityRatio: z.number().min(0).max(1).optional().default(0.8),
  monitoringEnabled: z.boolean().optional().default(true),
  active: z.boolean().optional().default(true),
});

export const roomUpdateSchema = roomSchema.partial();

/** Rejects camera ids that do not resolve to real Camera records. */
async function assertCamerasExist(cameraIds) {
  const ids = [...new Set((cameraIds || []).filter(Boolean))];
  if (ids.length === 0) return ids;

  const found = await Camera.find({ cameraId: { $in: ids } }).select('cameraId');
  const known = new Set(found.map((camera) => camera.cameraId));
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw ApiError.badRequest(
      `Unknown camera ${unknown.length === 1 ? 'ID' : 'IDs'}: ${unknown.join(', ')}. ` +
        'Add the camera under Cameras first, or remove it from this room.',
      { unknownCameraIds: unknown }
    );
  }
  return ids;
}

/** Attaches each room's current occupancy state in ONE bulk lookup. */
async function withCurrentState(rooms) {
  const states = await RoomOccupancyState.find({
    roomId: { $in: rooms.map((room) => room.roomId) },
  });
  const byRoom = new Map(states.map((state) => [state.roomId, state]));
  return rooms.map((room) => serializeRoomState(room, byRoom.get(room.roomId) ?? null));
}

export const listRooms = asyncHandler(async (req, res) => {
  // Every raw query value is coerced first: Express's extended query parser
  // turns `?search[$ne]=x` into an object, which would reach Mongo as an
  // operator and change which rooms the caller can read.
  const search = toQueryString(req.query.search);
  const activeParam = toQueryString(req.query.active);

  const filter = {};
  if (activeParam === 'false') filter.active = false;
  else if (activeParam === 'true') filter.active = true;
  if (search) {
    const pattern = new RegExp(escapeRegex(search), 'i');
    filter.$or = [{ roomId: pattern }, { name: pattern }];
  }

  const perPage = Math.min(Number(req.query.limit) || 50, 200);
  const page = Math.max(Number(req.query.page) || 1, 1);

  const [rooms, total] = await Promise.all([
    Room.find(filter).sort({ name: 1 }).skip((page - 1) * perPage).limit(perPage),
    Room.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: { items: await withCurrentState(rooms), total, page, perPage },
  });
});

/** Resolves a room by Mongo _id OR by its business `roomId`. */
async function findRoomOrThrow(id) {
  const byRoomId = await Room.findOne({ roomId: id });
  if (byRoomId) return byRoomId;
  if (/^[a-f\d]{24}$/i.test(String(id))) {
    const byObjectId = await Room.findById(id);
    if (byObjectId) return byObjectId;
  }
  throw ApiError.notFound('Room not found');
}

export const getRoom = asyncHandler(async (req, res) => {
  const room = await findRoomOrThrow(req.params.id);
  const state = await RoomOccupancyState.findOne({ roomId: room.roomId });
  res.json({ success: true, data: serializeRoomState(room, state) });
});

export const createRoom = asyncHandler(async (req, res) => {
  const exists = await Room.findOne({ roomId: req.body.roomId });
  if (exists) throw ApiError.conflict('A room with that ID already exists');

  const cameraIds = await assertCamerasExist(req.body.cameraIds);
  const room = await Room.create({ ...req.body, cameraIds });
  logger.info(`Room ${room.roomId} created (${cameraIds.length} camera(s))`);

  res.status(201).json({ success: true, data: serializeRoomState(room, null) });
});

export const updateRoom = asyncHandler(async (req, res) => {
  const room = await findRoomOrThrow(req.params.id);

  if (req.body.roomId && req.body.roomId !== room.roomId) {
    const clash = await Room.findOne({ roomId: req.body.roomId });
    if (clash) throw ApiError.conflict('A room with that ID already exists');
  }
  if (req.body.cameraIds) {
    req.body.cameraIds = await assertCamerasExist(req.body.cameraIds);
  }

  Object.assign(room, req.body);
  await room.save();

  const state = await RoomOccupancyState.findOne({ roomId: room.roomId });
  res.json({ success: true, data: serializeRoomState(room, state) });
});

/**
 * Delete or deactivate a room.
 *
 * `?deactivate=true` is a SOFT delete (active:false): the room stops being
 * monitored and stops appearing in the current-occupancy list, but its
 * history stays readable. A hard delete removes the room and its current-state
 * document; the occupancy HISTORY is deliberately left in place, because
 * deleting a room is a configuration change and should not silently destroy
 * recorded measurements.
 */
export const deleteRoom = asyncHandler(async (req, res) => {
  const room = await findRoomOrThrow(req.params.id);
  const deactivateOnly = String(req.query.deactivate || '').toLowerCase() === 'true';

  if (deactivateOnly) {
    room.active = false;
    room.monitoringEnabled = false;
    await room.save();
    res.json({
      success: true,
      data: { roomId: room.roomId, deactivated: true, room: serializeRoomState(room, null) },
    });
    return;
  }

  await room.deleteOne();
  await RoomOccupancyState.deleteOne({ roomId: room.roomId });
  logger.info(
    `Room ${room.roomId} deleted. Its occupancy history was RETAINED — delete it ` +
      'explicitly if that is intended.'
  );

  res.json({
    success: true,
    data: { roomId: room.roomId, deactivated: false, historyRetained: true },
  });
});
