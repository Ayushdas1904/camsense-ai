import { Camera } from '../models/Camera.js';
import { Detection } from '../models/Detection.js';
import { Alert } from '../models/Alert.js';
import { Person } from '../models/Person.js';
import { Attendance } from '../models/Attendance.js';
import { RecognitionEvent } from '../models/RecognitionEvent.js';
import { attendanceDateKey } from './identityRules.js';

/**
 * Computes the dashboard KPIs from real database state (never hardcoded).
 * Reused by both the REST endpoint and the socket "dashboard:update" push.
 *
 * Review 2 added the identity/attendance counters ADDITIVELY — the existing
 * keys are unchanged, because the frontend DashboardStats type and the
 * dashboard:update socket payload both consume this shape.
 */
export async function computeDashboardStats() {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const today = attendanceDateKey();

  const [
    totalCameras,
    activeCameras,
    peopleToday,
    weaponsToday,
    newAlerts,
    totalAlerts,
    totalPeople,
    recognitionEnabledPeople,
    presentToday,
    unknownIdentitiesToday,
  ] = await Promise.all([
    Camera.countDocuments({}),
    Camera.countDocuments({ status: 'online' }),
    Detection.countDocuments({ type: 'human', timestamp: { $gte: startOfDay } }),
    Detection.countDocuments({ type: 'weapon', timestamp: { $gte: startOfDay } }),
    Alert.countDocuments({ status: 'new' }),
    Alert.countDocuments({}),
    // ── Review 2 counters, each a real count over persisted documents ──
    Person.countDocuments({ active: true }),
    Person.countDocuments({ active: true, recognitionEnabled: true }),
    Attendance.countDocuments({ date: today, status: { $in: ['present', 'late'] } }),
    RecognitionEvent.countDocuments({
      status: 'unknown',
      timestamp: { $gte: startOfDay },
    }),
  ]);

  return {
    totalCameras,
    activeCameras,
    peopleDetectedToday: peopleToday,
    weaponsDetectedToday: weaponsToday,
    newAlerts,
    totalAlerts,
    // Review 2 (additive).
    totalPeople,
    recognitionEnabledPeople,
    presentToday,
    unknownIdentitiesToday,
  };
}
