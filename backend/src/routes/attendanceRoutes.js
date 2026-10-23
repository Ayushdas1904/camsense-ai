import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  listAttendance,
  getAttendanceSummary,
  getAttendanceRecord,
} from '../controllers/attendanceController.js';

/**
 * Attendance (Review 2) — GET ONLY, on purpose.
 *
 * There is deliberately NO POST/PUT/PATCH/DELETE here. Attendance is created
 * exclusively by the trusted recognition workflow behind
 * POST /api/ai/recognition (requireInternalSecret), so an authenticated
 * browser client can never submit a person ID and mark attendance.
 *
 * Do not add a write route to this file. If an operator override is ever
 * needed, it belongs behind requireRole('admin') with source:'manual' and an
 * explicit audit trail — not as a general attendance-creation endpoint.
 */
const router = Router();

router.get('/', requireAuth, listAttendance);
// Registered before /:id so "summary" is not read as a record id.
router.get('/summary', requireAuth, getAttendanceSummary);
router.get('/:id', requireAuth, getAttendanceRecord);

export default router;
