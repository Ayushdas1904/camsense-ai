import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  listRooms,
  getRoom,
  createRoom,
  updateRoom,
  deleteRoom,
  roomSchema,
  roomUpdateSchema,
} from '../controllers/roomController.js';

/**
 * Rooms / monitored zones (Review 3).
 *
 * AUTHORIZATION POLICY — the same shape peopleRoutes.js uses:
 *   Reads require requireAuth only, so any signed-in operator can see the
 *   rooms and their current occupancy.
 *   Every MUTATION additionally requires requireRole('admin'), because a
 *   room's capacity and thresholds decide when capacity alerts fire and, in
 *   the later Review 3 features, when a device is switched.
 */
const router = Router();

router.get('/', requireAuth, listRooms);
router.post('/', requireAuth, requireRole('admin'), validate(roomSchema), createRoom);

router.get('/:id', requireAuth, getRoom);
router.put('/:id', requireAuth, requireRole('admin'), validate(roomUpdateSchema), updateRoom);
router.delete('/:id', requireAuth, requireRole('admin'), deleteRoom);

export default router;
