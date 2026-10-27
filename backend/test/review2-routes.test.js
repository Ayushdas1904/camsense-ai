/**
 * Review 2 — route-surface guarantees.
 *
 * Reads the route files as text (node:fs, no dependency, no Express instance,
 * no database) and asserts the structural properties that make the backend the
 * trust boundary:
 *
 *   • attendance and recognition-event routers expose GET only, so no
 *     authenticated browser client can create an attendance record or assert
 *     that a recognition happened;
 *   • the two Review 2 service-to-service endpoints are shared-secret gated;
 *   • every mutating person route also requires the admin role;
 *   • the embeddings endpoint is the only route emitting biometric data, and it
 *     is internal-secret gated.
 *
 * A future change that quietly adds a client-facing attendance write, or drops
 * a guard, fails here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const routesDir = path.join(here, '..', 'src', 'routes');

const read = (file) => readFileSync(path.join(routesDir, file), 'utf8');

/** All `router.<method>(` verbs used in a route file. */
function routerMethods(source) {
  return [...source.matchAll(/router\.(get|post|put|patch|delete)\s*\(/g)].map((m) => m[1]);
}

/** The route-registration lines of a route file (comments excluded). */
function routeLines(source) {
  return source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => !line.startsWith('//') && !line.startsWith('*'))
    .join('\n');
}

test('the attendance router exposes GET only — no client-facing write path', () => {
  const methods = routerMethods(routeLines(read('attendanceRoutes.js')));

  assert.ok(methods.length > 0, 'the attendance router must register routes');
  assert.deepEqual([...new Set(methods)], ['get']);
  assert.equal(methods.includes('post'), false);
  assert.equal(methods.includes('put'), false);
  assert.equal(methods.includes('patch'), false);
  assert.equal(methods.includes('delete'), false);
});

test('the recognition-event router exposes GET only', () => {
  const methods = routerMethods(routeLines(read('recognitionEventRoutes.js')));

  assert.ok(methods.length > 0);
  assert.deepEqual([...new Set(methods)], ['get']);
});

test('no route file other than aiRoutes registers a recognition or attendance write', () => {
  for (const file of ['attendanceRoutes.js', 'recognitionEventRoutes.js', 'peopleRoutes.js']) {
    const source = routeLines(read(file));
    assert.equal(
      /router\.(post|put|patch|delete)\s*\(\s*['"][^'"]*(attendance|recognition-event)/i.test(source),
      false,
      `${file} must not register an attendance or recognition-event write`
    );
  }
});

test('the recognition ingest and embeddings endpoints are shared-secret gated', () => {
  const source = routeLines(read('aiRoutes.js'));

  assert.match(source, /router\.post\(\s*'\/recognition',\s*requireInternalSecret/);
  assert.match(source, /router\.get\(\s*'\/face-embeddings',\s*requireInternalSecret/);
  // The Review 1 detection ingest keeps its guard.
  assert.match(source, /router\.post\(\s*'\/ingest',\s*requireInternalSecret/);
  // The embeddings endpoint must NOT be reachable with a browser JWT.
  assert.equal(/'\/face-embeddings',\s*requireAuth/.test(source), false);
});

test('every mutating person route requires the admin role as well as auth', () => {
  const source = read('peopleRoutes.js');
  const mutations = [
    ...source.matchAll(/router\.(post|put|patch|delete)\s*\(([\s\S]*?)\);/g),
  ];

  assert.ok(mutations.length >= 5, 'expected the person create/update/toggle/delete/face routes');
  for (const [, method, body] of mutations) {
    assert.match(body, /requireAuth/, `${method} person route must require auth`);
    assert.match(
      body,
      /requireRole\('admin'\)/,
      `${method} person route must require the admin role`
    );
  }
});

test('the face-registration route exists and is admin-gated and validated', () => {
  const source = read('peopleRoutes.js');
  const match = /router\.post\(\s*\n?\s*'\/:id\/face-registration',([\s\S]*?)\);/.exec(source);

  assert.ok(match, 'POST /:id/face-registration must be registered');
  assert.match(match[1], /requireAuth/);
  assert.match(match[1], /requireRole\('admin'\)/);
  assert.match(match[1], /validate\(faceRegistrationSchema\)/);
});

test('the occupancy router exposes GET only — no client-facing headcount write', () => {
  const methods = routerMethods(routeLines(read('occupancyRoutes.js')));

  assert.ok(methods.length > 0, 'the occupancy router must register routes');
  assert.deepEqual([...new Set(methods)], ['get']);
  assert.equal(methods.includes('post'), false);
  assert.equal(methods.includes('put'), false);
  assert.equal(methods.includes('patch'), false);
  assert.equal(methods.includes('delete'), false);
});

test('the occupancy ingest is shared-secret gated and is the only occupancy write', () => {
  const source = routeLines(read('aiRoutes.js'));

  assert.match(source, /router\.post\(\s*'\/occupancy',\s*requireInternalSecret/);
  // Not reachable with a browser JWT — occupancy is AI-produced data.
  assert.equal(/'\/occupancy',\s*requireAuth/.test(source), false);

  // And no other route file registers an occupancy write.
  for (const file of ['occupancyRoutes.js', 'roomRoutes.js']) {
    const other = routeLines(read(file));
    assert.equal(
      /router\.(post|put|patch|delete)\s*\(\s*['"][^'"]*occupancy/i.test(other),
      false,
      `${file} must not register an occupancy write`
    );
  }
});

test('every mutating room route requires the admin role as well as auth', () => {
  const source = read('roomRoutes.js');
  const mutations = [
    ...source.matchAll(/router\.(post|put|patch|delete)\s*\(([\s\S]*?)\);/g),
  ];

  assert.ok(mutations.length >= 3, 'expected the room create/update/delete routes');
  for (const [, method, body] of mutations) {
    assert.match(body, /requireAuth/, `${method} room route must require auth`);
    assert.match(
      body,
      /requireRole\('admin'\)/,
      `${method} room route must require the admin role`
    );
  }
});

test('the Review 2 routers are mounted, and so are the Review 3 routers', () => {
  const source = read('index.js');
  const active = routeLines(source);

  assert.match(active, /router\.use\('\/people', peopleRoutes\)/);
  assert.match(active, /router\.use\('\/attendance', attendanceRoutes\)/);
  assert.match(active, /router\.use\('\/recognition-events', recognitionEventRoutes\)/);

  // Review 3 occupancy IS implemented now (it was a commented placeholder
  // through Review 2), so these mounts must be live.
  assert.match(active, /router\.use\('\/rooms', roomRoutes\)/);
  assert.match(active, /router\.use\('\/occupancy', occupancyRoutes\)/);

  // Review 3 devices, automation and energy are implemented too. /energy was
  // a commented placeholder until this feature mounted it.
  assert.match(active, /router\.use\('\/devices', deviceRoutes\)/);
  assert.match(active, /router\.use\('\/automation', automationRoutes\)/);
  assert.match(active, /router\.use\('\/energy', energyRoutes\)/);

  // The remaining placeholders are still unimplemented.
  for (const mount of ['analytics', 'notifications']) {
    assert.equal(
      new RegExp(`^router\\.use\\('/${mount}'`, 'm').test(active),
      false,
      `/${mount} must remain commented out until it is implemented`
    );
  }

  // Review 1 mounts are untouched.
  for (const mount of ['cameras', 'detections', 'alerts', 'dashboard', 'ai']) {
    assert.match(active, new RegExp(`router\\.use\\('/${mount}'`));
  }
});
