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
      enum: [
        'weapon',
        'unknown_person',
        'unknown_identity',
        'intrusion',
        'camera_offline',
        'system',
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
