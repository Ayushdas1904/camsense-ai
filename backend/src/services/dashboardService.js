import { Camera } from '../models/Camera.js';
import { Detection } from '../models/Detection.js';
import { Alert } from '../models/Alert.js';

/**
 * Computes the dashboard KPIs from real database state (never hardcoded).
 * Reused by both the REST endpoint and the socket "dashboard:update" push.
 */
export async function computeDashboardStats() {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [totalCameras, activeCameras, peopleToday, weaponsToday, newAlerts, totalAlerts] =
    await Promise.all([
      Camera.countDocuments({}),
      Camera.countDocuments({ status: 'online' }),
      Detection.countDocuments({ type: 'human', timestamp: { $gte: startOfDay } }),
      Detection.countDocuments({ type: 'weapon', timestamp: { $gte: startOfDay } }),
      Alert.countDocuments({ status: 'new' }),
      Alert.countDocuments({}),
    ]);

  return {
    totalCameras,
    activeCameras,
    peopleDetectedToday: peopleToday,
    weaponsDetectedToday: weaponsToday,
    newAlerts,
    totalAlerts,
  };
}
