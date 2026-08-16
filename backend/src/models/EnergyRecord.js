import mongoose from 'mongoose';

/**
 * EnergyRecord — energy usage/savings driven by occupancy-based automation (Review 3).
 * Future-ready schema.
 */
const energyRecordSchema = new mongoose.Schema(
  {
    location: { type: String, required: true, index: true },
    occupancy: { type: Number, min: 0 },
    lightStatus: { type: String, enum: ['on', 'off'], default: 'off' },
    fanStatus: { type: String, enum: ['on', 'off'], default: 'off' },
    energyConsumed: { type: Number, min: 0, default: 0 },
    energySaved: { type: Number, min: 0, default: 0 },
    timestamp: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

export const EnergyRecord = mongoose.model('EnergyRecord', energyRecordSchema);
