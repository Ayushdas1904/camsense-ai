import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getComponentHealth, getHealth } from '../controllers/healthController.js';

const router = Router();

// Unauthenticated liveness probe — reports only that this process is up and
// whether its database connection is open. Deliberately shallow.
router.get('/', getHealth);

/**
 * Per-component health for the dashboard panel. requireAuth, unlike the
 * liveness probe above: it names the AI service's model state, the camera
 * inventory, the device adapter and the index-verification states, which is
 * operational detail an anonymous caller has no reason to read. It still never
 * returns a secret, a connection string or a stack trace.
 */
router.get('/components', requireAuth, getComponentHealth);

export default router;
