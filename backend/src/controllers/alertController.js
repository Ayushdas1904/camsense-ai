import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { Alert } from '../models/Alert.js';
import { Camera } from '../models/Camera.js';
import { Room } from '../models/Room.js';
import { Device } from '../models/Device.js';
import { emit, SocketEvents } from '../sockets/index.js';
import { toQueryString } from '../services/identityRules.js';
import { parseDateRange } from '../services/occupancyRules.js';

export const alertStatusSchema = z.object({
  status: z.enum(['new', 'acknowledged', 'resolved']),
});

/**
 * Attaches the display names an alert refers to, without an N+1 query.
 *
 * ADDITIVE ONLY. Every pre-existing field — including `id`, `cameraName` and
 * everything spread from the document — is produced exactly as before, because
 * the Review 1 AlertsPage and the alert:new / alert:updated socket payloads all
 * consume this shape. Review 3 alerts can reference a room (occupancy and
 * capacity) or a device (a command that was not confirmed), so `roomName` and
 * `deviceName` are resolved alongside `cameraName`; a Review 1/2 alert simply
 * leaves them null.
 */
async function withCameraNames(alerts) {
  const ids = [...new Set(alerts.map((a) => a.cameraId).filter(Boolean))];
  const roomIds = [...new Set(alerts.map((a) => a.roomId).filter(Boolean))];
  const deviceIds = [...new Set(alerts.map((a) => a.deviceId).filter(Boolean))];

  const [cameras, rooms, devices] = await Promise.all([
    Camera.find({ cameraId: { $in: ids } }).select('cameraId name'),
    roomIds.length ? Room.find({ roomId: { $in: roomIds } }).select('roomId name') : [],
    deviceIds.length
      ? Device.find({ deviceId: { $in: deviceIds } }).select('deviceId name simulated')
      : [],
  ]);

  const nameById = new Map(cameras.map((c) => [c.cameraId, c.name]));
  const roomNameById = new Map(rooms.map((r) => [r.roomId, r.name]));
  const deviceById = new Map(devices.map((d) => [d.deviceId, d]));

  return alerts.map((a) => {
    const device = a.deviceId ? deviceById.get(a.deviceId) : null;
    return {
      ...a.toObject(),
      id: a._id.toString(),
      cameraName: nameById.get(a.cameraId) || a.cameraId,
      // Additive Review 3 references. Null on every Review 1/2 alert.
      roomName: a.roomId ? roomNameById.get(a.roomId) || a.roomId : null,
      deviceName: a.deviceId ? device?.name || a.deviceId : null,
      // So a device_failure alert can be labelled SIMULATED in the list.
      deviceSimulated: device ? device.simulated !== false : null,
    };
  });
}

/**
 * GET /api/alerts — paginated, with ADDITIVE filters.
 *
 * `status` and `severity` are the pre-existing filters and behave exactly as
 * before. Review 3 adds `type` (accepted as `type` or `category`), `cameraId`,
 * `roomId`, `deviceId` and a `from`/`to` date range. Every one of them is
 * optional, so an existing caller that sends none — the Review 1 AlertsPage
 * does exactly that — gets the same result set it always did.
 *
 * Every raw value goes through toQueryString first. Express's extended query
 * parser turns `?status[$ne]=resolved` into an object, which would otherwise
 * reach Mongo as an operator and change which alerts the caller can read. The
 * date range goes through the same defensive parseDateRange the occupancy and
 * energy history endpoints use, so `?from=banana` narrows nothing instead of
 * reaching Mongo as garbage.
 */
export const listAlerts = asyncHandler(async (req, res) => {
  const { limit = 50, page = 1 } = req.query;
  // Coerced, not trusted: `?status[$ne]=resolved` would otherwise reach Mongo
  // as an operator (Express's extended query parser builds an object from it).
  const status = toQueryString(req.query.status);
  const severity = toQueryString(req.query.severity);
  // `category` is accepted as an alias for `type` because the user-facing
  // vocabulary calls these categories.
  const type = toQueryString(req.query.type) || toQueryString(req.query.category);
  const cameraId = toQueryString(req.query.cameraId);
  const roomId = toQueryString(req.query.roomId);
  const deviceId = toQueryString(req.query.deviceId);

  const filter = {};
  if (status) filter.status = status;
  if (severity) filter.severity = severity;
  if (type) filter.type = type;
  if (cameraId) filter.cameraId = cameraId;
  if (roomId) filter.roomId = roomId;
  if (deviceId) filter.deviceId = deviceId;
  const range = parseDateRange({ from: req.query.from, to: req.query.to });
  if (range) filter.timestamp = range;

  const perPage = Math.min(Number(limit) || 50, 200);
  const skip = (Math.max(Number(page) || 1, 1) - 1) * perPage;

  const [alerts, total] = await Promise.all([
    Alert.find(filter).sort({ timestamp: -1 }).skip(skip).limit(perPage),
    Alert.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: { items: await withCameraNames(alerts), total, page: Number(page), perPage },
  });
});

export const getAlert = asyncHandler(async (req, res) => {
  const alert = await Alert.findById(req.params.id);
  if (!alert) throw ApiError.notFound('Alert not found');
  const [withName] = await withCameraNames([alert]);
  res.json({ success: true, data: withName });
});

/** Acknowledge / resolve an alert — a real backend state change, not UI-only. */
export const updateAlertStatus = asyncHandler(async (req, res) => {
  const alert = await Alert.findById(req.params.id);
  if (!alert) throw ApiError.notFound('Alert not found');

  alert.status = req.body.status;
  await alert.save();

  const [withName] = await withCameraNames([alert]);
  emit(SocketEvents.ALERT_UPDATED, withName);
  res.json({ success: true, data: withName });
});
