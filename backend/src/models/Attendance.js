import mongoose from 'mongoose';

/**
 * Attendance — one record per person per attendance session (Review 2).
 *
 * ATTENDANCE SESSION POLICY (documented, not implied):
 *   The session is the CALENDAR DATE. Exactly one attendance record may exist
 *   per (personId, date) pair. `date` is the local-calendar day as a
 *   "YYYY-MM-DD" string, and `sessionKey` mirrors it so a future change to a
 *   finer session granularity (e.g. morning/afternoon) needs no migration —
 *   only the key generator and the index change.
 *
 * DUPLICATE PREVENTION:
 *   Enforced by the DATABASE, not by any frontend or application-level check.
 *   The unique compound index { personId: 1, date: 1 } below is the mechanism.
 *   attendanceService.markAttendance() performs a single atomic
 *   findOneAndUpdate upsert against that key and additionally handles the
 *   E11000 duplicate-key error that a genuinely concurrent insert can still
 *   raise, so concurrent recognition reports cannot create two records.
 *
 * STATUS:
 *   'present' is the only status this implementation ever writes. 'late' and
 *   'absent' remain in the enum for compatibility but are NOT implemented:
 *   the project defines no timetable and no late-arrival rule, and inventing
 *   one would fabricate policy. Marking someone late therefore requires a
 *   schedule feature that does not exist yet.
 */
const attendanceSchema = new mongoose.Schema(
  {
    personId: { type: String, required: true, index: true },
    cameraId: { type: String },
    date: { type: String, required: true }, // YYYY-MM-DD (the attendance session)
    // Explicit session handle; equals `date` under the current daily policy.
    sessionKey: { type: String },
    firstSeen: { type: Date },
    lastSeen: { type: Date },
    status: {
      type: String,
      enum: ['present', 'late', 'absent'],
      default: 'present',
    },
    // How the record came to exist. 'recognition' is the only value the
    // trusted AI workflow writes; 'demo' marks clearly-labelled simulated
    // activity; 'manual' is reserved for a future operator override.
    source: {
      type: String,
      enum: ['recognition', 'manual', 'demo'],
      default: 'recognition',
      index: true,
    },
    // The recognition event that created this record — the audit trail linking
    // an attendance entry back to the identity match that justified it.
    recognitionEventId: { type: mongoose.Schema.Types.ObjectId, ref: 'RecognitionEvent' },
    // Cosine similarity of the match that created the record. NOT a
    // probability and NOT a detector confidence — a different measurement.
    similarity: { type: Number },
  },
  { timestamps: true }
);

/** Keeps sessionKey in step with the daily policy for document-path saves. */
attendanceSchema.pre('validate', function setSessionKey(next) {
  if (!this.sessionKey && this.date) this.sessionKey = this.date;
  next();
});

// THE duplicate-prevention mechanism. Do not remove.
attendanceSchema.index({ personId: 1, date: 1 }, { unique: true });
// Supports the attendance list/summary queries for a given day.
attendanceSchema.index({ date: 1, personId: 1 });

export const Attendance = mongoose.model('Attendance', attendanceSchema);
