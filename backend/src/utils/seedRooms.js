import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { Room } from '../models/Room.js';
import { Camera } from '../models/Camera.js';
import { logger } from './logger.js';

/**
 * Seeds a demo room so occupancy monitoring is demonstrable out of the box
 * (`npm run seed:rooms`). Run `npm run seed:cameras` first.
 *
 * These are real, editable/deletable database records — not hardcoded UI data.
 *
 * IDEMPOTENT AND NON-DESTRUCTIVE: upserts by `roomId` and DELETES NOTHING, so
 * running it twice changes nothing and running it on a live system cannot
 * remove an operator's configuration. It also never touches the occupancy
 * history.
 */
const demoRooms = [
  {
    roomId: 'ROOM-01',
    name: 'Computer Lab',
    description:
      'Demo room for Review 3 occupancy monitoring. Wired to the two seeded ' +
      'demo cameras — see the note below on why that count is a lower bound.',
    cameraIds: ['CAM-01', 'CAM-02'],
    capacity: 10,
    occupancyThreshold: 1,
    nearCapacityRatio: 0.8,
    monitoringEnabled: true,
    active: true,
  },
];

async function seedRooms() {
  await connectDatabase();

  for (const data of demoRooms) {
    // Only reference cameras that actually exist, so the seeded room does not
    // sit permanently at "Camera Unavailable" pointing at nothing.
    const cameras = await Camera.find({ cameraId: { $in: data.cameraIds } }).select('cameraId');
    const cameraIds = cameras.map((camera) => camera.cameraId);
    const missing = data.cameraIds.filter((id) => !cameraIds.includes(id));
    if (missing.length > 0) {
      logger.warn(
        `Cameras ${missing.join(', ')} do not exist — run \`npm run seed:cameras\` first. ` +
          `Room ${data.roomId} will be created with ${cameraIds.length} camera(s).`
      );
    }

    // Upsert, never delete. $setOnInsert on the tunable fields means an
    // operator's edited capacity/threshold survives a re-run.
    const result = await Room.findOneAndUpdate(
      { roomId: data.roomId },
      {
        $set: { name: data.name, description: data.description, cameraIds },
        $setOnInsert: {
          roomId: data.roomId,
          capacity: data.capacity,
          occupancyThreshold: data.occupancyThreshold,
          nearCapacityRatio: data.nearCapacityRatio,
          monitoringEnabled: data.monitoringEnabled,
          active: data.active,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    logger.info(
      `Room ${result.roomId} (${result.name}) ready with ${cameraIds.length} camera(s), ` +
        `capacity ${result.capacity}.`
    );
  }

  logger.info(
    'NOTE: a room with several cameras aggregates its occupancy with a MAX, not a sum — ' +
      'this project has no cross-camera re-identification, so summing would double-count ' +
      'anyone visible to two cameras. For an exact count, give a room one camera that ' +
      'covers it.'
  );

  await disconnectDatabase();
  process.exit(0);
}

seedRooms().catch((error) => {
  logger.error('Room seed failed', error.message);
  process.exit(1);
});
