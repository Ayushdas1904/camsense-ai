import mongoose from 'mongoose';
import { Person } from '../models/Person.js';
import { aiClient } from './aiClient.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';
import { buildPersonFilter, serializePerson } from './identityRules.js';

/**
 * Person business rules, so controllers stay thin.
 *
 * The pure parts (filter construction, serialization) live in identityRules.js
 * and are re-exported here, which keeps them unit-testable without mongoose
 * while callers still import them from the service they belong to.
 */
export { buildPersonFilter, serializePerson };

/** Finds a person by Mongo _id or by their human personId (e.g. "P-001"). */
export async function findPersonOrThrow(idOrPersonId, { withEmbedding = false } = {}) {
  const query = mongoose.isValidObjectId(idOrPersonId)
    ? { _id: idOrPersonId }
    : { personId: idOrPersonId };

  const person = withEmbedding
    ? await Person.findOne(query).select('+faceEmbedding')
    : await Person.findOne(query);

  if (!person) throw ApiError.notFound('Person not found');
  return person;
}

/**
 * Loads a person by their human personId WITH the stored embedding.
 *
 * Used only by the trusted recognition workflow, which must inspect the
 * embedding's dimension to re-verify an identity claim. Returns null rather
 * than throwing, because a recognition report naming an unknown personId is a
 * claim to reject, not a request to fail.
 */
export async function findPersonForVerification(personId) {
  if (!personId) return null;
  return Person.findOne({ personId }).select('+faceEmbedding');
}

/**
 * The enrolled-identity payload the AI service's embedding cache reads.
 *
 * THIS IS THE ONLY PLACE IN THE BACKEND THAT READS EMBEDDINGS OUT TO A CALLER,
 * and its single consumer is the shared-secret-gated, service-to-service
 * endpoint GET /api/ai/face-embeddings. It is never reachable from the browser.
 *
 * Pre-filters to people who are genuinely matchable — active, recognition
 * enabled, and holding a stored vector whose length agrees with the dimension
 * the record declares. The AI-service cache trusts this filter and replaces its
 * contents wholesale, so a deactivated, recognition-disabled or deleted person
 * disappears from matching as soon as the cache refreshes.
 */
export async function listEnabledEmbeddings() {
  // `.select('+faceEmbedding')` is the explicit opt-in required by the model's
  // `select: false`. Querying on the field is unaffected by that setting.
  const people = await Person.find({
    active: true,
    recognitionEnabled: true,
    faceEmbedding: { $exists: true, $ne: [] },
  }).select('+faceEmbedding');

  const items = [];
  for (const person of people) {
    const embedding = person.faceEmbedding;
    if (!Array.isArray(embedding) || embedding.length === 0) continue;

    const declaredDim = Number(person.embeddingDim) || embedding.length;
    if (declaredDim !== embedding.length) {
      // A vector that disagrees with its own declared dimension is not
      // trustworthy to compare against. Skip it; never pad or truncate.
      logger.warn(
        `Skipping person ${person.personId}: stored embedding length does not match embeddingDim`
      );
      continue;
    }

    items.push({
      personId: person.personId,
      name: person.name,
      embedding,
      embeddingModel: person.embeddingModel || null,
      embeddingDim: declaredDim,
    });
  }

  return items;
}

/**
 * Asks the AI service to drop and re-fetch its identity cache.
 *
 * Called after any change that affects who is matchable (create, edit,
 * recognition toggle, deactivate, delete) so a removed or disabled identity
 * stops being recognisable immediately instead of lingering until the cache TTL
 * expires.
 *
 * Failure is SWALLOWED (with a warning) on purpose: the AI service being down
 * must never fail the person write that triggered this, and the cache will
 * reload at its TTL anyway. It is logged so the gap is visible — including the
 * case where the AI service answered but could not actually re-fetch, which it
 * reports as `refreshed: false`. In that case the AI service marks its cached
 * set out of date and fails matching closed until a refresh succeeds, so the
 * removed identity is not matchable in the meantime.
 */
export async function notifyAiCacheRefresh() {
  try {
    const result = await aiClient.refreshFaceCache();
    const payload = result?.data ?? result ?? {};
    const count = payload.candidates;
    // `refreshed` is the AI service's own report of whether a fetch actually
    // ran AND installed a new generation. Reading `candidates` alone used to
    // log a successful refresh from the PREVIOUS generation's count when no
    // fetch had happened at all.
    if (payload.refreshed === false) {
      logger.warn(
        'AI identity cache refresh did NOT complete: the AI service could not re-fetch the ' +
          `enrolled identities${payload.last_error ? ` (${payload.last_error})` : ''}. It has ` +
          'marked its cached set out of date, so matching fails closed until a refresh ' +
          'succeeds.'
      );
      return false;
    }
    logger.info(
      `AI identity cache refreshed${count === undefined ? '' : ` (${count} enrolled identities)`}`
    );
    return true;
  } catch (err) {
    logger.warn(
      `AI identity cache refresh failed (identities will refresh at cache TTL): ${err.message}`
    );
    return false;
  }
}
