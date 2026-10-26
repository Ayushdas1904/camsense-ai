import mongoose from 'mongoose';

/**
 * OccupancyReading — one persisted occupancy MEASUREMENT for a room (Review 3).
 *
 * Replaces the thin, unused foundation-phase placeholder that lived here. The
 * mongoose model name is deliberately still `Occupancy`, so the collection
 * stays `occupancies` and nothing a previous run may have written is orphaned.
 * The legacy `location` field is kept as optional for the same reason.
 *
 * WHAT IS AND IS NOT STORED:
 *   NOT every frame, and not every report. Writing one document per processed
 *   frame would put thousands of near-identical rows per camera per minute
 *   into the database for no analytical gain. Persistence is CHANGE-BASED plus
 *   SAMPLED: a reading is written when the count or the status actually
 *   changes, or when the configured sampling interval has elapsed since the
 *   last write — see services/occupancyRules.js → shouldPersistReading. The
 *   live figure lives in RoomOccupancyState; this collection is the history.
 *
 * `count` IS NULLABLE, ON PURPOSE:
 *   When the camera is unavailable or the reading has gone stale, the count is
 *   stored as `null`, never as 0. "Nobody is in the room" and "we cannot tell
 *   how many people are in the room" are different facts, and a 0 here would
 *   make a full room look evacuated in the history and in every chart built
 *   from it. `available` records which of the two it was.
 */
const occupancySchema = new mongoose.Schema(
  {
    roomId: { type: String, required: true, index: true },
    // The camera the reading came from, when it came from exactly one. Null
    // for an aggregated multi-camera room reading.
    cameraId: { type: String, default: null },
    // Legacy field from the foundation-phase placeholder. Unused by Review 3
    // (the room's own `name` is the display label) and retained only so an
    // older document keeps validating.
    location: { type: String, trim: true },
    // NULL when the measurement is not trustworthy — see the note above.
    count: { type: Number, min: 0, default: null },
    // The room's configured capacity AT THE TIME of the reading, so history
    // stays interpretable after the capacity is edited. 0 = not configured.
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
      required: true,
      index: true,
    },
    // False means the figure could not be measured at this moment.
    available: { type: Boolean, default: true },
    // Mirrors Detection.source: 'real' is genuine model output, 'demo' is
    // clearly-labelled simulated activity. Never silently mixed.
    source: { type: String, enum: ['real', 'demo'], default: 'real', index: true },
    // Detection provenance: which per-camera figures produced this reading.
    // Kept small and non-biometric — camera ids and counts, never an image and
    // never an identity.
    trackedIds: { type: [String], default: [] },
    metadata: {
      // [{ cameraId, count, available }] as reported by the AI service.
      perCamera: { type: [mongoose.Schema.Types.Mixed], default: [] },
      // 'max' — see Room.js for why a multi-camera room is never summed.
      aggregation: { type: String, default: 'max' },
      reportedAt: { type: Date },
    },
    // Short machine-readable note on the quality of this reading, e.g.
    // 'measured', 'camera_unavailable', 'stale', 'monitoring_disabled'.
    dataQuality: { type: String, default: 'measured' },
    timestamp: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

// The two time-based history queries this feature actually runs: one room's
// history newest-first, and the global recent feed.
occupancySchema.index({ roomId: 1, timestamp: -1 });
occupancySchema.index({ timestamp: -1 });

export const OccupancyReading = mongoose.model('Occupancy', occupancySchema);

/** Backwards-compatible alias for the previous export name. */
export const Occupancy = OccupancyReading;
