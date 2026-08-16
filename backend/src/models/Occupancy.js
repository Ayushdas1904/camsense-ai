import mongoose from 'mongoose';

/**
 * Occupancy — periodic headcount for a location/camera (Review 3).
 * Future-ready schema.
 */
const occupancySchema = new mongoose.Schema(
  {
    cameraId: { type: String, required: true, index: true },
    location: { type: String, trim: true },
    count: { type: Number, required: true, min: 0 },
    capacity: { type: Number, min: 0 },
    timestamp: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

export const Occupancy = mongoose.model('Occupancy', occupancySchema);
