import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  changeControlMode,
  commandSchema,
  controlModeSchema,
  createDevice,
  deleteDevice,
  deviceSchema,
  deviceUpdateSchema,
  getAdapters,
  getDevice,
  getDeviceHistory,
  listDevicesHandler,
  probeDevice,
  removeOverride,
  sendCommand,
  updateDevice,
} from '../controllers/deviceController.js';

/**
 * Devices (Review 3).
 *
 * AUTHORIZATION POLICY:
 *   Reads (list, detail, history, adapters) require requireAuth.
 *   EVERY MUTATION requires requireAuth AND requireRole('admin') — including
 *   POST /:id/command, POST /:id/control-mode, POST /:id/probe and
 *   DELETE /:id/override. Issuing a command is the act of switching
 *   something, and changing a power rating silently changes every energy
 *   figure the system reports, so neither belongs to a non-admin.
 *
 * Every mutating body is validated with zod through the shared validate
 * middleware, and the controller rejects a roomId that does not resolve to a
 * real Room.
 */
const router = Router();

// Which adapters exist and which are actually implemented. Registered before
// /:id so the literal path is not swallowed by the parameterised route.
router.get('/adapters', requireAuth, getAdapters);

router.get('/', requireAuth, listDevicesHandler);
router.post('/', requireAuth, requireRole('admin'), validate(deviceSchema), createDevice);

router.get('/:id', requireAuth, getDevice);
router.put('/:id', requireAuth, requireRole('admin'), validate(deviceUpdateSchema), updateDevice);
router.delete('/:id', requireAuth, requireRole('admin'), deleteDevice);

// ── Manual control. Admin-only: these switch a device. ─────────
router.post(
  '/:id/command',
  requireAuth,
  requireRole('admin'),
  validate(commandSchema),
  sendCommand
);
router.post(
  '/:id/control-mode',
  requireAuth,
  requireRole('admin'),
  validate(controlModeSchema),
  changeControlMode
);
router.delete('/:id/override', requireAuth, requireRole('admin'), removeOverride);
router.post('/:id/probe', requireAuth, requireRole('admin'), probeDevice);

// Paginated and hard-capped in the service.
router.get('/:id/history', requireAuth, getDeviceHistory);

export default router;
