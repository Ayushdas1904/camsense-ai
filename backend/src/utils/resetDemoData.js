import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { AutomationLog } from '../models/AutomationLog.js';
import { Camera } from '../models/Camera.js';
import { Device } from '../models/Device.js';
import { DeviceStateHistory } from '../models/DeviceStateHistory.js';
import { EnergySummary } from '../models/EnergyRecord.js';
import { OccupancyReading } from '../models/Occupancy.js';
import { Room } from '../models/Room.js';
import { RoomOccupancyState } from '../models/RoomOccupancyState.js';
import { resetSimulation } from '../services/devices/simulationAdapter.js';
import { logger } from './logger.js';

/**
 * Demo-data reset for the Review 3 simulation state (`npm run demo:reset`).
 *
 * ═══ THIS IS A DEMO-ONLY TOOL ═══
 *
 * It exists so a rehearsed demonstration can be run again from a clean slate:
 * clear the simulated devices back to 'unknown', drop the automation decisions
 * and device-state history they produced, drop the demo-sourced occupancy
 * readings, and drop the energy summaries those simulated devices contributed
 * to. Nothing else.
 *
 * REPORT-ONLY BY DEFAULT, exactly like `npm run dedupe:attendance`. Without an
 * explicit flag it prints what it WOULD remove and changes nothing:
 *
 *     npm run demo:reset              # report only, writes nothing
 *     npm run demo:reset -- --apply   # actually remove what was listed
 *
 * ═══ WHAT IT WILL NEVER TOUCH ═══
 *
 * A demo reset that destroyed real records would be far worse than a demo that
 * started with stale data, so the blast radius is fixed and narrow:
 *
 *   • PEOPLE, ATTENDANCE, USERS and CAMERAS are never written. They are the
 *     records a person actually created, or that represent real observations.
 *     This file does not import Person, Attendance or User at all, and it
 *     imports Camera and Room READ-ONLY (to decide what counts as demo).
 *   • Detections, alerts and recognition events are never touched — they are
 *     the Review 1 and Review 2 event history.
 *   • ROOMS, DEVICES and AUTOMATION RULES are never deleted. Their
 *     CONFIGURATION is what you spent time setting up; only a simulated
 *     device's transient STATE is reset.
 *   • An occupancy reading with `source: 'real'` is never deleted. A reading
 *     produced by a real camera is a real observation, demo run or not.
 *   • A device that is not simulated is never written to, and neither is any
 *     history or energy row belonging to one. If a real adapter is ever
 *     implemented, this tool keeps its hands off it by construction.
 *
 * ═══ HOW "DEMO" IS DECIDED ═══
 *
 *   • A DEVICE is demo when `simulated === true` (which, today, is every
 *     device, because only the simulation adapter is implemented).
 *   • An OCCUPANCY READING is demo when `source === 'demo'`, which the ingest
 *     sets from the reporting camera's `mode`.
 *   • A ROOM's live occupancy state is demo when the room has no cameras, or
 *     when EVERY camera assigned to it is in `mode: 'demo'`. A room with even
 *     one real camera keeps its state.
 *   • An AUTOMATION LOG row is demo when its device is simulated, or when it
 *     is a room-level row (no deviceId) for a demo room.
 *
 * The live RoomOccupancyState document is derived data: the next accepted
 * occupancy report rebuilds it. Resetting it clears the threshold clocks so
 * the first automation decision of the demo is earned during the demo rather
 * than inherited from the last rehearsal.
 */

function parseArgs(argv) {
  return { apply: argv.includes('--apply') };
}

/** deviceIds of every SIMULATED device. The only devices this tool may touch. */
async function simulatedDeviceIds() {
  const devices = await Device.find({ simulated: true }).select('deviceId roomId name').lean();
  return devices;
}

/** roomIds whose every assigned camera is in demo mode (or which have none). */
async function demoRoomIds() {
  const rooms = await Room.find({}).select('roomId cameraIds').lean();
  if (rooms.length === 0) return [];

  const cameraIds = [...new Set(rooms.flatMap((room) => room.cameraIds ?? []))];
  const cameras = await Camera.find({ cameraId: { $in: cameraIds } })
    .select('cameraId mode')
    .lean();
  const modeOf = new Map(cameras.map((camera) => [camera.cameraId, camera.mode]));

  return rooms
    .filter((room) => {
      const assigned = room.cameraIds ?? [];
      // No cameras at all → nothing real is feeding it.
      if (assigned.length === 0) return true;
      // Every assigned camera must be demo. An unknown camera id is treated
      // as NOT demo, deliberately: the safe assumption is that it is real.
      return assigned.every((cameraId) => modeOf.get(cameraId) === 'demo');
    })
    .map((room) => room.roomId);
}

async function reset() {
  const { apply } = parseArgs(process.argv.slice(2));

  await connectDatabase();

  const devices = await simulatedDeviceIds();
  const deviceIds = devices.map((device) => device.deviceId);
  const demoRooms = await demoRoomIds();

  logger.info('─────────────────────────────────────────────────────────');
  logger.info(
    apply
      ? 'DEMO RESET — APPLYING. Only simulated/demo Review 3 state is affected.'
      : 'DEMO RESET — REPORT ONLY. Nothing will be changed.'
  );
  logger.info('─────────────────────────────────────────────────────────');
  logger.info(
    `Simulated devices in scope (${deviceIds.length}): ${deviceIds.join(', ') || 'none'}`
  );
  logger.info(`Demo rooms in scope (${demoRooms.length}): ${demoRooms.join(', ') || 'none'}`);
  logger.warn(
    'NOT in scope and never written by this tool: people, attendance, users, cameras, ' +
      'detections, alerts, recognition events, real-sourced occupancy readings, and the ' +
      'configuration of rooms, devices and automation rules.'
  );

  // ── Count first, so a report-only run shows the real blast radius ──
  const deviceFilter = { deviceId: { $in: deviceIds } };
  const automationFilter = {
    $or: [
      { deviceId: { $in: deviceIds } },
      // Room-level rows (a skipped decision has no device) for demo rooms.
      { deviceId: { $in: [null, ''] }, roomId: { $in: demoRooms } },
      { deviceId: { $exists: false }, roomId: { $in: demoRooms } },
    ],
  };
  const occupancyFilter = { source: 'demo' };
  const roomStateFilter = { roomId: { $in: demoRooms } };

  const [
    historyCount,
    automationCount,
    occupancyCount,
    energyCount,
    roomStateCount,
    realOccupancyKept,
  ] = await Promise.all([
    deviceIds.length ? DeviceStateHistory.countDocuments(deviceFilter) : 0,
    deviceIds.length || demoRooms.length ? AutomationLog.countDocuments(automationFilter) : 0,
    OccupancyReading.countDocuments(occupancyFilter),
    deviceIds.length ? EnergySummary.countDocuments(deviceFilter) : 0,
    demoRooms.length ? RoomOccupancyState.countDocuments(roomStateFilter) : 0,
    OccupancyReading.countDocuments({ source: { $ne: 'demo' } }),
  ]);

  const plan = [
    ['device state history rows (simulated devices)', historyCount, 'delete'],
    ['automation log rows (simulated devices / demo rooms)', automationCount, 'delete'],
    ["occupancy readings with source 'demo'", occupancyCount, 'delete'],
    ['energy summary rows (simulated devices)', energyCount, 'delete'],
    ['room occupancy live state rows (demo rooms)', roomStateCount, 'reset'],
    ['simulated device states', deviceIds.length, "reset to 'unknown'"],
  ];

  logger.info('─────────────────────────────────────────────────────────');
  for (const [label, count, action] of plan) {
    logger.info(`${apply ? 'will' : 'would'} ${action}: ${count} ${label}`);
  }
  logger.info(
    `KEEPING ${realOccupancyKept} occupancy reading(s) that are not source 'demo' — a ` +
      'reading from a real camera is a real observation.'
  );
  logger.info('─────────────────────────────────────────────────────────');

  if (!apply) {
    logger.warn(
      'Report-only run — nothing was changed. Re-run with `npm run demo:reset -- --apply` ' +
        'to apply exactly the changes listed above.'
    );
    await disconnectDatabase();
    process.exit(0);
  }

  // ── Apply ────────────────────────────────────────────────────
  let removed = 0;

  if (deviceIds.length) {
    removed += (await DeviceStateHistory.deleteMany(deviceFilter)).deletedCount || 0;
    removed += (await EnergySummary.deleteMany(deviceFilter)).deletedCount || 0;
  }
  if (deviceIds.length || demoRooms.length) {
    removed += (await AutomationLog.deleteMany(automationFilter)).deletedCount || 0;
  }
  removed += (await OccupancyReading.deleteMany(occupancyFilter)).deletedCount || 0;

  // RoomOccupancyState is RESET, not deleted: one document per room is part of
  // the room's shape, and the next occupancy report rebuilds its contents. The
  // honest reset is "no measurement", which is count NULL — never 0.
  if (demoRooms.length) {
    await RoomOccupancyState.updateMany(roomStateFilter, {
      $set: {
        count: null,
        status: 'camera_unavailable',
        available: false,
        cameras: [],
        lastUpdatedAt: null,
        lastReportAt: null,
        lastAlertAt: null,
        dataQuality: 'no_data',
        belowThresholdSince: null,
        aboveThresholdSince: null,
      },
    });
  }

  // Simulated devices go back to the honest initial state. CONFIGURATION is
  // preserved: name, room, type, wattage, adapter and controlMode are all left
  // exactly as the operator set them, so the demo does not have to be rebuilt.
  // 'unknown' rather than 'off', because nothing has been confirmed.
  if (deviceIds.length) {
    await Device.updateMany(
      { simulated: true },
      {
        $set: {
          reportedState: 'unknown',
          desiredState: null,
          connectionStatus: 'unknown',
          lastSuccessfulStateAt: null,
          'lastCommand.state': null,
          'lastCommand.issuedAt': null,
          'lastCommand.by': null,
          'lastCommand.reason': null,
          'lastCommand.outcome': null,
          'lastCommand.message': null,
          'override.state': null,
          'override.setAt': null,
          'override.expiresAt': null,
          'override.actorId': null,
          'override.reason': null,
        },
      }
    );
  }

  // The in-process simulation adapter keeps its own Map of simulated states.
  // Clearing it here only affects THIS process (the script's), so the note
  // below tells the operator to restart the backend, which is the only way to
  // clear the running server's copy.
  resetSimulation();

  logger.info(`Demo reset applied: ${removed} row(s) removed.`);
  logger.info(
    `${deviceIds.length} simulated device(s) reset to reportedState 'unknown' with their ` +
      'configuration preserved.'
  );
  logger.warn(
    'RESTART THE BACKEND before the demo. The simulation adapter holds its device states ' +
      "in memory per process, so the running server still has the old simulated states " +
      'until it restarts.'
  );
  logger.warn(
    'Automation stays OFF after a reset by design: enable the rule ' +
      '(POST /api/automation/rules/:id/enable) and set each device to controlMode ' +
      "'automatic' when you are ready to demonstrate it."
  );

  await disconnectDatabase();
  process.exit(0);
}

reset().catch((error) => {
  logger.error('Demo reset failed', error.message);
  process.exit(1);
});
