import mongoose from 'mongoose';

/**
 * Attendance — one record per person per day (Review 2).
 * The compound unique index enforces the "one entry per person per day" rule
 * that prevents duplicate attendance. Future-ready schema.
 */
const attendanceSchema = new mongoose.Schema(
  {
    personId: { type: String, required: true, index: true },
    cameraId: { type: String },
    date: { type: String, required: true }, // YYYY-MM-DD
    firstSeen: { type: Date },
    lastSeen: { type: Date },
    status: {
      type: String,
      enum: ['present', 'late', 'absent'],
      default: 'present',
    },
  },
  { timestamps: true }
);

attendanceSchema.index({ personId: 1, date: 1 }, { unique: true });

export const Attendance = mongoose.model('Attendance', attendanceSchema);
