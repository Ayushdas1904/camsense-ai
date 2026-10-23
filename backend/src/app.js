import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'node:path';

import { env, isProduction } from './config/env.js';
import apiRouter from './routes/index.js';
import { requireAssetAccess } from './middleware/auth.js';
import { notFound } from './middleware/notFound.js';
import { errorHandler } from './middleware/errorHandler.js';

/**
 * Builds and configures the Express application (no listening here — that's
 * server.js). Separating app construction from the HTTP server keeps the app
 * importable for tests and for attaching Socket.IO.
 */
export function createApp() {
  const app = express();

  // Security headers. crossOriginResourcePolicy is relaxed so the frontend
  // (different origin in dev) can load snapshot images from /uploads.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  // Stored images — detection/weapon snapshots, cropped face snapshots from
  // unknown-identity events, and enrolled people's registration portraits.
  //
  // AUTHENTICATED, not public. These are evidence images and biometric
  // photographs: an unguarded express.static mount meant that any URL which
  // had ever appeared in an <img src> kept working forever, for anyone, logged
  // in or not.
  //
  // requireAssetAccess accepts either a session token in the Authorization
  // header or a NARROWED, asset-scoped token in `?token=` — because an <img>
  // cannot send a header, and a URL-borne credential ends up in browser
  // history and any fronting proxy's log. A full session token in the query
  // string is refused there, so what can leak that way buys image reads only,
  // for a shorter window, instead of the whole API for the session's lifetime.
  //
  // Nothing here is a public asset: unauthenticated callers get 401.
  app.use(
    '/uploads',
    requireAssetAccess,
    express.static(path.resolve(env.snapshotDir, '..'), {
      // Don't let a browser or proxy cache a biometric image indefinitely.
      setHeaders: (res) => res.setHeader('Cache-Control', 'private, max-age=60'),
    })
  );

  // CORS — only the configured frontend origins may call the API.
  app.use(
    cors({
      origin: env.clientOrigins,
      credentials: true,
    })
  );

  // Body parsing.
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Request logging.
  app.use(morgan(isProduction ? 'combined' : 'dev'));

  // Root ping — cheap "is the process up" check separate from /api/health.
  app.get('/', (_req, res) => {
    res.json({ success: true, data: { name: 'CamSense AI Backend', version: '0.1.0' } });
  });

  // All API routes live under /api.
  app.use('/api', apiRouter);

  // 404 + centralized error handling (must be last).
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
