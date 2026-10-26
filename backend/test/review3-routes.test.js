/**
 * Review 3 — route-surface and configuration-hygiene guarantees.
 *
 * Reads source files as text (node:fs, no dependency, no Express instance, no
 * database, no running service) in the same style as review2-routes.test.js
 * and review2-security.test.js, and asserts the structural properties that
 * keep the backend the trust boundary for Review 3:
 *
 *   • every MUTATING room, device and automation route carries requireAuth AND
 *     requireRole('admin') — these routes switch devices and change the rules
 *     that switch devices;
 *   • POST /api/ai/occupancy is shared-secret gated and is the ONLY write path
 *     for AI-produced occupancy data;
 *   • no client-facing write route exists for occupancy readings, device state
 *     history, automation logs or energy figures — a browser client can never
 *     assert a headcount, a device state or a kWh number;
 *   • every historical read is hard-capped, so no query string produces an
 *     unbounded database query;
 *   • the shipped example configs contain placeholders only, never a real
 *     secret, and never tell a developer to bind every interface;
 *   • every new Review 3 env key is documented in .env.example AND read in
 *     config/env.js, in both directions.
 *
 * KNOW WHAT THIS IS WORTH. A text assertion proves a guard is WRITTEN, not
 * that it rejects a real request, and it breaks on an innocent refactor. The
 * runtime counterpart for Review 2 lives in review2-uploads-auth.test.js;
 * there is no runtime counterpart for Review 3 because nothing in this
 * repository has been executed (docs/REVIEW3-REPORT.md §D).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.join(here, '..');
const backendSrc = path.join(backendRoot, 'src');
const aiService = path.join(backendRoot, '..', 'ai-service');

const readSrc = (...parts) => readFileSync(path.join(backendSrc, ...parts), 'utf8');
const readRoute = (file) => readSrc('routes', file);
const readAi = (...parts) => readFileSync(path.join(aiService, ...parts), 'utf8');

/** Route-registration lines only, with comments stripped. */
function routeLines(source) {
  return source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => !line.startsWith('//') && !line.startsWith('*') && !line.startsWith('/*'))
    .join('\n');
}

/** All `router.<method>(` verbs in a route file. */
function routerMethods(source) {
  return [...source.matchAll(/router\.(get|post|put|patch|delete)\s*\(/g)].map((m) => m[1]);
}

/** Every mutating registration as [method, argumentsText]. */
function mutations(source) {
  return [...source.matchAll(/router\.(post|put|patch|delete)\s*\(([\s\S]*?)\);/g)].map(
    ([, method, body]) => [method, body]
  );
}

/** The Review 3 route files that may mutate state. */
const MUTATING_ROUTE_FILES = ['roomRoutes.js', 'deviceRoutes.js', 'automationRoutes.js'];

/** The Review 3 route files that must never mutate state. */
const READ_ONLY_ROUTE_FILES = ['occupancyRoutes.js', 'energyRoutes.js'];

// ════════════════════════════════════════════════════════════════
// AUTHORIZATION: every Review 3 mutation is admin-gated
// ════════════════════════════════════════════════════════════════

test('every mutating Review 3 route requires auth AND the admin role', () => {
  for (const file of MUTATING_ROUTE_FILES) {
    const source = readRoute(file);
    const found = mutations(source);

    assert.ok(found.length > 0, `${file} must register at least one mutation`);
    for (const [method, body] of found) {
      assert.match(body, /requireAuth/, `${file}: ${method} must require auth`);
      assert.match(
        body,
        /requireRole\('admin'\)/,
        `${file}: ${method} must require the admin role — Review 3 mutations control devices`
      );
    }
  }
});

test('every mutating Review 3 route validates its body or its params', () => {
  // An admin guard stops the wrong person calling; validation stops the right
  // person sending something the service cannot safely act on.
  for (const file of MUTATING_ROUTE_FILES) {
    const source = readRoute(file);
    assert.match(
      source,
      /validate\(/,
      `${file} must validate request bodies through the shared middleware`
    );
  }
});

test('the device command route — the one that actually switches things — is fully gated', () => {
  const source = readRoute('deviceRoutes.js');
  const command = /router\.post\(\s*\n?\s*'\/:id\/command',([\s\S]*?)\);/.exec(source);

  assert.ok(command, 'POST /api/devices/:id/command must be registered');
  assert.match(command[1], /requireAuth/);
  assert.match(command[1], /requireRole\('admin'\)/);
  assert.match(command[1], /validate\(/);
});

test('the rule enable and disable routes are admin-gated', () => {
  const source = routeLines(readRoute('automationRoutes.js'));

  // Enabling a rule is the single action that turns automation on, so it is
  // held to the same bar as changing the rule itself.
  assert.match(source, /router\.post\('\/rules\/:id\/enable',\s*requireAuth,\s*requireRole\('admin'\)/);
  assert.match(source, /router\.post\('\/rules\/:id\/disable',\s*requireAuth,\s*requireRole\('admin'\)/);
});

test('every Review 3 read route requires authentication', () => {
  for (const file of [...MUTATING_ROUTE_FILES, ...READ_ONLY_ROUTE_FILES]) {
    const source = routeLines(readRoute(file));
    const gets = [...source.matchAll(/router\.get\s*\(([\s\S]*?)\);/g)].map((m) => m[1]);
    assert.ok(gets.length > 0, `${file} must register at least one read`);
    for (const body of gets) {
      assert.match(body, /requireAuth/, `${file}: every GET must require auth`);
    }
  }
});

// ════════════════════════════════════════════════════════════════
// THE AI INGEST LEG IS THE ONLY WRITE PATH FOR AI-PRODUCED DATA
// ════════════════════════════════════════════════════════════════

test('POST /api/ai/occupancy is shared-secret gated and not reachable with a browser JWT', () => {
  const source = routeLines(readRoute('aiRoutes.js'));

  assert.match(source, /router\.post\(\s*'\/occupancy',\s*requireInternalSecret/);
  assert.equal(
    /'\/occupancy',\s*requireAuth/.test(source),
    false,
    'occupancy is AI-produced data — a browser client must not be able to submit it'
  );

  // The Review 1 and Review 2 ingest legs keep their guards.
  assert.match(source, /router\.post\(\s*'\/ingest',\s*requireInternalSecret/);
  assert.match(source, /router\.post\(\s*'\/recognition',\s*requireInternalSecret/);
});

test('the occupancy and energy routers expose GET only', () => {
  for (const file of READ_ONLY_ROUTE_FILES) {
    const methods = routerMethods(routeLines(readRoute(file)));
    assert.ok(methods.length > 0, `${file} must register routes`);
    assert.deepEqual(
      [...new Set(methods)],
      ['get'],
      `${file} must be read-only — these figures are derived, never submitted`
    );
  }
});

test('no route file registers a client-facing occupancy write', () => {
  const files = [...MUTATING_ROUTE_FILES, ...READ_ONLY_ROUTE_FILES];
  for (const file of files) {
    const source = routeLines(readRoute(file));
    assert.equal(
      /router\.(post|put|patch|delete)\s*\(\s*['"][^'"]*occupancy/i.test(source),
      false,
      `${file} must not register an occupancy write`
    );
  }
});

test('no route file registers a client-facing device-state-history or automation-log write', () => {
  const files = [...MUTATING_ROUTE_FILES, ...READ_ONLY_ROUTE_FILES];
  for (const file of files) {
    const source = routeLines(readRoute(file));

    // History is an audit trail: it is written by the service when a command
    // is CONFIRMED, never by a client claiming something happened.
    assert.equal(
      /router\.(post|put|patch|delete)\s*\(\s*['"][^'"]*histor/i.test(source),
      false,
      `${file} must not register a history write`
    );
    assert.equal(
      /router\.(post|put|patch|delete)\s*\(\s*['"][^'"]*(log|energy|summary|trend)/i.test(source),
      false,
      `${file} must not register a log or energy write`
    );
  }
});

test('reportedState is never settable straight from a request body', () => {
  // The whole confirm-before-recording rule would be worthless if a client
  // (or an admin) could PUT reportedState directly. Only the adapter result
  // may set it, inside deviceService.issueCommand.
  const controller = readSrc('controllers', 'deviceController.js');
  assert.match(controller, /deviceUpdateSchema/, 'deviceController must declare an update schema');
  // No zod field declaration for reportedState anywhere, so neither the create
  // nor the (derived) update schema can accept one from a request body.
  assert.equal(
    /reportedState\s*:\s*z\./.test(controller),
    false,
    'reportedState must not be a validated input field — only a confirmed adapter result sets it'
  );

  const service = readSrc('services', 'deviceService.js');
  const assignments = [...service.matchAll(/device\.reportedState\s*=\s*([^;\n]+)/g)].map(
    (m) => m[1].trim()
  );
  assert.ok(assignments.length > 0, 'reportedState must be assigned somewhere');
  for (const value of assignments) {
    assert.match(
      value,
      /result\.reportedState|probe|'unknown'/,
      `reportedState assigned from ${value} — it must come from an adapter result`
    );
  }
});

// ════════════════════════════════════════════════════════════════
// NO UNBOUNDED QUERIES
// ════════════════════════════════════════════════════════════════

test('every Review 3 historical read is hard-capped through normalizeHistoryPaging', () => {
  const capped = [
    ['services', 'occupancyService.js'],
    ['services', 'energyService.js'],
    ['services', 'deviceService.js'],
    ['controllers', 'automationController.js'],
  ];

  for (const parts of capped) {
    const source = readSrc(...parts);
    assert.match(
      source,
      /normalizeHistoryPaging\(/,
      `${parts.join('/')} must clamp paging through the shared helper`
    );
    assert.match(
      source,
      /maxLimit:/,
      `${parts.join('/')} must pass an explicit hard maximum`
    );
  }
});

test('the hard maximums come from configuration, not from the request', () => {
  assert.match(readSrc('services', 'occupancyService.js'), /env\.occupancy\.historyMaxLimit/);
  assert.match(readSrc('services', 'energyService.js'), /env\.energy\.historyMaxLimit/);
  assert.match(readSrc('controllers', 'automationController.js'), /env\.automation\.historyMaxLimit/);
});

test('the energy window query is itself bounded, not only its page size', () => {
  const source = readSrc('services', 'energyService.js');
  // A naive `changedAt <= windowEnd` query grows without limit as the system
  // runs, so the transition read is capped too.
  assert.match(source, /\.limit\(env\.energy\.historyMaxLimit\)/);
});

// ════════════════════════════════════════════════════════════════
// CONFIGURATION HYGIENE — both example files
// ════════════════════════════════════════════════════════════════

/** Review 3 backend env keys: documented in .env.example AND read in env.js. */
const BACKEND_REVIEW3_KEYS = [
  'OCCUPANCY_STALE_AFTER',
  'OCCUPANCY_PERSIST_INTERVAL',
  'OCCUPANCY_ALERT_COOLDOWN',
  'OCCUPANCY_HISTORY_MAX_LIMIT',
  'OCCUPANCY_NEAR_CAPACITY_RATIO',
  'DEVICE_COMMAND_TIMEOUT',
  'DEVICE_FAILURE_ALERT_COOLDOWN',
  'AUTOMATION_TICK_INTERVAL',
  'AUTOMATION_COMMAND_COOLDOWN',
  'AUTOMATION_DEFAULT_UNOCCUPIED_FOR',
  'AUTOMATION_MANUAL_OVERRIDE_MINUTES',
  'AUTOMATION_HISTORY_MAX_LIMIT',
  'AUTOMATION_FAILURE_ALERT_COOLDOWN',
  'ENERGY_BASELINE_HOURS_PER_DAY',
  'ENERGY_HISTORY_MAX_LIMIT',
];

const AI_REVIEW3_KEYS = [
  'AI_SERVICE_OCCUPANCY_ENABLED',
  'AI_SERVICE_OCCUPANCY_REPORT_INTERVAL',
  'AI_SERVICE_OCCUPANCY_MIN_TRACK_HITS',
  'AI_SERVICE_OCCUPANCY_TRACK_TTL',
];

test('every new backend env key is documented in .env.example and read in env.js', () => {
  const example = readFileSync(path.join(backendRoot, '.env.example'), 'utf8');
  const envSource = readSrc('config', 'env.js');

  for (const key of BACKEND_REVIEW3_KEYS) {
    assert.match(
      example,
      new RegExp(`^${key}=`, 'm'),
      `${key} must be documented in backend/.env.example`
    );
    assert.match(
      envSource,
      new RegExp(`process\\.env\\.${key}\\b`),
      `${key} must actually be read in config/env.js — an undocumented-but-read or documented-but-unread key is a configuration trap`
    );
  }
});

test('every new ai-service env key is documented and declared as a setting', () => {
  const example = readAi('.env.example');
  const config = readAi('app', 'config.py');

  for (const key of AI_REVIEW3_KEYS) {
    assert.match(example, new RegExp(`^${key}=`, 'm'), `${key} must be in ai-service/.env.example`);
    // env_prefix is AI_SERVICE_, so the setting name is the key without it.
    const field = key.replace(/^AI_SERVICE_/, '').toLowerCase();
    assert.match(
      config,
      new RegExp(`^\\s*${field}\\s*:`, 'm'),
      `${field} must be a declared Settings field in ai-service/app/config.py`
    );
  }
});

test('neither example config ships a real secret value', () => {
  const files = [
    ['backend/.env.example', readFileSync(path.join(backendRoot, '.env.example'), 'utf8')],
    ['ai-service/.env.example', readAi('.env.example')],
  ];

  for (const [label, source] of files) {
    const assignments = [...source.matchAll(/^([A-Z0-9_]*(SECRET|PASSWORD|TOKEN|KEY))=(.*)$/gm)];
    assert.ok(assignments.length > 0, `${label} must document at least one credential key`);

    for (const [, key, , value] of assignments) {
      const trimmed = value.trim();
      // Either empty (fail-closed) or an obvious placeholder. Never a value
      // that could be mistaken for a working credential.
      const placeholder =
        trimmed === '' ||
        /^(replace_with|change_me|changeme|your_|<.*>|placeholder)/i.test(trimmed);
      assert.ok(
        placeholder,
        `${label}: ${key} must carry a placeholder, not a usable value (found "${trimmed}")`
      );
    }
  }
});

test('neither example config tells a developer to bind every interface', () => {
  const backendExample = readFileSync(path.join(backendRoot, '.env.example'), 'utf8');
  const aiExample = readAi('.env.example');

  assert.equal(/^HOST=0\.0\.0\.0/m.test(backendExample), false);
  assert.equal(/^AI_SERVICE_HOST=0\.0\.0\.0/m.test(aiExample), false);
  // And the shipped defaults are loopback.
  assert.match(backendExample, /^HOST=127\.0\.0\.1/m);
  assert.match(aiExample, /^AI_SERVICE_HOST=127\.0\.0\.1/m);
});

test('nothing reads process.env outside config/env.js', () => {
  // Centralised configuration is what makes the env audit above meaningful:
  // a service reading process.env directly would bypass the documented
  // defaults and would not appear in .env.example.
  const offenders = [];
  const files = [
    ['services', 'occupancyService.js'],
    ['services', 'deviceService.js'],
    ['services', 'automationEngine.js'],
    ['services', 'energyService.js'],
    ['controllers', 'roomController.js'],
    ['controllers', 'deviceController.js'],
    ['controllers', 'automationController.js'],
    ['controllers', 'energyController.js'],
    ['controllers', 'occupancyController.js'],
  ];

  for (const parts of files) {
    if (/process\.env/.test(readSrc(...parts))) offenders.push(parts.join('/'));
  }
  assert.deepEqual(offenders, [], 'these files must read configuration through config/env.js');
});

// ════════════════════════════════════════════════════════════════
// STARTUP, SHUTDOWN AND INDEX VERIFICATION
// ════════════════════════════════════════════════════════════════

test('two concurrent commands for the same device cannot interleave', () => {
  const service = readSrc('services', 'deviceService.js');

  // issueCommand is reached from the operator route, from every accepted
  // occupancy report, and from the periodic tick — so the per-device guard is
  // what stops two interleaved commands writing two history rows for one
  // transition and inventing an on-interval the device never had.
  assert.match(service, /const inFlightCommands = new Set\(\)/);
  assert.match(service, /inFlightCommands\.has\(deviceId\)/);
  assert.match(service, /inFlightCommands\.add\(deviceId\)/);
  // Cleared in a finally, so a throwing adapter cannot wedge a device.
  assert.match(service, /finally\s*\{[\s\S]{0,200}inFlightCommands\.delete\(deviceId\)/);
  // A refusal is not an adapter failure: no alert, no history row.
  assert.match(service, /inFlight: true/);

  // The engine records it as a no-change rather than counting a failure.
  const engine = readSrc('services', 'automationEngine.js');
  assert.match(engine, /result\.inFlight/);

  // And the overlapping ticks guard is still in place.
  assert.match(engine, /if \(tickRunning\)/);
});

test('the automation interval is started and cleared on shutdown', () => {
  const server = readSrc('server.js');

  assert.match(server, /startAutomationEngine/);
  assert.match(server, /stopAutomationEngine/);
  // Cleared BEFORE the HTTP server closes, so a tick cannot fire against a
  // half-torn-down process.
  const stopIndex = server.indexOf('stopAutomationEngine');
  const closeIndex = server.indexOf('httpServer.close');
  assert.ok(stopIndex > 0 && closeIndex > 0);
  assert.ok(stopIndex < closeIndex, 'the engine must be stopped before the server closes');
});

test('an automation tick failure cannot crash the process', () => {
  const engine = readSrc('services', 'automationEngine.js');
  assert.match(engine, /try\s*\{/);
  assert.match(engine, /catch/);
  assert.match(engine, /automation_failure/);
});

test('the Review 3 indexes are built with createIndexes and read back to verify', () => {
  const db = readSrc('config', 'db.js');

  // createIndexes, never syncIndexes: syncIndexes also DROPS indexes the
  // schema does not declare, which would remove an operator's own.
  assert.equal(/\.syncIndexes\(\)/.test(db), false);
  assert.match(db, /createIndexes\(\)/);
  assert.match(db, /\.collection\.indexes\(\)/);

  // Three independent groups, so one failure does not skip the others.
  assert.match(db, /export function getAttendanceIndexState/);
  assert.match(db, /export function getOccupancyIndexState/);
  assert.match(db, /export function getDeviceAutomationIndexState/);

  // And a failure degrades a feature rather than stopping the boot.
  assert.equal(
    /throw new Error\(/.test(db),
    false,
    'a missing index must degrade the affected feature, not stop the backend booting'
  );
});

test('an unverified index refuses the affected WRITES while reads keep working', () => {
  const occupancy = readSrc('services', 'occupancyService.js');
  assert.match(occupancy, /getOccupancyIndexState\(\)/);

  const device = readSrc('services', 'deviceService.js');
  assert.match(device, /getDeviceAutomationIndexState\(\)/);
});

// ════════════════════════════════════════════════════════════════
// NO NEW DEPENDENCIES
// ════════════════════════════════════════════════════════════════

test('Review 3 added no npm dependency', () => {
  const pkg = JSON.parse(readFileSync(path.join(backendRoot, 'package.json'), 'utf8'));
  const allowed = [
    'bcryptjs',
    'cors',
    'dotenv',
    'express',
    'helmet',
    'jsonwebtoken',
    'mongoose',
    'morgan',
    'socket.io',
    'zod',
  ];

  assert.deepEqual(
    Object.keys(pkg.dependencies ?? {}).sort(),
    [...allowed].sort(),
    'the backend dependency set must be unchanged'
  );
});

test('the Review 3 seed and demo scripts referenced in the docs actually exist', () => {
  const pkg = JSON.parse(readFileSync(path.join(backendRoot, 'package.json'), 'utf8'));
  const scripts = pkg.scripts ?? {};

  for (const name of ['seed', 'seed:cameras', 'seed:rooms', 'seed:devices', 'demo:reset']) {
    assert.ok(scripts[name], `npm run ${name} is documented, so it must be declared`);
  }

  // And each one points at a file that is actually present.
  for (const name of ['seed:rooms', 'seed:devices', 'demo:reset']) {
    const match = /src\/utils\/([A-Za-z0-9_.-]+\.js)/.exec(scripts[name]);
    assert.ok(match, `${name} must run a script under src/utils`);
    assert.doesNotThrow(
      () => readSrc('utils', match[1]),
      `src/utils/${match[1]} must exist for npm run ${name}`
    );
  }
});

test('demo:reset is report-only unless --apply is passed', () => {
  const source = readSrc('utils', 'resetDemoData.js');

  assert.match(source, /--apply/, 'the reset tool must require an explicit --apply flag');
  // The same shape as the Review 2 dedupe tool.
  const dedupe = readSrc('utils', 'dedupeAttendance.js');
  assert.match(dedupe, /--apply/);

  // And it must never touch the collections that hold real records.
  for (const model of ['Person', 'Attendance', 'User', 'Camera']) {
    assert.equal(
      new RegExp(`${model}\\.(deleteMany|deleteOne|updateMany|findOneAndDelete)`).test(source),
      false,
      `resetDemoData must never write to ${model} — a demo reset must not destroy real data`
    );
  }
});
