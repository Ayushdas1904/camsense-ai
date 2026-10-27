import http from 'http';

import { createApp } from './app.js';
import { connectDatabase } from './config/db.js';
import { initSocket } from './sockets/index.js';
import { startAutomationEngine, stopAutomationEngine } from './services/automationEngine.js';
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

    // Review 3 automation. Primarily EVENT-DRIVEN (occupancyService calls the
    // engine after every accepted occupancy report); this starts the
    // low-frequency tick that makes the time-based transitions fire —
    // unoccupied delays maturing, manual overrides expiring, and occupancy
    // going stale when no report is arriving at all.
    //
    // Starting it switches nothing. Every rule is disabled by default and
    // every device's control mode is 'disabled', so two explicit operator
    // opt-ins stand between this line and any device being commanded.
    startAutomationEngine();

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
      // Clear the automation interval BEFORE the server closes, so a tick
      // cannot start issuing device commands while the process is tearing
      // down. Devices are left exactly as they are: shutting the backend down
      // is not a request to change the state of the lights.
      stopAutomationEngine();
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
