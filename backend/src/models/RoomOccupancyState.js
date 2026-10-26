import mongoose from 'mongoose';

/**
 * RoomOccupancyState — the CURRENT occupancy of one room (Review 3).
 *
 * Exactly one document per room, keyed by a unique `roomId`. It exists so
 * `GET /api/occupancy/current` is a bounded lookup of N rooms rather than a
 * scan of the occupancy history looking for each room's newest row — which is
 * the query that gets slower every day the system runs.
 *
 * This document is the live view; `Occupancy` (the readings collection) is the
 * history. They are written in the same ingest, but on different rules: the
 * state is upserted on EVERY accepted report so the dashboard is current,
 * while a history row is only written on a change or at the sampling interval.
 *
 * `count` is NULLABLE for the same reason as in the readings collection: when
 * the camera is unavailable or the figure has gone stale it is stored as null,
 * never 0, so an unreadable camera can never be displayed as an empty room.
 */
const roomOccupancyStateSchema = new mongoose.Schema(
  {
    roomId: { type: String, required: true, unique: true, trim: true, index: true },
    // NULL when not measurable. Never 0 as a stand-in for "unknown".
    count: { type: Number, min: 0, default: null },
    capacity: { type: Number, min: 0, default: 0 },
    status: {
      type: String,
      enum: [
        'occupied',
        'unoccupied',
        'near_capacity',
        'capacity_exceeded',
        'camera_unavailable',
        'stale',
      ],
      default: 'camera_unavailable',
      index: true,
    },
    available: { type: Boolean, default: false },
    source: { type: String, enum: ['real', 'demo'], default: 'real' },
    // Per-camera figures behind the aggregate: [{ cameraId, count, available,
    // reportedAt }]. Lets the UI show WHICH camera went dark.
    cameras: { type: [mongoose.Schema.Types.Mixed], default: [] },
    // When occupancy was last SUCCESSFULLY measured. Staleness is computed
    // from this, not from `updatedAt` — a report that says "unavailable" still
    // updates the document, so `updatedAt` would keep looking fresh while the
    // actual measurement aged.
    lastUpdatedAt: { type: Date, default: null },
    // When any report (including an unavailable one) was last received.
    lastReportAt: { type: Date, default: null },
    // Last time a capacity/occupancy alert was raised for this room, used for
    // the per-room alert cooldown.
    lastAlertAt: { type: Date, default: null },
    dataQuality: { type: String, default: 'no_data' },
    // ── Review 3 automation markers ─────────────────────────────
    // "Continuously at/below (or above) the automation threshold since" —
    // written by services/automationEngine.js via
    // automationRules.updateThresholdMarkers.
    //
    // PERSISTED, not merely held in memory, for one specific reason: on a
    // backend restart an in-memory marker would be absent, and a rule whose
    // unoccupied delay is satisfied by "no marker" would fire a switch-off the
    // room never actually earned. Writing them means a restart resumes the
    // same clock instead of inventing a new one. An UNUSABLE occupancy reading
    // freezes both markers rather than advancing either, so a camera outage
    // cannot accumulate "unoccupied" time.
    belowThresholdSince: { type: Date, default: null },
    aboveThresholdSince: { type: Date, default: null },
  },
  { timestamps: true }
);

export const RoomOccupancyState = mongoose.model(
  'RoomOccupancyState',
  roomOccupancyStateSchema
);
