import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../utils/logger.js';
import { Attendance } from '../models/Attendance.js';
import { Person } from '../models/Person.js';
import { Room } from '../models/Room.js';
import { RoomOccupancyState } from '../models/RoomOccupancyState.js';
import { OccupancyReading } from '../models/Occupancy.js';
import { Device } from '../models/Device.js';
import { DeviceStateHistory } from '../models/DeviceStateHistory.js';
import { AutomationRule } from '../models/AutomationRule.js';
import { AutomationLog } from '../models/AutomationLog.js';
import { EnergySummary } from '../models/EnergyRecord.js';

/**
 * Establishes the MongoDB connection.
 *
 * The rest of the app never calls mongoose.connect directly — it goes through
 * here so connection options, logging, and retry policy live in one place.
 */
export async function connectDatabase() {
  mongoose.set('strictQuery', true);

  mongoose.connection.on('connected', () => {
    logger.info('MongoDB connected');
  });
  mongoose.connection.on('error', (err) => {
    logger.error('MongoDB connection error', err.message);
  });
  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected');
  });

  await mongoose.connect(env.mongoUri);
  await ensureCriticalIndexes();
  return mongoose.connection;
}

/**
 * Whether the unique attendance index has been built AND verified in this
 * process. `{ verified: false }` means duplicate attendance prevention is NOT
 * in force, and attendanceService refuses to write while that is the case.
 */
let attendanceIndexState = { verified: false, error: null };

/** The current attendance duplicate-prevention state (read by attendanceService). */
export function getAttendanceIndexState() {
  return { ...attendanceIndexState };
}

/** Test hook: lets a unit test drive the guarded code path. */
export function setAttendanceIndexStateForTests(state) {
  attendanceIndexState = { verified: false, error: null, ...state };
}

/**
 * Whether the Review 3 occupancy indexes have been built AND verified in this
 * process. `{ verified: false }` means occupancyService refuses to WRITE
 * occupancy state or history — see ensureOccupancyIndexes below for why.
 */
let occupancyIndexState = { verified: false, error: null };

/** The current occupancy index state (read by occupancyService). */
export function getOccupancyIndexState() {
  return { ...occupancyIndexState };
}

/** Test hook: lets a unit test drive the guarded occupancy code path. */
export function setOccupancyIndexStateForTests(state) {
  occupancyIndexState = { verified: false, error: null, ...state };
}

/**
 * Whether the Review 3 device/automation/energy indexes have been built AND
 * verified in this process. `{ verified: false }` means deviceService refuses
 * to issue commands and the automation engine does not evaluate anything —
 * see ensureDeviceAutomationIndexes below for why.
 */
let deviceAutomationIndexState = { verified: false, error: null };

/** The current device/automation index state (read by deviceService and the engine). */
export function getDeviceAutomationIndexState() {
  return { ...deviceAutomationIndexState };
}

/** Test hook: lets a unit test drive the guarded device/automation code path. */
export function setDeviceAutomationIndexStateForTests(state) {
  deviceAutomationIndexState = { verified: false, error: null, ...state };
}

/**
 * Builds the indexes the application's correctness depends on, and records
 * whether the critical one could be verified.
 *
 * Two independent groups: the Review 2 ATTENDANCE duplicate-prevention index
 * (below) and the Review 3 OCCUPANCY indexes (ensureOccupancyIndexes). A
 * failure in one does not affect the other, and neither prevents the backend
 * from booting — each one degrades only its own write path.
 *
 * Attendance duplicate prevention is the unique compound index
 * `{ personId: 1, date: 1 }`: the atomic upsert in attendanceService is keyed
 * on it, and WITHOUT the index that upsert can race — two concurrent
 * operations that both find nothing can both insert. Mongoose would otherwise
 * create it implicitly via `autoIndex`, asynchronously, and swallow a failure
 * (for example when the collection already contains duplicates, or when a
 * deployment disables autoIndex for startup cost). So it is built explicitly
 * here and verified to exist.
 *
 * TWO DELIBERATE CHOICES, both from review findings:
 *
 * 1. `createIndexes()`, NOT `syncIndexes()`. syncIndexes also DROPS any index
 *    that is not declared in the schema, which would silently remove an index
 *    an operator added out of band (a reporting compound index, a TTL index for
 *    image/record retention). createIndexes builds what the schema declares and
 *    leaves everything else alone; the verification below is what actually
 *    guarantees the unique index exists, so nothing is lost by not dropping.
 *
 * 2. A failure here DEGRADES THE ATTENDANCE PATH rather than killing the
 *    process. Throwing from connectDatabase() meant an `attendances` collection
 *    that already contained duplicate {personId, date} pairs — or a Mongo user
 *    without index privileges — stopped the whole backend from booting, taking
 *    Review 1's detection ingest, alerts and camera control down with it, none
 *    of which depend on attendance. Instead: log loudly with the remediation,
 *    mark duplicate prevention unverified, and let attendanceService refuse
 *    attendance writes while it stays that way. Nothing is written without the
 *    guarantee, and everything that does not need the guarantee keeps working.
 *    `npm run dedupe:attendance` reports and removes the duplicates.
 */
export async function ensureCriticalIndexes() {
  // The groups are INDEPENDENT on purpose: an attendance index failure must
  // not stop the occupancy indexes from being built, nor those the
  // device/automation ones, and vice versa. Each group degrades only its own
  // write path.
  const attendance = await ensureAttendanceIndexes();
  await ensureOccupancyIndexes();
  await ensureDeviceAutomationIndexes();
  return attendance;
}

export async function ensureAttendanceIndexes() {
  attendanceIndexState = { verified: false, error: null };

  const fail = (message) => {
    attendanceIndexState = { verified: false, error: message };
    logger.error(
      `Attendance duplicate-prevention index NOT verified: ${message} ` +
        'Attendance writes are DISABLED until this is fixed (nothing is written without ' +
        'the unique index that prevents duplicates). Camera monitoring, detection, alerts ' +
        'and people management are unaffected. If `attendances` already contains duplicate ' +
        '{ personId, date } pairs, run `npm run dedupe:attendance` and restart.'
    );
    return attendanceIndexState;
  };

  try {
    // Builds the schema-declared indexes. Does NOT drop anything it did not
    // declare (see choice 1 above).
    await Attendance.createIndexes();
    await Person.createIndexes();
  } catch (err) {
    return fail(`the indexes could not be built (${err.message}).`);
  }

  // Verify rather than assume: a present-but-non-unique index would silently
  // leave the upsert as the only protection.
  let indexes;
  try {
    indexes = await Attendance.collection.indexes();
  } catch (err) {
    return fail(`the indexes on \`attendances\` could not be read (${err.message}).`);
  }

  const unique = indexes.find(
    (index) =>
      index.unique === true &&
      index.key &&
      Object.keys(index.key).length === 2 &&
      index.key.personId === 1 &&
      index.key.date === 1
  );
  if (!unique) {
    return fail('no unique { personId: 1, date: 1 } index exists on `attendances`.');
  }

  attendanceIndexState = { verified: true, error: null };
  logger.info('Attendance duplicate-prevention index verified (unique personId + date)');
  return attendanceIndexState;
}

/**
 * Builds and VERIFIES the Review 3 occupancy indexes.
 *
 * Two uniqueness guarantees matter here, and both are enforced by the
 * database rather than by application checks:
 *   • `rooms.roomId` unique — a duplicate room would split one physical space
 *     into two records, each receiving half the reports, so neither would show
 *     a correct count.
 *   • `roomoccupancystates.roomId` unique — this collection holds exactly one
 *     CURRENT-state document per room and occupancyService upserts into it on
 *     every accepted report. Without the unique index, two concurrent reports
 *     that both find nothing can both insert, after which the room has two
 *     "current" states and the dashboard shows whichever one it happens to
 *     read. That is the same race the attendance index prevents.
 *
 * THE SAME TWO DELIBERATE CHOICES AS THE ATTENDANCE BLOCK ABOVE:
 *
 * 1. `createIndexes()`, NOT `syncIndexes()` — syncIndexes also DROPS any index
 *    not declared in the schema, which would silently remove an index an
 *    operator added out of band (a reporting index, a TTL index for occupancy
 *    history retention — a very likely addition on this collection). The
 *    read-back verification below is what actually guarantees the unique
 *    indexes exist, so nothing is lost by not dropping.
 *
 * 2. A failure DEGRADES ONLY THE OCCUPANCY WRITE PATH. It does not throw, so
 *    the backend still boots and Review 1 detection/alerts/cameras and Review
 *    2 people/recognition/attendance are completely unaffected — none of them
 *    depend on occupancy. occupancyService checks getOccupancyIndexState() and
 *    refuses to write while it is unverified, so nothing is persisted without
 *    the guarantee, and reads of whatever already exists keep working.
 */
export async function ensureOccupancyIndexes() {
  occupancyIndexState = { verified: false, error: null };

  const fail = (message) => {
    occupancyIndexState = { verified: false, error: message };
    logger.error(
      `Occupancy indexes NOT verified: ${message} ` +
        'Occupancy WRITES are DISABLED until this is fixed (nothing is written without the ' +
        'unique indexes that keep one room to one current-state document). Camera ' +
        'monitoring, detection, alerts, people, recognition and attendance are unaffected. ' +
        'Remediation: ensure the Mongo user may create indexes, and that `rooms` and ' +
        '`roomoccupancystates` contain no duplicate roomId values, then restart.'
    );
    return occupancyIndexState;
  };

  try {
    // Builds what the schemas declare. Drops nothing (see choice 1 above).
    await Room.createIndexes();
    await RoomOccupancyState.createIndexes();
    await OccupancyReading.createIndexes();
  } catch (err) {
    return fail(`the occupancy indexes could not be built (${err.message}).`);
  }

  // Verify rather than assume: a present-but-non-unique index would leave the
  // upsert as the only protection against a duplicate current-state document.
  const verifyUniqueRoomId = async (model, collectionName) => {
    let indexes;
    try {
      indexes = await model.collection.indexes();
    } catch (err) {
      return `the indexes on \`${collectionName}\` could not be read (${err.message}).`;
    }
    const unique = indexes.find(
      (index) =>
        index.unique === true &&
        index.key &&
        Object.keys(index.key).length === 1 &&
        index.key.roomId === 1
    );
    return unique ? null : `no unique { roomId: 1 } index exists on \`${collectionName}\`.`;
  };

  const roomProblem = await verifyUniqueRoomId(Room, 'rooms');
  if (roomProblem) return fail(roomProblem);

  const stateProblem = await verifyUniqueRoomId(RoomOccupancyState, 'roomoccupancystates');
  if (stateProblem) return fail(stateProblem);

  occupancyIndexState = { verified: true, error: null };
  logger.info(
    'Occupancy indexes verified (unique roomId on rooms and roomoccupancystates)'
  );
  return occupancyIndexState;
}

/**
 * Builds and VERIFIES the Review 3 device / automation / energy indexes.
 *
 * Three uniqueness guarantees, all enforced by the database rather than by
 * application checks:
 *   • `devices.deviceId` unique — a duplicate device record would mean two
 *     "current states" for one physical device, and a command would update
 *     whichever one the query happened to read. Every energy figure derived
 *     from that device would then be computed from half its history.
 *   • `automationrules.ruleId` unique — a duplicated rule is evaluated twice
 *     per pass, which doubles the commands issued and defeats the cooldown
 *     that is supposed to stop a device being flapped.
 *   • the energy summary's unique { date, deviceId } — the daily rollup is an
 *     idempotent upsert on that key. Without the index a concurrent rollup can
 *     insert two rows for one device-day, and every total that reads them
 *     double-counts both the consumption and the "saving".
 *
 * THE SAME TWO DELIBERATE CHOICES AS THE BLOCKS ABOVE:
 *
 * 1. `createIndexes()`, NOT `syncIndexes()` — syncIndexes also DROPS any index
 *    not declared in the schema, which would silently remove an index an
 *    operator added out of band (a reporting index, or a TTL index for
 *    device-state-history retention, which is a very likely addition on a
 *    collection that grows with every switch). The read-back verification
 *    below is what actually guarantees the unique indexes exist, so nothing is
 *    lost by not dropping.
 *
 * 2. A failure DEGRADES ONLY THE DEVICE/AUTOMATION/ENERGY WRITE PATH. It does
 *    not throw, so the backend still boots, and Review 1 detection/alerts/
 *    cameras, Review 2 people/recognition/attendance and Review 3 occupancy
 *    are all completely unaffected — none of them depend on devices.
 *    deviceService.issueCommand refuses to send a command while it is
 *    unverified, and the automation engine's tick returns without evaluating
 *    anything, so NOTHING IS SWITCHED without the guarantee. Reads of whatever
 *    already exists keep working, which means the energy views stay readable.
 */
export async function ensureDeviceAutomationIndexes() {
  deviceAutomationIndexState = { verified: false, error: null };

  const fail = (message) => {
    deviceAutomationIndexState = { verified: false, error: message };
    logger.error(
      `Device/automation indexes NOT verified: ${message} ` +
        'Device COMMANDS and AUTOMATION are DISABLED until this is fixed (nothing is ' +
        'switched without the unique indexes that keep one device to one record and one ' +
        'rule to one evaluation). Camera monitoring, detection, alerts, people, ' +
        'recognition, attendance and occupancy are unaffected, and the energy views stay ' +
        'readable. Remediation: ensure the Mongo user may create indexes, and that ' +
        '`devices` and `automationrules` contain no duplicate deviceId/ruleId values, ' +
        'then restart.'
    );
    return deviceAutomationIndexState;
  };

  try {
    // Builds what the schemas declare. Drops nothing (see choice 1 above).
    await Device.createIndexes();
    await DeviceStateHistory.createIndexes();
    await AutomationRule.createIndexes();
    await AutomationLog.createIndexes();
    await EnergySummary.createIndexes();
  } catch (err) {
    return fail(`the device/automation indexes could not be built (${err.message}).`);
  }

  /**
   * Verifies a unique index by reading it back, rather than assuming
   * createIndexes succeeded: a present-but-non-unique index would leave the
   * upsert as the only protection against a duplicate.
   *
   * `keys` is the exact key set expected, so a unique index on a DIFFERENT
   * field set does not satisfy the check.
   */
  const verifyUnique = async (model, keys) => {
    const collectionName = model.collection.collectionName;
    let indexes;
    try {
      indexes = await model.collection.indexes();
    } catch (err) {
      return `the indexes on \`${collectionName}\` could not be read (${err.message}).`;
    }
    const names = Object.keys(keys);
    const unique = indexes.find(
      (index) =>
        index.unique === true &&
        index.key &&
        Object.keys(index.key).length === names.length &&
        names.every((name) => index.key[name] === keys[name])
    );
    return unique
      ? null
      : `no unique { ${names.map((n) => `${n}: ${keys[n]}`).join(', ')} } index exists on ` +
        `\`${collectionName}\`.`;
  };

  const deviceProblem = await verifyUnique(Device, { deviceId: 1 });
  if (deviceProblem) return fail(deviceProblem);

  const ruleProblem = await verifyUnique(AutomationRule, { ruleId: 1 });
  if (ruleProblem) return fail(ruleProblem);

  // NOTE ON THE COLLECTION NAME: the energy summary's mongoose model is still
  // named 'EnergyRecord' so the pre-existing `energyrecords` collection is not
  // orphaned by Review 3 replacing the placeholder schema (see
  // models/EnergyRecord.js). The collection name is therefore READ FROM THE
  // MODEL rather than hardcoded, so this check is correct either way.
  const summaryProblem = await verifyUnique(EnergySummary, { date: 1, deviceId: 1 });
  if (summaryProblem) return fail(summaryProblem);

  deviceAutomationIndexState = { verified: true, error: null };
  logger.info(
    'Device/automation indexes verified (unique deviceId on devices, ruleId on ' +
      `automationrules, and { date, deviceId } on \`${EnergySummary.collection.collectionName}\`)`
  );
  return deviceAutomationIndexState;
}

export async function disconnectDatabase() {
  await mongoose.connection.close();
}
