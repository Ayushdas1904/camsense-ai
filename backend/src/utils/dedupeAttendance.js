import { connectDatabase, disconnectDatabase, ensureCriticalIndexes } from '../config/db.js';
import { Attendance } from '../models/Attendance.js';
import { logger } from './logger.js';

/**
 * Attendance duplicate migration helper (`npm run dedupe:attendance`).
 *
 * Why this exists: duplicate attendance prevention is the unique
 * `{ personId, date }` index, and that index CANNOT be built on a collection
 * that already contains duplicate pairs — which can happen on a database
 * written by a build that predates the index, or by one running with it
 * dropped. When the index cannot be built, `config/db.js` marks duplicate
 * prevention unverified and `attendanceService` refuses to write attendance
 * (the rest of the application keeps running). This script is how an operator
 * clears that state.
 *
 * REPORT-ONLY BY DEFAULT. It prints what it would remove and changes nothing.
 * Deletion happens only with an explicit flag:
 *
 *     npm run dedupe:attendance             # report only, no writes
 *     npm run dedupe:attendance -- --apply  # actually remove the duplicates
 *
 * Which record survives: the one with the EARLIEST `firstSeen` (falling back to
 * `createdAt`, then `_id` order) — the first sighting of that person on that
 * date, which is what the field means. Before deleting the others, the survivor
 * takes the LATEST `lastSeen` across the group, so no observation window is
 * lost. Nothing is merged across different people or different dates.
 */

function parseArgs(argv) {
  return { apply: argv.includes('--apply') };
}

function pickSurvivor(records) {
  return [...records].sort((a, b) => {
    const aFirst = new Date(a.firstSeen || a.createdAt || 0).getTime();
    const bFirst = new Date(b.firstSeen || b.createdAt || 0).getTime();
    if (aFirst !== bFirst) return aFirst - bFirst;
    return String(a._id).localeCompare(String(b._id));
  })[0];
}

function latestLastSeen(records) {
  return records
    .map((r) => new Date(r.lastSeen || r.firstSeen || r.createdAt || 0).getTime())
    .reduce((max, value) => (value > max ? value : max), 0);
}

async function dedupe() {
  const { apply } = parseArgs(process.argv.slice(2));

  // connectDatabase() also attempts the index build; with duplicates present
  // that attempt fails, which is now logged rather than fatal — which is
  // exactly why this script can run at all.
  await connectDatabase();

  const groups = await Attendance.aggregate([
    { $group: { _id: { personId: '$personId', date: '$date' }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } },
  ]);

  if (groups.length === 0) {
    logger.info('No duplicate { personId, date } attendance records found.');
  } else {
    logger.warn(
      `${groups.length} duplicated { personId, date } key(s) found in \`attendances\`.`
    );
  }

  let removed = 0;
  for (const group of groups) {
    const { personId, date } = group._id;
    const records = await Attendance.find({ personId, date }).sort({ _id: 1 });
    if (records.length < 2) continue;

    const survivor = pickSurvivor(records);
    const doomed = records.filter((r) => String(r._id) !== String(survivor._id));
    const newest = latestLastSeen(records);

    logger.info(
      `${personId} / ${date}: ${records.length} records — keeping ${survivor._id} ` +
        `(firstSeen ${survivor.firstSeen?.toISOString?.() || survivor.firstSeen}), ` +
        `${apply ? 'removing' : 'would remove'} ${doomed.length}`
    );

    if (!apply) continue;

    if (newest && new Date(survivor.lastSeen || 0).getTime() < newest) {
      survivor.lastSeen = new Date(newest);
      await survivor.save();
    }
    const result = await Attendance.deleteMany({ _id: { $in: doomed.map((r) => r._id) } });
    removed += result.deletedCount || 0;
  }

  if (!apply) {
    logger.warn(
      'Report-only run — nothing was changed. Re-run with `-- --apply` to remove the ' +
        'duplicates listed above.'
    );
  } else {
    logger.info(`Removed ${removed} duplicate attendance record(s).`);
    const state = await ensureCriticalIndexes();
    logger.info(
      state.verified
        ? 'Unique { personId, date } index verified — attendance writes are enabled again.'
        : `Index still not verified: ${state.error}`
    );
  }

  await disconnectDatabase();
  process.exit(0);
}

dedupe().catch((error) => {
  logger.error('Attendance dedupe failed', error.message);
  process.exit(1);
});
