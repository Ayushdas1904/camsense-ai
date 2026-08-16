import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { Detection } from '../models/Detection.js';

/** List detection events with optional filters + pagination. */
export const listDetections = asyncHandler(async (req, res) => {
  const { cameraId, type, limit = 50, page = 1 } = req.query;
  const filter = {};
  if (cameraId) filter.cameraId = cameraId;
  if (type) filter.type = type;

  const perPage = Math.min(Number(limit) || 50, 200);
  const skip = (Math.max(Number(page) || 1, 1) - 1) * perPage;

  const [items, total] = await Promise.all([
    Detection.find(filter).sort({ timestamp: -1 }).skip(skip).limit(perPage),
    Detection.countDocuments(filter),
  ]);

  res.json({ success: true, data: { items, total, page: Number(page), perPage } });
});

export const getDetection = asyncHandler(async (req, res) => {
  const detection = await Detection.findById(req.params.id);
  if (!detection) throw ApiError.notFound('Detection not found');
  res.json({ success: true, data: detection });
});
