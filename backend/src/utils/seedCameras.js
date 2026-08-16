import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { Camera } from '../models/Camera.js';
import { logger } from './logger.js';

/**
 * Seeds demo cameras so the app is demonstrable out of the box (`npm run seed:cameras`).
 * These are real, editable/deletable DB records — not hardcoded UI data.
 * Idempotent: skips cameras whose cameraId already exists.
 */
const demoCameras = [
  {
    cameraId: 'CAM-01',
    name: 'Main Entrance',
    location: 'Building A · Front Door',
    mode: 'demo',
    streamUrl: '',
    status: 'offline',
    aiEnabled: true,
  },
  {
    cameraId: 'CAM-02',
    name: 'Computer Lab',
    location: 'Block C · Lab 2',
    mode: 'demo',
    streamUrl: '',
    status: 'offline',
    aiEnabled: true,
  },
];

async function seedCameras() {
  await connectDatabase();
  for (const data of demoCameras) {
    const exists = await Camera.findOne({ cameraId: data.cameraId });
    if (exists) {
      logger.info(`Camera ${data.cameraId} already exists — skipping`);
    } else {
      await Camera.create(data);
      logger.info(`Created demo camera ${data.cameraId} (${data.name})`);
    }
  }
  await disconnectDatabase();
  process.exit(0);
}

seedCameras().catch((error) => {
  logger.error('Camera seed failed', error.message);
  process.exit(1);
});
