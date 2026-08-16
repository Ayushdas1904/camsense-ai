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
- **Real-time (Socket.IO)** — gateway wired at the foundation; events emitted in later reviews.

Why separate the AI service? Python owns the CV ecosystem (OpenCV, YOLO, face
recognition). Isolating it lets models scale/deploy independently and keeps
heavy inference off the request path and out of the browser.

## 5. AI pipeline

Each detector implements one interface (`Detector.detect(frame) -> Detection[]`).
A `DetectionPipeline` composes the enabled detectors and returns a single
structured `DetectionResponse`. Mock detectors ship now; real YOLO/face models
replace their bodies later **without changing the interface**, so the backend
and frontend are unaffected. Every response includes a `mode` (`demo`/`real`)
field so simulated output is never mistaken for real inference.

## 6. Database architecture

Mongoose schemas: `User` (wired now for auth), plus future-ready
`Camera`, `Person`, `Detection`, `Alert`, `Attendance`, `Occupancy`,
`EnergyRecord`, `Notification`. Passwords are stored only as bcrypt hashes
(`select: false`). `Attendance` has a unique `(personId, date)` index that
enforces duplicate-prevention at the database level.

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

## 9. AI model integration (later reviews)

The AI service exposes `/api/detect` (and future `/api/recognize`,
`/api/occupancy`). The backend proxies/consumes these and persists results as
`Detection`/`Alert` documents, then pushes real-time events to the frontend via
Socket.IO. The contract is fixed now; only the model implementations change.

## 10–12. Results / challenges / future scope

Tracked per review. Future scope includes IoT device control, violence/behavior
detection, multi-camera distributed processing, and centralized monitoring.

## Development philosophy

Every feature follows: **USER ACTION → FRONTEND → API → BACKEND → DB/AI → RESULT → FRONTEND.**
No button exists without a real action behind it (now or planned); no metric is
faked; every detection is real or clearly labeled DEMO.
