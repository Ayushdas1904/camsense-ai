import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { Alert } from '../models/Alert.js';
import { Camera } from '../models/Camera.js';
import { emit, SocketEvents } from '../sockets/index.js';

export const alertStatusSchema = z.object({
  status: z.enum(['new', 'acknowledged', 'resolved']),
});

/** Attaches camera names to a list of alerts without an N+1 query. */
async function withCameraNames(alerts) {
  const ids = [...new Set(alerts.map((a) => a.cameraId).filter(Boolean))];
  const cameras = await Camera.find({ cameraId: { $in: ids } }).select('cameraId name');
  const nameById = new Map(cameras.map((c) => [c.cameraId, c.name]));
  return alerts.map((a) => ({
    ...a.toObject(),
    id: a._id.toString(),
    cameraName: nameById.get(a.cameraId) || a.cameraId,
  }));
}

export const listAlerts = asyncHandler(async (req, res) => {
  const { status, severity, limit = 50, page = 1 } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (severity) filter.severity = severity;

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
