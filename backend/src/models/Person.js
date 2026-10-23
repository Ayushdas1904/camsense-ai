import mongoose from 'mongoose';

/**
 * Person — a registered individual for face recognition / attendance (Review 2).
 *
 * BIOMETRIC DATA HANDLING (read before touching this file):
 *   `faceEmbedding` is the numeric vector produced by the AI service. It is
 *   biometric data and is protected by TWO independent mechanisms:
 *
 *     1. `select: false` — the field is excluded from every query result
 *        unless a caller explicitly asks for it with `.select('+faceEmbedding')`.
 *     2. A `toJSON`/`toObject` transform that deletes the field — so it cannot
 *        leak even if some future query over-selects or a document is spread
 *        straight into a response.
 *
 *   Exactly ONE endpoint in this API is allowed to emit it:
 *   GET /api/ai/face-embeddings, which is service-to-service, gated by the
 *   `x-ai-secret` shared secret, and never reachable from the browser. Client
 *   responses go through personService.serializePerson(), which whitelists
 *   fields and exposes only derived readiness flags (faceRegistered,
 *   embeddingDim, embeddingModel). Never log an embedding value.
 *
 *   One endpoint on the PYTHON AI SERVICE also returns an embedding —
 *   POST /api/faces/register, which hands the newly generated vector back for
 *   storage. It is gated by the same `x-ai-secret` service secret and is
 *   likewise never called by a browser. Those two service-to-service endpoints
 *   are the complete set; no browser-facing route in either service emits a
 *   vector.
 *
 *   The backend treats the vector as opaque data and never computes it itself —
 *   embedding generation belongs to the AI service.
 */
const personSchema = new mongoose.Schema(
  {
    personId: { type: String, required: true, unique: true, trim: true, index: true },
    name: { type: String, required: true, trim: true },
    // Optional: many people legitimately have no email on record, so the
    // uniqueness index below is sparse rather than plain unique.
    email: { type: String, trim: true, lowercase: true },
    // Person category per the Review 2 spec. 'admin' is rendered as
    // "Administrator" in the UI. The pre-existing free-text `role` field is
    // kept untouched so nothing that already reads it breaks.
    category: {
      type: String,
      enum: ['student', 'faculty', 'staff', 'admin'],
      default: 'student',
      index: true,
    },
    department: { type: String, trim: true },
    role: { type: String, trim: true },
    // URL reference to the stored registration photograph (never image bytes).
    photo: { type: String },
    faceEmbedding: { type: [Number], default: undefined, select: false },
    // Which model produced the stored vector, and its dimension. Recorded so a
    // stored embedding can be validated against the live model instead of being
    // silently compared across incompatible models.
    embeddingModel: { type: String },
    embeddingDim: { type: Number },
    faceRegisteredAt: { type: Date },
    recognitionEnabled: { type: Boolean, default: true, index: true },
    registeredAt: { type: Date, default: Date.now },
    // Soft-delete / deactivate flag. A person with active:false is never
    // matchable: they are excluded from the embedding set sent to the AI
    // service and rejected again by the backend's own re-verification.
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

// Sparse so multiple people may omit an email while real emails stay unique.
personSchema.index({ email: 1 }, { unique: true, sparse: true });
// Supports the people-list search (personId OR name OR email, case-insensitive).
personSchema.index({ name: 1 });
personSchema.index({ category: 1, active: 1 });

/**
 * Defence in depth: strip the embedding on serialization as well as on
 * selection. Applied to both toJSON and toObject because `toObject()` is a
 * common way to spread a document into a response elsewhere in this codebase.
 */
function stripEmbedding(_doc, ret) {
  delete ret.faceEmbedding;
  return ret;
}

personSchema.set('toJSON', { transform: stripEmbedding });
personSchema.set('toObject', { transform: stripEmbedding });

export const Person = mongoose.model('Person', personSchema);
