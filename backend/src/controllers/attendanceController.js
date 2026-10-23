import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { Attendance } from '../models/Attendance.js';
import { Person } from '../models/Person.js';
import { Camera } from '../models/Camera.js';
import { attendanceDateKey, escapeRegex, toQueryString } from '../services/identityRules.js';

/**
 * Attendance reporting (Review 2) — READ ONLY.
 *
 * THERE IS DELIBERATELY NO CLIENT-FACING POST /api/attendance, AND NO OTHER
 * WRITE ROUTE OF ANY KIND IN THIS CONTROLLER. Attendance records are created
 * only by the trusted recognition workflow: the AI service posts a recognition
 * result to POST /api/ai/recognition (gated by the `x-ai-secret` shared
 * secret), recognitionService re-verifies the identity against the backend's
 * own person records and threshold, and attendanceService performs the atomic
 * upsert. An authenticated browser client cannot submit a person ID and mark
 * attendance, because that would let a client assert an identity.
 *
 * Every number returned here is computed from persisted data. Nothing is
 * hardcoded, and nothing is derived in the frontend.
 */

/** Resolves person and camera display context for a page of records at once. */
async function enrich(records) {
  const personIds = [...new Set(records.map((r) => r.personId).filter(Boolean))];
  const cameraIds = [...new Set(records.map((r) => r.cameraId).filter(Boolean))];

  // Two bulk queries plus Map lookups — never one query per row (no N+1).
  const [people, cameras] = await Promise.all([
    Person.find({ personId: { $in: personIds } }).select(
      'personId name category department photo'
    ),
    Camera.find({ cameraId: { $in: cameraIds } }).select('cameraId name'),
  ]);

  const personById = new Map(people.map((p) => [p.personId, p]));
  const cameraNameById = new Map(cameras.map((c) => [c.cameraId, c.name]));

  return records.map((record) => {
    const person = personById.get(record.personId);
    return {
      id: record._id.toString(),
      personId: record.personId,
      // Falls back to the raw id when the person was deleted after the record
      // was written, so history stays readable.
      personName: person?.name || record.personId,
      category: person?.category || null,
      department: person?.department || null,
      photo: person?.photo || null,
      cameraId: record.cameraId || null,
      cameraName: record.cameraId
        ? cameraNameById.get(record.cameraId) || record.cameraId
        : null,
      date: record.date,
      sessionKey: record.sessionKey || record.date,
      firstSeen: record.firstSeen,
      lastSeen: record.lastSeen,
      status: record.status,
      source: record.source,
      recognitionEventId: record.recognitionEventId
        ? record.recognitionEventId.toString()
        : null,
      // A cosine similarity, not a detector confidence and not a probability.
      similarity: record.similarity ?? null,
      createdAt: record.createdAt,
    };
  });
}

/**
 * Builds the attendance filter. `department`, `category` and `search` are
 * properties of the PERSON, so they are resolved to a personId set first and
 * applied as a single $in — again avoiding a per-row lookup.
 *
 * Every raw query value goes through `toQueryString` first. Express's extended
 * query parser turns `?date[$ne]=2026-01-01` into an object, which would reach
 * Mongo as an OPERATOR and change which records the caller can read; the
 * coercion drops anything that is not a plain string or finite number.
 */
async function buildAttendanceFilter(query) {
  const date = toQueryString(query.date);
  const personId = toQueryString(query.personId);
  const cameraId = toQueryString(query.cameraId);
  const status = toQueryString(query.status);
  const department = toQueryString(query.department);
  const category = toQueryString(query.category);
  const search = toQueryString(query.search);

  const filter = {};
  if (date) filter.date = date;
  if (cameraId) filter.cameraId = cameraId;
  if (status) filter.status = status;
  if (personId) filter.personId = personId;

  const personFilter = {};
  if (department) personFilter.department = department;
  if (category) personFilter.category = category;
  if (search) {
    const pattern = new RegExp(escapeRegex(search), 'i');
    personFilter.$or = [{ personId: pattern }, { name: pattern }];
  }

  if (Object.keys(personFilter).length > 0) {
    const matching = await Person.find(personFilter).select('personId');
    const ids = matching.map((p) => p.personId);
    // Intersect with an explicit personId filter if both were supplied.
    if (filter.personId) {
      if (!ids.includes(filter.personId)) filter.personId = { $in: [] };
    } else {
      filter.personId = { $in: ids };
    }
  }

  return filter;
}

export const listAttendance = asyncHandler(async (req, res) => {
  const { limit = 50, page = 1 } = req.query;
  const filter = await buildAttendanceFilter(req.query);

  const perPage = Math.min(Number(limit) || 50, 200);
  const skip = (Math.max(Number(page) || 1, 1) - 1) * perPage;

  const [records, total] = await Promise.all([
    Attendance.find(filter).sort({ date: -1, firstSeen: -1 }).skip(skip).limit(perPage),
    Attendance.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: { items: await enrich(records), total, page: Number(page) || 1, perPage },
  });
});

/**
 * Attendance summary for one session (date). Every figure is a real count or
 * aggregation over persisted documents.
 *
 * `attendancePercentage` is present / registered. "Registered" means active
 * people, since a deactivated person is not expected to attend.
 */
export const getAttendanceSummary = asyncHandler(async (req, res) => {
  // Coerced, not trusted: an object from `?date[$gt]=` must not become a Mongo
  // operator.
  const date = toQueryString(req.query.date) || attendanceDateKey();
  const recentLimit = Math.min(Number(req.query.limit) || 10, 50);

  const [totalRegistered, recognitionReadyPeople, presentToday, recent] = await Promise.all([
    Person.countDocuments({ active: true }),
    Person.countDocuments({
      active: true,
      recognitionEnabled: true,
      faceEmbedding: { $exists: true, $ne: [] },
    }),
    Attendance.countDocuments({ date, status: { $in: ['present', 'late'] } }),
    Attendance.find({ date }).sort({ firstSeen: -1 }).limit(recentLimit),
  ]);

  const notMarked = Math.max(totalRegistered - presentToday, 0);
  const attendancePercentage =
    totalRegistered > 0 ? Math.round((presentToday / totalRegistered) * 1000) / 10 : 0;

  res.json({
    success: true,
    data: {
      date,
      totalRegistered,
      recognitionReadyPeople,
      presentToday,
      notMarked,
      attendancePercentage,
      recentRecords: await enrich(recent),
    },
  });
});

export const getAttendanceRecord = asyncHandler(async (req, res) => {
  const record = await Attendance.findById(req.params.id);
  if (!record) throw ApiError.notFound('Attendance record not found');
  const [enriched] = await enrich([record]);
  res.json({ success: true, data: enriched });
});
