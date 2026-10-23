import mongoose from 'mongoose';

/**
 * RecognitionEvent — the structured outcome of one face-recognition attempt
 * (Review 2).
 *
 * Written ONLY by services/recognitionService.js, which is reached only from
 * the shared-secret service-to-service endpoint POST /api/ai/recognition. No
 * authenticated browser client can create one, because a client must never be
 * able to assert an identity.
 *
 * `similarity` is a cosine similarity between face embeddings. It is present
 * only when a comparison actually happened, it is NOT a calibrated probability,
 * and it is a different measurement from a detector's `confidence` — the two
 * must never be presented interchangeably.
 *
 * `status` vocabulary mirrors the AI service's RecognitionStatus:
 *   known                  — a candidate cleared the configured threshold AND
 *                            was independently re-verified by the backend.
 *   unknown                — a usable face was detected and the recognition
 *                            pipeline was available, but no registered
 *                            identity met the threshold. An unknown identity
 *                            is an UNMATCHED FACE, not proof of wrongdoing.
 *   low_quality            — a face was found but was too small/poor to judge.
 *   recognition_unavailable — the models or identity cache were unavailable, so
 *                            no identity claim is possible. Never alerted on.
 *
 * `snapshot` is a URL reference produced by utils/snapshot.js. Image bytes are
 * never embedded in the document.
 */
const recognitionEventSchema = new mongoose.Schema(
  {
    cameraId: { type: String, required: true, index: true },
    // Present only for a verified 'known' result.
    personId: { type: String, index: true },
    // Name snapshotted at event time, so the event log stays readable even if
    // the person record is later renamed or deleted.
    personName: { type: String },
    status: {
      type: String,
      enum: ['known', 'unknown', 'low_quality', 'recognition_unavailable'],
      required: true,
      index: true,
    },
    similarity: { type: Number },
    // [x, y, width, height] in pixels of the processed frame — the REAL
    // coordinates returned by the AI service, never generated here.
    boundingBox: {
      type: [Number],
      validate: (v) => !v || v.length === 4,
    },
    snapshot: { type: String },
    // Transient per-camera session handle used to de-duplicate repeated
    // sightings of the same continuously visible face. It makes NO claim about
    // the person's real identity.
    trackId: { type: String },
    source: { type: String, enum: ['real', 'demo'], default: 'real' },
    acknowledged: { type: Boolean, default: false },
    // The alert raised for this event, when one was raised (unknown identities
    // reuse the EXISTING alert system rather than a second one).
    alertId: { type: mongoose.Schema.Types.ObjectId, ref: 'Alert' },
    timestamp: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

// Primary list query: most recent events for a camera.
recognitionEventSchema.index({ cameraId: 1, timestamp: -1 });

export const RecognitionEvent = mongoose.model('RecognitionEvent', recognitionEventSchema);
