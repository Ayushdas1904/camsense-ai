import { Router } from 'express';
import healthRoutes from './healthRoutes.js';
import authRoutes from './authRoutes.js';

/**
 * Central API router. Every feature area mounts here under /api.
 *
 * Routes marked "(future)" are part of the planned architecture (Reviews 1–3).
 * They are intentionally not implemented during the foundation phase, but the
 * mount points document the API surface so features slot in without churn.
 */
const router = Router();

// ── Implemented in the foundation ──────────────────────────────
router.use('/health', healthRoutes);
router.use('/auth', authRoutes);

// ── Planned API surface (uncomment/implement per review) ───────
// router.use('/users', userRoutes);            // Review 1
// router.use('/cameras', cameraRoutes);        // Review 1
// router.use('/detections', detectionRoutes);  // Review 1
// router.use('/alerts', alertRoutes);          // Review 1
// router.use('/people', peopleRoutes);         // Review 2
// router.use('/attendance', attendanceRoutes); // Review 2
// router.use('/occupancy', occupancyRoutes);   // Review 3
// router.use('/energy', energyRoutes);         // Review 3
// router.use('/analytics', analyticsRoutes);   // Review 3
// router.use('/notifications', notificationRoutes);
// router.use('/ai', aiRoutes);                 // backend <-> AI service proxy

export default router;
