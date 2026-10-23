import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { Person } from '../models/Person.js';
import { aiClient } from '../services/aiClient.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { parseImageDataUrl, removeStoredImage, saveSnapshot } from '../utils/snapshot.js';
import {
  buildPersonFilter,
  findPersonOrThrow,
  notifyAiCacheRefresh,
  serializePerson,
} from '../services/personService.js';

/**
 * Person management (Review 2).
 *
 * AUTHORIZATION: every MUTATING route is gated by requireAuth AND
 * requireRole('admin') in peopleRoutes.js — registering a face and managing
 * people are administrator actions because they create and modify biometric
 * records. READS require requireAuth alone, so an operator or viewer can see
 * who is enrolled and whether recognition is ready for them without being able
 * to enroll, edit, or delete anyone.
 *
 * No response from this controller ever contains a face embedding: every person
 * payload goes through serializePerson(), which builds a whitelist of fields.
 */

// Accepts a real email or an explicitly empty string (the field is optional;
// an empty value is normalised away before saving so the sparse unique index
// on `email` is not tripped by many people sharing "").
const optionalEmail = z.union([z.string().email('A valid email is required'), z.literal('')]);

export const personSchema = z.object({
  personId: z.string().min(1, 'Person ID is required').max(40),
  name: z.string().min(1, 'Name is required').max(80),
  email: optionalEmail.optional().default(''),
  // 'admin' is displayed as "Administrator".
  category: z.enum(['student', 'faculty', 'staff', 'admin']).default('student'),
  department: z.string().max(120).optional().default(''),
  role: z.string().max(80).optional().default(''),
  // A URL reference only. Image bytes arrive through the face-registration
  // endpoint, never through this field.
  photo: z.string().max(300).optional().default(''),
  recognitionEnabled: z.boolean().default(true),
  active: z.boolean().default(true),
});

export const personUpdateSchema = personSchema.partial();

export const recognitionToggleSchema = z.object({
  recognitionEnabled: z.boolean(),
});

export const faceRegistrationSchema = z.object({
  // A base64 image data URL. See the comment on registerPersonFace for why this
  // is JSON rather than multipart/form-data.
  image: z.string().min(32, 'A registration photograph is required'),
});

/** Drops empty optional values so they are absent rather than stored as "". */
function normalizePersonPayload(body) {
  const data = { ...body };
  if (!data.email) delete data.email;
  if (!data.department) delete data.department;
  if (!data.role) delete data.role;
  if (!data.photo) delete data.photo;
  return data;
}

export const listPeople = asyncHandler(async (req, res) => {
  const { search, category, recognitionEnabled, active, limit = 50, page = 1 } = req.query;

  const filter = buildPersonFilter({ search, category, recognitionEnabled, active });
  const perPage = Math.min(Number(limit) || 50, 200);
  const skip = (Math.max(Number(page) || 1, 1) - 1) * perPage;

  const [people, total] = await Promise.all([
    Person.find(filter).sort({ createdAt: -1 }).skip(skip).limit(perPage),
    Person.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: { items: people.map(serializePerson), total, page: Number(page) || 1, perPage },
  });
});

export const getPerson = asyncHandler(async (req, res) => {
  const person = await findPersonOrThrow(req.params.id);
  res.json({ success: true, data: serializePerson(person) });
});

export const createPerson = asyncHandler(async (req, res) => {
  const exists = await Person.findOne({ personId: req.body.personId });
  if (exists) throw ApiError.conflict('A person with that ID already exists');

  const data = normalizePersonPayload(req.body);
  if (data.email) {
    const emailClash = await Person.findOne({ email: data.email });
    if (emailClash) throw ApiError.conflict('A person with that email already exists');
  }

  const person = await Person.create(data);
  // Keeps the AI service's matchable set in step with the database.
  await notifyAiCacheRefresh();
  res.status(201).json({ success: true, data: serializePerson(person) });
});

export const updatePerson = asyncHandler(async (req, res) => {
  const person = await findPersonOrThrow(req.params.id);

  if (req.body.personId && req.body.personId !== person.personId) {
    const clash = await Person.findOne({ personId: req.body.personId });
    if (clash) throw ApiError.conflict('A person with that ID already exists');
  }
  if (req.body.email) {
    const emailClash = await Person.findOne({
      email: req.body.email,
      _id: { $ne: person._id },
    });
    if (emailClash) throw ApiError.conflict('A person with that email already exists');
  }

  const data = { ...req.body };
  // An explicitly cleared email must be unset, not stored as "" — otherwise the
  // sparse unique index would treat two cleared emails as a collision.
  if ('email' in data && !data.email) {
    person.email = undefined;
    delete data.email;
  }
  Object.assign(person, data);
  await person.save();

  await notifyAiCacheRefresh();
  res.json({ success: true, data: serializePerson(person) });
});

/**
 * Enable or disable recognition for a person.
 *
 * Disabling is immediate and enforced twice: the person drops out of the
 * embedding set the AI service caches, and the backend's own re-verification
 * rejects any claim naming them even if a stale cache still matched.
 */
export const setPersonRecognition = asyncHandler(async (req, res) => {
  const person = await findPersonOrThrow(req.params.id);
  person.recognitionEnabled = req.body.recognitionEnabled;
  await person.save();

  await notifyAiCacheRefresh();
  res.json({ success: true, data: serializePerson(person) });
});

/**
 * Delete or deactivate a person.
 *
 * `?deactivate=true` performs a soft delete (active:false), which keeps the
 * attendance history readable while making the person unmatchable. A hard
 * delete additionally clears the stored embedding and removes the stored
 * photograph file, so biometric data is not retained for someone who has been
 * removed from the system.
 */
export const deletePerson = asyncHandler(async (req, res) => {
  const person = await findPersonOrThrow(req.params.id);
  const deactivateOnly = String(req.query.deactivate || '').toLowerCase() === 'true';

  if (deactivateOnly) {
    person.active = false;
    person.recognitionEnabled = false;
    await person.save();
    await notifyAiCacheRefresh();
    res.json({
      success: true,
      data: { id: person._id.toString(), deactivated: true, person: serializePerson(person) },
    });
    return;
  }

  // Hard delete: the document goes, and with it the stored biometric vector.
  // The photograph file is removed too, so face images are not retained for
  // someone who has been removed from the system.
  const photo = person.photo;
  await person.deleteOne();
  if (photo) await removeStoredImage(photo);

  await notifyAiCacheRefresh();
  res.json({ success: true, data: { id: person._id.toString(), deactivated: false } });
});

/**
 * Operator-facing messages for the registration pipeline.
 *
 * These exact strings are required by the specification, so they are defined
 * once and relayed verbatim rather than being reworded at each call site.
 */
const REGISTRATION_MESSAGES = {
  FACE_DETECTED: 'Face detected successfully.',
  MULTIPLE_FACES: 'Registration photograph contains multiple faces.',
  NO_FACE: 'No usable face was detected. Please upload another image.',
  COMPLETED: 'Face registration completed successfully.',
};

/**
 * POST /api/people/:id/face-registration — enroll a face for a person.
 *
 * TRANSPORT TRADEOFF (deliberate): the photograph arrives as a base64 image
 * DATA URL inside a JSON body rather than as multipart/form-data. Reasons:
 * express.json is already configured with a 10 MB limit in app.js; the AI
 * service already exchanges images as base64 data URLs, so no re-encoding is
 * needed; and multipart would require adding a file-upload dependency (multer)
 * that cannot be installed in this environment. The cost is roughly 33% wire
 * overhead versus a binary upload, which is acceptable for a single
 * registration photograph. Swapping to multipart later only changes this
 * handler's first few lines.
 *
 * Validation order:
 *   1. body shape (Zod, in the route)
 *   2. the data URL declares an ALLOWED image mime type
 *   3. the DECODED byte length is within env.recognition.faceUploadMaxBytes
 *   4. the AI service detects exactly one usable face and produces an embedding
 *   5. only then is anything persisted
 *
 * If no valid embedding is produced, the person is NOT marked recognition-ready:
 * faceEmbedding is left untouched, so they remain unmatchable. The response
 * never includes the embedding.
 */
export const registerPersonFace = asyncHandler(async (req, res) => {
  // Loaded WITH the embedding path selected, so assigning the new vector below
  // is an update to a selected path. The vector is never read out of this
  // document: the response goes through serializePerson.
  const person = await findPersonOrThrow(req.params.id, { withEmbedding: true });

  // Step 2: validate the declared type before decoding anything large.
  const mimeMatch = /^data:([a-zA-Z0-9/+.-]+);base64,/.exec(req.body.image);
  const declaredMime = mimeMatch?.[1]?.toLowerCase();
  if (!declaredMime || !env.recognition.allowedImageMimes.includes(declaredMime)) {
    throw ApiError.badRequest(
      `The photograph must be a base64 image data URL of type ${env.recognition.allowedImageMimes.join(', ')}.`
    );
  }

  const parsed = parseImageDataUrl(req.body.image);
  if (!parsed) {
    throw ApiError.badRequest(
      'The photograph could not be read. Upload a PNG, JPEG, or WebP image.'
    );
  }

  // Step 3: size limit on the DECODED bytes, not the base64 string.
  if (parsed.buffer.length > env.recognition.faceUploadMaxBytes) {
    const maxMb = (env.recognition.faceUploadMaxBytes / 1_000_000).toFixed(1);
    throw ApiError.badRequest(`The photograph is too large. Maximum size is ${maxMb} MB.`);
  }

  // Step 4: the AI service owns face detection and embedding generation.
  let result;
  try {
    result = await aiClient.registerFace({ image: req.body.image });
  } catch (err) {
    // Reported honestly, and distinguishing "cannot reach the service" from
    // "the service rejected the call". Either way the person is NOT marked
    // recognition-ready and nothing is persisted.
    logger.warn(`Face registration call to the AI service failed: ${err.message}`);
    const unreachable = err?.statusCode === 503;
    throw new ApiError(
      503,
      unreachable
        ? 'Face recognition is unavailable: the AI service could not be reached. The person was not marked recognition-ready.'
        : `Face recognition is unavailable: ${err.message} The person was not marked recognition-ready.`
    );
  }

  const status = String(result?.status || '').toUpperCase();

  if (status === 'MULTIPLE_FACES') {
    throw ApiError.badRequest(REGISTRATION_MESSAGES.MULTIPLE_FACES, {
      facesDetected: result?.faces_detected ?? null,
      hint: 'Please upload an image containing one clearly visible face.',
    });
  }
  if (status === 'NO_FACE' || status === 'LOW_QUALITY' || status === 'INVALID_IMAGE') {
    throw ApiError.badRequest(REGISTRATION_MESSAGES.NO_FACE, {
      aiStatus: status,
      // The AI service's own explanation, relayed verbatim.
      detail: result?.message || null,
    });
  }
  if (status === 'RECOGNITION_UNAVAILABLE') {
    throw new ApiError(
      503,
      `Face recognition is unavailable: ${result?.message || 'the recognition model is not loaded.'} The person was not marked recognition-ready.`
    );
  }
  if (status !== 'OK') {
    throw ApiError.internal(
      `Face registration failed: ${result?.message || 'the AI service returned an unexpected result.'}`
    );
  }

  const embedding = result?.embedding;
  if (!Array.isArray(embedding) || embedding.length === 0) {
    // Defensive: an OK status with no usable vector must still not mark the
    // person recognition-ready.
    throw ApiError.internal(
      'Face registration failed: the recognition model did not return a valid embedding. The person was not marked recognition-ready.'
    );
  }

  // Step 5: persist. The photograph goes through the EXISTING storage layer
  // (utils/snapshot.js) under a `people` subdirectory and is referenced by URL;
  // image bytes are never stored in MongoDB.
  const photoUrl = await saveSnapshot(req.body.image, person.personId, { subdir: 'people' });
  const previousPhoto = person.photo;

  person.faceEmbedding = embedding;
  person.embeddingModel = result?.embedding_model || null;
  person.embeddingDim = Number(result?.embedding_dim) || embedding.length;
  person.faceRegisteredAt = new Date();
  if (photoUrl) person.photo = photoUrl;
  await person.save();

  // Don't retain the superseded photograph.
  if (photoUrl && previousPhoto && previousPhoto !== photoUrl) {
    await removeStoredImage(previousPhoto);
  }

  // Never log the embedding itself — only its shape.
  logger.info(
    `Face registered for ${person.personId} (model=${person.embeddingModel || 'unknown'}, dim=${person.embeddingDim})`
  );

  await notifyAiCacheRefresh();

  res.json({
    success: true,
    data: {
      status: 'OK',
      // Both required messages: the detection outcome and the overall result.
      faceDetected: true,
      detectionMessage: REGISTRATION_MESSAGES.FACE_DETECTED,
      message: REGISTRATION_MESSAGES.COMPLETED,
      facesDetected: result?.faces_detected ?? 1,
      // Where the face was found, for an operator-facing preview overlay.
      boundingBox: Array.isArray(result?.bbox) ? result.bbox : null,
      detectionScore: result?.detection_score ?? null,
      // Derived readiness only. The embedding itself is NOT in this response.
      person: serializePerson(person),
    },
  });
});
