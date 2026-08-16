import mongoose from 'mongoose';

/**
 * Person — a registered individual for face recognition / attendance (Review 2).
 *
 * `faceEmbedding` stores the numeric vector produced by the AI service; the
 * backend treats it as opaque data and never computes it itself.
 * Future-ready schema — not wired into routes during the foundation phase.
 */
const personSchema = new mongoose.Schema(
  {
    personId: { type: String, required: true, unique: true, trim: true, index: true },
    name: { type: String, required: true, trim: true },
    department: { type: String, trim: true },
    role: { type: String, trim: true },
    photo: { type: String },
    faceEmbedding: { type: [Number], default: undefined },
    recognitionEnabled: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const Person = mongoose.model('Person', personSchema);
