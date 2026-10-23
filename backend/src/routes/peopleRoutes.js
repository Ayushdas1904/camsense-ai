import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  listPeople,
  getPerson,
  createPerson,
  updatePerson,
  setPersonRecognition,
  deletePerson,
  registerPersonFace,
  personSchema,
  personUpdateSchema,
  recognitionToggleSchema,
  faceRegistrationSchema,
} from '../controllers/personController.js';

/**
 * Person management (Review 2).
 *
 * AUTHORIZATION POLICY:
 *   Reads require requireAuth only, so any signed-in operator can see who is
 *   enrolled and whether recognition is ready for them.
 *   Every MUTATION additionally requires requireRole('admin'): creating,
 *   editing, toggling recognition for, deleting, or registering a face for a
 *   person are administrator actions, because they create and modify biometric
 *   records. Face registration in particular is restricted to administrators.
 */
const router = Router();

router.get('/', requireAuth, listPeople);
router.post('/', requireAuth, requireRole('admin'), validate(personSchema), createPerson);

router.get('/:id', requireAuth, getPerson);
router.put('/:id', requireAuth, requireRole('admin'), validate(personUpdateSchema), updatePerson);
router.patch(
  '/:id/recognition',
  requireAuth,
  requireRole('admin'),
  validate(recognitionToggleSchema),
  setPersonRecognition
);
router.delete('/:id', requireAuth, requireRole('admin'), deletePerson);

// Face enrollment. The photograph is a base64 image data URL in a JSON body —
// see the comment on registerPersonFace for why, and for the validation order.
router.post(
  '/:id/face-registration',
  requireAuth,
  requireRole('admin'),
  validate(faceRegistrationSchema),
  registerPersonFace
);

export default router;
