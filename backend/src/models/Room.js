import mongoose from 'mongoose';

/**
 * Room — a monitored zone whose occupancy is estimated from one or more
 * cameras (Review 3).
 *
 * CAMERA ASSOCIATION, AND WHY IT AGGREGATES WITH A MAX:
 *   `cameraIds` holds Camera.cameraId values (the human-readable business key,
 *   matching how Detection, Alert and Attendance reference a camera), not
 *   ObjectIds.
 *
 *   A room may list several cameras, but THIS PROJECT HAS NO CROSS-CAMERA
 *   RE-IDENTIFICATION. The AI service's person tracks are per-camera and
 *   transient, so the same person seen by two cameras covering one room is two
 *   independent tracks with no way to know they are the same human. Summing the
 *   per-camera counts would therefore DOUBLE-COUNT them. The aggregation is
 *   consequently a MAX across the room's cameras (see
 *   services/occupancyRules.js → aggregateRoomCount), which is a documented
 *   lower bound on the real headcount rather than a fabricated exact figure.
 *
 *   Practical consequence to tell the operator: for an accurate count, give a
 *   room ONE camera whose field of view covers it. Multiple cameras are
 *   supported for coverage, not for additive counting.
 *
 * THRESHOLDS:
 *   `occupancyThreshold` is the count at or above which the room counts as
 *   occupied (default 1 — one person makes a room occupied). It is also what
 *   the Review 3 automation rules compare against.
 *   `nearCapacityRatio` is the fraction of `capacity` at which the status
 *   becomes "Near Capacity". Ignored when `capacity` is 0/unset, because a
 *   ratio of an unknown capacity is meaningless.
 */
const roomSchema = new mongoose.Schema(
  {
    roomId: { type: String, required: true, unique: true, trim: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: '' },
    // Camera.cameraId values. Validated against real Camera records by the
    // controller — a room must not reference a camera that does not exist.
    cameraIds: { type: [String], default: [] },
    // 0 (the default) means "capacity not configured": capacity-based statuses
    // are then skipped entirely rather than computed against a guess.
    capacity: { type: Number, min: 0, default: 0 },
    occupancyThreshold: { type: Number, min: 0, default: 1 },
    nearCapacityRatio: { type: Number, min: 0, max: 1, default: 0.8 },
    // Monitoring can be paused without deleting the room or its history.
    monitoringEnabled: { type: Boolean, default: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Supports the "which rooms watch this camera?" lookup performed on every
// occupancy ingest — the hot path for this feature.
roomSchema.index({ cameraIds: 1, active: 1 });

export const Room = mongoose.model('Room', roomSchema);
