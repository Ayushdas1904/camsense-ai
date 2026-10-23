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
  detection, alert, camera-status and dashboard events, and Review 2 adds
  `person:recognized`, `identity:unknown`, `attendance:marked` and
  `recognition:status`.

Why separate the AI service? Python owns the CV ecosystem (OpenCV, YOLO, face
recognition). Isolating it lets models scale/deploy independently and keeps
heavy inference off the request path and out of the browser.

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

## 6. Database architecture

Mongoose schemas, by status:

- **Wired and in use** — `User` (auth), `Camera`, `Detection`, `Alert`
  (Review 1); `Person`, `Attendance`, `RecognitionEvent` (Review 2).
- **Scaffolding for Review 3** — `Occupancy`, `EnergyRecord`, `Notification`.

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

**Planned (Review 3, not implemented)** — an occupancy surface
(e.g. `/api/occupancy`) plus the `/occupancy`, `/energy` and `/analytics`
backend mounts, which remain commented out in `backend/src/routes/index.js`.

## 10–12. Results / challenges / future scope

Tracked per review. Future scope includes IoT device control, violence/behavior
detection, multi-camera distributed processing, and centralized monitoring.

Review 1 results are demonstrable. **Review 2 was implemented but could not be
executed** in the environment it was written in: no test, build, typecheck,
dependency install, model download, database, or service start was possible, so
the identity layer is statically reviewed rather than demonstrated, and no
recognition-accuracy figure is claimed. The per-command record is in
[`REVIEW2-REPORT.md`](REVIEW2-REPORT.md) §11.

## Development philosophy

Every feature follows: **USER ACTION → FRONTEND → API → BACKEND → DB/AI → RESULT → FRONTEND.**
No button exists without a real action behind it (now or planned); no metric is
faked; every detection is real or clearly labeled DEMO.
