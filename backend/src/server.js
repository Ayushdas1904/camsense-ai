import http from 'http';

import { createApp } from './app.js';
import { connectDatabase } from './config/db.js';
import { initSocket } from './sockets/index.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';

/**
 * Composition root: connect the database, build the app, attach the real-time
 * gateway, and start listening. Any startup failure exits with a clear message.
 */
async function start() {
  try {
    await connectDatabase();

    const app = createApp();
    const httpServer = http.createServer(app);
    initSocket(httpServer);

    httpServer.listen(env.port, env.host, () => {
      logger.info(`CamSense backend listening on http://${env.host}:${env.port}`);
      logger.info(`Environment: ${env.nodeEnv}`);
      if (env.host === '0.0.0.0' || env.host === '::') {
        logger.warn(
          `HOST=${env.host} — this backend is reachable from other machines. It serves ` +
            'snapshot and registration-portrait images; make sure the network it is on is ' +
            'private.'
        );
      }
    });

    const shutdown = (signal) => {
      logger.warn(`${signal} received — shutting down`);
      httpServer.close(() => process.exit(0));
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (error) {
    logger.error('Failed to start backend', error.message);
    process.exit(1);
  }
}

start();
