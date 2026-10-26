# CamSense AI — Review 3 Final Report

**Review 3 — "Teach CCTV to UNDERSTAND & ACT": smart occupancy monitoring,
occupancy-based energy optimization, device management with safe simulated
control, energy analytics, system-wide integration, and project completion.**

---

## ⚠ Read this before anything else

**Nothing in Review 3 has been executed.** No test, no build, no typecheck, no
`npm install`, no `pip install`, no byte-compile, no service start, no database
operation, no page render, no API call, and no camera experiment. Shell
execution was unavailable for the entire implementation: every command,
including a bare `echo hello`, failed at the OS sandbox layer *before the
command itself ran*.

That is also true of **Review 2**, which was written in the same conditions
(see [`REVIEW2-REPORT.md`](REVIEW2-REPORT.md) §11). So the honest statement of
where this project stands is:

> Review 1 is the only part of CamSense AI that has ever been run. Review 2 and
> Review 3 are written, internally consistent, and statically verified against
> the sources they call — and entirely unexecuted.

Consequently:

- **No accuracy figure is claimed anywhere.** No occupancy count, recognition
  result or detection has been measured.
- **No energy saving is claimed as measured.** Every kWh and every percentage
  this project can produce is an **estimate** computed from an operator-typed
  wattage against a **declared assumption**. There is no power meter in this
  project.
- **No physical device has ever been switched.** Device control is
  simulation-only. There is no MQTT, ESP32 or relay integration in this
  repository, and none is stubbed.

Section **D** below is the integrity-critical part of this report: it keeps
"actually executed" and "could not be executed" in two visibly separate
subsections, with the verbatim per-command record.

---

## A. Project completion summary

### A.1 What is complete, across all three reviews

| Review | Theme | Implementation | Ever executed? |
|---|---|---|---|
| **Foundation** | Architecture, scaffolding, auth, models | Complete | Yes |
| **Review 1** | *Teach CCTV to SEE* — cameras, MJPEG streaming, YOLOv8 human + weapon detection, detection events, alerts, live dashboard | Complete | **Yes** — this is the only part of the project with runtime evidence behind it |
| **Review 2** | *Teach CCTV to IDENTIFY* — person management, YuNet face detection, SFace embeddings, threshold-gated matching, attendance with database-level duplicate prevention, unknown-identity alerts | Complete | **No** — written, statically verified, never run |
| **Review 3** | *Teach CCTV to UNDERSTAND & ACT* — rooms/zones, occupancy estimation, occupancy history, device management, simulation adapter, automation engine, energy analytics, dashboard integration, unified alerts, component health | Complete | **No** — written, statically verified, never run |

### A.2 Review 3 feature-by-feature status

Mapped to the features the brief asked for.

| Feature | Status | Where it lives |
|---|---|---|
| **A — Smart occupancy monitoring** | Implemented | `ai-service/app/services/stream_manager.py` (`_person_track_for`, `_update_occupancy`), `backend/src/services/occupancyRules.js`, `occupancyService.js` |
| Occupancy from the existing human-detection pipeline | Implemented — same YOLO pass, no second model | `_update_occupancy` |
| Distinct-track counting (no per-frame summing) | Implemented | `_person_track_for` + `occupancy_min_track_hits` |
| Room/zone configuration (capacity, threshold, cameras, monitoring on/off) | Implemented | `models/Room.js`, `roomController.js`, `RoomFormModal.tsx` |
| Six occupancy statuses | Implemented | `occupancyRules.deriveOccupancyStatus` |
| Occupancy history with sampled/change-based persistence | Implemented | `occupancyRules.shouldPersistReading`, `models/Occupancy.js` |
| Stale/unavailable never reported as zero | Implemented, enforced in one place | `deriveOccupancyStatus` returns `count: null` |
| **B — Occupancy-based energy optimization** | Implemented | `services/automationRules.js`, `automationEngine.js` |
| Rule 1 (becomes occupied → switch on) | Implemented | `decideDeviceAction` step 6 |
| Rule 2 (becomes unoccupied for a delay → switch off) | Implemented | `decideDeviceAction` step 7 |
| Rule 3 (data unavailable → suspend switching) | Implemented, the fail-safe | `decideDeviceAction` step 3 |
| Rule 4 (manual override with expiry) | Implemented | `decideDeviceAction` step 2, `deviceService.setManualOverride` |
| Cooldowns, delays, schedules, anti-flapping | Implemented | `decideDeviceAction` steps 4–7 |
| Rule execution history including the skips | Implemented | `models/AutomationLog.js` |
| **C — Device management and safe control** | Implemented | `models/Device.js`, `services/deviceService.js`, `services/devices/*` |
| Adapter interface | Implemented as a documented contract | `services/devices/adapter.js` |
| Simulation adapter, explicitly labelled | Implemented | `services/devices/simulationAdapter.js` |
| Real-hardware adapter | **Not implemented, and not stubbed** — `getAdapter` throws for any type other than `simulation` | `services/devices/index.js` |
| Confirm-before-recording | Implemented, enforced in one funnel | `deviceService.issueCommand` |
| **D — Energy consumption and savings analytics** | Implemented | `services/energyRules.js`, `energyService.js` |
| kWh = W × (s/3600) / 1000, in one place | Implemented | `energyRules.energyKwh` |
| Declared, configurable baseline | Implemented | `ENERGY_BASELINE_HOURS_PER_DAY`, returned in every response |
| Savings clamped, percentage null at a zero baseline | Implemented | `savingsKwh`, `savingsPercent` |
| Explicit insufficient-data state | Implemented | `insufficientData` + `requires` |
| **E — Final dashboard integration** | Implemented | `frontend/src/pages/DashboardPage.tsx`, `EnergyPage.tsx`, `AnalyticsPage.tsx` |
| **F — Alerts and event management** | Implemented, additive to the existing Alerts page | `models/Alert.js` (enum extended), `alertController.js`, `AlertsPage.tsx` |
| **G — Real-time updates and service health** | Implemented | `sockets/index.js`, `GET /api/health/components` |
| **H — Security and reliability pass** | Done; see §D.3 for the per-item record | — |
| **I — Test the entire application** | **Tests written, none executed.** See §D | `backend/test/review3-*.test.js`, `ai-service/tests/test_review3_occupancy.py` |
| **J — Demo mode and reset** | Implemented | `npm run seed:rooms`, `npm run seed:devices`, `npm run demo:reset` |

### A.3 What is incomplete, and what is deliberately absent

**Incomplete because the environment prevented it:**

1. **Execution of anything.** The single largest gap in this delivery. Every
   acceptance criterion that requires a running system is unverified.
2. **Verification that the five new unique indexes actually build** —
   `rooms.roomId`, `roomoccupancystates.roomId`, `devices.deviceId`,
   `automationrules.ruleId`, `energysummaries.{date,deviceId}`. The code builds
   them with `createIndexes()` and reads them back; nothing has read anything
   back yet.
3. **Any TypeScript diagnostic.** `tsc --noEmit` has never run over the Review 3
   frontend, so a JSX type error or a recharts prop mismatch would not have been
   caught by hand-checking.

**Deliberately absent, by scope decision:**

4. **A real device adapter.** No MQTT broker, no ESP32 firmware, no relay
   board. The brief said not to introduce infrastructure to make the
   architecture look more advanced, so the adapter interface is the documented
   extension point and nothing pretends to drive hardware.
5. **Cross-camera re-identification.** A room with two cameras aggregates with
   `MAX`, never a sum, because there is no way to know two tracks are the same
   person. See §E.
6. **`/api/analytics` and `/api/notifications`.** Both remain commented
   placeholders in `backend/src/routes/index.js`. The Analytics *page* is built
   on the occupancy and energy endpoints, so no analytics route was needed, and
   `models/Notification.js` stays unused — Socket.IO plus the Alerts page
   already covers notification.
7. **Attendance timetables / late-arrival rules.** Review 2 modelled `late` in
   the enum and never writes it. Inventing a schedule would have fabricated
   policy.
8. **Retention and expiry jobs.** Occupancy readings, automation logs, device
   history and snapshots accumulate until something removes them. `demo:reset`
   is a demo tool, not a retention policy.

---

## B. Code changes

### B.1 AI service (`ai-service/`)

| File | Change |
|---|---|
| `app/services/stream_manager.py` | **Occupancy estimation.** Added `_person_tracks` / `_person_track_seq` / `_person_pass`, `_person_track_for(bbox)` (greedy bbox-IoU, one claim per track per pass, TTL expiry — the same approach the Review 2 face tracker uses, reusing `face_service.bbox_iou`), and `_update_occupancy(detections, settings)`. Added `occupancy_count`, `occupancy_updated_at` (monotonic), `occupancy_updated_wall`, `occupancy_available` and the `occupancy_age_seconds` property. The occupancy update and the occupancy report are each wrapped in `try/except` so a fault there marks the headcount unavailable and logs, rather than killing the camera thread and taking Review 1 detection with it. |
| `app/services/event_reporter.py` | **A third report leg**: `report_occupancy(camera_id, count, available, frame_mode)` with its own `_last_occupancy_sent` rate limiter and `occupancy_report_interval`, dispatched through the existing `_dispatch('occupancy', …)` so it inherits the per-leg per-camera in-flight cap and the dropped-report counter. A **change** in the count bypasses the interval. **No frame and no image is ever attached** — a headcount needs no snapshot. |
| `app/models/schemas.py` | `StreamStats` extended **additively** with a nullable `occupancy`, `occupancy_available: bool` and `occupancy_age_seconds`. `occupancy` is deliberately nullable. |
| `app/api/routes.py` | The existing `@secured.get("/stream/{camera_id}/stats")` handler now returns the occupancy fields. **No new route was added**, so `router.include_router(secured)` is still the last statement in the module and the "every route but `/health` is secret-gated" property is untouched. |
| `app/config.py` | `occupancy_enabled` (True), `occupancy_report_interval` (5.0), `occupancy_min_track_hits` (2), `occupancy_track_ttl` (3.0). |
| `.env.example` | The four `AI_SERVICE_OCCUPANCY_*` keys, placeholders and comments only. |
| `tests/test_review3_occupancy.py` | **New.** Stdlib `unittest`, mocks `YoloModel`, loads no weights. |

**What did not change in the AI pipeline:** YOLO human and weapon detection run
on every processed frame exactly as in Review 1; the recognition cadence, face
tracks, report legs and shutdown drain are untouched. Occupancy is a separate
additive call after `_update_stats`. No pip dependency was added.

### B.2 Backend — new models

| Collection | Model file | Purpose |
|---|---|---|
| `rooms` | `models/Room.js` | Zone configuration: `roomId` (unique), cameras, capacity, `occupancyThreshold`, `nearCapacityRatio`, `monitoringEnabled`, `active` |
| `occupancies` | `models/Occupancy.js` *(placeholder replaced)* | Occupancy **history** readings. `count` is **nullable**. Model name kept as `Occupancy` so the collection is not orphaned; the legacy `location` field was kept optional |
| `roomoccupancystates` | `models/RoomOccupancyState.js` | One doc per room: the **current** count/status/availability, plus the persisted automation threshold clocks |
| `devices` | `models/Device.js` | `deviceId` (unique), room, type, `reportedState` (default `unknown`), `desiredState`, `controlMode` (default `disabled`), `adapterType`, `simulated`, `connectionStatus`, `lastCommand`, `override`, `powerRatingWatts`, `active` |
| `devicestatehistories` | `models/DeviceStateHistory.js` | The state timeline: `fromState`, `toState`, `changedAt`, `trigger`, `reason`, `ruleId`, `actorId`, **`confirmed`** |
| `automationrules` | `models/AutomationRule.js` | `ruleId` (unique), room, devices, **`enabled` default false**, threshold, `unoccupiedForSec`, delays, `allowedHours`, `commandCooldownSec`, **`onUnavailableOccupancy` default `suspend`**, `manualOverrideMinutes` |
| `automationlogs` | `models/AutomationLog.js` | Every evaluation, including the skips: `decision`, `reason`, nullable `occupancyCount`, `occupancyStatus`, `outcome`, `adapterMessage` |
| `energyrecords` | `models/EnergyRecord.js` *(placeholder replaced)* | `EnergySummary`: one ESTIMATED day per device, unique `{ date, deviceId }`, `estimated` always true |

**Extended in place, additively:** `models/Alert.js` — the `type` enum gained
`occupancy_warning`, `capacity_exceeded`, `device_failure`,
`automation_failure`, `ai_service_failure`, `camera_unavailable`, with **all six
original values retained** so stored documents stay valid (the same approach
Review 2 took when it added `unknown_identity` while keeping `unknown_person`).
Optional `roomId` and `deviceId` fields were added.

### B.3 Backend — new indexes

| Collection | Indexes | Verified at startup? |
|---|---|---|
| `rooms` | **`roomId` unique**, `{ cameraIds, active }` | Yes — read back |
| `roomoccupancystates` | **`roomId` unique**, `status` | Yes — read back |
| `occupancies` | `{ roomId, timestamp: -1 }`, `{ timestamp: -1 }`, `status`, `source` | Built, not read back |
| `devices` | **`deviceId` unique**, `roomId`, `reportedState`, `controlMode`, `{ roomId, active }` | Yes — read back |
| `devicestatehistories` | `{ deviceId, changedAt: -1 }`, `{ roomId, changedAt: -1 }` | Built, not read back |
| `automationrules` | **`ruleId` unique**, `{ roomId, enabled, active }` | Yes — read back |
| `automationlogs` | `{ roomId, evaluatedAt: -1 }`, `{ deviceId, evaluatedAt: -1 }`, `evaluatedAt` | Built, not read back |
| `energyrecords` | **`{ date, deviceId }` unique**, `{ roomId, date: -1 }` | Yes — read back |

`ensureCriticalIndexes()` in `config/db.js` was refactored into **three
independent groups** — attendance (Review 2), occupancy, device/automation —
because the original early-return path meant one group's failure would have
skipped the others entirely. Each uses `createIndexes()` and **never**
`syncIndexes()` (which also drops indexes the schema does not declare). A
verification failure **degrades only the affected write path** and leaves the
backend booting: occupancy writes refuse, device commands refuse, automation
ticks return early, and Review 1 / Review 2 are untouched.

### B.4 Backend — new routes

All reads require `requireAuth`. **Every mutation additionally requires
`requireRole('admin')`**, because these routes control devices.

| Area | Endpoints |
|---|---|
| Rooms | `GET/POST /api/rooms`, `GET/PUT/DELETE /api/rooms/:id` |
| Occupancy *(GET only)* | `GET /api/occupancy/current`, `/summary`, `/history` |
| Devices | `GET/POST /api/devices`, `GET/PUT/DELETE /api/devices/:id`, `POST /api/devices/:id/command`, `POST /api/devices/:id/control-mode`, `DELETE /api/devices/:id/override`, `POST /api/devices/:id/probe`, `GET /api/devices/:id/history`, `GET /api/devices/adapters` |
| Automation | `GET/POST /api/automation/rules`, `GET/PUT/DELETE /api/automation/rules/:id`, `POST /api/automation/rules/:id/enable`, `/disable`, `/evaluate`, `GET /api/automation/history`, `GET /api/automation/health` |
| Energy *(GET only)* | `GET /api/energy/summary`, `/history`, `/by-room`, `/by-device`, `/trend` |
| Health | `GET /api/health` *(unauthenticated liveness, unchanged)*, `GET /api/health/components` *(JWT)* |
| AI (service-to-service) | **`POST /api/ai/occupancy`** — shared-secret gated, and the **only** write path for occupancy |

`backend/src/routes/index.js` now mounts `/rooms`, `/occupancy`, `/devices`,
`/automation` and `/energy`. `/analytics` and `/notifications` remain commented
placeholders.

### B.5 Backend — new services and rules

| File | Role |
|---|---|
| `services/occupancyRules.js` | **Dependency-free.** `deriveOccupancyStatus`, `aggregateRoomCount` (MAX), `shouldPersistReading`, `isOccupancyUsable`, `shouldRaiseOccupancyAlert`, `normalizeHistoryPaging`, `parseDateRange` |
| `services/occupancyService.js` | Ingest, aggregation, state upsert, conditional history write, socket emit, capacity alerts, `listCurrent/listHistory/roomSummary` |
| `services/automationRules.js` | **Dependency-free.** `decideDeviceAction` (the seven-step precedence), `isOccupancyActionable`, `isOverrideActive`, `isWithinAllowedHours`, `updateThresholdMarkers` |
| `services/automationEngine.js` | Event-driven evaluation plus one low-frequency tick; writes every decision to `AutomationLog`; raises `automation_failure` on fault; interval cleared on shutdown |
| `services/energyRules.js` | **Dependency-free.** `energyKwh`, `onSecondsFromHistory`, `hasUsableHistory`, `baselineKwh`, `savingsKwh`, `savingsPercent`, `roundKwh`, `windowHours` |
| `services/energyService.js` | `summary/history/byRoom/byDevice/trend/rollupDay`, computed from confirmed `DeviceStateHistory` + configured wattage |
| `services/deviceService.js` | CRUD, `issueCommand` (the only writer of device state), `setControlMode`, `setManualOverride`, `clearOverride`, `syncDeviceState`, `deviceHealth` |
| `services/devices/adapter.js` | The adapter contract + `validateAdapterResult` |
| `services/devices/simulationAdapter.js` | In-process simulated state, `SIMULATED`-prefixed messages, `setSimulatedFailure` for the failure walkthrough |
| `services/devices/index.js` | `getAdapter` — returns the simulation adapter, **throws** for anything else |

The three dependency-free rule modules exist specifically so `node:test` can
drive every decision branch — stale data, overrides, cooldowns, schedule
boundaries, the energy maths — with plain objects, no MongoDB and no AI service.
That mirrors Review 2's `services/identityRules.js`.

### B.6 Backend — extended in place

`config/env.js` (occupancy / devices / automation / energy blocks),
`config/db.js` (two new index groups + their state getters),
`sockets/index.js` (`occupancy:update`, `room:status`, `device:state`,
`automation:action`, `energy:update`),
`controllers/aiController.js` + `routes/aiRoutes.js` (the occupancy ingest),
`controllers/alertController.js` (additive filters: category/type, severity,
cameraId, roomId, deviceId, status, date range — acknowledge/resolve and the
existing payload shape **unchanged**),
`controllers/healthController.js` + `routes/healthRoutes.js`
(`GET /api/health/components`),
`services/dashboardService.js` (Review 3 KPIs added additively; all ten
pre-existing keys retained with identical names),
`server.js` (engine start/stop), `package.json` (`seed:rooms`, `seed:devices`,
`demo:reset`), `.env.example`.

### B.7 Frontend

| File | Change |
|---|---|
| `pages/EnergyPage.tsx` | **Placeholder replaced.** Room occupancy cards (six statuses, last successful update, no-data indicator), rooms admin panel, devices panel (reported vs desired, control mode, `SIMULATED` badge, manual on/off, override with expiry, last-command failures), automation rules panel, automation activity list **including the skipped decisions and their reasons**, energy strip with the baseline description. Subscribes to `occupancy:update`, `room:status`, `device:state`, `automation:action`, and re-fetches over REST on mount and on socket reconnect |
| `pages/AnalyticsPage.tsx` | **Placeholder replaced.** Recharts: consumed-vs-baseline trend, energy by room, energy by device, occupancy over time for a selected room. Every chart has an `ErrorState` and an `EmptyState` driven by the backend's `requires` message; the occupancy line uses `connectNulls={false}` so an outage shows as a **gap** rather than a line dropping to zero |
| `pages/DashboardPage.tsx` | Review 3 tiles plus a component-health panel, ordered by the brief's priority: critical alerts → camera/AI status → occupancy and capacity → detection/recognition activity → device automation → energy |
| `pages/AlertsPage.tsx` | Additive filters (category, severity, room, device, status, date range); room/device references rendered instead of `undefined`; row wrapping fixed; two unlabelled filter selects given accessible labels |
| `pages/SettingsPage.tsx` | A **hardcoded `DEMO` status indicator was removed** and replaced with the real AI reachability, the real `model_loaded` flag, the AI service's own reported mode, and the real DEMO/REAL camera split |
| `pages/LiveMonitoringPage.tsx` | Occupancy added to the stats panel, explicitly distinguished from the per-frame *People* box count, showing an em-dash and an explanation when `occupancy_available` is false; one filter select labelled |
| `utils/review3.ts` | **New.** `renderCount()` / `renderNumber()` print an em-dash for null — the single place the null-is-not-zero rule is enforced on the UI |
| `services/{occupancy,device,automation,energy,health}Service.ts` | **New.** Same shape as the existing `dashboardService.ts` |
| `components/{RoomFormModal,DeviceFormModal,AutomationRuleFormModal}.tsx` | **New**, following the `PersonFormModal` pattern including field-level validation |
| `components/ui/Modal.tsx` | **Fixed:** no height cap meant a tall form's lower fields and Save button were clipped off the viewport with no way to reach them |
| `components/layout/Sidebar.tsx`, `layouts/AppLayout.tsx` | **Fixed:** there was **no navigation at all below 768px** — the sidebar is `hidden md:flex` and the topbar had no nav, so every section was unreachable on a narrow window. Added a `md:hidden` strip rendered from the same `navItems` list |
| `types/index.ts`, `services/socket.ts`, `services/alertService.ts` | Review 3 interfaces, event names and filters |

No npm dependency was added: charts use **recharts** and icons use
**lucide-react**, both already installed.

### B.8 Tests and tooling added

| File | Contents |
|---|---|
| `backend/test/review3-occupancy.test.js` | Status derivation (all six), null-not-zero three ways, MAX aggregation, change-based persistence, alert cooldown, bounded paging |
| `backend/test/review3-automation.test.js` | The fail-safe, override precedence and expiry, anti-flapping, cooldown, delays, schedule wrap, the adapter registry, simulation disclosure, failure injection, energy basics, route guards |
| `backend/test/review3-energy.test.js` | **New in this feature.** The formula and the two classic unit slips as explicit not-equals; the two awkward window cases; unconfirmed rows excluded; `unknown` contributing nothing; the baseline pro-rata and cap; clamped savings; a **null** percentage at a zero baseline; the documented worked example composed end to end; source-text guarantees that the formula is derived once and that nothing is random |
| `backend/test/review3-routes.test.js` | **New in this feature.** Every Review 3 mutation is `requireAuth` + `requireRole('admin')` + validated; the AI ingest is secret-gated; occupancy and energy are GET-only; no client-facing write for occupancy, history, logs or energy; `reportedState` is not a validated input field; every history read is clamped; both `.env.example` files carry placeholders only and never `0.0.0.0`; every new env key is in **both** the example and `env.js`; nothing reads `process.env` outside `config/env.js`; the per-device in-flight guard; interval shutdown ordering; index verification shape; no new npm dependency; every documented `npm run` script exists and points at a real file |
| `ai-service/tests/test_review3_occupancy.py` | **New in this feature.** One person across **100 consecutive frames counts once**; a drifting box stays one track; two distinct boxes are two occupants; each box claims at most one track per frame; only `human` detections count; the min-hit rule suppresses a one-frame blip; a track expires after the TTL and the list is bounded; **an unavailable model does not zero the count**; a never-measured worker reports `None` not `0`; availability recovers; disabling occupancy does not fabricate a zero; track ids are per-camera and do not survive a restart |
| `backend/src/utils/resetDemoData.js` + `npm run demo:reset` | **New in this feature.** Report-only without `--apply` |
| `backend/src/utils/seedRooms.js` + `npm run seed:rooms` | ROOM-01 wired to CAM-01 + CAM-02, idempotent upsert |
| `backend/src/utils/seedDevices.js` + `npm run seed:devices` | DEV-LIGHT-01 (108 W), DEV-FAN-01 (75 W), RULE-LAB-01 — **all disabled** |

### B.9 Two pre-existing Review 2 test assertions had to change

Both were obsolete by design, and **neither had ever run**, so neither
"regressed":

1. **`review2-routes.test.js`** asserted that `/occupancy`, `/energy` and
   `/analytics` must stay **commented out** ("Review 3 must stay
   unimplemented"). Review 3 implements the first two, so the assertion now
   checks that `/rooms`, `/occupancy`, `/devices`, `/automation` and `/energy`
   **are** mounted, with only `['analytics', 'notifications']` still expected to
   be absent.
2. **`review2-security.test.js`** asserted `/syncIndexes\(\)/.test(db) === false`
   against the *text* of `config/db.js` — but the Review 2 **comment** in that
   file explaining *why* `syncIndexes()` is avoided already matched the pattern,
   so **this assertion would have failed on its first ever run**, before Review 3
   touched anything. It was tightened to `/\.syncIndexes\(\)/`, which still
   catches a real call but not prose.

---

## C. Setup and execution

### C.1 Service topology

| Service | Address | Health |
|---|---|---|
| MongoDB | `mongodb://127.0.0.1:27017/camsense` | — |
| AI service (FastAPI) | `127.0.0.1:8000` | `/api/health` · docs at `/docs` |
| Backend (Express) | `127.0.0.1:5050` | `/api/health`, `/api/health/components` |
| Frontend (Vite) | `127.0.0.1:5173` | — |

**Port 5050, not 5000**, because macOS AirPlay Receiver occupies 5000. The
committed defaults are not consistent on this point — set `PORT=5050` in
`backend/.env` and `VITE_API_BASE_URL=http://localhost:5050/api` in
`frontend/.env`. This inconsistency is a known, documented issue carried over
from Review 1/2; it is recorded rather than silently changed because the
developer's existing `.env` files were not read or written by this work.

**Both services bind `127.0.0.1` by default** in code and in both
`.env.example` files.

### C.2 Exact commands, in order

```bash
# 1. MongoDB
mongod --dbpath ~/.camsense/mongo-data --port 27017 --bind_ip 127.0.0.1

# 2. AI service
cd ai-service
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt          # no new pip package in Review 3
python download_assets.py                # yolov8n.pt, vtest.avi, 2 face ONNX files
cp .env.example .env                     # then set AI_SERVICE_INGEST_SECRET
uvicorn app.main:app --reload            # 127.0.0.1:8000

# 3. Backend
cd backend
cp .env.example .env                     # set MONGODB_URI, JWT_SECRET, AI_INGEST_SECRET, PORT=5050
npm install                              # no new npm package in Review 3
npm run seed                             # admin account
npm run seed:cameras                     # CAM-01, CAM-02
npm run seed:rooms                       # ROOM-01, wired to both cameras
npm run seed:devices                     # DEV-LIGHT-01 (108 W), DEV-FAN-01 (75 W), RULE-LAB-01 — ALL DISABLED
npm run dev                              # 127.0.0.1:5050

# 4. Frontend
cd frontend
cp .env.example .env                     # VITE_API_BASE_URL=http://localhost:5050/api
npm install
npm run dev                              # 127.0.0.1:5173
```

Sign in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` from `backend/.env`
(defaults `admin@camsense.ai` / `ChangeMe123!`).

### C.3 Required model downloads

`cd ai-service && python download_assets.py` fetches `yolov8n.pt`,
`samples/vtest.avi`, `face_detection_yunet_2023mar.onnx` and
`face_recognition_sface_2021dec.onnx` into `models/`. All four are
**gitignored**. The script is idempotent and fails *softly*, printing the target
path so a file can be dropped in by hand.

**Review 3 needs no new weights.** Occupancy is derived from the same
`yolov8n.pt` human detections Review 1 already produces. If the weights are
absent, occupancy reports **unavailable** — never a count of zero.

### C.4 Required environment variables (Review 3 only)

**`backend/.env`:**

| Key | Default | Meaning |
|---|---|---|
| `OCCUPANCY_STALE_AFTER` | `30` | Seconds after which a reading is **stale**; a stale figure reports a **null** count, never 0 |
| `OCCUPANCY_PERSIST_INTERVAL` | `60` | Heartbeat for an unchanged room. A change in count/status/availability always writes immediately |
| `OCCUPANCY_ALERT_COOLDOWN` | `300` | Per-room cooldown for near-capacity / capacity-exceeded alerts |
| `OCCUPANCY_HISTORY_MAX_LIMIT` | `500` | Hard cap on `GET /api/occupancy/history` page size |
| `OCCUPANCY_NEAR_CAPACITY_RATIO` | `0.8` | Fraction of capacity at which the status becomes Near Capacity |
| `DEVICE_COMMAND_TIMEOUT` | `5` | Seconds an adapter call may take before it counts as failed |
| `DEVICE_FAILURE_ALERT_COOLDOWN` | `300` | Seconds between two `device_failure` alerts for the same device |
| `AUTOMATION_TICK_INTERVAL` | `30` | The time-driven tick. The engine is primarily event-driven |
| `AUTOMATION_COMMAND_COOLDOWN` | `60` | Minimum seconds between commands to the same device |
| `AUTOMATION_DEFAULT_UNOCCUPIED_FOR` | `300` | Default seconds at/below threshold before a room counts as unoccupied |
| `AUTOMATION_MANUAL_OVERRIDE_MINUTES` | `30` | Default override lifetime |
| `AUTOMATION_HISTORY_MAX_LIMIT` | `500` | Hard cap on `GET /api/automation/history` |
| `AUTOMATION_FAILURE_ALERT_COOLDOWN` | `300` | Seconds between two `automation_failure` alerts |
| `ENERGY_BASELINE_HOURS_PER_DAY` | `12` | **THE DECLARED BASELINE.** An assumption, not a measurement |
| `ENERGY_HISTORY_MAX_LIMIT` | `500` | Hard cap on energy page size and on in-window transition reads |

**`ai-service/.env`:**

| Key | Default | Meaning |
|---|---|---|
| `AI_SERVICE_OCCUPANCY_ENABLED` | `true` | Set false to stop estimating/reporting occupancy; detection carries on |
| `AI_SERVICE_OCCUPANCY_REPORT_INTERVAL` | `5.0` | Minimum seconds between occupancy POSTs per camera; a **change** bypasses it |
| `AI_SERVICE_OCCUPANCY_MIN_TRACK_HITS` | `2` | Consecutive processed frames a track needs before it counts |
| `AI_SERVICE_OCCUPANCY_TRACK_TTL` | `3.0` | Seconds a person track survives without being re-seen |

`frontend/.env` gains nothing. The frontend never receives a credential and
never calls the AI service.

**`AI_INGEST_SECRET` (backend) must equal `AI_SERVICE_INGEST_SECRET`
(ai-service).** Both default to empty on purpose, so an unset value fails closed
with a message naming the variable rather than 401ing every call against a
default that could never match. No `.env.example` in this repository contains a
real secret.

### C.5 Database setup and migration notes

No migration script is required and **no destructive change was made**.

- Mongoose creates the new collections on model registration.
- The five unique indexes are built and read back at startup; a failure
  degrades only the affected feature.
- `models/Occupancy.js` and `models/EnergyRecord.js` replaced thin, **unused**
  foundation-phase placeholders. Both kept their mongoose model names
  (`Occupancy`, `EnergyRecord`) so their collections are not orphaned, and the
  legacy fields were retained as **optional** so any pre-existing document
  still validates. `Occupancy.location`, previously `required`, is now optional
  because new readings are keyed by room.
- `Alert.type` was extended **additively**; every pre-existing enum value was
  kept, so stored alerts remain valid.
- If the device/automation indexes cannot be verified, device commands and
  automation refuse to run and the remediation is logged. Occupancy, detection,
  recognition and attendance are unaffected.

### C.6 Demo mode

**Demo vs real is explicit everywhere.** A camera carries a `mode`
(`demo` | `real`); every detection and every occupancy reading carries a
`source` (`real` | `demo`); every simulated device carries `simulated: true`,
an adapter type, and messages prefixed with the literal word `SIMULATED`.

```bash
cd backend
npm run seed:cameras && npm run seed:rooms && npm run seed:devices
npm run demo:reset              # REPORT ONLY — prints what it would remove
npm run demo:reset -- --apply   # actually applies exactly that
```

`npm run demo:reset` clears **only** simulated/demo Review 3 state: device
state history and energy summaries for simulated devices, automation logs for
simulated devices and demo rooms, occupancy readings with `source: 'demo'`, and
the live room occupancy state of demo rooms. It **resets** simulated devices to
`reportedState: 'unknown'` while preserving their configuration.

It **never** writes to people, attendance, users or cameras — it does not even
import the Person, Attendance or User models — and it never deletes a room, a
device, an automation rule, a detection, an alert, a recognition event, or an
occupancy reading whose `source` is not `demo`.

**Two explicit operator steps stand between a seeded demo and any device being
commanded**, by design:

1. enable the rule — `POST /api/automation/rules/RULE-LAB-01/enable`, or the
   toggle on the Occupancy & Energy page;
2. set each device to `controlMode: 'automatic'` —
   `POST /api/devices/DEV-LIGHT-01/control-mode`, or the control on the page.

`POST /api/automation/rules/:id/evaluate` forces one evaluation immediately, so
a demo does not have to wait for the 30-second tick.
`setSimulatedFailure(deviceId, true)` in
`backend/src/services/devices/simulationAdapter.js` is what makes the
`device_failure` walkthrough reproducible.

---

## D. Verification

This is the integrity-critical section. It is assembled from the per-command
records written during each implementation feature and appended to
[`REVIEW3-VERIFICATION.md`](REVIEW3-VERIFICATION.md), not from memory.

### D.1 Actually executed

> **Nothing.**
>
> Not one test, build, typecheck, lint, install, byte-compile, syntax check,
> import resolution, service start, HTTP request, or database operation was
> executed at any point in Review 3. **There is no passing result to report and
> no test output exists.** Every test file described in §B.8 is written and
> present in the tree and has never been run.

That statement is deliberately absolute. If any part of this report reads as
though something was confirmed by running it, this subsection overrides it.

### D.2 Could not be executed

**The blocker, verbatim.** Every shell command attempted in this environment
failed at the OS sandbox layer *before the command itself ran*:

```
sandbox-exec: sandbox_apply: Operation not permitted

Exit Code: 71
```

accompanied by the tool note *"This command failed while running with the OS
sandbox enabled. Sandbox restrictions may have contributed; the exact cause
could not be determined."*

`echo hello` fails identically, which is what establishes this as a wholesale
loss of shell execution rather than a project, dependency or syntax problem.
Alternate launchers (an absolute interpreter path, `/usr/bin/env`, the local
`tsc` binary, a single-file `node --check`) were tried during Review 2 to rule
out a PATH or wrapper issue; all behaved the same.

**Per-command record.** Every command below was genuinely attempted exactly
once, in the working directory shown. Every one was **BLOCKED** with the error
and exit code above. None is reported as passing.

| # | Feature | Command | Working directory | Attempted | Result | Exit |
|---|---|---|---|---|---|---|
| 1 | FEAT-001 | `npm test` | `backend` | yes | BLOCKED | 71 |
| 2 | FEAT-001 | `npm install` | `backend` | yes | BLOCKED | 71 |
| 3 | FEAT-001 | `npm run lint` *(= `tsc --noEmit`)* | `frontend` | yes | BLOCKED | 71 |
| 4 | FEAT-001 | `npm run build` *(= `tsc -b && vite build`)* | `frontend` | yes | BLOCKED | 71 |
| 5 | FEAT-001 | `python -m unittest discover -s tests -v` | `ai-service` | yes | BLOCKED | 71 |
| 6 | FEAT-001 | `python -m compileall app` | `ai-service` | yes | BLOCKED | 71 |
| 7 | FEAT-001 | `node --check src/server.js` | `backend` | yes | BLOCKED | 71 |
| 8 | FEAT-001 | `curl -s http://127.0.0.1:5050/api/health` | repo root | yes | BLOCKED | 71 |
| 9 | FEAT-001 | `curl -s http://127.0.0.1:8000/api/health` | repo root | yes | BLOCKED | 71 |
| 10 | FEAT-002 | `npm test` | `backend` | yes | BLOCKED | 71 |
| 11 | FEAT-002 | `python -m compileall app` | `ai-service` | yes | BLOCKED | 71 |
| 12 | FEAT-002 | `echo hello` | repo root | yes | BLOCKED | 71 |
| 13 | FEAT-002 | `ls -1 backend/test/` | repo root | yes | BLOCKED | 71 |
| 14 | FEAT-002 | `wc -l docs/REVIEW3-VERIFICATION.md` | repo root | yes | BLOCKED | 71 |
| 15 | FEAT-003 | `npm test` | `backend` | yes | BLOCKED | 71 |
| 16 | FEAT-003 | `node --check src/services/automationEngine.js` | `backend` | yes | BLOCKED | 71 |
| 17 | FEAT-003 | `tail -40 docs/REVIEW3-VERIFICATION.md` | repo root | yes | BLOCKED | 71 |
| 18 | FEAT-004 | `npm run lint` | `frontend` | yes | BLOCKED | 71 |
| 19 | FEAT-004 | `npm run build` | `frontend` | yes | BLOCKED | 71 |
| 20 | FEAT-004 | `echo hello` | repo root | yes | BLOCKED | 71 |
| 21 | FEAT-004 | `ls -R frontend/src/components frontend/src/pages` | repo root | yes | BLOCKED | 71 |
| 22 | FEAT-004 | `ls frontend/public` | repo root | yes | BLOCKED | 71 |
| 23 | FEAT-004 | `wc -l docs/REVIEW3-VERIFICATION.md` | repo root | yes | BLOCKED | 71 |
| 24 | **FEAT-005 (final)** | `npm test` | `backend` | yes | BLOCKED | 71 |
| 25 | **FEAT-005 (final)** | `npm run lint` | `frontend` | yes | BLOCKED | 71 |
| 26 | **FEAT-005 (final)** | `npm run build` | `frontend` | yes | BLOCKED | 71 |
| 27 | **FEAT-005 (final)** | `python -m unittest discover -s tests -v` | `ai-service` | yes | BLOCKED | 71 |
| 28 | **FEAT-005 (final)** | `python -m compileall app` | `ai-service` | yes | BLOCKED | 71 |
| 29 | FEAT-005 | `git status --short` | `camsense-ai` | yes | BLOCKED | 71 |
| 30 | FEAT-005 | `grep -n … backend/src/services/energyService.js` | `camsense-ai` | yes | BLOCKED | 71 |
| 31 | FEAT-005 | `grep -c "" README.md docs/REVIEW2-REPORT.md` | `camsense-ai` | yes | BLOCKED | 71 |

Rows **24–28** are the five commands re-attempted at the very end of the work,
after every source edit was complete, specifically so this report reflects the
**final state of the tree** rather than a mid-task snapshot. All five were
blocked again, identically.

### What this means, stated plainly

| Verification | Status |
|---|---|
| Backend unit tests (`node --test`) | **not_executed** |
| Frontend typecheck (`tsc --noEmit`) | **not_executed** |
| Frontend production build (`vite build`) | **not_executed** |
| AI-service unit tests (`unittest`) | **not_executed** |
| Python byte-compile (`compileall`) | **not_executed** |
| Lint | **n/a** — there is no ESLint config in this repository; `npm run lint` *is* the typecheck |
| Integration / end-to-end | **not_executed** — no service was ever started |
| Real-camera experiment | **not_executed** — no camera, and no RTSP source |
| Database operation | **not_executed** — MongoDB was not reachable |

**The static audit is not a substitute for compiling or running the code.**
Reading a file and confirming that a named export exists proves the import will
resolve; it does not prove the function behaves correctly, that mongoose
accepts the schema, that `tsc` accepts the JSX, that a recharts prop signature
matches, that an index can be built on the existing data, or that a request
reaching a route produces the right response. Those are exactly the classes of
defect that a first execution surfaces, and this delivery has not had one.

### D.3 What static verification *was* done, and what it found

Since nothing could be run, static resolution was the substitute and was done
systematically. The full per-feature tables are in
[`REVIEW3-VERIFICATION.md`](REVIEW3-VERIFICATION.md) §§1–8. Summary:

| Check | Scope | Result |
|---|---|---|
| Every import resolves to a real named export | ~130 importer/target pairs across backend, ai-service and frontend, each confirmed by opening the target file | Clean |
| Every Mongoose field used in a filter / projection / `$set` / `$setOnInsert` is declared in its schema | 7 new collections + the extended `Alert` | Clean |
| Every `Settings` attribute read in the AI service is declared in `config.py` | all | Clean |
| Every `StreamStats` field constructed is declared in `schemas.py` | all | Clean |
| Every property read off an API response is declared in `frontend/src/types/index.ts` | 16 payload groups | Clean after one correction *(see below)* |
| Every prop union value passed to a UI primitive is in range | Button, Badge, StatusIndicator | Clean |
| The Review 2 change set (≈10,000 unexecuted lines) | FEAT-001 audited the whole import graph, TS types and schema usage | **Clean — nothing was broken, nothing needed fixing** |
| The backend import graph is acyclic | `occupancyService → automationEngine → deviceService`, `automationEngine → energyService` | Acyclic |
| Authorization surface, route by route | every Review 3 route | Every mutation is `requireAuth` + `requireRole('admin')`; occupancy and energy are GET-only |
| `backend/.env.example` ↔ `config/env.js`, both directions | all keys | Complete both ways |
| `ai-service/.env.example` ↔ `config.py`, both directions | all keys | Complete both ways |

**Two shape traps that static reading caught and that would have compiled:**

1. `energyService.byRoom()` builds each room as
   `{ roomId, ...totalsFor(rows), devices: rows.map(...) }` — the explicit
   `devices` key comes **after** the spread, so a room's `devices` is the
   per-device **array**, not the device **count** that `totalsFor` put there.
   Typing it the obvious way would have compiled and then displayed a wrong
   number. The interface uses `Omit<EnergyTotals, 'devices'>` and the chart
   reads `contributingDevices` for the count.
2. The recognition health field names were read from
   `ai-service/app/models/schemas.py::RecognitionStatusResponse` rather than
   guessed. A first draft used a non-existent `identities` field and was
   corrected to `cache_size` / `cache_loaded` / `cache_stale` /
   `cache_age_seconds`.

### D.4 Feature H — security and reliability pass, item by item

Every item from the brief's checklist, with its result. "Fixed" means the code
was changed in this review; "verified" means it was read and found already
correct.

| # | Checklist item | Result |
|---|---|---|
| 1 | **Exposed credentials or secrets** | **Verified clean.** Neither `.env.example` contains a usable value — `JWT_SECRET`, `AI_INGEST_SECRET` and `AI_SERVICE_INGEST_SECRET` all carry `replace_with_…` placeholders, and `SEED_ADMIN_PASSWORD` is the documented `ChangeMe123!` demo value. `backend/.env` and `ai-service/.env` were neither read nor written at any point in Review 3. A `review3-routes.test.js` assertion now enforces the placeholder rule. The shared secret lives only in env vars; no secret, connection string or stack trace reaches any API payload (`healthController.safeMessage()` takes the first line of an error and caps it at 200 characters) |
| 2 | **Unsafe environment-variable handling** | **Verified clean + enforced.** Nothing outside `config/env.js` reads `process.env` — asserted by a new test over the nine Review 3 services and controllers. Every new key has a commented default in `env.js` and a placeholder in `.env.example`, checked in both directions |
| 3 | **Missing authorization checks** | **Verified clean.** Every Review 3 mutation (room create/update/delete, device create/update/delete/command/control-mode/override/probe, rule create/update/delete/enable/disable/evaluate) is `requireAuth` + `requireRole('admin')`. Occupancy and energy routers are GET-only with zero mutating verbs. `POST /api/ai/occupancy` is `requireInternalSecret` and is the only occupancy write path; it is explicitly **not** reachable with a browser JWT |
| 4 | **Unvalidated user input** | **Verified clean.** Every mutating route validates through the existing zod `validate` middleware. `roomId`/`deviceId`/`cameraId` references are rejected unless they resolve to a real document. `parseDateRange` **drops** an unparseable or object-valued date (so `?from[$gt]=x` narrows nothing instead of reaching Mongo as an operator). `reportedState` is not a validated input field anywhere — only a confirmed adapter result sets it |
| 5 | **Unsafe file uploads** | **Not applicable to Review 3** — it adds no upload path. Review 2's single path (base64 JSON, declared mime allowlist, `FACE_UPLOAD_MAX_BYTES`) is unchanged |
| 6 | **Unprotected snapshots** | **Verified clean and unchanged.** `/uploads` stays behind `requireAssetAccess`. The occupancy report leg deliberately carries **no frame and no image** — a headcount needs no snapshot, and sending one would put faces on a leg with no reason to carry them |
| 7 | **CORS configuration** | **Verified clean and unchanged.** Still the explicit `CLIENT_ORIGIN` allowlist from Review 1; Review 3 added no origin and no route outside it |
| 8 | **Incorrect error handling** | **Verified clean.** Everything flows through `ApiError` + the central `errorHandler`; responses are always `{ success, data }` or `{ success: false, error: { message } }`. A failed device command returns **HTTP 502 with `success: false`**, never a 200 with a quiet flag. **Fixed:** a command refused because another is in flight now returns **409**, not 502 — nothing failed and nothing was attempted |
| 9 | **Unhandled promise rejections** | **Verified clean.** The interval callback's promise is `.catch()`-ed; `runTick` is wrapped end to end; `onOccupancyUpdated` swallows its own errors so an automation fault cannot fail an occupancy ingest; `logDecision` and `raiseAutomationFailure` each catch their own writes (the latter matters most — it is only ever called from an error path) |
| 10 | **Unhandled Python exceptions** | **FIXED.** `_run` — the camera worker thread body — had no top-level `try/except`, so a raise inside the new `_update_occupancy` would have killed the thread and taken **Review 1 detection** with it. `_update_occupancy` and both `report_occupancy` call sites are now individually guarded, matching the pattern face detection and recognition already use: a fault marks occupancy **unavailable** (never 0) and prints a diagnostic, while YOLO detection, the MJPEG stream and detection reporting carry on |
| 11 | **Broken service URLs** | **Recorded, not changed.** The port 5000-vs-5050 default inconsistency (`env.js`, `backend/.env.example`, `frontend/.env.example` and `apiClient.ts` say 5000; `socket.ts`, `cameraService.ts`, `assetUrl.ts`, `ai-service/app/config.py` and `ai-service/.env.example` say 5050). Setting `VITE_API_BASE_URL` collapses all four onto one value, so it only bites on a missing `.env`. **Deliberately not changed:** the developer's `.env` files already exist with working values that this work must not read or modify, and moving a default with no way to run the result is the larger risk. Documented in the README, in `REVIEW2-REPORT.md` follow-up #5, and here |
| 12 | **Duplicate event processing** | **Verified + FIXED.** Occupancy readings are change-based plus sampled, so consecutive identical frames produce one row. Capacity alerts have a per-room cooldown with an escalation exemption. `device_failure` and `automation_failure` alerts gained cooldowns in FEAT-004 — without them, one broken device re-commanded on every tick would have produced one alert per tick and buried the alert list. Both are **database-level** checks, so they survive a restart; the underlying failure is still recorded in full on every occurrence |
| 13 | **Race conditions in attendance or automation** | **FIXED — a real race.** Attendance is unchanged (one atomic `findOneAndUpdate` upsert on the unique key, with `E11000` caught). Automation had a genuine gap: `runTick` guards against two **ticks** overlapping (`tickRunning`), but `issueCommand` is also reached from `POST /api/devices/:id/command` and from `onOccupancyUpdated()` — which fires on **every** accepted occupancy report, and two cameras in one room report independently. Every step in `issueCommand` awaits (the adapter call, `device.save()`, the history write), so two commands for the **same device** could interleave, both read the same `previousState`, and both write a `DeviceStateHistory` row — and those rows *are* the timeline the energy arithmetic reads, so a duplicate produces an on-interval that never happened. **Added an in-flight guard keyed by `deviceId`** (`inFlightCommands`) with the second command **refused**, not queued, and the entry always cleared in a `finally` so a throwing adapter cannot wedge a device. The engine records the refusal as a `no_change`, not a failure |
| 14 | **Stale or misleading UI state** | **Verified + FIXED.** A stale or unavailable room renders its status and an em-dash, never 0, and its capacity bar is suppressed so an empty bar cannot imply emptiness. The Analytics occupancy line uses `connectNulls={false}` so an outage is a **gap**. `savingsPercent === null` renders "Not enough configuration", never 0%. A `device:state` event for a refused command carries `commandFailed: true` with the **unchanged** state, so patching the row does not redraw the device as switched. **Fixed in FEAT-004:** `SettingsPage` rendered a **hardcoded `DEMO` indicator regardless of reality** — replaced with the real AI reachability, real `model_loaded`, the service's own reported mode and the real DEMO/REAL camera split |
| 15 | **Memory leaks / unbounded growth** | **Verified + FIXED.** AI service: `_person_tracks` is TTL-expired on every update (a test drives 20 tracks and asserts the list empties); `_last_occupancy_sent` is keyed per camera. Backend: `latestByCamera` is keyed by a cameraId validated against a real `Camera`, so it is bounded by configured cameras; `simulatedState` by device count; `inFlightCommands` by concurrency. **Fixed:** `markerClocks` (keyed `roomId:threshold`) had no cap — an operator repeatedly editing a rule's threshold would leave one dead entry per old value for the process lifetime. Added `MARKER_CLOCK_MAX_KEYS = 500` with oldest-first eviction, matching the Review 2 idiom; evicting an entry only ever **restarts** a clock, which delays a switch-off rather than bringing one forward |
| 16 | **Unbounded database queries** | **Verified clean.** Every historical read goes through `normalizeHistoryPaging`, which clamps a missing, zero, negative, non-numeric or absurdly large `limit` into `[1, maxLimit]`, with the maximum coming from configuration and never from the request. The energy window query is bounded **twice** — one prior transition plus an in-window page capped at `ENERGY_HISTORY_MAX_LIMIT` — because a naive `changedAt <= windowEnd` read grows forever as the system runs |
| 17 | **Repeated queries / unnecessary model initialisation** | **Verified clean.** `RoomOccupancyState` exists precisely so `GET /api/occupancy/current` is a bounded N-room lookup rather than a scan of the history for each room's newest row. Occupancy adds **no** model load and **no** extra inference pass: it reuses the human detections Review 1 already produces on every processed frame. YOLO and both face models stay behind their lock-guarded `instance()` singletons |
| 18 | **Startup and shutdown behaviour** | **Verified clean.** `startAutomationEngine()` is idempotent (a second call does not create a second interval, which would double every evaluation); the interval is `unref()`-ed so a forgotten clear still lets the process exit; `stopAutomationEngine()` runs **before** `httpServer.close()` so a tick cannot fire against a half-torn-down process — asserted by index ordering in a test. Devices are deliberately **left as they are** on shutdown: stopping the backend is not a request to change the state of the lights. The AI service's `reporter.shutdown()` drain is untouched |
| 19 | **Degradation: stopping the AI service or a camera must not crash anything** | **Verified clean.** AI service down → `GET /api/ai/status` is caught and reported honestly; occupancy reports simply stop arriving and the backend's own staleness window turns the figure to `stale` with a **null** count; automation records `skipped_stale_data` and switches nothing; detection/recognition/attendance/alerts/people/cameras all keep working. Camera down → the worker's `not ok` branch marks occupancy unavailable, reports it, backs off and reopens the source. Weights absent → `detection_model` reports **down** while the backend API reports ok, because the health endpoint reads the AI service's own `model_loaded` flag rather than inferring it. Database index unverified → only the affected write path refuses |
| 20 | **An unknown identity must not be classed as a confirmed threat** | **Verified clean and unchanged.** `unknown_identity` is still `warning`, never `critical`, and the UI caveat still renders. The new Review 3 alert types are also `warning`: a crowded room and a light that did not switch are operational conditions, not security incidents, and ranking them alongside a weapon sighting would devalue the critical tier |

**Nothing from the checklist was found and left unfixed.** The three items
recorded rather than changed are item 11 (the port default inconsistency —
changing a working developer `.env` setup with no way to run the result is the
larger risk), the pre-existing `nodemon ^1.14.10` pin in
`backend/package.json` (affects `npm run dev` only; a dependency change is out
of scope and unverifiable here), and `roomController.updateRoom`'s
`Object.assign(doc, req.body)` without an undefined-strip (flagged in FEAT-003,
pre-existing, never executed; `updateDevice` and `updateRule` do strip).

### D.5 Integration workflows — designed, not verified

Every row below was traced by reading the code end to end. **None was
executed.**

| Workflow | Traced path | Executed? |
|---|---|---|
| Camera → occupancy → room state → dashboard | `_update_occupancy` → `report_occupancy` → `POST /api/ai/occupancy` → `occupancyService.ingestOccupancy` → `aggregateRoomCount` → `deriveOccupancyStatus` → `RoomOccupancyState` upsert → `occupancy:update` → `EnergyPage` / `DashboardPage` | **No** |
| Occupancy → automation → device → history → energy | `ingestOccupancy` → `onOccupancyUpdated` → `evaluateRoom` → `decideDeviceAction` → `issueCommand` → adapter → `DeviceStateHistory` → `energyService` → `AnalyticsPage` | **No** |
| Stale data fail-safe | tick → `occupancyViewFor` re-derives status → `isOccupancyActionable` → `skipped_stale_data` → `AutomationLog` → activity list | **No** |
| Manual override | `POST /api/devices/:id/command` with `override` → `setManualOverride` → expiry → `skipped_override` → automatic control resumes | **No** |
| Device failure | `setSimulatedFailure` → `issueCommand` → `ok: false` → 502 → `confirmed: false` row + `command_failed` log + `device_failure` alert, `reportedState` untouched | **No** |
| Capacity exceeded | count > capacity → `capacity_exceeded` → `shouldRaiseOccupancyAlert` → cooldown → `Alert` → Alerts page | **No** |
| Reconnect recovery | socket `connect` → full REST re-load on `EnergyPage` and `DashboardPage` | **No** |
| Review 1 regression | cameras, streaming, YOLO human/weapon detection, demo weapon, detection events, alerts, acknowledge/resolve | **No** — unchanged by inspection only |
| Review 2 regression | person registration, face registration, matching, attendance, duplicate prevention, unknown-identity alerts | **No** — unchanged by inspection only |

---

## E. Known limitations

### E.1 The limitation that frames all the others

**Review 2 and Review 3 have never been executed.** Treat every behaviour in
this report as *designed and statically reviewed*, not *demonstrated*. Review 1
is the only part of CamSense AI with runtime evidence behind it.

### E.2 Model accuracy and environmental limits

- **No accuracy evaluation of any kind has been performed** — not for
  detection, not for recognition, not for occupancy. No figure in this project
  is a measurement.
- **`yolov8n` (COCO) has no firearm class.** Real weapon detection is therefore
  limited to **bladed objects** (knife, scissors). The *"Trigger demo weapon
  (DEMO)"* button exists for exactly this reason: it injects a clearly-labelled
  `source: 'demo'` event so the critical-alert pipeline is demonstrable without
  pretending a gun was detected. `yolov8n` is also the smallest YOLOv8 variant,
  chosen for CPU speed, so it is the least accurate of the family.
- **The `0.363` recognition threshold is uncalibrated.** It is the figure
  OpenCV publishes as a starting point for SFace cosine matching. It has not
  been tuned against this project's enrolled population, cameras or lighting.
  **A cosine similarity is not a probability** and must never be displayed as
  one.
- **No liveness or anti-spoofing detection.** A printed photo or a phone screen
  may well match. Recognition is not proof of physical presence.
- **Environmental sensitivity is untested here**: pose, lighting, occlusion,
  masks, low resolution, crowding, camera angle and motion blur all affect both
  detection and recognition, and none has been characterised.

### E.3 Occupancy — what the number actually is

The headcount is **the number of distinct live person tracks on one camera
worker**, where tracks are associated between consecutive processed frames by
greedy bounding-box IoU (threshold 0.3) and expire after
`occupancy_track_ttl` (3 s) without being re-seen. That is a deliberate,
cheap de-duplication method, and it has real limits:

- **It is not a multi-object tracker.** No Kalman filter, no motion model, no
  appearance embedding, no ByteTrack/DeepSORT. **Two people who cross will
  mis-associate**, and the count can be briefly wrong in either direction.
- **No cross-camera re-identification exists.** The same person in front of two
  cameras legitimately opens two independent tracks, and nothing can know they
  are one human. A room with several cameras therefore aggregates with
  **`MAX`**, never a sum: summing would report two people where there is one,
  and the error grows with the overlap. The maximum is a documented **lower
  bound** — possibly an undercount when the cameras see genuinely different
  parts of the room, but never a fabricated overcount. *For an accurate count,
  give a room one camera that covers it.*
- **Tracks do not survive a worker restart.** They are in-memory per worker, so
  restarting the AI service or stopping and starting a camera resets the count
  to "never measured" (`null`, not 0).
- **A person who is not detected is not counted.** Occupancy inherits every
  limitation of the underlying `yolov8n` person detector, including occlusion
  and small/distant subjects.
- **`occupancy_min_track_hits` (default 2) trades latency for stability.** A
  genuinely new person takes at least two processed frames to appear in the
  count.
- **A headcount is only reported, never measured, as 0 when the camera was
  actually looked at.** Unavailable and stale both report `count: null`. That
  distinction is enforced in one place (`deriveOccupancyStatus`) and asserted
  three ways in the tests, because treating "unknown" as "empty" is exactly
  what would switch the lights off on a room full of people.

### E.4 Device control — simulation only

- **No physical device has ever been switched, and none can be.** There is no
  MQTT broker, no ESP32 firmware, no relay board, and no HTTP device adapter in
  this repository. `getAdapter()` **throws** a clear not-implemented error for
  any adapter type other than `simulation`, rather than stubbing something that
  silently pretends to work.
- Simulation is disclosed four ways: every adapter result carries
  `simulated: true`, every message is prefixed with the literal word
  `SIMULATED`, every device API payload carries `simulated` + `adapterType` +
  `adapterImplemented`, and `GET /api/devices/adapters` returns a plain-language
  statement of which adapters actually work.
- A never-commanded simulated device probes as **`unknown`**, not `off`.
- The simulated state lives in one in-process `Map`, so it does **not** survive
  a backend restart and is **not** shared between processes — which is why
  `npm run demo:reset` tells you to restart the backend.
- **A reachable adapter does not mean hardware is connected.** The health panel
  reports the device adapter with the dedicated status `simulation`, never
  `ok`.

### E.5 Energy — every figure is an estimate

- **There is no power meter in this project.** Energy is
  `(a power rating an operator typed in) × (the duration the device was
  recorded on)`. A device whose `powerRatingWatts` is wrong produces a
  confidently wrong kWh figure, and a device driven by the simulation adapter
  was never physically on at all — the duration is real elapsed time, but the
  "device" was an entry in a `Map`.
- **The baseline is an assumption, and it is the only reason a savings figure
  can be quoted at all.** `ENERGY_BASELINE_HOURS_PER_DAY` (default 12) means
  "the hours per day this device would have run under its configured operating
  schedule **without** occupancy-based switching". It is not measured, not
  inferred from history, and not a hidden constant: it is returned inside every
  energy response together with a description of what it assumes. **Quote the
  baseline whenever you quote a saving.**
- Savings are `max(0, baseline − actual)`. A device that ran *longer* than the
  baseline reports **0 saved**, not a negative saving.
- `savingsPercent` is **null** when the baseline is 0, because with no baseline
  there is nothing to be a percentage of. 0% and 100% are both claims the data
  does not support. The UI renders "Not enough configuration".
- Figures come only from `DeviceStateHistory` rows with `confirmed: true`. A
  command that **failed** never bills a room for electricity it did not use,
  and a state of `unknown` contributes nothing — neither on nor off.
- `GET /api/energy/trend` reads the `EnergySummary` rollup, which the automation
  tick fills for **yesterday only**, at most once per local day. On a fresh
  system it returns `insufficientData: true` and the UI says so rather than
  drawing a flat line at zero.

### E.6 Hardware and external-service dependencies

| Dependency | Needed for | If absent |
|---|---|---|
| MongoDB | everything persistent | the backend exits on start |
| `yolov8n.pt` | human + weapon detection, and therefore occupancy | the AI service starts, detection reports **unavailable**, occupancy reports **unavailable** (never 0) |
| The two face ONNX files | face detection, recognition, attendance | the service starts; both report **UNAVAILABLE**; registration refuses and the person stays visibly not recognition-ready |
| `samples/vtest.avi` | the DEMO camera source | the live stream stays black |
| A real CCTV camera / RTSP URL | REAL mode | DEMO mode works without any hardware; **no real camera has been tested** |
| IoT hardware | real device control | **not supported at all** — simulation only |
| Internet | the one-time asset download and the package installs | run `download_assets.py` once with connectivity, or drop the files into `models/` by hand |

### E.7 Remaining bugs and unmet acceptance criteria

1. **Unmet: "Relevant tests and production builds have been executed and their
   results recorded."** The results are recorded (§D) — but as **blocked**. The
   tests exist and have never run. This is the one acceptance criterion the
   environment made impossible, and it is the most consequential.
2. **Unmet in part: "The existing application can be started using documented
   instructions."** The instructions correspond to real scripts and real files,
   verified by reading `package.json` and the filesystem. **Nobody has followed
   them end to end in this environment.**
3. **Latent risk: first-execution defects in Review 2 + Review 3.** Roughly
   10,000 unexecuted Review 2 lines plus the Review 3 change set. Expect the
   normal first-run class of problems — a mongoose schema quirk, a `tsc`
   complaint in the new pages, an index that will not build on existing data.
   FEAT-001 audited the Review 2 import graph, types and schema usage and found
   it **clean**, which lowers but does not remove that risk.
4. **Known, deliberately unchanged:** the port 5000/5050 default inconsistency;
   `nodemon ^1.14.10` in `backend/package.json`; `roomController.updateRoom`'s
   `Object.assign` without an undefined-strip; `PlaceholderPage.tsx` left on
   disk unreferenced (deleting a file needs a shell — it cannot render, and
   `noUnusedLocals` does not flag an unused module).
5. **No retention or expiry job** for occupancy readings, automation logs,
   device state history or snapshots. They accumulate until something removes
   them. `demo:reset` is a demo tool, not a retention policy.
6. **The responsive check was a code read of Tailwind classes, not a resized
   viewport.** The mobile-navigation and modal-clipping defects described in
   §B.7 were found and fixed by inspection; the fixes have not been seen in a
   browser.
7. **The two new alert cooldowns and `GET /api/health/components` have never
   been exercised**, so their graceful-degradation branches are untested.
8. **Role gating in the UI is a convenience.** The control that matters is
   `requireRole('admin')` on the backend route.

---

## F. Final demonstration plan (5–8 minutes)

Rehearse once. Before starting: MongoDB up, AI service up, backend up, frontend
up, `python download_assets.py` already run, and the seed chain already run
(`npm run seed` → `seed:cameras` → `seed:rooms` → `seed:devices`). Optionally
`npm run demo:reset -- --apply`, then **restart the backend**.

**Say this in the first fifteen seconds:** *"Review 1 has been run. Review 2 and
Review 3 are written and statically verified but have never been executed in
the environment they were written in — shell access was unavailable. Everything
I am about to show you is either live Review 1 behaviour or Review 2/3 code
running for the first time right now. No accuracy number and no energy saving
in this project is a measurement."*

| # | Step | What to show | Say out loud |
|---|---|---|---|
| **1** | **Dashboard** *(~40 s)* | Log in as admin. Walk the priority order: critical alerts → camera and AI-service status → current occupancy and capacity → recent detection and recognition activity → device automation → energy. Point at the component-health panel | "Every tile is a real count over persisted documents. The health panel reads each component from the component that owns the state — the AI model row is the AI service's own `model_loaded` flag, not an inference from the backend being up" |
| **2** | **Camera input + human detection** *(~50 s)* | Live Monitoring → *Main Entrance (CAM-01)* → **Start Stream**. Point at the YOLO person boxes, FPS, inference time | "Real YOLOv8 detections on real pedestrians in the bundled sample video. This is Review 1, and it is the part of the project that has actually been run" |
| **3** | **Weapon detection** *(~30 s)* | Click **Trigger demo weapon (DEMO)**. A CRITICAL alert appears live on the Dashboard and Alerts page, labelled DEMO | **State the limitation**: "`yolov8n` is a COCO model and COCO has no firearm class, so genuine weapon detection here is limited to bladed objects — knife, scissors. This button injects a clearly-labelled demo event so you can see the critical-alert pipeline without me pretending a gun was detected" |
| **4** | **Register a person → recognition → attendance** *(~70 s)* | People → Register Person (a **consenting** participant or a suitable test image) → Register face → watch it flip to *recognition ready* → back to Live Monitoring → the Identity Results panel shows the name → Attendance shows one record | "The threshold is `0.363` — OpenCV's published starting point for SFace, **uncalibrated** for these cameras. A cosine similarity is not a probability. An embedding is stored only on an `OK` result; there is no partial success" |
| **5** | **Duplicate prevention + unknown identity** *(~40 s)* | Keep the same person in frame: `lastSeen` updates, **no** second attendance record. Then show an unenrolled face → `UNKNOWN` → after the persistence and cooldown rules, the `unknown_identity` alert on the existing Alerts page | "Duplicate prevention is a **unique database index** on `{ personId, date }`, built and read back at startup — not a frontend check. And an unknown identity is severity **warning**, never critical: it means the system could not match a face, not that anyone is unauthorized" |
| **6** | **Open a room → occupancy monitoring** *(~60 s)* | Occupancy & Energy → the ROOM-01 card: current count, capacity, status badge, **last successful update**. Open the rooms panel and show capacity / threshold / camera assignment. Then open Analytics and show the occupancy-over-time chart | "The count is the number of **distinct person tracks**, not a sum of per-frame detections — one person standing there for a minute counts once. ROOM-01 has two cameras, so they aggregate with **MAX, never a sum**: there is no cross-camera re-identification in this project, so summing would report two people where there is one" |
| **7** | **Simulated device control + automation** *(~70 s)* | The devices panel: DEV-LIGHT-01 (108 W) and DEV-FAN-01 (75 W), each with a visible **SIMULATED** badge. Switch one on manually. Then the two explicit opt-ins: **enable RULE-LAB-01**, set both devices to **automatic**. Hit *Evaluate* and read the decision in the automation activity list | "These are **simulated** devices. There is no MQTT, no ESP32 and no relay board in this project, and nothing is stubbed to pretend otherwise — an unimplemented adapter has its commands **refused** with a clear error. Notice automation took two deliberate operator actions to start: rules are created disabled and devices are created with control mode `disabled`" |
| **8** | **Manual override + the stale-data fail-safe** *(~70 s)* | Issue a manual command **with override**, then evaluate: the activity list shows **`skipped_override`** with its expiry. Then stop the AI service (or stop the camera) and wait past `OCCUPANCY_STALE_AFTER` (30 s): the room card flips to **Occupancy Data Stale** showing an **em-dash, not 0**, and the next evaluation logs **`skipped_stale_data`** | "This is the most important thirty seconds of the demo. The camera is gone, so the system does **not** know the room is empty — and it refuses to act. Unavailable data is not evidence of an empty room. Note the count renders as a dash: reporting 0 would be a claim the system cannot make, and it is exactly what would switch the lights off on a room full of people. Also note the skip is **written to the log** — a suspended rule is invisible unless it is recorded" |
| **9** | **Energy analytics + the savings calculation** *(~60 s)* | The energy strip: consumed today, estimated saved today, estimated savings %, with the **baseline description rendered next to it** and the ESTIMATED / SIMULATED badges. Then Analytics: consumed-vs-baseline trend, energy by room, energy by device. Walk the arithmetic on screen | "kWh is watts × seconds ÷ 3600 ÷ 1000, derived in exactly one place. DEV-LIGHT-01 at 108 W recorded on for 4 hours is **0.432 kWh**. The baseline is the declared assumption that without occupancy switching it would have run 12 hours — 108 W × 12 h = **1.296 kWh** — so the estimated saving is **0.864 kWh, about 67%**. Both numbers are **estimates**: that 108 W is a figure I typed in, there is no power meter anywhere in this project, and the 12 hours is an assumption I am stating rather than hiding. If the baseline were 0 the percentage would show as *not enough configuration*, never as 0%" |
| **10** | **Architecture, testing and limitations** *(~60 s)* | `docs/ARCHITECTURE.md` (the data-flow diagram), `docs/OCCUPANCY_ENERGY.md` (the tracking limitations and the worked example), then **this report, §D** | "The frontend talks only to the Node backend; the backend is the only thing that talks to the AI service; AI-produced data — detections, recognition and now occupancy — can only enter over the shared-secret service leg, and the backend re-verifies it against its own records and its own thresholds. And here is the verification section: separate subsections for what ran and what did not. **Nothing in Review 2 or Review 3 has been executed** — every command failed at the OS sandbox layer, exit code 71, recorded verbatim. The tests are written and present; they have never run" |

### Optional extra (≈30 s, if time allows)

**The device-failure walkthrough.** Call
`setSimulatedFailure('DEV-LIGHT-01', true)` (via a node REPL against
`backend/src/services/devices/simulationAdapter.js`), then issue a command. The
API returns **502**, a `device_failure` alert appears, the device history gains
a row with `confirmed: false`, and the device's reported state is **left
unchanged** — the UI says the command failed, not that the device switched.
*"The system never claims a device changed state unless the adapter confirmed
it, and a failed command is never counted as energy consumed."*

### Steps that cannot be demonstrated in the environment this was written in

| Step | Why | What to say instead |
|---|---|---|
| **Everything** | Shell execution was unavailable, so no service could be started here. Steps 1–10 assume the demonstrator has a working machine | "This was written in an environment with no shell. The first time any of this runs is the first time you run it" |
| Real CCTV / RTSP input *(step 2)* | No camera and no RTSP source | Use DEMO mode and say so: "This is the bundled sample video in DEMO mode. Every detection carries `source: 'demo'` or `source: 'real'`, and the two are never silently mixed" |
| Firearm detection *(step 3)* | COCO has no gun class | Covered in step 3's script |
| Physical light/fan switching *(steps 7–8)* | No hardware, and no real adapter | Covered in step 7's script |
| A measured energy saving *(step 9)* | No power meter | Covered in step 9's script |
| A multi-day energy trend *(step 9)* | The rollup fills **yesterday** only, so a fresh system has none | The chart shows the backend's `insufficientData` message naming what is needed. Say: "no completed day has been rolled up yet" |
| Any accuracy figure | No evaluation was performed | Do not quote one |

---

## Appendix — related documents

| Document | Contents |
|---|---|
| [`REVIEW3-VERIFICATION.md`](REVIEW3-VERIFICATION.md) | The per-feature verification record: §§1–5 FEAT-001, §6 FEAT-002, §7 FEAT-003, §8 FEAT-004, §9 FEAT-005 |
| [`OCCUPANCY_ENERGY.md`](OCCUPANCY_ENERGY.md) | The Review 3 technical companion: module map, tracking method and its limits, status derivation, automation precedence, the energy calculation worked through, the adapter contract |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | System architecture and the Review 3 data flow |
| [`FACE_RECOGNITION.md`](FACE_RECOGNITION.md) | The Review 2 identity pipeline |
| [`REVIEW2-REPORT.md`](REVIEW2-REPORT.md) | The Review 2 delivery report, including its own §11 verification record |
| [`../README.md`](../README.md) | Setup, operation, limitations, demo procedure |
