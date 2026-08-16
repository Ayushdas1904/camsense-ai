import mongoose from 'mongoose';

/**
 * Detection — a single AI detection event produced by the AI service.
 *
 * boundingBox is [x, y, width, height] in pixels. `class` holds the specific
 * label (e.g. "person", "knife"); `type` is the module family (e.g. "human",
 * "weapon", "face"). Future-ready schema for Review 1's AI event generation.
 */
const detectionSchema = new mongoose.Schema(
  {
    cameraId: { type: String, required: true, index: true },
    type: {
      type: String,
      enum: ['human', 'weapon', 'face', 'other'],
      required: true,
      index: true,
    },
    class: { type: String, required: true },
    confidence: { type: Number, min: 0, max: 1, required: true },
    boundingBox: {
      type: [Number],
      validate: (v) => !v || v.length === 4,
    },
    snapshot: { type: String },
    source: { type: String, enum: ['demo', 'real'], default: 'demo' },
    timestamp: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

export const Detection = mongoose.model('Detection', detectionSchema);
