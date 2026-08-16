import { asyncHandler } from '../utils/asyncHandler.js';
import { computeDashboardStats } from '../services/dashboardService.js';
import { Alert } from '../models/Alert.js';
import { Detection } from '../models/Detection.js';
import { Camera } from '../models/Camera.js';
import { aiClient } from '../services/aiClient.js';

/** Dashboard KPIs — all derived from real DB state + live AI status. */
export const getDashboardStats = asyncHandler(async (_req, res) => {
  const stats = await computeDashboardStats();

  // AI status is best-effort: the dashboard must still render if AI is down.
  let ai = { reachable: false, model_loaded: false, detectors: [] };
  try {
    ai = { reachable: true, ...(await aiClient.getStatus()) };
  } catch {
    ai.reachable = false;
  }

  res.json({ success: true, data: { ...stats, ai } });
});

/** Recent security events feed (latest alerts + detections merged). */
export const getRecentEvents = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 10, 50);

  const [alerts, detections, cameras] = await Promise.all([
    Alert.find().sort({ timestamp: -1 }).limit(limit),
    Detection.find().sort({ timestamp: -1 }).limit(limit),
    Camera.find().select('cameraId name'),
  ]);
  const nameById = new Map(cameras.map((c) => [c.cameraId, c.name]));

  const events = [
    ...alerts.map((a) => ({
      kind: 'alert',
      id: a._id.toString(),
      severity: a.severity,
      title: a.message,
      cameraName: nameById.get(a.cameraId) || a.cameraId,
      timestamp: a.timestamp,
    })),
    ...detections.map((d) => ({
      kind: 'detection',
      id: d._id.toString(),
      severity: d.type === 'weapon' ? 'critical' : 'info',
      title: `${d.class} detected`,
      cameraName: nameById.get(d.cameraId) || d.cameraId,
      timestamp: d.timestamp,
    })),
  ]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, limit);

  res.json({ success: true, data: events });
});
