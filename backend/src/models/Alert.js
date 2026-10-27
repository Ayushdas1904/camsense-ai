import mongoose from 'mongoose';

/**
 * Alert — an actionable security event derived from one or more detections.
 * Future-ready schema (Review 1 basic alerts, expanded in Review 2/3).
 */
const alertSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      // 'unknown_identity' is the Review 2 category for a face the recognition
      // pipeline could not match to a registered person. The older
      // 'unknown_person' value is deliberately RETAINED: removing an enum
      // value would invalidate any document already stored with it.
      //
      // Review 3 extends this list ADDITIVELY for the same reason — every
      // existing value stays, so stored documents keep validating:
      //   occupancy_warning   a room has reached its near-capacity ratio
      //   capacity_exceeded   a room's count is above its configured capacity
      //   device_failure      a device command was not confirmed by its adapter
      //   automation_failure  an automation rule could not be carried out
      //   ai_service_failure  the AI service is unreachable or degraded
      //   camera_unavailable  a camera stopped producing usable frames
      // The last four are raised by later Review 3 features; the values are
      // declared here so the enum is extended once.
      enum: [
        'weapon',
        'unknown_person',
        'unknown_identity',
        'intrusion',
        'camera_offline',
        'system',
        'occupancy_warning',
        'capacity_exceeded',
        'device_failure',
        'automation_failure',
        'ai_service_failure',
        'camera_unavailable',
      ],
      required: true,
      index: true,
    },
    severity: {
      type: String,
      enum: ['info', 'warning', 'critical'],
      default: 'info',
      index: true,
    },
    cameraId: { type: String, index: true },
    personId: { type: String },
    // Review 3: the monitored room an occupancy/capacity alert refers to.
    // Optional and additive — Review 1/2 alerts simply leave it unset.
    roomId: { type: String, index: true },
    // Review 3: the device a `device_failure` alert refers to. Optional and
    // additive for the same reason as roomId. Set when a command was not
    // confirmed by its adapter; the alert says the command failed and the
    // state is UNCHANGED, never that the device switched.
    deviceId: { type: String, index: true },
    detectionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Detection' },
    message: { type: String, required: true },
    snapshot: { type: String },
    status: {
      type: String,
      enum: ['new', 'acknowledged', 'resolved'],
      default: 'new',
      index: true,
    },
    timestamp: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

export const Alert = mongoose.model('Alert', alertSchema);
