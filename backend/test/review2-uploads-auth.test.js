/**
 * Review 2 — the /uploads image mount, exercised as a RUNNING server.
 *
 * This is the one place in the backend suite that issues real HTTP requests
 * instead of asserting on source text. It answers the question the text
 * assertions cannot: does the gate actually REJECT a request?
 *
 * What it proves:
 *   • an anonymous request for a stored image gets 401, not a file;
 *   • a full SESSION token in `?token=` is refused. That parameter accepts only
 *     the narrowed, asset-scoped token, because an image URL leaks into browser
 *     history and any fronting proxy's log, and what leaks there must not be a
 *     credential for the whole API.
 *
 * What it cannot prove here: the SUCCESS path. A valid asset token is verified
 * and then the user is loaded from MongoDB, and there is no database in this
 * environment (a mongoose query without a connection buffers and times out
 * rather than answering), so the authorised-read case still needs a real
 * database. Both assertions above complete before any database access.
 *
 * The server binds 127.0.0.1 on an ephemeral port and is closed in teardown.
 *
 * Requires `npm install` (express, mongoose, jsonwebtoken). Without it the
 * tests SKIP with the import error rather than failing for the wrong reason.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

let createApp;
let signAuthToken;
let skip = false;
try {
  ({ createApp } = await import('../src/app.js'));
  ({ signAuthToken } = await import('../src/utils/token.js'));
} catch (err) {
  skip = `dependencies are not installed (${err.message.split('\n')[0]}) — run npm install`;
}

async function withServer(run) {
  const server = http.createServer(createApp());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('an anonymous request for a stored image is rejected', { skip }, async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/uploads/snapshots/does-not-exist.jpg`);
    assert.equal(res.status, 401, 'stored snapshots and portraits must never be anonymous');
    const body = await res.json();
    assert.equal(body.success, false);
  });
});

test('a full session token is not accepted in the image URL', { skip }, async () => {
  await withServer(async (base) => {
    const sessionToken = signAuthToken({ sub: '000000000000000000000000', role: 'admin' });
    const res = await fetch(
      `${base}/uploads/snapshots/does-not-exist.jpg?token=${encodeURIComponent(sessionToken)}`
    );
    assert.equal(
      res.status,
      401,
      'the query parameter must accept only the narrowed asset token, so a leaked ' +
        'image URL cannot be replayed against the rest of the API'
    );
  });
});

test('a garbage token in the image URL is rejected', { skip }, async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/uploads/snapshots/x.jpg?token=not-a-jwt`);
    assert.equal(res.status, 401);
  });
});
