/**
 * Backend test harness smoke test.
 *
 * Uses Node's built-in test runner (`node:test`, available on Node >= 18, which
 * package.json already requires) so the suite adds no npm dependency. Run with
 * `npm test` from the backend/ directory.
 *
 * The assertions below exercise real Review 1 code (src/utils/ApiError.js) and
 * are deliberately written against the property names that file actually
 * defines — `statusCode`, `message`, `details`, `isOperational`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { ApiError } from '../src/utils/ApiError.js';

test('ApiError.notFound carries HTTP 404 on statusCode', () => {
  const err = ApiError.notFound('x');

  assert.ok(err instanceof ApiError);
  assert.ok(err instanceof Error);
  assert.equal(err.statusCode, 404);
  assert.equal(err.message, 'x');
  assert.equal(err.isOperational, true);
});

test('ApiError factories map to their documented status codes', () => {
  assert.equal(ApiError.badRequest().statusCode, 400);
  assert.equal(ApiError.unauthorized().statusCode, 401);
  assert.equal(ApiError.forbidden().statusCode, 403);
  assert.equal(ApiError.notFound().statusCode, 404);
  assert.equal(ApiError.conflict().statusCode, 409);
  assert.equal(ApiError.internal().statusCode, 500);
});

test('ApiError.badRequest passes validation details through untouched', () => {
  const details = [{ path: 'email', message: 'A valid email is required' }];
  const err = ApiError.badRequest('Invalid request body', details);

  assert.equal(err.statusCode, 400);
  assert.deepEqual(err.details, details);
});
