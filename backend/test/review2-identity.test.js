/**
 * Review 2 — identity, attendance and alerting decision rules.
 *
 * Uses Node's built-in test runner (`node:test`, Node >= 18, already required
 * by package.json) so the suite adds no npm dependency. Run with `npm test`
 * from the backend/ directory.
 *
 * These tests target src/services/identityRules.js, which imports NOTHING — no
 * mongoose, no env, no AI client. That is deliberate: the rules that form the
 * backend's trust boundary are therefore verifiable without a live MongoDB,
 * without a running AI service, and without model weights.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  attendanceDateKey,
  attendanceDuplicatePreventionReady,
  attendanceWriteDue,
  buildPersonFilter,
  cooldownElapsed,
  escapeRegex,
  interpretUpsertResult,
  isPersistableRecognitionStatus,
  normalizeRecognitionStatus,
  serializePerson,
  shouldRaiseUnknownAlert,
  toQueryString,
  validateIdentityClaim,
} from '../src/services/identityRules.js';

const THRESHOLD = 0.363;

/** A person who is fully eligible to be recognised. */
function eligiblePerson(overrides = {}) {
  return {
    _id: 'abc123',
    personId: 'P-001',
    name: 'Test Participant',
    category: 'student',
    recognitionEnabled: true,
    active: true,
    faceEmbedding: new Array(128).fill(0.01),
    embeddingDim: 128,
    embeddingModel: 'sface_2021dec',
    ...overrides,
  };
}

// ── The threshold gate ────────────────────────────────────────────

test('a similarity below the configured threshold is rejected', () => {
  const result = validateIdentityClaim({
    person: eligiblePerson(),
    similarity: THRESHOLD - 0.0001,
    threshold: THRESHOLD,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'below_threshold');
});

test('a similarity exactly at the threshold is accepted', () => {
  const result = validateIdentityClaim({
    person: eligiblePerson(),
    similarity: THRESHOLD,
    threshold: THRESHOLD,
  });

  assert.equal(result.ok, true);
  assert.equal(result.reason, 'verified');
});

test('being the closest candidate does not matter — only the threshold does', () => {
  // 0.30 would be the best score in a batch, and the AI service may well have
  // reported it as its top candidate. It still must not be accepted.
  const result = validateIdentityClaim({
    person: eligiblePerson(),
    similarity: 0.3,
    threshold: THRESHOLD,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'below_threshold');
});

test('a missing or non-numeric similarity is rejected, never defaulted', () => {
  for (const similarity of [undefined, null, 'high', NaN, Infinity]) {
    const result = validateIdentityClaim({
      person: eligiblePerson(),
      similarity,
      threshold: THRESHOLD,
    });
    assert.equal(result.ok, false, `similarity ${String(similarity)} must be rejected`);
    assert.equal(result.reason, 'similarity_missing');
  }
});

// ── Person eligibility ────────────────────────────────────────────

test('a person with recognition disabled is rejected even above the threshold', () => {
  const result = validateIdentityClaim({
    person: eligiblePerson({ recognitionEnabled: false }),
    similarity: 0.95,
    threshold: THRESHOLD,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'recognition_disabled');
});

test('a deactivated person is rejected even above the threshold', () => {
  const result = validateIdentityClaim({
    person: eligiblePerson({ active: false }),
    similarity: 0.95,
    threshold: THRESHOLD,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'person_inactive');
});

test('an unknown personId is rejected', () => {
  const result = validateIdentityClaim({
    person: null,
    similarity: 0.95,
    threshold: THRESHOLD,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'person_not_found');
});

test('a person with no stored embedding is rejected', () => {
  const result = validateIdentityClaim({
    person: eligiblePerson({ faceEmbedding: undefined, embeddingDim: undefined }),
    similarity: 0.95,
    threshold: THRESHOLD,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no_embedding');
});

test('an embedding whose length disagrees with its declared dimension is rejected', () => {
  const result = validateIdentityClaim({
    person: eligiblePerson({ faceEmbedding: new Array(64).fill(0.01), embeddingDim: 128 }),
    similarity: 0.95,
    threshold: THRESHOLD,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'embedding_dim_mismatch');
});

test('an embedding that does not match the live model dimension is rejected', () => {
  const result = validateIdentityClaim({
    person: eligiblePerson({ faceEmbedding: new Array(512).fill(0.01), embeddingDim: 512 }),
    similarity: 0.95,
    threshold: THRESHOLD,
    expectedDim: 128,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'embedding_dim_mismatch');
});

test('a misconfigured threshold rejects rather than accepting by default', () => {
  const result = validateIdentityClaim({
    person: eligiblePerson(),
    similarity: 0.95,
    threshold: 'not-a-number',
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'threshold_misconfigured');
});

// ── Model metadata at the trust boundary ──────────────────────────

test('an embedding from a different model is rejected, not scored', () => {
  const result = validateIdentityClaim({
    person: eligiblePerson({ embeddingModel: 'some_other_model' }),
    similarity: 0.95,
    threshold: THRESHOLD,
    expectedDim: 128,
    expectedModel: 'sface_2021dec',
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'embedding_model_mismatch');
});

test('a matching model name passes, and both metadata checks apply together', () => {
  const result = validateIdentityClaim({
    person: eligiblePerson(),
    similarity: 0.95,
    threshold: THRESHOLD,
    expectedDim: 128,
    expectedModel: 'sface_2021dec',
  });

  assert.equal(result.ok, true);
  assert.equal(result.reason, 'verified');
});

test('an unknown model name on either side is not treated as a mismatch', () => {
  // A person enrolled before the model name was recorded, or a reporter that
  // sent none, must still be verifiable on the dimension checks alone.
  const noStoredModel = validateIdentityClaim({
    person: eligiblePerson({ embeddingModel: null }),
    similarity: 0.95,
    threshold: THRESHOLD,
    expectedDim: 128,
    expectedModel: 'sface_2021dec',
  });
  const noReportedModel = validateIdentityClaim({
    person: eligiblePerson(),
    similarity: 0.95,
    threshold: THRESHOLD,
    expectedDim: 128,
    expectedModel: null,
  });

  assert.equal(noStoredModel.ok, true);
  assert.equal(noReportedModel.ok, true);
});

// ── Unknown-identity persistence and cooldown ─────────────────────

const UNKNOWN_CONFIG = {
  unknownPersistenceCount: 2,
  unknownPersistenceWindowSec: 10,
  unknownAlertCooldownSec: 60,
};

test('the first sighting of an unknown face raises nothing', () => {
  const first = shouldRaiseUnknownAlert(undefined, 1_000_000, UNKNOWN_CONFIG);

  assert.equal(first.raise, false);
  assert.equal(first.reason, 'awaiting_persistence');
  assert.equal(first.sightings, 1);
});

test('an unknown face raises once the persistence count is met inside the window', () => {
  const now = 1_000_000;
  const first = shouldRaiseUnknownAlert(undefined, now, UNKNOWN_CONFIG);
  const second = shouldRaiseUnknownAlert(first.state, now + 2000, UNKNOWN_CONFIG);

  assert.equal(second.raise, true);
  assert.equal(second.reason, 'persisted');
  assert.equal(second.sightings, 2);
});

test('sightings that fall outside the persistence window do not accumulate', () => {
  const now = 1_000_000;
  const first = shouldRaiseUnknownAlert(undefined, now, UNKNOWN_CONFIG);
  // 11 s later: outside the 10 s window, so this counts as a fresh first sighting.
  const later = shouldRaiseUnknownAlert(first.state, now + 11_000, UNKNOWN_CONFIG);

  assert.equal(later.raise, false);
  assert.equal(later.reason, 'awaiting_persistence');
  assert.equal(later.sightings, 1);
});

test('the cooldown suppresses a second alert for the same continuously visible face', () => {
  const now = 1_000_000;
  const first = shouldRaiseUnknownAlert(undefined, now, UNKNOWN_CONFIG);
  const raised = shouldRaiseUnknownAlert(first.state, now + 1000, UNKNOWN_CONFIG);
  assert.equal(raised.raise, true);

  // Still visible a second later, and again two seconds after that.
  const third = shouldRaiseUnknownAlert(raised.state, now + 2000, UNKNOWN_CONFIG);
  const fourth = shouldRaiseUnknownAlert(third.state, now + 4000, UNKNOWN_CONFIG);

  assert.equal(third.raise, false);
  assert.equal(third.reason, 'cooldown');
  assert.equal(fourth.raise, false);
  assert.equal(fourth.reason, 'cooldown');
});

test('a new alert is allowed once the cooldown has elapsed', () => {
  const now = 1_000_000;
  const first = shouldRaiseUnknownAlert(undefined, now, UNKNOWN_CONFIG);
  const raised = shouldRaiseUnknownAlert(first.state, now + 1000, UNKNOWN_CONFIG);
  assert.equal(raised.raise, true);

  // 61 s after the alert: cooldown expired. Two sightings rebuild persistence.
  const after = now + 62_000;
  const a = shouldRaiseUnknownAlert(raised.state, after, UNKNOWN_CONFIG);
  const b = shouldRaiseUnknownAlert(a.state, after + 1000, UNKNOWN_CONFIG);

  assert.equal(b.raise, true);
  assert.equal(b.reason, 'persisted');
});

// ── Recognition status mapping ────────────────────────────────────

test('recognition_unavailable is a distinct status and is never treated as unknown', () => {
  assert.equal(normalizeRecognitionStatus('RECOGNITION_UNAVAILABLE'), 'recognition_unavailable');
  assert.notEqual(normalizeRecognitionStatus('RECOGNITION_UNAVAILABLE'), 'unknown');
});

test('every AI-service recognition status maps to a backend status', () => {
  assert.equal(normalizeRecognitionStatus('KNOWN'), 'known');
  assert.equal(normalizeRecognitionStatus('UNKNOWN'), 'unknown');
  assert.equal(normalizeRecognitionStatus('LOW_QUALITY'), 'low_quality');
  assert.equal(normalizeRecognitionStatus('NO_FACE'), 'no_face');
});

test('an unrecognised status is not guessed at', () => {
  assert.equal(normalizeRecognitionStatus('DEFINITELY_A_MATCH'), null);
  assert.equal(normalizeRecognitionStatus(undefined), null);
});

// ── Embedding redaction ───────────────────────────────────────────

test('serializePerson omits faceEmbedding entirely for a person who HAS one', () => {
  const person = eligiblePerson();
  const serialized = serializePerson(person);

  // The key must be ABSENT, not merely empty or falsy.
  assert.equal('faceEmbedding' in serialized, false);
  assert.equal(Object.keys(serialized).includes('faceEmbedding'), false);
  // Proof the fixture really did carry a vector.
  assert.equal(person.faceEmbedding.length, 128);
  // Readiness is communicated by derived flags instead.
  assert.equal(serialized.faceRegistered, true);
  assert.equal(serialized.recognitionReady, true);
  assert.equal(serialized.embeddingDim, 128);
});

test('no serialized person value contains the embedding vector', () => {
  const serialized = serializePerson(eligiblePerson());
  for (const [key, value] of Object.entries(serialized)) {
    assert.equal(Array.isArray(value), false, `${key} must not be an array of numbers`);
  }
});

test('recognitionReady is false when the person has no embedding', () => {
  const serialized = serializePerson(
    eligiblePerson({ faceEmbedding: undefined, embeddingDim: undefined })
  );

  assert.equal(serialized.faceRegistered, false);
  assert.equal(serialized.recognitionReady, false);
  assert.equal(serialized.embeddingDim, null);
});

test('recognitionReady is false when recognition is disabled or the person is inactive', () => {
  assert.equal(serializePerson(eligiblePerson({ recognitionEnabled: false })).recognitionReady, false);
  assert.equal(serializePerson(eligiblePerson({ active: false })).recognitionReady, false);
});

// ── Search filter safety ──────────────────────────────────────────

test('search terms are regex-escaped so metacharacters cannot alter the query', () => {
  assert.equal(escapeRegex('a+b'), 'a\\+b');
  assert.equal(escapeRegex('(a+)+$'), '\\(a\\+\\)\\+\\$');

  const filter = buildPersonFilter({ search: '(a+)+$' });
  // The pattern matches the literal text, not an expanded expression.
  assert.equal(filter.$or.length, 3);
  assert.equal(filter.$or[0].personId.test('(a+)+$'), true);
  assert.equal(filter.$or[0].personId.test('aaaa'), false);
});

test('buildPersonFilter normalises query-string booleans', () => {
  assert.deepEqual(buildPersonFilter({ active: 'true' }), { active: true });
  assert.deepEqual(buildPersonFilter({ active: 'false' }), { active: false });
  assert.deepEqual(buildPersonFilter({ recognitionEnabled: 'true' }), { recognitionEnabled: true });
  // Absent or blank filters must not constrain the query at all.
  assert.deepEqual(buildPersonFilter({ active: '' }), {});
  assert.deepEqual(buildPersonFilter({}), {});
});

// ── Attendance session + write throttle ───────────────────────────

test('the attendance session key is the local calendar date', () => {
  assert.equal(attendanceDateKey(new Date(2026, 9, 22, 10, 30)), '2026-10-22');
  // Month and day are zero-padded, so keys sort lexicographically.
  assert.equal(attendanceDateKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});

test('the first attendance sighting always writes', () => {
  assert.equal(attendanceWriteDue(undefined, 1_000_000, 30), true);
  assert.equal(attendanceWriteDue(null, 1_000_000, 30), true);
});

test('repeat sightings inside the cooldown do not trigger another write', () => {
  const now = 1_000_000;
  assert.equal(attendanceWriteDue(now, now + 5_000, 30), false);
  assert.equal(attendanceWriteDue(now, now + 29_999, 30), false);
  assert.equal(attendanceWriteDue(now, now + 30_000, 30), true);
});

// ── Known-event cooldown ──────────────────────────────────────────

test('the first known sighting always produces an event', () => {
  assert.equal(cooldownElapsed(undefined, 1_000_000, 30), true);
  assert.equal(cooldownElapsed(null, 1_000_000, 30), true);
});

test('a continuously recognised person does not produce an event per report', () => {
  const now = 1_000_000;
  // One report per second for the next 29 s must all be suppressed.
  for (let second = 1; second < 30; second += 1) {
    assert.equal(
      cooldownElapsed(now, now + second * 1000, 30),
      false,
      `a report ${second}s after the last event must not write another`
    );
  }
  assert.equal(cooldownElapsed(now, now + 30_000, 30), true);
});

test('a zero cooldown means every sighting is due (opt-out, not a crash)', () => {
  assert.equal(cooldownElapsed(1_000_000, 1_000_000, 0), true);
});

// ── Statuses that may never be persisted ──────────────────────────

test('only known and unknown may become stored events', () => {
  assert.equal(isPersistableRecognitionStatus('known'), true);
  assert.equal(isPersistableRecognitionStatus('unknown'), true);
  // An unavailable pipeline, an absent face and a too-small face are counted
  // only: no event, no attendance, no alert.
  assert.equal(isPersistableRecognitionStatus('recognition_unavailable'), false);
  assert.equal(isPersistableRecognitionStatus('no_face'), false);
  assert.equal(isPersistableRecognitionStatus('low_quality'), false);
  assert.equal(isPersistableRecognitionStatus(null), false);
  assert.equal(isPersistableRecognitionStatus('anything_else'), false);
});

test('the AI service status vocabulary maps onto the persistable set as expected', () => {
  assert.equal(
    isPersistableRecognitionStatus(normalizeRecognitionStatus('RECOGNITION_UNAVAILABLE')),
    false
  );
  assert.equal(isPersistableRecognitionStatus(normalizeRecognitionStatus('KNOWN')), true);
});

// ── Upsert result interpretation (attendance created vs. updated) ──

test('an upsert that inserted is reported as created', () => {
  const record = { _id: 'a1', firstSeen: new Date(1000), lastSeen: new Date(1000) };
  const result = interpretUpsertResult({
    value: record,
    lastErrorObject: { n: 1, updatedExisting: false, upserted: 'a1' },
    ok: 1,
  });

  assert.equal(result.created, true);
  assert.equal(result.record, record);
});

test('an upsert that updated an existing record is not reported as created', () => {
  const record = { _id: 'a1', firstSeen: new Date(1000), lastSeen: new Date(9000) };
  const result = interpretUpsertResult({
    value: record,
    lastErrorObject: { n: 1, updatedExisting: true },
    ok: 1,
  });

  assert.equal(result.created, false);
  assert.equal(result.record, record);
});

test('updatedExisting:false alone is enough to mean created', () => {
  // Guards the case where the driver reports the flag but not the upserted id.
  const result = interpretUpsertResult({
    value: { _id: 'a1' },
    lastErrorObject: { n: 1, updatedExisting: false },
    ok: 1,
  });

  assert.equal(result.created, true);
});

test('with no result metadata, firstSeen === lastSeen is the fallback for created', () => {
  const inserted = interpretUpsertResult({
    _id: 'a1',
    firstSeen: new Date(5000),
    lastSeen: new Date(5000),
  });
  const updated = interpretUpsertResult({
    _id: 'a1',
    firstSeen: new Date(5000),
    lastSeen: new Date(8000),
  });

  assert.equal(inserted.created, true);
  assert.equal(updated.created, false);
  assert.equal(updated.record._id, 'a1');
});

test('a missing upsert result is never reported as created', () => {
  assert.deepEqual(interpretUpsertResult(null), { created: false, record: null });
  assert.deepEqual(interpretUpsertResult(undefined), { created: false, record: null });
  assert.equal(interpretUpsertResult({ lastErrorObject: { n: 0 } }).created, false);
});

// ── NoSQL operator injection in read filters ──────────────────────

test('toQueryString passes plain strings and finite numbers', () => {
  assert.equal(toQueryString('2026-02-14'), '2026-02-14');
  assert.equal(toQueryString('  CAM-01  '), 'CAM-01');
  assert.equal(toQueryString(42), '42');
});

test('toQueryString drops anything that could reach Mongo as an operator', () => {
  // Express's extended query parser produces these from
  // `?date[$ne]=x`, `?date=a&date=b` and `?date[$gt][x]=1`.
  assert.equal(toQueryString({ $ne: 'x' }), undefined);
  assert.equal(toQueryString(['a', 'b']), undefined);
  assert.equal(toQueryString({ $gt: { x: 1 } }), undefined);
  assert.equal(toQueryString(''), undefined);
  assert.equal(toQueryString('   '), undefined);
  assert.equal(toQueryString(undefined), undefined);
  assert.equal(toQueryString(null), undefined);
  assert.equal(toQueryString(true), undefined);
  assert.equal(toQueryString(Number.NaN), undefined);
});

test('buildPersonFilter refuses an operator object in category or search', () => {
  assert.deepEqual(buildPersonFilter({ category: { $ne: 'student' } }), {});
  assert.deepEqual(buildPersonFilter({ search: { $ne: '' } }), {});
  // And still works for the legitimate case.
  assert.deepEqual(buildPersonFilter({ category: 'faculty' }), { category: 'faculty' });
});

// ── Attendance is not written without its database guarantee ───────

test('attendance requires a VERIFIED unique index, not merely a reported one', () => {
  // The unique { personId, date } index IS the duplicate-prevention
  // mechanism. Startup records whether it could be built and verified; the
  // write path consults that state and refuses rather than writing attendance
  // records nothing protects from duplication.
  assert.equal(attendanceDuplicatePreventionReady({ verified: true, error: null }), true);
  assert.equal(attendanceDuplicatePreventionReady({ verified: false, error: 'duplicates' }), false);
  // Anything other than an explicit true is a refusal — a missing state, a
  // truthy-but-not-true value, or an undefined import must not pass.
  assert.equal(attendanceDuplicatePreventionReady(undefined), false);
  assert.equal(attendanceDuplicatePreventionReady(null), false);
  assert.equal(attendanceDuplicatePreventionReady({}), false);
  assert.equal(attendanceDuplicatePreventionReady({ verified: 'yes' }), false);
  assert.equal(attendanceDuplicatePreventionReady({ verified: 1 }), false);
});
