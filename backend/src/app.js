import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

import { env, isProduction } from './config/env.js';
import apiRouter from './routes/index.js';
import { notFound } from './middleware/notFound.js';
import { errorHandler } from './middleware/errorHandler.js';

/**
 * Builds and configures the Express application (no listening here — that's
 * server.js). Separating app construction from the HTTP server keeps the app
 * importable for tests and for attaching Socket.IO.
 */
export function createApp() {
  const app = express();

  // Security headers.
  app.use(helmet());

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
