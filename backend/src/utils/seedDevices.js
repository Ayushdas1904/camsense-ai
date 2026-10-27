import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { Device } from '../models/Device.js';
import { AutomationRule } from '../models/AutomationRule.js';
import { Room } from '../models/Room.js';
import { env } from '../config/env.js';
import { logger } from './logger.js';

/**
 * Seeds two clearly-labelled SIMULATED devices and one DISABLED automation
 * rule, so Review 3's device control, automation and energy analytics are
 * demonstrable out of the box (`npm run seed:devices`). Run
 * `npm run seed:cameras` and `npm run seed:rooms` first.
 *
 * These are real, editable/deletable database records — not hardcoded UI data.
 *
 * IDEMPOTENT AND NON-DESTRUCTIVE: upserts by `deviceId` / `ruleId` and DELETES
 * NOTHING, so running it twice changes nothing and running it on a live system
 * cannot remove an operator's configuration. It never touches device state
 * history, so past energy figures stay reproducible.
 *
 * THREE THINGS IT DELIBERATELY DOES NOT DO:
 *   • it does not enable the rule. `enabled: false` — an administrator must
 *     turn it on.
 *   • it does not put the devices into 'automatic' control mode. They are
 *     seeded 'disabled', the schema default. Automation therefore requires two
 *     separate explicit opt-ins before anything is ever switched.
 *   • it does not set a reported state. Both devices start 'unknown', which is
 *     the truth: nothing has confirmed their state. Seeding them as 'off'
 *     would be a fabricated reading and the energy maths would treat it as a
 *     measured off-interval.
 */
const DEMO_ROOM_ID = 'ROOM-01';

const demoDevices = [
  {
    deviceId: 'DEV-LIGHT-01',
    name: 'Computer Lab Ceiling Lights (SIMULATED)',
    type: 'light',
    // Realistic configured estimate: roughly 6 × 18 W LED panels for a small
    // lab. A CONFIGURED ESTIMATE, not a measurement — there is no meter here.
    powerRatingWatts: 108,
  },
  {
    deviceId: 'DEV-FAN-01',
    name: 'Computer Lab Ceiling Fan (SIMULATED)',
    type: 'fan',
    // Typical ceiling fan at medium speed. Again: configured, not measured.
    powerRatingWatts: 75,
  },
];

const demoRule = {
  ruleId: 'RULE-LAB-01',
  name: 'Computer Lab occupancy lighting (disabled by default)',
  description:
    'Switches the lab light and fan on when the room is occupied and off after it has ' +
    'been continuously unoccupied. SUSPENDS automatic switching entirely while the ' +
    'occupancy figure is unavailable or stale — unavailable data is not evidence of an ' +
    'empty room. Created DISABLED: enable it and set the devices to automatic mode to ' +
    'use it.',
  occupancyThreshold: 0,
  // Short enough to demonstrate in a few minutes, long enough to be a real
  // delay rather than an instant reaction.
  unoccupiedForSec: 120,
  switchOffDelaySec: 0,
  switchOnDelaySec: 0,
  allowedHours: { start: '', end: '' },
  commandCooldownSec: 60,
  // The safe default, stated explicitly in the seed so it is visible.
  onUnavailableOccupancy: 'suspend',
};

async function seedDevices() {
  await connectDatabase();

  const room = await Room.findOne({ roomId: DEMO_ROOM_ID });
  if (!room) {
    logger.warn(
      `Room ${DEMO_ROOM_ID} does not exist — run \`npm run seed:rooms\` first. The devices ` +
        'will still be created, but they will not be automated until the room exists.'
    );
  }

  const deviceIds = [];
  for (const data of demoDevices) {
    // Upsert, never delete. $setOnInsert on the operational fields means an
    // operator's edited wattage, control mode and device state survive a
    // re-run — in particular, re-seeding must never reset a device's control
    // mode back to disabled or wipe a confirmed reported state.
    const result = await Device.findOneAndUpdate(
      { deviceId: data.deviceId },
      {
        $set: { name: data.name, roomId: DEMO_ROOM_ID, type: data.type },
        $setOnInsert: {
          deviceId: data.deviceId,
          powerRatingWatts: data.powerRatingWatts,
          // Automation off until an administrator opts in.
          controlMode: 'disabled',
          adapterType: 'simulation',
          simulated: true,
          // Honest initial values. NOT 'off'.
          reportedState: 'unknown',
          desiredState: null,
          connectionStatus: 'unknown',
          active: true,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    deviceIds.push(result.deviceId);
    logger.info(
      `Device ${result.deviceId} (${result.type}, ${result.powerRatingWatts} W configured) ` +
        `ready in ${result.roomId} — SIMULATED, control mode '${result.controlMode}', ` +
        `reported state '${result.reportedState}'.`
    );
  }

  const rule = await AutomationRule.findOneAndUpdate(
    { ruleId: demoRule.ruleId },
    {
      $set: {
        name: demoRule.name,
        description: demoRule.description,
        roomId: DEMO_ROOM_ID,
        deviceIds,
      },
      $setOnInsert: {
        ruleId: demoRule.ruleId,
        // DISABLED. The whole point.
        enabled: false,
        occupancyThreshold: demoRule.occupancyThreshold,
        unoccupiedForSec: demoRule.unoccupiedForSec,
        switchOffDelaySec: demoRule.switchOffDelaySec,
        switchOnDelaySec: demoRule.switchOnDelaySec,
        allowedHours: demoRule.allowedHours,
        commandCooldownSec: demoRule.commandCooldownSec,
        onUnavailableOccupancy: demoRule.onUnavailableOccupancy,
        manualOverrideMinutes: env.automation.manualOverrideMinutes,
        active: true,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  logger.info(
    `Automation rule ${rule.ruleId} ready for ${rule.roomId} over ${deviceIds.length} ` +
      `device(s): enabled=${rule.enabled}, threshold=${rule.occupancyThreshold}, ` +
      `unoccupiedFor=${rule.unoccupiedForSec}s, onUnavailableOccupancy=` +
      `'${rule.onUnavailableOccupancy}'.`
  );

  logger.info(
    'NOTE: both devices are SIMULATED — no physical hardware is controlled, and only the ' +
      'simulation adapter is implemented in this project. Their power ratings are ' +
      'CONFIGURED ESTIMATES used for the energy arithmetic, not measurements. To switch ' +
      "anything automatically you must (1) enable the rule and (2) set each device's " +
      "control mode to 'automatic' — two explicit steps, on purpose."
  );

  await disconnectDatabase();
  process.exit(0);
}

seedDevices().catch((error) => {
  logger.error('Device seed failed', error.message);
  process.exit(1);
});
