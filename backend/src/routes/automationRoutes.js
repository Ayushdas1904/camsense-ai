import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  createRule,
  deleteRule,
  disableRule,
  enableRule,
  evaluateRule,
  getAutomationHealth,
  getAutomationHistory,
  getRule,
  listRules,
  ruleSchema,
  ruleUpdateSchema,
  updateRule,
} from '../controllers/automationController.js';

/**
 * Automation rules and execution history (Review 3).
 *
 * AUTHORIZATION POLICY:
 *   Reads (rules, history, health) require requireAuth.
 *   EVERY rule change requires requireAuth AND requireRole('admin') —
 *   create, update, delete, enable, disable and the manual evaluate. A rule
 *   decides when a device is switched, so being able to edit one is
 *   equivalent to being able to switch it.
 *
 * Every mutating body is validated with zod, and the controller rejects a
 * roomId or deviceId that does not resolve to a real record.
 */
const router = Router();

// History before /rules/:id so neither path shadows the other.
router.get('/history', requireAuth, getAutomationHistory);
router.get('/health', requireAuth, getAutomationHealth);

router.get('/rules', requireAuth, listRules);
router.post('/rules', requireAuth, requireRole('admin'), validate(ruleSchema), createRule);

router.get('/rules/:id', requireAuth, getRule);
router.put(
  '/rules/:id',
  requireAuth,
  requireRole('admin'),
  validate(ruleUpdateSchema),
  updateRule
);
router.delete('/rules/:id', requireAuth, requireRole('admin'), deleteRule);

// Enable/disable are separate endpoints rather than a PUT field so the act of
// turning automation on is explicit in the API surface and in the audit log.
router.post('/rules/:id/enable', requireAuth, requireRole('admin'), enableRule);
router.post('/rules/:id/disable', requireAuth, requireRole('admin'), disableRule);

// Runs the rule's room once, now. Takes no shortcuts — the same fail-safe and
// the same adapter confirmation apply.
router.post('/rules/:id/evaluate', requireAuth, requireRole('admin'), evaluateRule);

export default router;
