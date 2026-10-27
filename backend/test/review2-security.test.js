/**
 * Review 2 — exposure and authentication guarantees, asserted on SOURCE TEXT.
 *
 * Reads source files as text (node:fs, no dependency, no Express instance, no
 * database, no running service) and asserts the properties the reviews found
 * missing. A future change that re-opens one of them fails here.
 *
 * KNOW WHAT THIS IS WORTH. A text assertion proves a guard is WRITTEN, not
 * that it rejects a real request, and it breaks on an innocent refactor. The
 * runtime counterpart lives in `review2-uploads-auth.test.js`, which starts the
 * app on loopback and checks that an anonymous image request actually gets 401.
 * This file covers the properties that cannot be exercised without a database
 * or the ONNX weights (the AI service's own routing, the bind defaults, the
 * index enforcement).
 *
 * Each assertion exists because of a specific finding:
 *   • the AI service's face endpoints returned a face embedding with no
 *     authentication at all, and the service bound 0.0.0.0;
 *   • the backend served registration portraits and cropped face snapshots
 *     through an unauthenticated express.static mount;
 *   • the backend listened on every interface by default;
 *   • duplicate attendance prevention depended on an index nothing verified;
 *   • the two services shipped different default shared secrets;
 *   • dropped recognition reports were invisible to every status surface.
 *
 * Nothing in this repository has been executed (see docs/REVIEW2-REPORT.md §11).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const backendSrc = path.join(here, '..', 'src');
const aiService = path.join(here, '..', '..', 'ai-service');

const readBackend = (...segments) => readFileSync(path.join(backendSrc, ...segments), 'utf8');
const readAi = (...segments) => readFileSync(path.join(aiService, ...segments), 'utf8');

// ── Backend: stored images are not anonymously fetchable ──────────

test('the /uploads mount is authenticated', () => {
  const app = readBackend('app.js');

  // The mount serves detection snapshots, cropped face snapshots from
  // unknown-identity events, and enrolled people's registration portraits.
  assert.match(
    app,
    /app\.use\(\s*'\/uploads',\s*requireAssetAccess,/,
    '/uploads must be gated — it serves biometric photographs'
  );
  // And must not be re-added as a bare static mount.
  assert.equal(
    /app\.use\('\/uploads',\s*express\.static/.test(app),
    false,
    '/uploads must not be served without an auth guard'
  );
});

test('the image URL credential is narrowed, not the session token', () => {
  const auth = readBackend('middleware', 'auth.js');
  const token = readBackend('utils', 'token.js');
  const assetUrl = readFileSync(
    path.join(here, '..', '..', 'frontend', 'src', 'utils', 'assetUrl.ts'),
    'utf8'
  );

  // The asset mount verifies and loads a user, not merely the presence of a
  // parameter, and the query parameter takes ONLY an asset-scoped token.
  assert.match(auth, /export const requireAssetAccess/);
  assert.match(auth, /verifyAssetToken\(token\)/);
  assert.match(auth, /if \(!token\) throw ApiError\.unauthorized/);

  // The scope is actually checked on both sides: an asset token must not work
  // as a session credential, and a session token must not work as an asset one.
  assert.match(token, /payload\.scope !== ASSET_TOKEN_SCOPE/);
  assert.match(token, /if \(payload && payload\.scope\)/);

  // The frontend must put the narrowed token in image URLs, never the session.
  assert.match(assetUrl, /assetTokenStorage\.get\(\)/);
  assert.equal(
    /tokenStorage\.get\(\)/.test(assetUrl),
    false,
    'the session token must not be appended to image URLs'
  );
});

// ── Backend: private by default ───────────────────────────────────

test('the backend binds loopback by default', () => {
  assert.match(
    readBackend('config', 'env.js'),
    /host:\s*process\.env\.HOST\s*\|\|\s*'127\.0\.0\.1'/,
    'HOST must default to 127.0.0.1'
  );
  assert.match(
    readBackend('server.js'),
    /httpServer\.listen\(env\.port,\s*env\.host/,
    'the server must bind the configured host rather than every interface'
  );
});

// ── Backend: the service credential reaches the AI service ────────

test('every backend call to the AI service carries the service secret', () => {
  const client = readBackend('services', 'aiClient.js');

  assert.match(client, /'x-ai-secret':\s*env\.aiIngestSecret/);
  // aiFetch attaches it centrally…
  assert.match(client, /headers:\s*serviceHeaders\(options\.headers\)/);
  // …and the streaming proxy, which bypasses aiFetch, attaches it explicitly.
  assert.match(client, /\/api\/stream\/\$\{encodeURIComponent\(cameraId\)\}`,\s*\{[\s\S]*?serviceHeaders\(\)/);
});

test('the internal-secret middleware compares the value, it does not just look for a header', () => {
  const middleware = readBackend('middleware', 'internalAuth.js');

  assert.match(middleware, /timingSafeEqual/);
  assert.match(middleware, /secretsMatch\(secret, expected\)/);
  assert.match(middleware, /ApiError\.unauthorized/);
  // An unconfigured secret must reject everything rather than compare against
  // an empty string and admit a caller that sends nothing.
  assert.match(middleware, /if \(!expected\)/);
});

// ── Backend: duplicate attendance depends on a verified index ─────

test('the unique attendance index is built and verified at startup', () => {
  const db = readBackend('config', 'db.js');

  // createIndexes, NOT syncIndexes: syncIndexes also DROPS any index the
  // schema does not declare, which would remove an operator's out-of-band
  // reporting or retention index on the next start.
  //
  // The pattern matches an actual CALL (`.syncIndexes()`), not the bare word:
  // db.js explains in prose why syncIndexes() is not used, and a comment
  // naming the method it deliberately avoids is not a use of it.
  assert.match(db, /Attendance\.createIndexes\(\)/);
  assert.equal(
    /\.syncIndexes\(\)/.test(db),
    false,
    'syncIndexes drops indexes it did not declare — use createIndexes'
  );
  assert.match(db, /Attendance\.collection\.indexes\(\)/);
  assert.match(db, /index\.unique === true/);
  assert.match(db, /index\.key\.personId === 1/);
  assert.match(db, /index\.key\.date === 1/);
  assert.match(db, /await ensureCriticalIndexes\(\)/);
});

test('an unverified index disables attendance writes, not the whole backend', () => {
  const db = readBackend('config', 'db.js');
  const service = readBackend('services', 'attendanceService.js');

  // A failure must be recorded and logged, not thrown: throwing from
  // connectDatabase() stopped the process, taking Review 1 detection, alerts
  // and camera control down with it — none of which need attendance.
  assert.match(db, /export function getAttendanceIndexState/);
  assert.match(db, /logger\.error\(/);
  assert.equal(
    /throw new Error\(/.test(db),
    false,
    'a missing index must degrade attendance, not stop the backend from booting'
  );

  // And the attendance path must then refuse to write, because the unique
  // index IS the duplicate-prevention mechanism.
  //
  // Asserted as PROPERTIES, not as one exact spelling. The guard may bind the
  // state to a variable first (attendanceService.js does, so the refusal can
  // quote `indexState.error` back to the caller, which a nested call could
  // not), rename that variable, or wrap the condition across lines. All three
  // are the same guard, so none of them should fail this test. What must not
  // change is that the state is READ, that it GATES the write, and that the
  // refusal is an early return carrying the reason.
  assert.match(
    service,
    /getAttendanceIndexState\s*\(/,
    'attendanceService must read the index state startup recorded'
  );

  // The gate itself: the readiness check is negated inside an `if`, so it
  // decides something. A bare call whose result is discarded gates nothing.
  const gate = service.match(
    /if\s*\(\s*!\s*attendanceDuplicatePreventionReady\s*\(\s*([^)]*?)\s*\)/
  );
  assert.ok(
    gate,
    'the write must be gated by !attendanceDuplicatePreventionReady(...), not merely mention it'
  );

  // ...and what it is gated ON is the index state: either passed inline, or
  // bound to a variable (under any name) from getAttendanceIndexState().
  const gateArgument = gate[1];
  const gatedOnIndexState =
    /getAttendanceIndexState\s*\(/.test(gateArgument) ||
    (/^[A-Za-z_$][\w$]*$/.test(gateArgument) &&
      new RegExp(
        `(?:const|let|var)\\s+${gateArgument}\\s*=\\s*(?:await\\s+)?getAttendanceIndexState\\s*\\(`
      ).test(service));
  assert.ok(
    gatedOnIndexState,
    `the guard must be fed by getAttendanceIndexState(), got \`${gateArgument}\``
  );

  // The refusal is an EARLY RETURN carrying the reason, so attendance writes
  // stop while the process keeps running. Not a throw, and not an exit.
  assert.match(service, /rejected: 'duplicate_prevention_unverified'/);
  assert.match(
    service,
    /return\s*\{[^}]*rejected:\s*'duplicate_prevention_unverified'/,
    'the refusal must be returned to the caller, not thrown'
  );
  const refusalIndex = service.indexOf("rejected: 'duplicate_prevention_unverified'");
  assert.ok(
    refusalIndex > gate.index,
    'the refusal must be inside the guard it belongs to, not before it'
  );
  assert.equal(
    /\bthrow\b/.test(service.slice(gate.index, refusalIndex)),
    false,
    'the duplicate-prevention guard must return, not throw'
  );
  assert.equal(
    /process\.exit\(/.test(service),
    false,
    'an unverified index must disable attendance writes, not stop the backend'
  );
});

test('attendance writes still go through one atomic upsert on that key', () => {
  const service = readBackend('services', 'attendanceService.js');

  assert.match(service, /findOneAndUpdate\(\{ personId: person\.personId, date \}/);
  assert.match(service, /upsert: true/);
  assert.match(service, /err\?\.code === 11000/);
  // The throttle timestamp must be recorded after the write, so a failed write
  // does not block retries for the length of the cooldown.
  const upsertIndex = service.indexOf('findOneAndUpdate');
  const throttleIndex = service.indexOf('lastWriteAt.set');
  assert.ok(
    upsertIndex < throttleIndex,
    'the write throttle must be recorded after the upsert, not before it'
  );
});

// ── AI service: the face endpoints are gated, the bind is loopback ─

test('the AI service requires its service secret on the face endpoints', () => {
  const routes = readAi('app', 'api', 'routes.py');

  assert.match(routes, /secured = APIRouter\(dependencies=\[Depends\(require_service_secret\)\]\)/);
  for (const route of [
    '@secured.post\\("/faces/register"',
    '@secured.post\\("/faces/cache/refresh"',
    '@secured.get\\("/faces/status"',
  ]) {
    assert.match(routes, new RegExp(route), `${route} must be registered on the secured router`);
  }
  // No face route may be registered on the open router.
  assert.equal(
    /@router\.(get|post)\("\/faces/.test(routes),
    false,
    'no /faces route may be unauthenticated — /faces/register emits an embedding'
  );
});

test('the inherited stream endpoints are gated too', () => {
  const routes = readAi('app', 'api', 'routes.py');

  for (const route of [
    '@secured.post\\("/stream/start"',
    '@secured.post\\("/stream/\\{camera_id\\}/stop"',
    '@secured.post\\("/stream/\\{camera_id\\}/demo-weapon"',
    '@secured.get\\("/stream/\\{camera_id\\}/stats"',
    '@secured.get\\("/stream/\\{camera_id\\}"',
    '@secured.get\\("/status"',
  ]) {
    assert.match(routes, new RegExp(route), `${route} must require the service secret`);
  }
  // /health stays open as a liveness probe, and is the ONLY open route.
  assert.match(routes, /@router\.get\("\/health"/);
  const openRoutes = [...routes.matchAll(/@router\.(get|post)\("([^"]+)"/g)].map((m) => m[2]);
  assert.deepEqual(openRoutes, ['/health']);
});

test('the AI service gate verifies the secret and fails closed when none is set', () => {
  const security = readAi('app', 'api', 'security.py');

  assert.match(security, /secrets\.compare_digest/);
  assert.match(security, /HTTP_401_UNAUTHORIZED/);
  // An unconfigured secret must reject everything rather than allow everything.
  assert.match(security, /if not expected:/);
  assert.match(security, /HTTP_503_SERVICE_UNAVAILABLE/);
});

test('the AI service binds loopback by default and ships no default secret', () => {
  const config = readAi('app', 'config.py');

  assert.match(
    config,
    /host:\s*str\s*=\s*"127\.0\.0\.1"/,
    'AI_SERVICE_HOST must default to loopback'
  );
  assert.equal(/host:\s*str\s*=\s*"0\.0\.0\.0"/.test(config), false);
  // No default shared secret: a non-empty one could never match the backend's
  // own default, so a no-.env run 401'd every backend→AI call and took Review 1
  // monitoring down with it. Empty means the fail-closed 503 fires instead,
  // naming the variable to set.
  assert.match(config, /ingest_secret:\s*str\s*=\s*""/);
  assert.equal(
    readAi('.env.example').includes('AI_SERVICE_HOST=0.0.0.0'),
    false,
    'the shipped example config must not tell a developer to bind every interface'
  );
});

// ── Identity work must not block Review 1 detection ───────────────

test('the camera worker does no blocking backend I/O on the detection thread', () => {
  const faceService = readAi('app', 'recognition', 'face_service.py');
  const reporter = readAi('app', 'services', 'event_reporter.py');

  // The per-frame cache refresh is dispatched, not awaited.
  assert.match(faceService, /ensure_fresh\([\s\S]*?blocking=False/);
  // Both report legs post from a background thread.
  assert.match(reporter, /self\._dispatch\("detection", camera_id, self\._post_ingest/);
  assert.match(reporter, /self\._dispatch\("recognition", camera_id, self\._post_recognition/);
  assert.match(reporter, /MAX_IN_FLIGHT_REPORTS/);
});

test('a dropped report is counted, surfaced, and treated as a leg failure', () => {
  const reporter = readAi('app', 'services', 'event_reporter.py');
  const pipeline = readAi('app', 'services', 'pipeline.py');
  const routes = readAi('app', 'api', 'routes.py');
  const schemas = readAi('app', 'models', 'schemas.py');

  // Counted per leg AND per camera (the cap used to be global, so a merely
  // slow backend plus a few cameras dropped reports routinely).
  assert.match(reporter, /self\._dropped\[key\] = self\._dropped\.get\(key, 0\) \+ 1/);
  assert.match(reporter, /def dropped_reports/);
  // A drop means the backend never learned about the sighting, so the leg is
  // not working — the status panel must not read `active`.
  assert.match(reporter, /self\.recognition_leg_ok = False/);
  assert.match(pipeline, /seconds_since_drop\("recognition"\)/);
  // And the count is visible through the API, not only in stdout.
  assert.match(schemas, /recognition_reports_dropped: int = 0/);
  assert.match(routes, /recognition_reports_dropped=reporter\.dropped_reports/);
  // In-flight POSTs are drained briefly at shutdown rather than abandoned.
  assert.match(reporter, /def shutdown/);
  assert.match(readAi('app', 'main.py'), /reporter\.shutdown\(\)/);
});

test('face detection runs on the recognition cadence, not every frame', () => {
  const stream = readAi('app', 'services', 'stream_manager.py');

  // An empty list (not None) is passed on non-recognition frames, so the
  // pipeline's face detector does not fall back to its own YuNet pass.
  assert.match(stream, /faces: list\[dict\] = \[\]/);
  assert.match(stream, /detections = pipeline\.run\(frame, faces=faces\)/);
  assert.equal(
    /faces = None/.test(stream),
    false,
    'passing faces=None would make the pipeline run face detection on every frame'
  );
});
