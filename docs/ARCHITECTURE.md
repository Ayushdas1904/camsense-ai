# CamSense AI — Architecture

This document explains the system design for the academic reviews. It is
organized around the topics an evaluator will ask about.

## 1. Problem statement

Traditional CCTV records video and depends on humans to continuously watch it.
Monitoring is fatiguing, error-prone, and reactive — incidents are usually seen
after the fact. A single camera also serves only one purpose (recording), even
though the same feed could answer many questions.

## 2. Existing system

- Passive recording to disk/NVR.
- Manual monitoring on video walls.
- No automatic understanding of content.
- Separate systems for attendance, occupancy, and energy control.

## 3. Proposed system

CamSense AI adds an intelligence layer:

> CAMERA → SEE → UNDERSTAND → GENERATE EVENT → TAKE ACTION

One camera infrastructure powers security, identity, attendance, occupancy,
energy optimization, and analytics.

## 4. System architecture

Two decoupled paths keep AI models isolated from the UI:

```
FRONTEND ──► BACKEND ──► DATABASE           (application data path)
VIDEO ──► AI SERVICE ──► BACKEND ──► FRONTEND (intelligence path)
```

- **Frontend (React)** — talks only to the backend through a centralized API layer.
- **Backend (Node/Express)** — auth, data, business rules; the only caller of the AI service.
- **AI service (Python/FastAPI)** — all computer-vision work behind a stable JSON contract.
- **Database (MongoDB)** — persistence via Mongoose schemas.
- **Real-time (Socket.IO)** — gateway wired at the foundation; Review 1 emits
  detection, alert, camera-status and dashboard events, Review 2 adds
  `person:recognized`, `identity:unknown`, `attendance:marked` and
  `recognition:status`, and Review 3 adds `occupancy:update`, `room:status`,
  `device:state`, `automation:action` and `energy:update`.

Why separate the AI service? Python owns the CV ecosystem (OpenCV, YOLO, face
recognition). Isolating it lets models scale/deploy independently and keeps
heavy inference off the request path and out of the browser.

### 4.1 Review 3 data flow — camera to device to dashboard

Review 3 adds a third leg to the intelligence path. It reuses the **same** YOLO
human detections Review 1 already produces: no second model, no extra inference
pass, no new dependency.

```
┌──────────────┐
│ CAMERA/VIDEO │  RTSP (real mode) or the bundled sample video (demo mode)
└──────┬───────┘
       │ frames, skipped to a target FPS
       ▼
┌─────────────────────────────────────────────────────────────┐
│ AI SERVICE · per-camera worker thread                       │
│                                                             │
│  YOLOv8  ──► human + weapon detections   (Review 1, every   │
│    │                                      processed frame)  │
│    │                                                        │
│    └──► PERSON TRACKS  (bbox-IoU ≥ 0.3, one claim per       │
│          frame, TTL 3 s, min 2 hits)                        │
│              │                                              │
│              ▼                                              │
│       occupancy = COUNT OF DISTINCT LIVE TRACKS             │
│       occupancy_available = model loaded AND capture ok      │
│       (unavailable ⇒ keep the last count, NEVER zero it)     │
└──────┬──────────────────────────────────────────────────────┘
       │ POST /api/ai/occupancy        x-ai-secret, background thread,
       │                               rate-limited, bypassed on a change,
       │                               NO FRAME AND NO IMAGE
       ▼
╔═════════════════════════════════════════════════════════════╗
║ NODE BACKEND — THE TRUST BOUNDARY                           ║
║                                                             ║
║  cameraId must resolve to a real Camera                     ║
║  count must be a non-negative integer                       ║
║  per-camera figures older than OCCUPANCY_STALE_AFTER are    ║
║    dropped from the aggregate                               ║
║  aggregateRoomCount  ──► MAX across the room's cameras      ║
║                          (NEVER a sum — see §4.2)           ║
║  deriveOccupancyStatus ──► one of six statuses, and         ║
║                            count = NULL when not measurable ║
╚══════┬───────────────────────────────┬══════════════════════╝
       │                               │
       ▼                               ▼
┌──────────────────┐        ┌────────────────────────────┐
│ ROOM OCCUPANCY   │        │ OCCUPANCY HISTORY          │
│ STATE            │        │ (`occupancies`)            │
│ one doc per room │        │ written on a CHANGE, or at │
│ upserted on      │        │ the sampling interval —    │
│ EVERY report     │        │ never once per frame       │
└──────┬───────────┘        └────────────────────────────┘
       │ direct function call (no queue, no second process)
       ▼
┌─────────────────────────────────────────────────────────────┐
│ AUTOMATION ENGINE                                           │
│   re-derives the status AT EVALUATION TIME                   │
│   decideDeviceAction, in this precedence:                    │
│     1 rule disabled / device not automatic → no_change       │
│     2 unexpired manual override  → skipped_override          │
│     3 occupancy NOT USABLE       → skipped_stale_data  ◄──── THE FAIL-SAFE
│     4 outside allowed hours      → skipped_schedule          │
│     5 inside command cooldown    → skipped_cooldown          │
│     6 above threshold            → switch_on  / no_change    │
│     7 below threshold long enough→ switch_off / no_change    │
│                                                             │
│   EVERY decision — including every skip — is written to     │
│   AutomationLog. A suspended rule is invisible otherwise.   │
└──────┬──────────────────────────────────────────────────────┘
       │ deviceService.issueCommand  (the ONLY writer of device state,
       │                              serialised per deviceId)
       ▼
┌─────────────────────────────────────────────────────────────┐
│ DEVICE ADAPTER  —  getAdapter(adapterType)                  │
│   'simulation' ──► in-process state, 'SIMULATED …' message  │
│   anything else ──► THROWS 'not implemented'                │
│                     (no MQTT/ESP32/relay exists, and no     │
│                      stub pretends to work)                 │
└──────┬──────────────────────────────────────────────────────┘
       │
   confirmed? ──── no ──► reportedState UNTOUCHED
       │                  history row confirmed:false
       │ yes              AutomationLog 'command_failed'
       │                  device_failure Alert (cooldowned)
       ▼                  HTTP 502 — never a quiet 200
┌──────────────────┐
│ DEVICE STATE     │  fromState → toState, changedAt, trigger,
│ HISTORY          │  reason, ruleId, actorId, confirmed
└──────┬───────────┘
       │ confirmed rows only
       ▼
┌─────────────────────────────────────────────────────────────┐
│ ENERGY ANALYTICS — ESTIMATES, NOT MEASUREMENTS              │
│   onSeconds = Σ confirmed 'on' intervals ∩ window           │
│   kWh       = configured watts × (onSeconds/3600) / 1000    │
│   baseline  = watts × ENERGY_BASELINE_HOURS_PER_DAY / 1000  │
│               (a DECLARED ASSUMPTION, pro-rated and capped) │
│   saved     = max(0, baseline − kWh)                        │
│   saved %   = NULL when the baseline is 0                   │
└──────┬──────────────────────────────────────────────────────┘
       │ REST + Socket.IO
       ▼
┌─────────────────────────────────────────────────────────────┐
│ REACT DASHBOARD                                             │
│   null renders as an em-dash, never 0                       │
│   SIMULATED / DEMO / ESTIMATED badges                       │
│   the baseline description sits next to every saving        │
│   reconnecting clients RE-FETCH over REST                   │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 Why occupancy enters over the service leg, and never from a client

Occupancy is **AI-produced data**, so it follows the rule Review 2 established
for recognition results, for exactly the same reason:

- **`POST /api/ai/occupancy` behind `requireInternalSecret` is the only write
  path.** The occupancy router is GET-only and there is no
  `POST /api/occupancy`, in the same way there is deliberately no
  `POST /api/attendance`. An authenticated browser client can read a headcount;
  it can never assert one.
- **The backend re-derives rather than trusting.** It applies its **own**
  staleness window (`OCCUPANCY_STALE_AFTER`) at evaluation time, so a stored
  status of *occupied* that was true ten minutes ago becomes *stale* with a
  **null** count before any automation rule can act on it. The AI service's
  verdict is an input, not a conclusion.
- **No image crosses the occupancy leg.** A headcount needs no snapshot, so the
  payload carries camera ids and counts only — no frame, no face, no identity,
  no embedding. Sending one would put people's faces on a leg with no reason to
  carry them.
- **`MAX`, never a sum, for a multi-camera room.** There is no cross-camera
  re-identification anywhere in this project, so one person standing in the
  overlap of two cameras is tracked independently by both and nothing can know
  the two tracks are the same human. Adding the counts would report two people
  where there is one, and the error would grow with the overlap. The maximum is
  a documented **lower bound** on the true headcount: possibly an undercount
  when the cameras see genuinely different parts of a room, but never a
  fabricated overcount.
- **Unavailable is not zero, and that distinction is the security property.**
  `camera_unavailable` and `stale` both carry `count: null`. Treating that null
  as `0` anywhere downstream would read *"we cannot see the room"* as *"the room
  is empty"* — and the automation engine would then switch the lights off on
  whoever is in it. The rule is enforced in one function
  (`occupancyRules.deriveOccupancyStatus`) and re-checked independently in a
  second (`automationRules.isOccupancyActionable`).

### 4.3 System workflow — one occupancy report, end to end

```
 t0   camera worker processes a frame
      │ YOLO returns 3 human boxes
      │ 2 match live tracks, 1 opens a new track (hits=1, below min 2)
      ├─► occupancy_count = 2        occupancy_available = true
      │
 t0+  reporter: count CHANGED from 1 → 2, so the 5 s interval is bypassed
      └─► POST /api/ai/occupancy {cameraId, count:2, available:true, mode}
                │
 t1   backend: camera resolves · count valid · rooms containing CAM-01 found
      │ ROOM-01 also has CAM-02, whose last report is 4 s old and available
      │ aggregate = MAX(2, 1) = 2            ← not 3
      │ derive  = 'occupied', count 2  (capacity 10, threshold 1)
      ├─► RoomOccupancyState upsert          (always)
      ├─► history row: count changed         (shouldPersistReading → write)
      ├─► emit occupancy:update + room:status
      └─► onOccupancyUpdated('ROOM-01')
                │
 t2   engine: RULE-LAB-01 enabled, DEV-LIGHT-01 controlMode 'automatic'
      │ markers: above-threshold clock started at t1
      │ decide: no override · usable · in hours · past cooldown ·
      │         2 > threshold 0 · device reportedState 'off'
      ├─► switch_on
      ├─► issueCommand → simulation adapter → ok, 'SIMULATED light on'
      ├─► reportedState 'on' · DeviceStateHistory confirmed:true
      ├─► AutomationLog decision 'switch_on', outcome 'applied'
      └─► emit device:state + automation:action
                │
 t3   (camera later goes dark; no report arrives at all)
      │ the 30 s tick fires anyway  ← this is why the tick exists
      │ re-derive: lastUpdatedAt is 40 s old > OCCUPANCY_STALE_AFTER
      │ status 'stale', count NULL
      ├─► decide → skipped_stale_data        NO COMMAND ISSUED
      ├─► threshold clocks FROZEN (an outage cannot accrue "unoccupied" time)
      └─► AutomationLog row with occupancyCount NULL, visible in the UI
```

## 5. AI pipeline

Each detector implements one interface (`Detector.detect(frame) -> Detection[]`).
A `DetectionPipeline` composes the enabled detectors and returns a single
structured `DetectionResponse`. The interface has held across two reviews: the
mock detectors of the foundation phase were replaced by real YOLOv8
human/weapon detection in Review 1, and Review 2 added a face detector to the
same list — **without changing the interface**, so the backend and frontend were
unaffected. Every response includes a `mode` (`demo`/`real`) field so simulated
output is never mistaken for real inference.

Review 2 keeps face **recognition** deliberately outside the `Detector`
interface, because recognition is not detection. `FaceDetector` reports presence
and location only; identity is produced by a separate module
(`app/recognition/face_service.py`) that aligns the face with YuNet's landmarks,
embeds it with SFace into a 128-d L2-normalized vector, and compares it against
a cached set of enrolled identities by cosine similarity, gated by a
configurable threshold. Recognition runs at a lower cadence than object
detection (every *N*th processed frame) so the Review 1 path is never slowed,
and both models are loaded exactly once. When the ONNX weights are absent the
recognition modules report themselves unavailable and YOLO detection continues
unaffected. See [`FACE_RECOGNITION.md`](FACE_RECOGNITION.md).

Review 3 adds **occupancy** without touching that interface at all. It consumes
the `human` detections the pipeline already returns and keeps per-camera person
tracks in the worker, so there is no new detector, no second inference pass and
no new dependency. Occupancy is therefore a *derived* measurement rather than a
model output — which is why its honesty rules live in the worker and in the
backend rather than in a detector. See
[`OCCUPANCY_ENERGY.md`](OCCUPANCY_ENERGY.md).

## 6. Database architecture

Mongoose schemas, by status:

- **Wired and in use** — `User` (auth), `Camera`, `Detection`, `Alert`
  (Review 1); `Person`, `Attendance`, `RecognitionEvent` (Review 2); `Room`,
  `Occupancy`, `RoomOccupancyState`, `Device`, `DeviceStateHistory`,
  `AutomationRule`, `AutomationLog`, `EnergySummary` (Review 3).
- **Still unused scaffolding** — `Notification`. Socket.IO plus the Alerts page
  already cover notification, so nothing writes it.

Review 3 replaced the two thin foundation-phase placeholders, `Occupancy` and
`EnergyRecord`, with real schemas. Both kept their mongoose **model names** so
their collections are not orphaned, and their legacy fields were retained as
**optional** so any pre-existing document still validates. `Alert.type` was
extended **additively** with `occupancy_warning`, `capacity_exceeded`,
`device_failure`, `automation_failure`, `ai_service_failure` and
`camera_unavailable`, keeping every pre-existing value — the same approach
Review 2 took when it added `unknown_identity` alongside `unknown_person`.

Two schema decisions carry the Review 3 honesty rules into the database itself:
`Occupancy.count` and `RoomOccupancyState.count` are **nullable**, so an
unmeasurable room is stored as `null` rather than as `0`; and
`DeviceStateHistory.confirmed` is what the energy arithmetic filters on, so a
command that failed can never bill a room for electricity it did not use.

`ensureCriticalIndexes()` in `config/db.js` now runs **three independent
groups** — attendance, occupancy, and device/automation — because a single
early-return path meant one group's failure would have skipped the others. Each
builds with `createIndexes()` and then **reads the indexes back** to verify
five unique keys: `rooms.roomId`, `roomoccupancystates.roomId`,
`devices.deviceId`, `automationrules.ruleId` and
`energyrecords.{date, deviceId}`. A verification failure degrades **only** the
affected write path — occupancy writes refuse, device commands refuse, the
automation tick returns early — and the backend keeps booting.

Passwords are stored only as bcrypt hashes (`select: false`).
`Person.faceEmbedding` is protected the same way and additionally stripped by a
`toJSON`/`toObject` transform; one shared-secret, service-to-service endpoint
in this API (`GET /api/ai/face-embeddings`) is permitted to emit it, and the
browser never calls it. On the AI service, `POST /api/faces/register` returns a
newly generated vector for storage and is gated by the same shared secret;
those two endpoints are the complete set. `Attendance` has a unique
`(personId, date)` index that enforces duplicate-prevention at the database
level — one record per person per calendar date, with the concurrent-insert
`E11000` path handled in `attendanceService`. That index is built and verified
at startup by `config/db.js` (with `createIndexes`, which never drops an index
it did not declare); if it cannot be built or verified, attendance writes are
refused and logged with their remediation while the rest of the backend keeps
running — `npm run dedupe:attendance` clears the duplicate records that block
the build.
Embeddings are a protected database field rather than a file; face IMAGES
(registration portraits, cropped event snapshots) are files on disk, served
only through the authenticated `/uploads` mount — which accepts a session token
in the `Authorization` header, or a narrowed, asset-scoped, shorter-lived token
in `?token=` for `<img>` tags, never the session token in a URL. The security
implications are documented in the README's *Biometric data handling* section,
including the explicit statement that embeddings are **not** anonymous or
irreversible.

## 7. Backend architecture

Layered: `routes → controllers → services → models`, with `middleware`
(auth, validation, error handling), `config` (env, db), `utils`, and `sockets`.
Controllers handle HTTP; services hold business rules; a central error handler
gives every response a consistent `{ success, error }` shape and never leaks
stack traces to clients.

## 8. Frontend architecture

`pages` render inside `layouts`; `components/ui` holds reusable primitives; a
centralized Axios client + per-resource services are the only place HTTP lives;
Redux Toolkit holds genuinely global state (auth); typed end to end via `types`.
Loading / empty / error states are standardized components.

## 9. AI model integration

The AI service exposes a stable JSON contract; the backend is its only caller,
and it authenticates: every route below except `GET /api/health` requires the
`x-ai-secret` shared service secret, verified in constant time and failing
closed when no secret is configured — there is no default value for it on
either side that could accidentally match. Both services bind `127.0.0.1` by
default.

**System** — `GET /api/health` (the only unauthenticated route),
`GET /api/status` (real per-detector readiness).

**Streaming (Review 1)** — `POST /api/stream/start`,
`POST /api/stream/{camera_id}/stop`,
`POST /api/stream/{camera_id}/demo-weapon`,
`GET /api/stream/{camera_id}/stats`, `GET /api/stream/{camera_id}` (MJPEG).
Detection results are *pushed* to the backend by a per-camera worker thread
rather than pulled per request, so there is no `/api/detect` endpoint: the
worker POSTs to `POST /api/ai/ingest` with the `x-ai-secret` shared secret,
from a background thread so a stalled backend cannot slow frame processing.

**Face recognition (Review 2)** — `POST /api/faces/register`,
`POST /api/faces/cache/refresh`, `GET /api/faces/status`. Recognition results
follow the same push model, to `POST /api/ai/recognition`; the AI service reads
enrolled embeddings from `GET /api/ai/face-embeddings`. All four of those
backend endpoints are shared-secret gated and unreachable from the browser.

The backend persists results as `Detection` / `Alert` / `RecognitionEvent` /
`Attendance` documents — after independently re-verifying any identity claim —
then pushes real-time events to the frontend over Socket.IO.

**Occupancy (Review 3)** — the AI service gained **no new
route** in Review 3: occupancy is reported by the same push model
(`POST /api/ai/occupancy`, shared-secret gated) and surfaced through the
existing `GET /api/stream/{camera_id}/stats`, which now also returns
`occupancy`, `occupancy_available` and `occupancy_age_seconds`. On the backend
side, `/rooms`, `/occupancy`, `/devices`, `/automation` and `/energy` are now
mounted; only `/analytics` and `/notifications` remain commented out in
`backend/src/routes/index.js`.

## 10–12. Results / challenges / future scope

Tracked per review. Future scope includes **a real IoT device adapter** (the
interface exists; only the simulation adapter is implemented), a proper
multi-object tracker and cross-camera re-identification for accurate occupancy,
actual power metering so energy figures become measurements rather than
estimates, violence/behavior detection, multi-camera distributed processing, and
centralized monitoring.

Review 1 results are demonstrable. **Review 2 and Review 3 were both
implemented but could not be executed** in the environment they were written
in: no test, build, typecheck, dependency install, model download, database, or
service start was possible. The identity, occupancy, automation and energy
layers are therefore statically reviewed rather than demonstrated, **no
recognition-accuracy figure and no energy-savings figure is claimed as
measured**, and no device — not even a simulated one — has ever been switched.
The per-command records are in [`REVIEW2-REPORT.md`](REVIEW2-REPORT.md) §11 and
[`REVIEW3-REPORT.md`](REVIEW3-REPORT.md) §D.

## Development philosophy

Every feature follows: **USER ACTION → FRONTEND → API → BACKEND → DB/AI → RESULT → FRONTEND.**
No button exists without a real action behind it (now or planned); no metric is
faked; every detection is real or clearly labeled DEMO; every device is real or
clearly labeled SIMULATED; and anything the system cannot measure is reported as
unknown rather than as zero.
