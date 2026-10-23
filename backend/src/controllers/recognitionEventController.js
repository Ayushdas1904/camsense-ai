import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { RecognitionEvent } from '../models/RecognitionEvent.js';
import { Person } from '../models/Person.js';
import { Camera } from '../models/Camera.js';
import { toQueryString } from '../services/identityRules.js';

/**
 * Recognition events (Review 2) — READ ONLY.
 *
 * Events are written exclusively by recognitionService, behind the shared-secret
 * endpoint POST /api/ai/recognition. There is no client-facing write route,
 * because a client must never be able to assert that a recognition happened.
 *
 * Responses never include a face embedding: this controller selects from
 * RecognitionEvent (which has no embedding field) and enriches only with a
 * person's display fields.
 */

/** Bulk person/camera enrichment via Map lookups — no per-row queries. */
async function enrich(events) {
  const personIds = [...new Set(events.map((e) => e.personId).filter(Boolean))];
  const cameraIds = [...new Set(events.map((e) => e.cameraId).filter(Boolean))];

  const [people, cameras] = await Promise.all([
    Person.find({ personId: { $in: personIds } }).select('personId name category department'),
    Camera.find({ cameraId: { $in: cameraIds } }).select('cameraId name location'),
  ]);

  const personById = new Map(people.map((p) => [p.personId, p]));
  const cameraById = new Map(cameras.map((c) => [c.cameraId, c]));

  return events.map((event) => {
    const person = event.personId ? personById.get(event.personId) : null;
    const camera = cameraById.get(event.cameraId);
    return {
      id: event._id.toString(),
      cameraId: event.cameraId,
      cameraName: camera?.name || event.cameraId,
      location: camera?.location || null,
      status: event.status,
      // Populated only for a verified 'known' event.
      personId: event.personId || null,
      personName: person?.name || event.personName || null,
      category: person?.category || null,
      department: person?.department || null,
      // Cosine similarity — present only when a comparison happened. NOT a
      // detector confidence and NOT a calibrated probability.
      similarity: event.similarity ?? null,
      // The real coordinates reported by the AI service.
      boundingBox: event.boundingBox || null,
      snapshot: event.snapshot || null,
      trackId: event.trackId || null,
      source: event.source,
      acknowledged: event.acknowledged,
      alertId: event.alertId ? event.alertId.toString() : null,
      timestamp: event.timestamp,
    };
  });
}

export const listRecognitionEvents = asyncHandler(async (req, res) => {
  const { from, to, limit = 50, page = 1 } = req.query;

  // Coerced, not trusted: Express's extended query parser turns
  // `?status[$ne]=known` into an object, which would reach Mongo as an
  // operator and widen what the caller can read.
  const cameraId = toQueryString(req.query.cameraId);
  const status = toQueryString(req.query.status);
  const personId = toQueryString(req.query.personId);

  const filter = {};
  if (cameraId) filter.cameraId = cameraId;
  if (status) filter.status = status;
  if (personId) filter.personId = personId;
  if (from || to) {
    const range = {};
    // An unparseable date is ignored rather than passed to Mongo as an Invalid
    // Date, which would surface as an opaque cast error.
    const fromDate = typeof from === 'string' ? new Date(from) : null;
    const toDate = typeof to === 'string' ? new Date(to) : null;
    if (fromDate && !Number.isNaN(fromDate.getTime())) range.$gte = fromDate;
    if (toDate && !Number.isNaN(toDate.getTime())) range.$lte = toDate;
    if (Object.keys(range).length > 0) filter.timestamp = range;
  }

  const perPage = Math.min(Number(limit) || 50, 200);
  const skip = (Math.max(Number(page) || 1, 1) - 1) * perPage;

  const [events, total] = await Promise.all([
    RecognitionEvent.find(filter).sort({ timestamp: -1 }).skip(skip).limit(perPage),
    RecognitionEvent.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: { items: await enrich(events), total, page: Number(page) || 1, perPage },
  });
});

export const getRecognitionEvent = asyncHandler(async (req, res) => {
  const event = await RecognitionEvent.findById(req.params.id);
  if (!event) throw ApiError.notFound('Recognition event not found');
  const [enriched] = await enrich([event]);
  res.json({ success: true, data: enriched });
});
