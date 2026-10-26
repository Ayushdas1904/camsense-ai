/**
 * Shared application types. Mirrors the backend's data contract so the app is
 * fully typed end to end.
 */

export type UserRole = 'admin' | 'operator' | 'viewer';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  createdAt?: string;
  updatedAt?: string;
}

export interface AuthSession {
  user: User;
  token: string;
  /**
   * Narrowed credential for the backend's authenticated `/uploads` image
   * mount. An <img> cannot send an Authorization header, so this one travels
   * in the URL; it is scoped to image reads and expires sooner than `token`,
   * which the backend refuses to accept in that query parameter.
   */
  assetToken?: string;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiErrorBody {
  success: false;
  error: { message: string; details?: unknown };
}

export type ViewStatus = 'idle' | 'loading' | 'success' | 'empty' | 'error';

export interface BackendHealth {
  service: string;
  status: string;
  environment: string;
  uptimeSeconds: number;
  database: { status: string };
  timestamp: string;
}

// ── Review 1 ─────────────────────────────────────────────────

export type CameraMode = 'demo' | 'real';
export type CameraStatus = 'online' | 'offline' | 'connecting' | 'error';

export interface Camera {
  _id: string;
  cameraId: string;
  name: string;
  location: string;
  streamUrl: string;
  mode: CameraMode;
  status: CameraStatus;
  aiEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CameraInput {
  cameraId: string;
  name: string;
  location?: string;
  streamUrl?: string;
  mode: CameraMode;
  aiEnabled: boolean;
}

export type DetectionType = 'human' | 'weapon' | 'face' | 'other';

export interface Detection {
  _id: string;
  cameraId: string;
  type: DetectionType;
  class: string;
  confidence: number;
  boundingBox?: number[];
  source: 'demo' | 'real';
  timestamp: string;
}

export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertStatus = 'new' | 'acknowledged' | 'resolved';

export interface Alert {
  id: string;
  type: string;
  severity: AlertSeverity;
  cameraId: string;
  cameraName?: string;
  objectClass?: string;
  confidence?: number;
  message: string;
  snapshot?: string;
  status: AlertStatus;
  timestamp: string;
  /**
   * Review 3 (additive, optional). An occupancy or capacity alert references a
   * room; a device_failure alert references a device. Review 1/2 alerts leave
   * all of these undefined, so the Review 1 AlertsPage keeps typing unchanged.
   */
  roomId?: string;
  roomName?: string | null;
  deviceId?: string;
  deviceName?: string | null;
  /** So a device_failure row can be labelled SIMULATED. */
  deviceSimulated?: boolean | null;
}

export interface DetectorStatus {
  key: string;
  label: string;
  /**
   * Review 2 widened this union: the recognition and attendance rows need to be
   * able to report INACTIVE and ERROR in addition to the Review 1 states, and
   * ai-service/app/detection/base.py documents all five.
   */
  status: 'active' | 'unavailable' | 'demo' | 'inactive' | 'error';
}

export interface AiStatus {
  reachable?: boolean;
  mode: CameraMode;
  model_loaded: boolean;
  detectors: DetectorStatus[];
}

export interface DashboardStats {
  totalCameras: number;
  activeCameras: number;
  peopleDetectedToday: number;
  weaponsDetectedToday: number;
  newAlerts: number;
  totalAlerts: number;
  ai: AiStatus;
  // Review 2 (additive, and optional so an older backend response still types).
  totalPeople?: number;
  recognitionEnabledPeople?: number;
  presentToday?: number;
  unknownIdentitiesToday?: number;
  /**
   * Review 3 (additive, optional for the same reason).
   *
   * EVERY ONE OF THESE IS `number | null`, and the null is load-bearing: the
   * backend returns null when a figure COULD NOT BE DETERMINED, which is not
   * the same as 0. A null `roomsOccupied` means the occupancy layer failed to
   * answer; a 0 means it answered "no room is occupied". The UI must render an
   * em-dash for null and never coerce it with `?? 0`.
   *
   * Occupancy rooms whose figure is untrustworthy are counted in their own
   * bucket (`roomsOccupancyUnavailable`) and are deliberately NOT part of
   * `roomsOccupied` or of an unoccupied count — a camera outage is not an
   * empty building.
   */
  roomsMonitored?: number | null;
  roomsTotal?: number | null;
  roomsOccupied?: number | null;
  roomsNearCapacity?: number | null;
  roomsCapacityExceeded?: number | null;
  roomsOccupancyUnavailable?: number | null;
  totalOccupants?: number | null;
  roomsWithoutOccupancyData?: number | null;
  devicesTotal?: number | null;
  devicesOn?: number | null;
  devicesUnknownState?: number | null;
  devicesSimulated?: number | null;
  devicesOffline?: number | null;
  devicesAutomatic?: number | null;
  automationRulesEnabled?: number | null;
  automationActionsToday?: number | null;
  automationSkippedStaleToday?: number | null;
  automationFailuresToday?: number | null;
  energyKwhToday?: number | null;
  energySavedKwhToday?: number | null;
  energySavingsPercentToday?: number | null;
  /** Always true when a figure is present — there is no power meter here. */
  energyEstimated?: boolean | null;
  energySimulated?: boolean | null;
  energyInsufficientData?: boolean | null;
  energyBaselineHoursPerDay?: number | null;
}

export interface StreamStats {
  camera_id: string;
  running: boolean;
  mode: CameraMode;
  fps: number;
  inference_ms: number;
  people: number;
  weapons: number;
  model_loaded: boolean;
  // Review 2 (additive, optional for the same reason).
  faces?: number;
  known_faces?: number;
  unknown_faces?: number;
  recognition_available?: boolean;
  recognition_errors?: number;
  // Reports the AI service had to discard because its in-flight POST cap was
  // reached. Non-zero means the backend never learned about those sightings.
  recognition_reports_dropped?: number;
  detection_reports_dropped?: number;
  /**
   * Review 3 (additive, optional). The number of DISTINCT tracked people —
   * one person across consecutive frames counts once — which is NOT the same
   * figure as `people` above (the human box count in the current frame).
   *
   * `occupancy` is `number | null`: null when the worker could not measure it.
   * When `occupancy_available` is false the last value is deliberately LEFT AS
   * IT WAS rather than zeroed, so the consumer must check the flag and render
   * a no-data indicator instead of the number.
   */
  occupancy?: number | null;
  occupancy_available?: boolean;
  occupancy_age_seconds?: number | null;
}

export interface RecentEvent {
  kind: 'alert' | 'detection';
  id: string;
  severity: AlertSeverity;
  title: string;
  cameraName: string;
  timestamp: string;
}

/** Socket event payloads (must match backend sockets/index.js). */
export interface DetectionEventPayload {
  id: string;
  cameraId: string;
  cameraName: string;
  type: DetectionType;
  class: string;
  confidence: number;
  source: 'demo' | 'real';
  timestamp: string;
}

// ── Review 2 ─────────────────────────────────────────────────
//
// Mirrors the backend contract exactly:
//   serializePerson()            in backend/src/services/identityRules.js
//   enrich()                     in backend/src/controllers/attendanceController.js
//   enrich()                     in backend/src/controllers/recognitionEventController.js
//   getAttendanceSummary()       in backend/src/controllers/attendanceController.js
//   the Review 2 emit() payloads in backend/src/services/recognitionService.js
//
// PRIVACY: there is deliberately NO embedding field anywhere below. A face
// embedding is biometric data; the only endpoint in the whole API that emits
// one is the shared-secret-gated GET /api/ai/face-embeddings, which is
// service-to-service and never reaches the browser. Because the Person type has
// no such field, the type system itself forbids the frontend from handling a
// biometric vector. Recognition readiness is driven by the derived booleans
// (`faceRegistered`, `recognitionReady`) instead.

/** 'admin' is rendered as "Administrator" — see personCategoryLabel. */
export type PersonCategory = 'student' | 'faculty' | 'staff' | 'admin';

export interface Person {
  /** Mongo _id, serialized as `id` by the backend. */
  id: string;
  personId: string;
  name: string;
  email: string;
  category: PersonCategory;
  department: string;
  /** Pre-existing free-text field, kept alongside `category`. */
  role: string;
  /** URL reference to the stored photograph — never image bytes. */
  photo: string | null;
  recognitionEnabled: boolean;
  active: boolean;
  /** Derived: a face embedding exists for this person. */
  faceRegistered: boolean;
  /** Derived: faceRegistered AND recognitionEnabled AND active. */
  recognitionReady: boolean;
  embeddingModel: string | null;
  /** Vector LENGTH only — metadata, never the vector. */
  embeddingDim: number | null;
  faceRegisteredAt: string | null;
  registeredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PersonInput {
  personId: string;
  name: string;
  email?: string;
  category: PersonCategory;
  department?: string;
  role?: string;
  recognitionEnabled?: boolean;
  active?: boolean;
}

/**
 * Recognition outcome. `known` is the ONLY status for which a person's name may
 * be rendered — see backend validateIdentityClaim(): being the closest
 * candidate is not a match.
 */
export type RecognitionStatus = 'known' | 'unknown' | 'low_quality' | 'recognition_unavailable';

export interface RecognitionEvent {
  id: string;
  cameraId: string;
  cameraName: string;
  location: string | null;
  status: RecognitionStatus;
  /** Populated only for a verified `known` event. */
  personId: string | null;
  personName: string | null;
  category: PersonCategory | null;
  department: string | null;
  /**
   * Cosine similarity between face embeddings. This is NOT an object-detection
   * confidence and NOT a calibrated probability — never render it with the same
   * label as Detection.confidence.
   */
  similarity: number | null;
  /** Real coordinates from the AI service: [x, y, width, height]. */
  boundingBox: number[] | null;
  snapshot: string | null;
  trackId: string | null;
  source: 'real' | 'demo';
  acknowledged: boolean;
  alertId: string | null;
  timestamp: string;
}

export type AttendanceStatus = 'present' | 'late' | 'absent';
export type AttendanceSource = 'recognition' | 'manual' | 'demo';

export interface AttendanceRecord {
  id: string;
  personId: string;
  personName: string;
  category: PersonCategory | null;
  department: string | null;
  photo: string | null;
  cameraId: string | null;
  cameraName: string | null;
  /** The attendance session key: a 'YYYY-MM-DD' calendar date. */
  date: string;
  sessionKey: string;
  firstSeen: string;
  lastSeen: string | null;
  status: AttendanceStatus;
  source: AttendanceSource;
  recognitionEventId: string | null;
  /** Face similarity, not a detector confidence. */
  similarity: number | null;
  createdAt: string;
}

/**
 * Every figure here is counted/aggregated by the backend over persisted
 * documents. The UI must render them as-is and must never recompute them from a
 * partial page of rows.
 */
export interface AttendanceSummary {
  date: string;
  totalRegistered: number;
  recognitionReadyPeople: number;
  presentToday: number;
  notMarked: number;
  attendancePercentage: number;
  recentRecords: AttendanceRecord[];
}

/** Successful outcome of POST /api/people/:id/face-registration. */
export interface FaceRegistrationResult {
  status: 'OK';
  faceDetected: boolean;
  /** Backend message, relayed verbatim: 'Face detected successfully.' */
  detectionMessage: string;
  /** Backend message, relayed verbatim: 'Face registration completed successfully.' */
  message: string;
  facesDetected: number;
  boundingBox: number[] | null;
  /** Face DETECTION score from the detector — not a recognition similarity. */
  detectionScore: number | null;
  person: Person;
}

/** person:recognized — emitted only after the backend re-verified the claim. */
export interface PersonRecognizedPayload {
  eventId: string;
  cameraId: string;
  cameraName?: string;
  personId: string;
  personName: string;
  similarity: number | null;
  threshold: number;
  boundingBox: number[] | null;
  status: 'known';
  source: 'real' | 'demo';
  attendanceMarked: boolean;
  timestamp: string;
}

/** identity:unknown — an unmatched face, not proof of wrongdoing. */
export interface IdentityUnknownPayload {
  eventId: string;
  alertId: string;
  cameraId: string;
  cameraName?: string;
  status: 'unknown';
  reason?: string;
  similarity: number | null;
  threshold: number;
  boundingBox: number[] | null;
  snapshot: string | null;
  trackId?: string | null;
  sightings?: number;
  source: 'real' | 'demo';
  timestamp: string;
}

/** attendance:marked — emitted only when a record was actually created. */
export interface AttendanceMarkedPayload {
  id: string;
  personId: string;
  personName: string;
  cameraId: string | null;
  cameraName?: string;
  date: string;
  status: AttendanceStatus;
  source: AttendanceSource;
  firstSeen: string;
  lastSeen: string | null;
  similarity: number | null;
}

/** Display label for a person category. 'admin' reads as "Administrator". */
export const personCategoryLabel: Record<PersonCategory, string> = {
  student: 'Student',
  faculty: 'Faculty',
  staff: 'Staff',
  admin: 'Administrator',
};

// ── Review 3 ─────────────────────────────────────────────────
//
// Mirrors the backend contract exactly:
//   serializeRoomState()     in backend/src/services/occupancyService.js
//   listHistory()            in backend/src/services/occupancyService.js
//   roomSummary()            in backend/src/services/occupancyService.js
//   serializeDevice()        in backend/src/services/deviceService.js
//   listDeviceHistory()      in backend/src/services/deviceService.js
//   serializeRule()          in backend/src/controllers/automationController.js
//   getAutomationHistory()   in backend/src/controllers/automationController.js
//   summary/history/byRoom/byDevice/trend in backend/src/services/energyService.js
//   getComponentHealth()     in backend/src/controllers/healthController.js
//
// ═══ THE TWO CONTRACTS THE UI MUST NOT BREAK ═══
//
// 1. OCCUPANCY `count` IS `number | null`, AND NULL IS NOT ZERO. The backend
//    returns null whenever the figure is not trustworthy — a camera that
//    cannot be read, or a reading older than the staleness window. A room with
//    `status: 'camera_unavailable'` and `count: null` must render its status
//    and a no-data indicator. Writing `count ?? 0` would turn "we don't know"
//    into "the room is empty", which is the single most misleading thing this
//    page could do.
//
// 2. EVERY ENERGY FIGURE IS AN ESTIMATE, and `savingsPercent` is
//    `number | null`. There is no power meter in this project: energy is a
//    CONFIGURED wattage multiplied by a measured duration, quoted against an
//    operator-set baseline that travels inside every response. A null
//    `savingsPercent` means the baseline is 0 and no percentage is meaningful;
//    it must never render as 0%.

/** The six occupancy statuses. Exactly the backend's OCCUPANCY_STATUSES. */
export type OccupancyStatus =
  | 'occupied'
  | 'unoccupied'
  | 'near_capacity'
  | 'capacity_exceeded'
  | 'camera_unavailable'
  | 'stale';

/** One camera's contribution to a room's figure. */
export interface RoomCameraReading {
  cameraId: string;
  count: number | null;
  available: boolean;
  reportedAt: string | null;
}

/**
 * A room/zone together with its CURRENT occupancy, as returned by
 * GET /api/rooms, GET /api/rooms/:id and GET /api/occupancy/current.
 */
export interface Room {
  roomId: string;
  name: string;
  description: string;
  cameraIds: string[];
  /** 0 means "capacity not configured" — capacity statuses are then skipped. */
  capacity: number;
  occupancyThreshold: number;
  nearCapacityRatio: number;
  monitoringEnabled: boolean;
  active: boolean;
  /** NULL, never 0, when unavailable or stale. See contract 1 above. */
  count: number | null;
  status: OccupancyStatus;
  /** The backend's own wording. Use it rather than a local label map. */
  statusLabel: string;
  available: boolean;
  source: 'real' | 'demo' | null;
  cameras: RoomCameraReading[];
  /** Last SUCCESSFUL measurement. Does not move while a camera is dark. */
  lastUpdatedAt: string | null;
  /** Last report of any kind, successful or not. */
  lastReportAt: string | null;
  dataQuality: string;
  staleAfterSec: number;
}

/** Body for POST /api/rooms and PUT /api/rooms/:id (admin only). */
export interface RoomInput {
  roomId: string;
  name: string;
  description?: string;
  cameraIds: string[];
  capacity: number;
  occupancyThreshold: number;
  nearCapacityRatio?: number;
  monitoringEnabled: boolean;
  active?: boolean;
}

/** One persisted occupancy measurement from GET /api/occupancy/history. */
export interface OccupancyReading {
  id: string;
  roomId: string;
  roomName: string;
  cameraId: string | null;
  /** NULL when the reading recorded an unavailable or stale source. */
  count: number | null;
  capacity: number;
  status: OccupancyStatus;
  statusLabel: string;
  available: boolean;
  source: 'real' | 'demo';
  dataQuality: string;
  perCamera: RoomCameraReading[];
  /** 'max' — never a sum, because cross-camera tracking is not implemented. */
  aggregation: string;
  timestamp: string;
}

/** GET /api/occupancy/current. */
export interface OccupancyCurrent {
  items: Room[];
  total: number;
  /** Backend-supplied status wording, keyed by status. */
  statusLabels: Record<string, string>;
}

/** GET /api/occupancy/summary — the dashboard's occupancy block. */
export interface OccupancySummary {
  totalRooms: number;
  monitoredRooms: number;
  occupiedRooms: number;
  unoccupiedRooms: number;
  nearCapacityRooms: number;
  capacityExceededRooms: number;
  /** Its own bucket — deliberately not folded into unoccupiedRooms. */
  unavailableRooms: number;
  staleRooms: number;
  /** Sum of trustworthy counts only. */
  totalOccupants: number;
  /** How many rooms are missing from totalOccupants. */
  roomsWithoutData: number;
  totalCapacity: number;
  rooms: Room[];
  statusLabels: Record<string, string>;
}

export type DeviceType = 'light' | 'fan';
/** 'unknown' is the honest initial state. It is NOT 'off'. */
export type DeviceState = 'on' | 'off' | 'unknown';
export type DeviceControlMode = 'automatic' | 'manual' | 'disabled';
/** Only 'simulation' is implemented — see GET /api/devices/adapters. */
export type DeviceAdapterType = 'simulation' | 'http';

export interface DeviceCommandRecord {
  state: DeviceState | null;
  issuedAt: string | null;
  by: string | null;
  reason: string | null;
  /** 'applied' | 'failed' — a failure means the state did NOT change. */
  outcome: string | null;
  message: string | null;
}

export interface DeviceOverride {
  active: boolean;
  state: DeviceState | null;
  expiresAt: string | null;
  remainingSec: number;
  actorId?: string | null;
  reason?: string | null;
}

export interface Device {
  id: string | null;
  deviceId: string;
  name: string;
  roomId: string;
  type: DeviceType;
  /** 'unknown' until an adapter confirmed something. Never display as 'off'. */
  reportedState: DeviceState;
  desiredState: 'on' | 'off' | null;
  controlMode: DeviceControlMode;
  adapterType: DeviceAdapterType;
  /** TRUE for the simulation adapter. A SIMULATED badge is mandatory. */
  simulated: boolean;
  /** FALSE means commands to this device are refused, not silently simulated. */
  adapterImplemented: boolean;
  connectionStatus: 'online' | 'offline' | 'unknown';
  lastCommand: DeviceCommandRecord | null;
  lastSuccessfulStateAt: string | null;
  override: DeviceOverride;
  /** A CONFIGURED ESTIMATE used for energy arithmetic, not a measurement. */
  powerRatingWatts: number;
  /** False when the rating is 0 — the device then contributes no energy figure. */
  powerRatingConfigured: boolean;
  active: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  /** Present on a device:state emit for a command that FAILED. */
  commandFailed?: boolean;
  /** Present on GET /api/devices/:id. */
  rules?: { ruleId: string; name: string; enabled: boolean; roomId: string }[];
  note?: string;
}

/** Body for POST /api/devices and PUT /api/devices/:id (admin only). */
export interface DeviceInput {
  deviceId: string;
  name: string;
  roomId: string;
  type: DeviceType;
  controlMode: DeviceControlMode;
  adapterType: DeviceAdapterType;
  powerRatingWatts: number;
  active?: boolean;
}

/** One row of GET /api/devices/:id/history. */
export interface DeviceStateHistoryRow {
  id: string;
  deviceId: string;
  roomId: string | null;
  fromState: DeviceState;
  toState: DeviceState;
  changedAt: string;
  trigger: 'automation' | 'manual' | 'adapter_sync' | 'startup';
  reason: string;
  ruleId: string | null;
  actorId: string | null;
  /** FALSE = the command was attempted and NOT confirmed. Excluded from energy. */
  confirmed: boolean;
  adapterMessage: string | null;
  durationSec: number | null;
}

/** GET /api/devices/adapters — which adapters actually work. */
export interface AdapterHealth {
  adapters: { type: string; implemented: boolean; simulated: boolean; label: string }[];
  simulation: Record<string, unknown>;
  /** Plain-language statement that only simulation is implemented. */
  note: string;
}

/** Outcome of POST /api/devices/:id/command. HTTP 502 when ok is false. */
export interface DeviceCommandResult {
  ok: boolean;
  deviceId: string;
  requestedState: 'on' | 'off';
  /** On failure this is the UNCHANGED previous state. */
  reportedState: DeviceState;
  simulated: boolean;
  message: string;
  override: DeviceOverride | null;
  device: Device;
}

export type AutomationUnavailablePolicy = 'suspend' | 'leave_as_is';

export interface AutomationRule {
  id: string | null;
  ruleId: string;
  name: string;
  description: string;
  roomId: string;
  deviceIds: string[];
  /** Defaults to FALSE on the backend. Nothing runs until explicitly enabled. */
  enabled: boolean;
  occupancyThreshold: number;
  unoccupiedForSec: number;
  switchOffDelaySec: number;
  switchOnDelaySec: number;
  /** Both empty means "always allowed". An end before the start wraps midnight. */
  allowedHours: { start: string; end: string };
  commandCooldownSec: number;
  onUnavailableOccupancy: AutomationUnavailablePolicy;
  /** Backend prose describing what the rule does when a camera goes dark. */
  unavailableDataBehaviour: string;
  manualOverrideMinutes: number;
  active: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  devices?: Device[];
  devicesInAutomaticMode?: number;
  devicesTotal?: number;
  note?: string;
}

/** Body for POST /api/automation/rules and PUT .../:id (admin only). */
export interface AutomationRuleInput {
  ruleId: string;
  name: string;
  description?: string;
  roomId: string;
  deviceIds: string[];
  enabled: boolean;
  occupancyThreshold: number;
  unoccupiedForSec: number;
  switchOffDelaySec: number;
  switchOnDelaySec: number;
  allowedHours: { start: string; end: string };
  commandCooldownSec: number;
  onUnavailableOccupancy: AutomationUnavailablePolicy;
  manualOverrideMinutes: number;
  active?: boolean;
}

/**
 * Every automation decision, INCLUDING the skipped ones.
 *
 * The skips are the point: a rule that refused to act because the occupancy
 * figure was stale is the most important thing this list can show, and
 * filtering it out would make a suspended rule indistinguishable from one that
 * was never evaluated.
 */
export type AutomationDecision =
  | 'switch_on'
  | 'switch_off'
  | 'no_change'
  | 'skipped_stale_data'
  | 'skipped_override'
  | 'skipped_schedule'
  | 'skipped_cooldown'
  | 'command_failed';

export interface AutomationLog {
  id: string;
  ruleId: string | null;
  roomId: string | null;
  deviceId: string | null;
  decision: AutomationDecision;
  /** Human-readable, written by the engine. Render it verbatim. */
  reason: string;
  /** NULL for an unavailable or stale figure — never 0. */
  occupancyCount: number | null;
  occupancyStatus: OccupancyStatus | null;
  outcome: 'applied' | 'failed' | 'not_applicable';
  adapterMessage: string | null;
  evaluatedAt: string;
}

/** What the automation engine is actually doing. Facts, not a colour. */
export interface AutomationEngineHealth {
  running: boolean;
  tickIntervalSec: number;
  lastTickAt: string | null;
  lastError: string | null;
  note: string;
  rules?: number;
  enabledRules?: number;
}

/**
 * The declared assumption a savings figure is measured against. It travels
 * inside EVERY energy response, and the UI must render `description` next to
 * any savings number — a saving without its baseline is meaningless.
 */
export interface EnergyBaseline {
  hoursPerDay: number;
  description: string;
  /** 'ENERGY_BASELINE_HOURS_PER_DAY' — the env var that sets it. */
  source: string;
}

export interface EnergyDeviceFigures {
  deviceId: string;
  name: string;
  roomId: string;
  type: DeviceType;
  simulated: boolean;
  adapterType: DeviceAdapterType;
  powerRatingWatts: number;
  powerRatingConfigured: boolean;
  reportedState: DeviceState;
  onSeconds: number;
  onHours: number;
  energyKwh: number;
  baselineKwh: number;
  savedKwh: number;
  /** NULL when the baseline is 0. Must never render as 0%. */
  savingsPercent: number | null;
  estimated: true;
  insufficientData: boolean;
  /** What is missing. Render this as the empty-state text. */
  requires: string[] | null;
  transitionsConsidered: number;
}

export interface EnergyTotals {
  devices: number;
  /** How many devices are actually behind the total. */
  contributingDevices: number;
  devicesWithoutData: number;
  onSeconds: number;
  energyKwh: number;
  baselineKwh: number;
  savedKwh: number;
  savingsPercent: number | null;
  estimated: true;
  simulated: boolean;
}

/** Automation decision counts for a window — the context a saving needs. */
export interface EnergyAutomationCounts {
  switchedOn: number;
  switchedOff: number;
  noChange?: number;
  /** The fail-safe firing. A high number means the figures cover less. */
  skippedStaleData: number;
  skippedOverride?: number;
  skippedSchedule?: number;
  skippedCooldown?: number;
  failures: number;
  total: number;
}

/** GET /api/energy/summary. */
export interface EnergySummary {
  date: string;
  window: { from: string; to: string; partialDay: boolean };
  baseline: EnergyBaseline;
  estimated: true;
  simulated: boolean;
  insufficientData: boolean;
  requires: string[] | null;
  devices: EnergyDeviceFigures[];
  totals: EnergyTotals;
  automation: EnergyAutomationCounts;
}

/** One row of GET /api/energy/history — the evidence behind the summary. */
export interface EnergyHistoryRow {
  id: string;
  deviceId: string;
  deviceName: string;
  roomId: string | null;
  fromState: DeviceState;
  toState: DeviceState;
  changedAt: string;
  trigger: string;
  reason: string;
  ruleId: string | null;
  confirmed: boolean;
  adapterMessage: string | null;
  /** null while the interval is still open. */
  durationSec: number | null;
  powerRatingWatts: number;
  energyKwh: number;
  /** Explains a zero without the reader having to infer it. */
  energyCountedReason: string;
  simulated: boolean;
  estimated: true;
}

export interface EnergyHistory {
  items: EnergyHistoryRow[];
  total: number;
  page: number;
  perPage: number;
  maxLimit: number;
  baseline: EnergyBaseline;
  estimated: true;
}

/**
 * GET /api/energy/by-room.
 *
 * NOTE on `rooms[].devices`: the backend builds each room as
 * `{ roomId, ...totalsFor(rows), devices: rows.map(...) }`, and the explicit
 * `devices` key comes AFTER the spread — so it is the per-device ARRAY, not
 * the device count that `totals.devices` carries. Read `contributingDevices`
 * for the count behind a room's figure.
 */
export interface EnergyByRoomDevice {
  deviceId: string;
  name: string;
  energyKwh: number;
  savedKwh: number;
  simulated: boolean;
  insufficientData: boolean;
}

export interface EnergyRoomRollup extends Omit<EnergyTotals, 'devices'> {
  roomId: string;
  devices: EnergyByRoomDevice[];
}

export interface EnergyByRoom {
  window: { from: string; to: string; hours: number };
  baseline: EnergyBaseline;
  estimated: true;
  simulated: boolean;
  insufficientData: boolean;
  requires: string[] | null;
  rooms: EnergyRoomRollup[];
  totals: EnergyTotals;
}

/** GET /api/energy/by-device. */
export interface EnergyByDevice {
  window: { from: string; to: string; hours: number };
  baseline: EnergyBaseline;
  estimated: true;
  simulated: boolean;
  insufficientData: boolean;
  requires: string[] | null;
  devices: EnergyDeviceFigures[];
  totals: EnergyTotals;
}

/**
 * GET /api/energy/trend — daily totals from the EnergySummary rollup.
 *
 * `insufficientData` is TRUE until at least one COMPLETED day has been rolled
 * up, so an empty trend on a fresh system is expected and must render the
 * `requires` message rather than a flat line at zero.
 */
export interface EnergyTrendDay {
  date: string;
  energyKwh: number;
  baselineKwh: number;
  savedKwh: number;
  devices: number;
  simulated: boolean;
  savingsPercent: number | null;
  estimated: true;
}

export interface EnergyTrend {
  days: EnergyTrendDay[];
  baseline: EnergyBaseline;
  estimated: true;
  insufficientData: boolean;
  requires: string[] | null;
}

/**
 * GET /api/health/components.
 *
 * 'simulation' is its own status, deliberately NOT 'ok': the simulation
 * adapter responding is not evidence that hardware is connected. 'unknown'
 * means the component's state could not be determined, and the `detail`
 * carries the reason. No component here is ever reported as ready because the
 * backend answered — the AI model and the recognition subsystem are probed
 * independently.
 */
export type ComponentStatus = 'ok' | 'degraded' | 'down' | 'simulation' | 'unknown';

export interface ComponentHealth {
  key: string;
  label: string;
  status: ComponentStatus;
  /** Plain-language reason. Render it verbatim; it never contains a secret. */
  detail: string;
  [extra: string]: unknown;
}

export interface SystemHealth {
  overall: ComponentStatus;
  overallNote: string;
  simulationInUse: boolean;
  components: ComponentHealth[];
  timestamp: string;
}

/** occupancy:update — the serialized room state. */
export type OccupancyUpdatePayload = Room;

/** room:status — emitted only when a room's status actually changed. */
export interface RoomStatusPayload {
  roomId: string;
  roomName: string;
  previousStatus: OccupancyStatus | null;
  status: OccupancyStatus;
  statusLabel: string;
  count: number | null;
  available: boolean;
  timestamp: string;
}

/**
 * device:state — the serialized device.
 *
 * On a FAILED command this carries `commandFailed: true` and the UNCHANGED
 * `reportedState`. It must be rendered as a failure, never as a state change.
 */
export type DeviceStatePayload = Device;

/** automation:action — one engine decision, including the skips. */
export type AutomationActionPayload = AutomationLog;

/** energy:update — a rollup landed; re-fetch rather than trusting the payload. */
export interface EnergyUpdatePayload {
  date: string;
  devices: number;
  estimated: true;
}


