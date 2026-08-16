import { Router } from 'express';
import healthRoutes from './healthRoutes.js';
import authRoutes from './authRoutes.js';
import cameraRoutes from './cameraRoutes.js';
import detectionRoutes from './detectionRoutes.js';
import alertRoutes from './alertRoutes.js';
import dashboardRoutes from './dashboardRoutes.js';
import aiRoutes from './aiRoutes.js';

/**
 * Central API router. Every feature area mounts here under /api.
 *
 * Routes marked "(future)" are part of the planned architecture (Reviews 1–3).
 * They are intentionally not implemented during the foundation phase, but the
 * mount points document the API surface so features slot in without churn.
 */
const router = Router();

// ── Foundation ─────────────────────────────────────────────────
router.use('/health', healthRoutes);
router.use('/auth', authRoutes);

// ── Review 1: "Teach CCTV to SEE" ──────────────────────────────
router.use('/cameras', cameraRoutes);
router.use('/detections', detectionRoutes);
router.use('/alerts', alertRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/ai', aiRoutes); // backend <-> AI service (ingest + status)

// ── Planned API surface (later reviews) ────────────────────────
// router.use('/people', peopleRoutes);         // Review 2
// router.use('/attendance', attendanceRoutes); // Review 2
// router.use('/occupancy', occupancyRoutes);   // Review 3
// router.use('/energy', energyRoutes);         // Review 3
// router.use('/analytics', analyticsRoutes);   // Review 3
// router.use('/notifications', notificationRoutes);

export default router;
