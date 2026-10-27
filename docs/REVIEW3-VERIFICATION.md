# Review 3 · Verification Record

This document records what was and was not executed while preparing Review 3,
and the static audit that was performed in place of a green build.

**Nothing in this file should be read as a passing test, build or typecheck.**
Every command listed in section 1 failed before the command itself ran. No
test suite, no build, no typecheck and no service start has been executed
against this repository.

---

## 1. Verification commands attempted

Each command below was attempted **exactly once** with the agent's shell tool.
Every one failed at the operating-system sandbox layer *before* the command
was executed, so no command output of any kind (not even a shell error from
`npm`, `node`, `python` or `curl`) exists for any of them.

Verbatim failure output, identical for all nine attempts:

```
sandbox-exec: sandbox_apply: Operation not permitted
```

```
Exit Code: 71
```

| Command | Attempted | Result | Verbatim output |
| --- | --- | --- | --- |
| `cd /Users/ayuxhdas/camsense-ai/backend && npm test` | yes, once | **not executed** — blocked by the OS sandbox | `sandbox-exec: sandbox_apply: Operation not permitted` / Exit Code: 71 |
| `cd /Users/ayuxhdas/camsense-ai/backend && npm install` | yes, once | **not executed** — blocked by the OS sandbox | `sandbox-exec: sandbox_apply: Operation not permitted` / Exit Code: 71 |
| `cd /Users/ayuxhdas/camsense-ai/frontend && npm run lint` | yes, once | **not executed** — blocked by the OS sandbox | `sandbox-exec: sandbox_apply: Operation not permitted` / Exit Code: 71 |
| `cd /Users/ayuxhdas/camsense-ai/frontend && npm run build` | yes, once | **not executed** — blocked by the OS sandbox | `sandbox-exec: sandbox_apply: Operation not permitted` / Exit Code: 71 |
| `cd /Users/ayuxhdas/camsense-ai/ai-service && python -m unittest discover -s tests -v` | yes, once | **not executed** — blocked by the OS sandbox | `sandbox-exec: sandbox_apply: Operation not permitted` / Exit Code: 71 |
| `cd /Users/ayuxhdas/camsense-ai/ai-service && python -m compileall app` | yes, once | **not executed** — blocked by the OS sandbox | `sandbox-exec: sandbox_apply: Operation not permitted` / Exit Code: 71 |
| `cd /Users/ayuxhdas/camsense-ai/backend && node --check src/server.js` | yes, once | **not executed** — blocked by the OS sandbox | `sandbox-exec: sandbox_apply: Operation not permitted` / Exit Code: 71 |
| `curl -s http://127.0.0.1:5050/api/health` | yes, once | **not executed** — blocked by the OS sandbox | `sandbox-exec: sandbox_apply: Operation not permitted` / Exit Code: 71 |
| `curl -s http://127.0.0.1:8000/api/health` | yes, once | **not executed** — blocked by the OS sandbox | `sandbox-exec: sandbox_apply: Operation not permitted` / Exit Code: 71 |

Consequences to keep in mind when reading any Review 3 claim:

* `backend/test/*.test.js` has never run. The Review 2 identity-rule unit
  tests are unverified.
* `ai-service/tests/*.py` has never run.
* `tsc --noEmit` and `vite build` have never run, so no TypeScript diagnostic
  has ever been produced for this codebase.
* No MongoDB connection has been made, so no index has been built and
  `ensureCriticalIndexes()` has never reported either outcome.
* Neither service has been started, so no startup diagnostic, no model load
  result and no health response has ever been observed.

The two commands the user *has* run outside this environment, for the record:

* `npm install` in `backend/` reported `up to date, audited 377 packages`,
  which confirms Review 2 introduced no new backend npm dependency.
* `npm run seed` failed with
  `[ERROR] Seed failed connect ECONNREFUSED 127.0.0.1:27017` — MongoDB was not
  running. That failure occurred before any Review 2 code was reached, so it
  tells us nothing about Review 2's correctness.

---

## 2. Static audit of the never-executed Review 2 change set

Review 2 added roughly 10,000 lines that had never been compiled, imported,
type-checked or run. Because no build can be run here, every import and every
type reference was resolved **by reading the target file** and confirming the
named export actually exists. This is the substitute for a green baseline, and
its limits are stated in section 5.

### 2.1 Backend (Node ESM) — import graph

Walked from `backend/src/server.js` and `backend/src/app.js` outwards. Every
relative import below was checked by opening the target file and confirming
each named binding is exported there.

Entry points and routing:

* `src/server.js` → `app.js` (`createApp`), `config/db.js` (`connectDatabase`),
  `sockets/index.js` (`initSocket`), `config/env.js` (`env`),
  `utils/logger.js` (`logger`) — **all resolve**
* `src/app.js` → `config/env.js` (`env`, `isProduction`), `routes/index.js`
  (default), `middleware/auth.js` (`requireAssetAccess`),
  `middleware/notFound.js` (`notFound`), `middleware/errorHandler.js`
  (`errorHandler`) — **all resolve**
* `src/routes/index.js` → 11 route modules, each a default export — **all
  resolve**

Review 2 routes → controllers:

* `routes/peopleRoutes.js` imports `listPeople`, `getPerson`, `createPerson`,
  `updatePerson`, `setPersonRecognition`, `deletePerson`, `registerPersonFace`,
  `personSchema`, `personUpdateSchema`, `recognitionToggleSchema`,
  `faceRegistrationSchema` from `controllers/personController.js` — **all 11
  are exported there**
* `routes/attendanceRoutes.js` imports `listAttendance`,
  `getAttendanceSummary`, `getAttendanceRecord` — **all exported**
* `routes/recognitionEventRoutes.js` imports `listRecognitionEvents`,
  `getRecognitionEvent` — **both exported**
* `routes/aiRoutes.js` imports `ingest`, `ingestRecognitionResults`,
  `listFaceEmbeddings`, `getAiStatus` from `controllers/aiController.js` —
  **all exported**
* Middleware used by those routes: `requireAuth`, `requireRole`,
  `requireAuthQueryOrHeader`, `requireAssetAccess` (`middleware/auth.js`),
  `requireInternalSecret` (`middleware/internalAuth.js`), `validate`
  (`middleware/validate.js`) — **all exported**

Review 2 controllers → services, models, utils:

* `controllers/personController.js` → `personService.js`
  (`buildPersonFilter`, `findPersonOrThrow`, `notifyAiCacheRefresh`,
  `serializePerson`), `utils/snapshot.js` (`parseImageDataUrl`,
  `removeStoredImage`, `saveSnapshot`), `models/Person.js` (`Person`),
  `services/aiClient.js` (`aiClient`), `utils/ApiError.js` (`ApiError`),
  `utils/asyncHandler.js` (`asyncHandler`), `config/env.js`, `utils/logger.js`
  — **all resolve**
* `controllers/aiController.js` → `eventService.js` (`ingestDetections`),
  `recognitionService.js` (`ingestRecognition`), `personService.js`
  (`listEnabledEmbeddings`), `aiClient.js`, `sockets/index.js` (`emit`,
  `SocketEvents`) — **all resolve**
* `controllers/attendanceController.js` and
  `controllers/recognitionEventController.js` → `identityRules.js`
  (`attendanceDateKey`, `escapeRegex`, `toQueryString`) plus the Attendance /
  Person / Camera / RecognitionEvent models — **all resolve**

Review 2 services:

* `services/recognitionService.js` imports `cooldownElapsed`,
  `isPersistableRecognitionStatus`, `normalizeRecognitionStatus`,
  `shouldRaiseUnknownAlert`, `validateIdentityClaim` from `identityRules.js`;
  `serializeAlert` from `eventService.js`; `computeDashboardStats` from
  `dashboardService.js`; `findPersonForVerification` from `personService.js`;
  `markAttendance` from `attendanceService.js`; `saveSnapshot` from
  `utils/snapshot.js` — **all resolve**.
  `serializeAlert(alert, cameraName, confidence, objectClass)` is called with
  four arguments and is declared with exactly those four parameters.
* `services/attendanceService.js` imports `attendanceDateKey`,
  `attendanceDuplicatePreventionReady`, `attendanceWriteDue`,
  `interpretUpsertResult`, `validateIdentityClaim` from `identityRules.js`, and
  `getAttendanceIndexState` from `config/db.js` — **all resolve**
* `services/personService.js` re-exports `buildPersonFilter` and
  `serializePerson` from `identityRules.js`; both are declared there, so the
  re-export is valid
* `services/identityRules.js` imports nothing at all (by design), and exports
  all 13 names its consumers import: `escapeRegex`, `toQueryString`,
  `buildPersonFilter`, `serializePerson`, `validateIdentityClaim`,
  `shouldRaiseUnknownAlert`, `cooldownElapsed`, `attendanceWriteDue`,
  `interpretUpsertResult`, `attendanceDuplicatePreventionReady`,
  `isPersistableRecognitionStatus`, `attendanceDateKey`,
  `normalizeRecognitionStatus`

Socket event names used by Review 2 code
(`RECOGNITION_STATUS`, `PERSON_RECOGNIZED`, `IDENTITY_UNKNOWN`,
`ATTENDANCE_MARKED`, plus the Review 1 `ALERT_NEW` and `DASHBOARD_UPDATE`) are
all present in the `SocketEvents` map in `sockets/index.js`, and all four
Review 2 names match the frontend's copy in `frontend/src/services/socket.ts`
string for string.

`aiClient` methods called by Review 2 code — `registerFace`,
`refreshFaceCache`, `getFaceStatus`, `getStatus` — are all defined on the
exported `aiClient` object.

`ApiError` static helpers used anywhere in the Review 2 files
(`badRequest`, `notFound`, `conflict`, `internal`, plus the
`new ApiError(503, …)` constructor form) all exist on the class.

`utils/snapshot.js` `saveSnapshot(dataUrl, cameraId, { subdir })` is called
with the `subdir` option by `personController.js`; the signature accepts it.

Backend test files: `test/review2-identity.test.js` imports from
`../src/services/identityRules.js` and `test/smoke.test.js` from
`../src/utils/ApiError.js` — both resolve. The other three Review 2 test files
(`review2-routes`, `review2-security`, `review2-uploads-auth`) read source
files from disk with `node:fs` rather than importing them, so they have no
import surface to break.

**Result: no unresolved import and no missing named export was found in the
backend.**

### 2.2 AI service (Python) — import graph

Every `from app.* import *` in the Review 2 modules was resolved by reading the
target module and confirming the attribute is defined there.

* `app/main.py` → `app.api.routes` (`router`), `app.config`
  (`get_settings`), `app.detection.yolo_model` (`YoloModel`),
  `app.recognition` (`face_service`), `app.recognition.face_model`
  (`FaceDetectorModel`, `FaceEmbedderModel`), `app.services.pipeline`
  (`warmup`), `app.services.event_reporter` (`reporter`) — **all resolve**
* `app/api/routes.py` → `app.api.security` (`require_service_secret`),
  `app.models.schemas` (`FaceRegistrationRequest`, `FaceRegistrationResponse`,
  `HealthResponse`, `RecognitionStatusResponse`, `StreamControlResponse`,
  `StreamStartRequest`, `StreamStats`, `SystemStatus` — all 8 declared),
  `app.recognition.face_service`, `app.recognition.face_model`,
  `app.services.event_reporter` (`reporter`), `app.services.pipeline`
  (`pipeline`), `app.services.stream_manager` (`stream_manager`) — **all
  resolve**
* `app/recognition/face_service.py` → `app.models.schemas`
  (`FaceRecognitionResult`, `FaceRegistrationResponse`,
  `RecognitionStatusResponse`), `app.recognition.embedding_cache`
  (`embedding_cache`), `app.recognition.face_model` — **all resolve**
* `app/services/stream_manager.py` → `face_service.detect_faces`,
  `face_service.recognize_frame`, `face_service.bbox_iou`;
  `pipeline.run(frame, faces=…)`, `pipeline.annotate(frame, detections,
  recognitions)`; `reporter.report(...)`, `reporter.report_recognition(...)` —
  **all resolve with matching signatures**
* `app/services/pipeline.py` → `app.recognition.face_detection`
  (`FaceDetector`), `app.recognition.face_service` (`RecognitionStatus`),
  `app.recognition.embedding_cache` (`embedding_cache`),
  `face_service.identity_labels_trustworthy`, plus `reporter.dropped_reports`
  and `reporter.seconds_since_drop` and `reporter.recognition_leg_ok` — **all
  resolve**

Specifically confirmed, because `stream_manager.py` and `api/routes.py` call
all of them, `app/recognition/face_service.py` defines and exposes:
`detect_faces`, `recognize_frame`, `bbox_iou`, `decode_image`, `register_face`,
`refresh_identity_cache`, `recognition_status`, `recognition_available` — plus
`cosine_similarity`, `generate_embedding`, `match_embedding`, `is_low_quality`
and `identity_labels_trustworthy`. **All eight required names are present.**

`StreamStats` is constructed in `api/routes.py` with `faces`, `known_faces`,
`unknown_faces`, `recognition_available`, `recognition_errors`,
`recognition_reports_dropped` and `detection_reports_dropped`; all seven are
declared fields on the schema. `_CameraWorker` exposes the matching
attributes (`faces`, `known_faces`, `unknown_faces`, `recognition_errors`).

`Settings` attributes read anywhere in the Review 2 Python code
(`face_detection_confidence`, `face_min_size`, `face_match_threshold`,
`face_registration_max_faces`, `face_recognition_every_n_frames`,
`embedding_cache_ttl`, `embedding_cache_stale_grace`, `embedding_fetch_timeout`,
`embedding_source`, `ingest_secret`, `detection_mode`, `origins_list`, `host`,
`port`, plus the Review 1 keys) are all declared in `app/config.py`.

`requests` is used lazily inside `embedding_cache._fetch_candidates` and
`event_reporter`; it is pinned in `requirements.txt` (`requests==2.32.3`), so
no new dependency is implied.

Secured-router rule honoured: every route in `app/api/routes.py` except
`/health` is registered on `secured`, and `router.include_router(secured)` is
the last statement in the module.

**Result: no unresolved import and no missing attribute was found in the AI
service.**

One thing that could **not** be determined without a shell: whether the
zero-byte `__init__.py` files exist under `ai-service/app/api`,
`app/models`, `app/services`, `app/detection` and `ai-service/tests`. The file
tool cannot distinguish an empty file from a missing one, and the directory
index does not cover this repository. This is not expected to matter —
`app/recognition/__init__.py` definitely exists (it has content), and Python 3
namespace packages make the others importable either way, while
`python -m unittest` puts the current directory on `sys.path` so
`from app.config import …` resolves from `ai-service/` regardless. Confirm with
`ls ai-service/app/*/__init__.py` if an `ImportError` ever appears.

### 2.3 Frontend (TypeScript)

Strictness actually in force, read from `frontend/tsconfig.json` before judging
anything: `strict: true`, `noUnusedLocals: true`, `noUnusedParameters: true`,
`noFallthroughCasesInSwitch: true`, `noEmit: true`, `jsx: react-jsx`,
`moduleResolution: bundler`, and the `@/* → ./src/*` path alias. `npm run lint`
is `tsc --noEmit`; there is no ESLint configuration in the repository, so
"lint" here means a typecheck only.

Checked, by opening each target file:

* Every `@/` import in the Review 2 files resolves to a real file:
  `@/components/ui` (barrel), `@/components/PersonFormModal`,
  `@/components/FaceRegistrationStep`, `@/components/PlaceholderPage`,
  `@/services/{peopleService,attendanceService,recognitionService,dashboardService,cameraService,alertService,apiClient,authService,socket}`,
  `@/hooks/{redux,useSocketEvent}`, `@/utils/{assetUrl,format,storage,cn}`,
  `@/types`, `@/routes/{AppRoutes,navigation}`, `@/layouts/AppLayout`,
  `@/store/slices/authSlice`
* The `@/components/ui` barrel exports all 16 names the Review 2 pages import:
  `Button`, `Card`, `CardHeader`, `CardBody`, `Badge`,
  `StatusIndicator`, `Input`, `Select`, `Modal`, `ConfirmDialog`, `PageHeader`,
  `LoadingState`, `EmptyState`, `ErrorState`, `ToastProvider`, `useToast`
* Every prop passed to those primitives exists on its declared props type, and
  every union value is in range: `Button` `variant` (`primary|secondary|ghost|danger`)
  and `size` (`sm|md`), `Badge` `tone` (`neutral|safe|critical|warning|info`),
  `StatusIndicator` `status` (`online|offline|warning|error|ai`),
  `Select` `options: {value,label}[]`, `Modal` `{open,onClose,title,children,footer?}`,
  `ConfirmDialog` `{open,title,message,confirmLabel?,danger?,loading?,onConfirm,onCancel}`,
  `CardHeader` `{title,description?,action?}`, `PageHeader`
  `{title,description?,action?}`, `EmptyState` `{title?,description?,icon?,action?}`,
  `ErrorState` `{message?,onRetry?}`
* Every type imported from `@/types` by the Review 2 code is declared and
  exported in `frontend/src/types/index.ts`: `Person`, `PersonInput`,
  `PersonCategory`, `personCategoryLabel` (a value, not a type),
  `RecognitionEvent`, `RecognitionStatus`, `AttendanceRecord`,
  `AttendanceSummary`, `AttendanceStatus`, `AttendanceSource`,
  `FaceRegistrationResult`, `PersonRecognizedPayload`,
  `IdentityUnknownPayload`, `AttendanceMarkedPayload`, plus the Review 1
  `Alert`, `AiStatus`, `Camera`, `DashboardStats`, `DetectionEventPayload`,
  `DetectorStatus`, `RecentEvent`, `StreamStats`, `ViewStatus`, `ApiSuccess`,
  `ApiErrorBody`, `AuthSession`, `User`
* Every property read off an API response exists on the declared interface.
  Spot-checked exhaustively for the three Review 2 pages: `PeoplePage` reads
  only `id`, `personId`, `name`, `email`, `category`, `department`, `photo`,
  `active`, `faceRegistered`, `recognitionEnabled`, `recognitionReady` off
  `Person`; `AttendancePage`'s socket handler constructs a full
  `AttendanceRecord` from `AttendanceMarkedPayload` and supplies `null` for the
  four fields the payload does not carry (`category`, `department`, `photo`,
  `recognitionEventId`), which the interface declares nullable;
  `LiveMonitoringPage` reads `StreamStats.{fps,inference_ms,people,weapons,faces,known_faces,recognition_available}`,
  all of which are declared (the Review 2 additions are optional, and every
  read site uses `?? 0` / `=== true`)
* `DetectorStatus.status` was widened by Review 2 to
  `'active' | 'unavailable' | 'demo' | 'inactive' | 'error'`, and both
  exhaustive `Record<DetectorStatus['status'], …>` maps that consume it
  (`ServiceRow` in `LiveMonitoringPage.tsx`) list all five keys — so the map is
  complete and will not fail the index check
* All 12 pages referenced by `routes/AppRoutes.tsx` export the named component
  the route imports, including the two Review 3 placeholders `EnergyPage` and
  `AnalyticsPage`, which are already routed at `/energy` and `/analytics` and
  already in `routes/navigation.ts`
* `import.meta.env.VITE_API_BASE_URL` is typed by `src/vite-env.d.ts`, so the
  five modules that read it do not depend on an ambient Vite type being picked
  up by accident

**Result: no unresolved import, no missing exported type and no out-of-range
prop union was found in the frontend.**

### 2.4 Mongoose field usage vs schemas

Every field name used in a query filter, projection, `$set` or `$setOnInsert`
by the three Review 2 services was checked against the schema that owns it.

| Service | Fields used | Schema | Verdict |
| --- | --- | --- | --- |
| `recognitionService.js` | `RecognitionEvent.create({cameraId, personId, personName, status, similarity, boundingBox, trackId, source, timestamp})`, then `alertId` | `models/RecognitionEvent.js` | all declared |
| `recognitionService.js` | `Alert.create({type:'unknown_identity', severity, cameraId, detectionId, message, snapshot, status, timestamp})` | `models/Alert.js` | all declared; `'unknown_identity'` **is** in the `type` enum, and `'warning'` is in `severity` |
| `recognitionService.js` | `Person.countDocuments({active, recognitionEnabled, faceEmbedding:{$exists,$ne}})` | `models/Person.js` | all declared |
| `recognitionService.js` | `Camera.findOne({cameraId}).select('cameraId name')` | `models/Camera.js` | both declared |
| `attendanceService.js` | key `{personId, date}`; `$setOnInsert {cameraId, sessionKey, firstSeen, status, source, similarity, recognitionEventId}`; `$set {lastSeen}` | `models/Attendance.js` | all 10 declared, and the key matches the unique compound index `{personId:1, date:1}` exactly |
| `personService.js` | `Person.find({active, recognitionEnabled, faceEmbedding}).select('+faceEmbedding')`, then `personId`, `name`, `embeddingModel`, `embeddingDim` | `models/Person.js` | all declared; `+faceEmbedding` is the correct opt-in for `select:false` |
| `personController.js` | writes `faceEmbedding`, `embeddingModel`, `embeddingDim`, `faceRegisteredAt`, `photo` | `models/Person.js` | all declared |
| `attendanceController.js` | filters on `date`, `cameraId`, `status`, `personId`; sorts `{date:-1, firstSeen:-1}`; projects `personId name category department photo` | `Attendance`, `Person` | all declared |
| `recognitionEventController.js` | filters on `cameraId`, `status`, `personId`, `timestamp`; projects `cameraId name location` | `RecognitionEvent`, `Camera` | all declared |
| `dashboardService.js` | `Attendance.countDocuments({date, status})`, `RecognitionEvent.countDocuments({status, timestamp})`, `Detection.countDocuments({type, timestamp})` | `Attendance`, `RecognitionEvent`, `Detection` | all declared |

**Result: no schema/query field mismatch was found.**

---

## 3. If your `backend/.env` predates Review 2

`backend/.env.example` and `backend/src/config/env.js` agree exactly — all 26
keys documented in the example have a matching read in `env.js`, and `env.js`
reads no key the example does not document. Nothing needs changing in either
file.

However, a `backend/.env` created before Review 2 will be **missing the eleven
keys below**. Every one of them has a code default in `env.js`, so the backend
starts and behaves sensibly without them; the only cost is that the values are
not visible or tunable in your `.env`. Copy any you want to change out of
`backend/.env.example`.

| Key | Default in `env.js` | What it controls |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Bind address. Loopback by default on purpose — this process serves snapshot images and registration portraits. |
| `ASSET_TOKEN_EXPIRES_IN` | `1d` | Lifetime of the narrowed token used in `/uploads` image URLs. |
| `RECOGNITION_MATCH_THRESHOLD` | `0.363` | Cosine similarity an identity claim must clear. OpenCV's published starting point for SFace, not a calibrated value. |
| `RECOGNITION_EMBEDDING_DIM` | `128` | Dimension the configured model produces; a vector from another embedding space is rejected rather than scored. |
| `UNKNOWN_PERSISTENCE_COUNT` | `2` | Sightings of the same camera+track required before an unknown-identity event is raised. |
| `UNKNOWN_PERSISTENCE_WINDOW` | `10` | Seconds those sightings must fall within. |
| `UNKNOWN_ALERT_COOLDOWN` | `60` | Seconds before the same continuously visible unmatched face may alert again. |
| `KNOWN_EVENT_COOLDOWN` | `30` | Seconds between stored `known` recognition events for the same person on the same camera. |
| `ATTENDANCE_UPDATE_COOLDOWN` | `30` | Minimum gap between `lastSeen` writes for an already-marked person. |
| `ENROLLED_COUNT_TTL` | `30` | Seconds the "is anybody enrolled?" count is cached for. |
| `FACE_UPLOAD_MAX_BYTES` | `5000000` | Maximum decoded size of a registration photograph. |

No secret value was written to any `.env.example`, and neither `backend/.env`
nor `ai-service/.env` was read from or written to.

`ai-service/.env.example` was cross-checked the same way against
`app/config.py`: every documented `AI_SERVICE_*` key maps to a declared
`Settings` field and vice versa, and it ships `AI_SERVICE_HOST=127.0.0.1`
(which is what `backend/test/review2-security.test.js` asserts).

---

## 4. Findings carried forward, not fixed here

The audit found **no** unresolved import, missing export, out-of-range union
or schema/query mismatch, so nothing was changed in the Review 2 code. Three
observations are recorded instead, because fixing them is outside this audit's
scope and each would change runtime behaviour or dependency state.

1. **The backend port is still inconsistent across committed defaults.** This
   is the open item already flagged in `README.md` and as follow-up #5 in
   `docs/REVIEW2-REPORT.md`. The disagreement, exactly as it stands:

   | Location | Default |
   | --- | --- |
   | `backend/src/config/env.js` | `PORT` → `5000` |
   | `backend/.env.example` | `PORT=5000` |
   | `frontend/.env.example` | `VITE_API_BASE_URL=http://localhost:5000/api` |
   | `frontend/src/services/apiClient.ts` | fallback `http://localhost:5000/api` |
   | `frontend/src/services/socket.ts` | fallback `http://localhost:5050/api` |
   | `frontend/src/services/cameraService.ts` | fallback `http://localhost:5050/api` |
   | `frontend/src/utils/assetUrl.ts` | fallback `http://localhost:5050/api` |
   | `ai-service/app/config.py` | `backend_url` → `http://127.0.0.1:5050` |
   | `ai-service/.env.example` | `AI_SERVICE_BACKEND_URL=http://127.0.0.1:5050` |

   Note the split *inside the frontend*: with `VITE_API_BASE_URL` unset, API
   calls would go to port 5000 while the Socket.IO connection, the MJPEG
   stream URL and the `/uploads` image URLs would go to 5050. Setting
   `VITE_API_BASE_URL` (which `frontend/.env.example` instructs you to do)
   makes all four read the same value, so this only bites when `.env` is
   missing. It was left alone deliberately: the user's own `backend/.env` and
   `frontend/.env` already exist with values this audit must not read or
   change, so silently moving a default could break a working setup. **Pick one
   port — 5050 is what the README, the AI service and the docs assume — and set
   it explicitly in `backend/.env` (`PORT=5050`) and `frontend/.env`
   (`VITE_API_BASE_URL=http://localhost:5050/api`).**

2. **`backend/package.json` pinned `nodemon` at `^1.14.10`**, a 2018 release,
   where current is 3.x. This was **not** a pre-existing condition as
   originally recorded here: the file pinned `^3.1.4` before this session's
   work began, and the downgrade was introduced by agent work during the
   Review 2 / Review 3 implementation. The pin has since been reverted to
   `^3.1.4`. It affects `npm run dev` only, never `npm start`, `npm test` or
   the production path. `node_modules` still contains 1.14.10, so `npm
   install` must be re-run for the revert to take effect.

3. **`frontend/src/pages/LiveMonitoringPage.tsx` uses the bare `React`
   namespace** in one type position (`icon: React.ReactNode` on the local
   `Metric` component) without importing React, while the rest of the file
   imports named hooks only. TypeScript permits a type-only reference to the
   UMD global namespace from inside a module, so this is a style inconsistency
   rather than an error, and it was left as-is. If `tsc` ever reports TS2686
   here, the fix is to add `import type { ReactNode } from 'react'` and use
   `ReactNode`, matching every other component in the codebase.

---

## 5. What static resolution does and does not prove

Reading every import and confirming the named export exists is **not** a
substitute for compiling or running the code. It proves only that the module
graph is internally consistent and that every referenced name is declared
somewhere.

It cannot and does not detect:

* **Type errors beyond name resolution.** Assignability, variance, inference
  failures, narrowing gaps, excess-property checks and `noUnusedLocals`
  violations are decided by `tsc`, which has never run. The frontend section
  above checks that names and prop unions line up; it does not claim `tsc`
  would emit zero diagnostics.
* **Runtime behaviour of any kind.** Logic errors, off-by-one errors, wrong
  thresholds, race conditions, incorrect Mongo query semantics (as opposed to
  misspelled field names) and incorrect async ordering are all invisible to
  this method.
* **Whether the unique `{personId, date}` index actually builds.** If
  `attendances` already contains duplicate pairs, `ensureCriticalIndexes()`
  will mark duplicate prevention unverified and `attendanceService` will refuse
  every attendance write. Only a real MongoDB connection can tell you which
  way it goes. `npm run dedupe:attendance` is the remediation.
* **Whether any model file loads.** Both ONNX face models and `yolov8n.pt` are
  gitignored and fetched by `python download_assets.py`. Nothing here confirms
  they are present or that OpenCV in the installed environment actually
  provides `cv2.FaceDetectorYN` and `cv2.FaceRecognizerSF`.
* **Python import-time failures.** Missing packages, version conflicts and
  pydantic validation errors at `Settings()` construction would all surface
  only on an actual import.
* **Whether the two services can authenticate to each other.** That requires
  `AI_INGEST_SECRET` (backend) to equal `AI_SERVICE_INGEST_SECRET`
  (ai-service), with both services running.

### First real run: the checks to perform, in order

Once a shell is available, run these and record the real output. Until then,
treat every line of this document as an audit note, not a test result.

```bash
# 1. Backend syntax + unit tests (no MongoDB needed for the rule tests)
cd backend && node --check src/server.js && npm test

# 2. Frontend typecheck, then the production build
cd ../frontend && npm run lint && npm run build

# 3. AI service: import check, then unit tests
cd ../ai-service && python -m compileall app && python -m unittest discover -s tests -v

# 4. Services up, in this order
mongod --version                     # MongoDB must be running first
cd ../ai-service && uvicorn app.main:app --reload
cd ../backend && npm run seed && npm run seed:cameras && npm run dev
cd ../frontend && npm run dev

# 5. Health, from a second terminal
curl -s http://127.0.0.1:8000/api/health
curl -s http://127.0.0.1:5050/api/health
```

Watch the backend's startup log specifically for
`Attendance duplicate-prevention index verified (unique personId + date)`. If
that line is absent, attendance writes are disabled and the preceding error
line says why.

---

## 6. FEAT-002 · occupancy monitoring — verification attempts

Appended by the occupancy feature. Section 1 above still stands; nothing below
changes it.

### 6.1 Commands attempted

Both commands in this feature's verification list were attempted **exactly
once**, and both failed at the OS sandbox layer *before* the command ran. They
are recorded as **not executed**. Neither is reported as passing.

| Command | Attempted | Result | Verbatim output |
| --- | --- | --- | --- |
| `cd /Users/ayuxhdas/camsense-ai/backend && npm test` | yes, once | **blocked — not executed** | `sandbox-exec: sandbox_apply: Operation not permitted` · Exit Code 71 |
| `cd /Users/ayuxhdas/camsense-ai/ai-service && python -m compileall app` | yes, once | **blocked — not executed** | `sandbox-exec: sandbox_apply: Operation not permitted` · Exit Code 71 |
| `echo hello` (sanity check that the shell itself is unavailable) | yes, once | **blocked** | `sandbox-exec: sandbox_apply: Operation not permitted` · Exit Code 71 |
| `ls -1 backend/test/` | yes, once | **blocked** | `sandbox-exec: sandbox_apply: Operation not permitted` · Exit Code 71 |
| `wc -l docs/REVIEW3-VERIFICATION.md` | yes, once | **blocked** | `sandbox-exec: sandbox_apply: Operation not permitted` · Exit Code 71 |

**No test, build, typecheck, byte-compile or service start was performed for
this feature.** The occupancy code has never been executed.

### 6.2 Static verification substitute — imports and named exports

Every import added by this feature was checked by opening the target file and
confirming the named binding is actually exported there.

| Importer | Imported from | Names | Confirmed |
| --- | --- | --- | --- |
| `services/occupancyService.js` | `models/Room.js` | `Room` | yes |
| | `models/RoomOccupancyState.js` | `RoomOccupancyState` | yes |
| | `models/Occupancy.js` | `OccupancyReading` | yes |
| | `models/Camera.js` | `Camera` | yes |
| | `models/Alert.js` | `Alert` | yes |
| | `config/env.js` | `env` | yes |
| | `config/db.js` | `getOccupancyIndexState` | yes (added in this feature) |
| | `sockets/index.js` | `emit`, `SocketEvents` | yes |
| | `utils/logger.js`, `utils/ApiError.js` | `logger`, `ApiError` | yes |
| | `services/occupancyRules.js` | `aggregateRoomCount`, `deriveOccupancyStatus`, `isValidCount`, `normalizeHistoryPaging`, `parseDateRange`, `shouldPersistReading`, `shouldRaiseOccupancyAlert`, `OCCUPANCY_STATUS_LABELS` | all 8 exported |
| `controllers/roomController.js` | `services/identityRules.js` | `escapeRegex`, `toQueryString` | yes |
| | `services/occupancyService.js` | `serializeRoomState` | yes |
| | `utils/asyncHandler.js` | `asyncHandler` | yes |
| `controllers/occupancyController.js` | `services/occupancyService.js` | `listCurrent`, `listHistory`, `roomSummary` | yes |
| `routes/roomRoutes.js` | `middleware/auth.js` | `requireAuth`, `requireRole` | yes |
| | `middleware/validate.js` | `validate` | yes |
| | `controllers/roomController.js` | `listRooms`, `getRoom`, `createRoom`, `updateRoom`, `deleteRoom`, `roomSchema`, `roomUpdateSchema` | all 7 exported |
| `routes/occupancyRoutes.js` | `controllers/occupancyController.js` | `getCurrentOccupancy`, `getOccupancySummary`, `getOccupancyHistory` | yes |
| `routes/aiRoutes.js` | `controllers/aiController.js` | `ingestOccupancyReport` | yes (added) |
| | `middleware/internalAuth.js` | `requireInternalSecret` | yes |
| `config/db.js` | `models/Room.js`, `models/RoomOccupancyState.js`, `models/Occupancy.js` | `Room`, `RoomOccupancyState`, `OccupancyReading` | yes |
| `utils/seedRooms.js` | `config/db.js` | `connectDatabase`, `disconnectDatabase` | yes |
| `test/review3-occupancy.test.js` | `services/occupancyRules.js` | 9 names | all exported |

`services/occupancyRules.js` imports **nothing**, mirroring
`services/identityRules.js`, so the new test file pulls in no mongoose, no env
and no logger.

AI service, same method:

| Module | Reads | Confirmed |
| --- | --- | --- |
| `services/stream_manager.py` | `settings.occupancy_enabled`, `occupancy_track_ttl`, `occupancy_min_track_hits` | declared in `app/config.py` |
| | `face_service.bbox_iou`, `YoloModel.instance().available` | already imported in this module |
| `services/event_reporter.py` | `settings.occupancy_enabled`, `occupancy_report_interval`, `backend_url`, `ingest_secret`, `report_timeout` | all declared |
| `api/routes.py` | `worker.occupancy_count`, `worker.occupancy_available`, `worker.occupancy_age_seconds`, `reporter.dropped_reports('occupancy', id)` | all declared on `_CameraWorker` / `EventReporter` |
| `api/routes.py` → `StreamStats(...)` | `occupancy`, `occupancy_available`, `occupancy_age_seconds`, `occupancy_reports_dropped` | all declared in `app/models/schemas.py` |

The new occupancy stats fields are returned from the **existing**
`@secured.get("/stream/{camera_id}/stats")` handler — no new AI-service route
was added, so the `router.include_router(secured)` merge at the bottom of
`api/routes.py` is untouched and still the last statement in the module.

### 6.3 Static verification substitute — Mongoose field usage

Every field name used in a query filter, projection, `$set` or `$setOnInsert`
in `occupancyService.js` and `roomController.js` was checked against the schema
that declares it.

| Query / write | Fields | Declared in |
| --- | --- | --- |
| `Camera.findOne({ cameraId }).select('cameraId name mode')` | `cameraId`, `name`, `mode` | `models/Camera.js` |
| `Room.find({ cameraIds, active })` | `cameraIds`, `active` | `models/Room.js` |
| room fields read | `roomId`, `name`, `description`, `cameraIds`, `capacity`, `occupancyThreshold`, `nearCapacityRatio`, `monitoringEnabled`, `active` | `models/Room.js` |
| `RoomOccupancyState.findOneAndUpdate` `$set` | `count`, `capacity`, `status`, `available`, `source`, `cameras`, `lastUpdatedAt`, `lastReportAt`, `dataQuality` | `models/RoomOccupancyState.js` |
| `RoomOccupancyState.updateOne` `$set` | `lastAlertAt` | `models/RoomOccupancyState.js` |
| `OccupancyReading.findOne(...).select('count status available timestamp')` | `count`, `status`, `available`, `timestamp` | `models/Occupancy.js` |
| `OccupancyReading.create` | `roomId`, `cameraId`, `count`, `capacity`, `status`, `available`, `source`, `trackedIds`, `metadata.perCamera`, `metadata.aggregation`, `metadata.reportedAt`, `dataQuality`, `timestamp` | `models/Occupancy.js` |
| `Alert.create` | `type`, `severity`, `roomId`, `cameraId`, `message`, `status`, `timestamp` | `models/Alert.js` (`roomId` added additively; `occupancy_warning` / `capacity_exceeded` added to the `type` enum) |

Enum values written are all inside their declared enums: statuses
`occupied` / `unoccupied` / `near_capacity` / `capacity_exceeded` /
`camera_unavailable` / `stale`; alert severity `warning`; reading source
`real` / `demo`.

### 6.4 Static verification substitute — route surface

Confirmed by reading the files:

* `backend/src/routes/index.js` really does mount both new routers —
  `router.use('/rooms', roomRoutes)` and `router.use('/occupancy', occupancyRoutes)`.
  The previously commented `/occupancy` placeholder was uncommented, not
  restructured; `/energy`, `/analytics` and `/notifications` remain commented.
* `backend/src/routes/aiRoutes.js` wraps the ingest in the shared-secret guard:
  `router.post('/occupancy', requireInternalSecret, ingestOccupancyReport)`.
* `backend/src/routes/occupancyRoutes.js` registers **GET only** — three routes,
  no `post`/`put`/`patch`/`delete`. There is no client-facing occupancy write
  path anywhere.
* `backend/src/routes/roomRoutes.js` — reads are `requireAuth`; all three
  mutations are `requireAuth` **and** `requireRole('admin')`.

### 6.5 Two pre-existing Review 2 test assertions that had to change

Neither of these could have been caught by FEAT-001's audit, which checked
imports and exports rather than test assertions. Both tests have never run.

1. **`backend/test/review2-routes.test.js`** asserted that `/occupancy` must
   remain **commented out** ("Review 3 must stay unimplemented"). Review 3 has
   now implemented it, so that assertion is obsolete by design. The test was
   updated to assert the opposite — `/rooms` and `/occupancy` are mounted —
   while still requiring `/energy` and `/analytics` to stay commented until
   they are implemented. Three new assertions were added in the same file's
   existing style: the occupancy router is GET-only, the AI occupancy ingest is
   `requireInternalSecret`-gated and not reachable with a browser JWT, and every
   room mutation requires the admin role.

2. **`backend/test/review2-security.test.js`** asserted
   `/syncIndexes\(\)/.test(db) === false` against the *text* of
   `config/db.js`. That pattern already matched the Review 2 **comment** that
   explains why `syncIndexes()` is deliberately not used, so the assertion
   would have failed on its first ever run, before Review 3 touched anything.
   The pattern was tightened to `/\.syncIndexes\(\)/`, which still catches a
   real call (`Attendance.syncIndexes()`) but not prose naming the method being
   avoided. Verified by grep that `config/db.js` contains no `.syncIndexes()`
   call. The other assertions in that test still hold: `Attendance.createIndexes()`,
   `Attendance.collection.indexes()`, `index.key.personId === 1`,
   `index.key.date === 1`, `await ensureCriticalIndexes()`,
   `export function getAttendanceIndexState`, and no `throw new Error(` in
   `db.js`.

### 6.6 What this feature's static check does NOT prove

Everything in section 5 still applies. Specific to occupancy:

* **Nothing confirms the headcount is correct.** The de-duplication rule
  (distinct live person tracks, IoU-associated across consecutive frames, with
  a minimum-hits requirement) is readable and its intent is documented, but it
  has never processed a frame. IoU association will mis-associate when two
  people cross, and the count is a per-camera estimate, not a measurement.
* **Nothing confirms the new indexes build.** If `rooms` or
  `roomoccupancystates` already contained duplicate `roomId` values, or the
  Mongo user cannot create indexes, `ensureOccupancyIndexes()` will mark
  occupancy unverified and `occupancyService` will refuse every occupancy
  **write** while reads keep working. Only a real MongoDB connection can say.
  Watch startup for
  `Occupancy indexes verified (unique roomId on rooms and roomoccupancystates)`.
* **A multi-camera room's count is a documented lower bound, not a total.**
  There is no cross-camera re-identification in this project, so the
  aggregation is a MAX. A room whose cameras cover genuinely different areas
  will under-report. Give a room one camera for an accurate figure.
* **The new `node:test` file has never run.** `backend/test/review3-occupancy.test.js`
  exists and imports only the dependency-free rules module, so it *should* run
  without MongoDB — but that is a claim about the code, not an observed result.

### 6.7 New environment keys (all with code defaults)

Both `.env.example` files were updated with **placeholders and comments only**;
no secret was added, and `backend/.env` and `ai-service/.env` were not read or
written. Every key has a working default in code, so an existing `.env` that
predates Review 3 needs no change.

| Key | Default | Where |
| --- | --- | --- |
| `OCCUPANCY_STALE_AFTER` | `30` (seconds) | `backend/src/config/env.js` |
| `OCCUPANCY_PERSIST_INTERVAL` | `60` (seconds) | same |
| `OCCUPANCY_ALERT_COOLDOWN` | `300` (seconds) | same |
| `OCCUPANCY_HISTORY_MAX_LIMIT` | `500` | same |
| `OCCUPANCY_NEAR_CAPACITY_RATIO` | `0.8` | same |
| `AI_SERVICE_OCCUPANCY_ENABLED` | `true` | `ai-service/app/config.py` |
| `AI_SERVICE_OCCUPANCY_REPORT_INTERVAL` | `5.0` (seconds) | same |
| `AI_SERVICE_OCCUPANCY_MIN_TRACK_HITS` | `2` | same |
| `AI_SERVICE_OCCUPANCY_TRACK_TTL` | `3.0` (seconds) | same |

No npm or pip dependency was added.

### 6.8 Database changes (non-destructive)

* `rooms` — **new** collection. Unique `roomId`, plus `{ cameraIds: 1, active: 1 }`.
* `roomoccupancystates` — **new** collection. Unique `roomId`.
* `occupancies` — **existing** collection name retained deliberately. The thin
  unused foundation-phase placeholder schema was replaced with the real
  reading schema; the legacy `location` field is kept optional so any older
  document still validates. Two new indexes: `{ roomId: 1, timestamp: -1 }` and
  `{ timestamp: -1 }`.
* `alerts` — the `type` enum was extended **additively**. Every existing value
  (`weapon`, `unknown_person`, `unknown_identity`, `intrusion`,
  `camera_offline`, `system`) is retained, so no stored document is
  invalidated. An optional `roomId` field was added.
* Nothing is dropped, renamed or deleted. `createIndexes()` is used, never
  `syncIndexes()`.

---

## 7. FEAT-003 · devices, automation and energy — verification attempts

Appended by the device-control / automation / energy feature. Sections 1 and 6
above still stand; nothing below changes either.

### 7.1 Commands attempted

Both commands in this feature's verification list were attempted **exactly
once**, and both failed at the OS sandbox layer *before* the command ran. They
are recorded as **not executed**. Neither is reported as passing.

| Command | Attempted | Result | Verbatim output |
| --- | --- | --- | --- |
| `cd /Users/ayuxhdas/camsense-ai/backend && npm test` | yes, once | **blocked — not executed** | `sandbox-exec: sandbox_apply: Operation not permitted` · Exit Code 71 |
| `cd /Users/ayuxhdas/camsense-ai/backend && node --check src/services/automationEngine.js` | yes, once | **blocked — not executed** | `sandbox-exec: sandbox_apply: Operation not permitted` · Exit Code 71 |
| `tail -40 docs/REVIEW3-VERIFICATION.md` (incidental, while appending this section) | yes, once | **blocked** | `sandbox-exec: sandbox_apply: Operation not permitted` · Exit Code 71 |

**No test, build, typecheck, syntax check or service start was performed for
this feature.** The device, automation and energy code has never been executed.
In particular, no device has ever been commanded, no automation rule has ever
been evaluated, and no kWh figure has ever been computed by a running process.

### 7.2 Static verification substitute — imports and named exports

Every import added by this feature was checked by opening the target file and
confirming the named binding is actually exported there.

| Importer | Imported from | Names | Confirmed |
| --- | --- | --- | --- |
| `services/deviceService.js` | `models/Device.js`, `models/DeviceStateHistory.js`, `models/AutomationLog.js` | `Device`, `DeviceStateHistory`, `AutomationLog` | yes (all new) |
| | `models/Alert.js`, `models/Room.js` | `Alert`, `Room` | yes |
| | `config/env.js` | `env` (`env.devices.commandTimeoutSec`, `env.automation.manualOverrideMinutes`, `env.energy.historyMaxLimit`) | yes, all three blocks added in this feature |
| | `config/db.js` | `getDeviceAutomationIndexState` | yes (added in this feature) |
| | `services/devices/index.js` | `getAdapter` | yes |
| | `services/devices/adapter.js` | `validateAdapterResult`, `COMMANDABLE_STATES` | yes |
| | `services/automationRules.js` | `isOverrideActive` | yes |
| | `services/occupancyRules.js` | `normalizeHistoryPaging`, `parseDateRange` | yes (reused, not re-implemented) |
| `services/automationEngine.js` | `models/AutomationRule.js`, `models/AutomationLog.js` | `AutomationRule`, `AutomationLog` | yes (both new) |
| | `models/Device.js`, `models/Room.js`, `models/RoomOccupancyState.js`, `models/Alert.js` | `Device`, `Room`, `RoomOccupancyState`, `Alert` | yes |
| | `services/occupancyRules.js` | `deriveOccupancyStatus`, `isOccupancyUsable` | yes |
| | `services/identityRules.js` | `attendanceDateKey` | yes (reused for the energy day key) |
| | `services/automationRules.js` | `decideDeviceAction`, `minutesOfDay`, `updateThresholdMarkers` | yes |
| | `services/deviceService.js` | `issueCommand`, `serializeDevice` | yes |
| | `services/energyService.js` | `rollupDay` | yes |
| `services/energyService.js` | `models/EnergyRecord.js` | `EnergySummary` | yes (new export; `EnergyRecord` kept as an alias) |
| | `services/energyRules.js` | `baselineKwh`, `energyKwh`, `hasUsableHistory`, `onSecondsFromHistory`, `roundKwh`, `savingsKwh`, `savingsPercent`, `windowHours` | all 8 exported |
| | `services/identityRules.js` | `attendanceDateKey` | yes |
| | `services/occupancyRules.js` | `normalizeHistoryPaging`, `parseDateRange` | yes |
| `services/devices/index.js` | `services/devices/adapter.js` | `ADAPTER_TYPES` | yes |
| | `services/devices/simulationAdapter.js` | `simulationAdapter`, `simulationSnapshot`, `setSimulatedFailure`, `isSimulatedFailure`, `resetSimulation` | all 5 exported |
| | `utils/ApiError.js` | `ApiError` | yes |
| `controllers/deviceController.js` | `services/deviceService.js` | `assertRoomExists`, `clearOverride`, `findDeviceOrThrow`, `issueCommand`, `listDeviceHistory`, `listDevices`, `serializeDevice`, `setControlMode`, `setManualOverride`, `syncDeviceState` | all 10 exported |
| | `services/devices/adapter.js` / `index.js` | `ADAPTER_TYPES`, `adapterHealth` | yes |
| `controllers/automationController.js` | `services/deviceService.js` | `assertDevicesExist`, `assertRoomExists` | yes |
| | `services/automationEngine.js` | `automationEngineHealth`, `devicesForRule`, `evaluateRoom` | yes |
| `controllers/energyController.js` | `services/energyService.js` | `byDevice`, `byRoom`, `history`, `summary`, `trend` | all 5 exported |
| `routes/deviceRoutes.js` | `controllers/deviceController.js` | `changeControlMode`, `commandSchema`, `controlModeSchema`, `createDevice`, `deleteDevice`, `deviceSchema`, `deviceUpdateSchema`, `getAdapters`, `getDevice`, `getDeviceHistory`, `listDevicesHandler`, `probeDevice`, `removeOverride`, `sendCommand`, `updateDevice` | all 15 exported |
| `routes/automationRoutes.js` | `controllers/automationController.js` | `createRule`, `deleteRule`, `disableRule`, `enableRule`, `evaluateRule`, `getAutomationHealth`, `getAutomationHistory`, `getRule`, `listRules`, `ruleSchema`, `ruleUpdateSchema`, `updateRule` | all 12 exported |
| `routes/energyRoutes.js` | `controllers/energyController.js` | `getEnergySummary`, `getEnergyHistory`, `getEnergyByRoom`, `getEnergyByDevice`, `getEnergyTrend` | all 5 exported |
| `routes/index.js` | `deviceRoutes.js`, `automationRoutes.js`, `energyRoutes.js` | default exports | yes, all three have `export default router` |
| `config/db.js` | the five new models | `Device`, `DeviceStateHistory`, `AutomationRule`, `AutomationLog`, `EnergySummary` | yes |
| `server.js` | `services/automationEngine.js` | `startAutomationEngine`, `stopAutomationEngine` | yes |
| `services/occupancyService.js` | `services/automationEngine.js` | `onOccupancyUpdated` | yes |
| `utils/seedDevices.js` | `config/db.js` | `connectDatabase`, `disconnectDatabase` | yes |
| `test/review3-automation.test.js` | `services/automationRules.js` | 8 names | all exported |
| | `services/energyRules.js` | 7 names | all exported |
| | `services/devices/*` | `getAdapter`, `isAdapterImplemented`, `simulationAdapter`, `resetSimulation`, `setSimulatedFailure`, `validateAdapterResult` | all exported |

`services/automationRules.js` and `services/energyRules.js` import **nothing**,
mirroring `services/identityRules.js` and `services/occupancyRules.js`. The new
test file asserts that property by reading the files, so a future import there
fails the suite.

**Import-cycle check** (done by hand, since nothing can be executed):
`occupancyService → automationEngine → deviceService → {models, adapter,
automationRules, occupancyRules}` and `automationEngine → energyService →
{models, energyRules, identityRules, occupancyRules}`. Neither `deviceService`
nor `energyService` imports `automationEngine`, and nothing imports
`occupancyService` back, so the graph is acyclic.

### 7.3 Mongoose fields used in a filter, projection or `$set`

Every field referenced in a query was checked against the schema that declares
it.

| Collection | Fields used | Declared |
| --- | --- | --- |
| `devices` | `deviceId`, `name`, `roomId`, `type`, `reportedState`, `desiredState`, `controlMode`, `adapterType`, `simulated`, `connectionStatus`, `lastCommand.*`, `lastSuccessfulStateAt`, `override.*`, `powerRatingWatts`, `active` | yes, all |
| `devicestatehistories` | `deviceId`, `roomId`, `fromState`, `toState`, `changedAt`, `trigger`, `reason`, `ruleId`, `actorId`, `confirmed`, `adapterMessage`, `durationSec` | yes, all |
| `automationrules` | `ruleId`, `name`, `description`, `roomId`, `deviceIds`, `enabled`, `occupancyThreshold`, `unoccupiedForSec`, `switchOffDelaySec`, `switchOnDelaySec`, `allowedHours.start/end`, `commandCooldownSec`, `onUnavailableOccupancy`, `manualOverrideMinutes`, `active` | yes, all |
| `automationlogs` | `ruleId`, `roomId`, `deviceId`, `decision`, `reason`, `occupancyCount`, `occupancyStatus`, `outcome`, `adapterMessage`, `evaluatedAt` | yes, all |
| `energyrecords` (the `EnergySummary` schema) | `date`, `deviceId`, `roomId`, `onSeconds`, `powerRatingWatts`, `energyKwh`, `baselineKwh`, `savedKwh`, `baselineHoursPerDay`, `estimated`, `simulated` | yes, all |
| `roomoccupancystates` | `belowThresholdSince`, `aboveThresholdSince` | **added in this feature** |
| `alerts` | `type: 'device_failure' \| 'automation_failure'`, `severity`, `roomId`, `deviceId`, `message`, `status`, `timestamp` | enum values were already present (FEAT-002); `deviceId` **added in this feature** |

Nullable-with-`min` check, as for occupancy: `AutomationLog.occupancyCount` and
`Device.desiredState` are nullable. `null` is listed explicitly in the
`desiredState` / `lastCommand.state` / `override.state` enums so mongoose
accepts it, and `min: 0` passes a null value.

### 7.4 Authorization surface

| Route | Auth | Admin | Validated |
| --- | --- | --- | --- |
| `GET /api/devices`, `/:id`, `/:id/history`, `/adapters` | yes | — | — |
| `POST /api/devices` | yes | **yes** | `deviceSchema` |
| `PUT /api/devices/:id` | yes | **yes** | `deviceUpdateSchema` |
| `DELETE /api/devices/:id` | yes | **yes** | — |
| `POST /api/devices/:id/command` | yes | **yes** | `commandSchema` |
| `POST /api/devices/:id/control-mode` | yes | **yes** | `controlModeSchema` |
| `POST /api/devices/:id/probe` | yes | **yes** | — |
| `DELETE /api/devices/:id/override` | yes | **yes** | — |
| `GET /api/automation/rules`, `/rules/:id`, `/history`, `/health` | yes | — | — |
| `POST /api/automation/rules` | yes | **yes** | `ruleSchema` |
| `PUT /api/automation/rules/:id` | yes | **yes** | `ruleUpdateSchema` |
| `DELETE /api/automation/rules/:id` | yes | **yes** | — |
| `POST /api/automation/rules/:id/enable` | yes | **yes** | — |
| `POST /api/automation/rules/:id/disable` | yes | **yes** | — |
| `POST /api/automation/rules/:id/evaluate` | yes | **yes** | — |
| `GET /api/energy/summary`, `/history`, `/by-room`, `/by-device`, `/trend` | yes | — | — |

There is **no mutating energy route** — every figure is derived on request, so
there is nothing for a client to submit. `routes/index.js` was confirmed by
reading it to mount `/devices`, `/automation` and `/energy`; `/analytics` and
`/notifications` remain commented placeholders.

Every history endpoint is paginated through `normalizeHistoryPaging` with a
hard maximum (`AUTOMATION_HISTORY_MAX_LIMIT`, `ENERGY_HISTORY_MAX_LIMIT`, both
default 500), so no query string can produce an unbounded read.

### 7.5 The pre-existing test assertion that had to change

`backend/test/review2-routes.test.js` was updated by FEAT-002 to assert that
`/energy` and `/analytics` **must remain commented out**. This feature
implements and mounts `/energy`, so that assertion was obsolete by design and
would have failed. It was updated in the file's existing style:

* the mount test now asserts `/devices`, `/automation` and `/energy` **are**
  mounted alongside `/rooms` and `/occupancy`;
* the still-unimplemented loop was narrowed to `analytics` and `notifications`;
* the test name changed from "…and so are the Review 3 occupancy routers" to
  "…and so are the Review 3 routers".

No other existing assertion was touched. `review2-security.test.js` still holds:
`db.js` contains no `.syncIndexes()` call and no `throw new Error(`, and still
exports `getAttendanceIndexState`.

### 7.6 Safety properties, and where each one is enforced

| Property | Enforced in |
| --- | --- |
| A state change is recorded **only** when the adapter confirmed it | `deviceService.issueCommand` — the single chokepoint; the failure path returns before `device.reportedState` is assigned |
| A failed command raises `device_failure` and leaves the state untouched | same function, failure branch (`confirmed: false` history row + `command_failed` log + alert) |
| Stale/unavailable occupancy switches nothing | `automationRules.decideDeviceAction` step 3, and `isOccupancyActionable`, which rejects a `null` count independently of the flag the engine passes in |
| A camera outage cannot accumulate "unoccupied" time | `automationRules.updateThresholdMarkers` — an unusable reading freezes both clocks |
| An operator's override is not immediately undone | step 2 of the same function; the override carries an explicit `expiresAt` |
| No repeated identical commands, no flapping | the already-in-desired-state short-circuits in steps 6 and 7, plus `skipped_cooldown` in step 5 |
| Automation is off until asked for twice | `Device.controlMode` default `'disabled'` + `AutomationRule.enabled` default `false` |
| Only the simulation adapter can control anything | `services/devices/index.js → getAdapter` throws for every other type |
| Simulation is never presented as hardware | `simulated: true` and a `SIMULATED`-prefixed message from the adapter, carried into `serializeDevice`, `DeviceStateHistory.adapterMessage` and `AutomationLog.adapterMessage` |
| No fabricated energy figure | `energyService` reads only `confirmed: true` transitions and configured wattages; `insufficientData` + `requires` instead of a zero |
| No misleading savings percentage | `energyRules.savingsPercent` returns `null` when the baseline is 0 |
| An automation fault cannot crash the process | `runTick` / `onOccupancyUpdated` try/catch → `automation_failure` alert |
| The interval is cleared on shutdown | `server.js` `shutdown()` calls `stopAutomationEngine()` before `httpServer.close()` |

### 7.7 What this feature's static check does NOT prove

Everything in sections 5 and 6.6 still applies. Specific to this feature:

* **No device has ever been switched, not even a simulated one.** The
  simulation adapter's Map has never held a value in a running process. Every
  claim about the command path, the failure path and the alert is a claim about
  the code as read, not an observed result.
* **No automation rule has ever been evaluated.** The precedence order, the
  delays, the cooldown and the override expiry are readable and unit-testable,
  but the unit test itself has never run.
* **No kWh figure has ever been computed by a running process.** The formula
  `watts × (seconds/3600) / 1000` is implemented in one place and is asserted
  by the new test file, but that file has not executed.
* **Every energy figure is an ESTIMATE even when the code is correct.** There
  is no power meter in this project. kWh is a configured wattage multiplied by
  a recorded duration, and for a simulated device the duration is real elapsed
  time while the "device" was a Map entry. The declared baseline
  (`ENERGY_BASELINE_HOURS_PER_DAY`, default 12) is an assumption, not a
  measurement — a saving quoted without it means nothing.
* **Nothing confirms the three new unique indexes build.** If `devices` or
  `automationrules` already contained duplicates, or the Mongo user cannot
  create indexes, `ensureDeviceAutomationIndexes()` marks the group unverified
  and device commands **and** automation refuse to run while the rest of the
  backend keeps working. Watch startup for
  `Device/automation indexes verified (unique deviceId on devices, ruleId on automationrules, and { date, deviceId } on 'energyrecords')`.
* **The restart behaviour of the threshold clocks is unobserved.** The clocks
  are in memory, keyed by `roomId:threshold`, seeded from the persisted
  `RoomOccupancyState` pair only when the rule's threshold equals the room's;
  for any other threshold the clock starts fresh, which can only *delay* a
  switch-off. That reasoning has not been exercised.
* **`npm run seed:devices` has never run.** It should be idempotent and
  non-destructive by construction (upsert by `deviceId`/`ruleId`, `$setOnInsert`
  for every tunable field, no delete), but that is unverified.

### 7.8 New environment keys (all with code defaults)

`backend/.env.example` was updated with **placeholders and comments only**; no
secret was added, and `backend/.env` was neither read nor written. Every key has
a working default in code, so an existing `.env` needs no change.

| Key | Default | Where |
| --- | --- | --- |
| `DEVICE_COMMAND_TIMEOUT` | `5` (seconds) | `backend/src/config/env.js` → `env.devices` |
| `AUTOMATION_TICK_INTERVAL` | `30` (seconds) | `env.automation` |
| `AUTOMATION_COMMAND_COOLDOWN` | `60` (seconds) | same |
| `AUTOMATION_DEFAULT_UNOCCUPIED_FOR` | `300` (seconds) | same |
| `AUTOMATION_MANUAL_OVERRIDE_MINUTES` | `30` (minutes) | same |
| `AUTOMATION_HISTORY_MAX_LIMIT` | `500` | same |
| `ENERGY_BASELINE_HOURS_PER_DAY` | `12` (hours) | `env.energy` |
| `ENERGY_HISTORY_MAX_LIMIT` | `500` | same |

No npm or pip dependency was added. No MQTT, ESP32 or relay integration was
added, and none is stubbed.

### 7.9 Database changes (non-destructive)

* `devices` — **new** collection. Unique `deviceId`, plus
  `{ roomId: 1, active: 1 }`.
* `devicestatehistories` — **new** collection. `{ deviceId: 1, changedAt: -1 }`
  and `{ roomId: 1, changedAt: -1 }`. This is the sole input to the energy
  analytics, and it is never deleted when a device is removed, so past figures
  stay reproducible.
* `automationrules` — **new** collection. Unique `ruleId`, plus
  `{ roomId: 1, enabled: 1, active: 1 }`.
* `automationlogs` — **new** collection. `{ roomId: 1, evaluatedAt: -1 }` and
  `{ deviceId: 1, evaluatedAt: -1 }`.
* `energyrecords` — **existing** collection name retained deliberately. The
  mongoose model is still named `EnergyRecord`, so the thin unused
  foundation-phase placeholder's collection is not orphaned; the schema is now
  `EnergySummary` and the legacy fields (`location`, `occupancy`,
  `lightStatus`, `fanStatus`, `energyConsumed`, `energySaved`) are retained as
  **optional** — `location` in particular was `required` before and is not any
  more. New unique index `{ date: 1, deviceId: 1 }`, plus
  `{ roomId: 1, date: -1 }`. The collection is a **cache**: everything in it is
  recomputable from `devicestatehistories`.
* `roomoccupancystates` — two optional fields added
  (`belowThresholdSince`, `aboveThresholdSince`). No index change.
* `alerts` — an optional `deviceId` field was added. The `type` enum was
  **not** changed: FEAT-002 had already added `device_failure` and
  `automation_failure` additively.
* Nothing is dropped, renamed or deleted. `createIndexes()` is used, never
  `syncIndexes()`.


Index creation happens automatically at startup. `npm run seed:rooms` creates
one demo room (`ROOM-01`, wired to `CAM-01` and `CAM-02`) by upsert; it deletes
nothing and is safe to re-run.

---

## 8. FEAT-004 · frontend integration, health surface and UI polish

Appended by the system-integration / UI feature. Sections 1–5 (FEAT-001),
6 (FEAT-002) and 7 (FEAT-003) are untouched.

### 8.1 Verification commands attempted

Each command was attempted **exactly once** and was **not** retried. Neither
produced a TypeScript diagnostic, so **no part of this feature has been
type-checked, compiled, bundled or executed.**

| # | Command | Verbatim output | Exit code | Reported as |
|---|---------|-----------------|-----------|-------------|
| 1 | `cd /Users/ayuxhdas/camsense-ai/frontend && npm run lint` (= `tsc --noEmit`) | `sandbox-exec: sandbox_apply: Operation not permitted` | 71 | **not executed** |
| 2 | `cd /Users/ayuxhdas/camsense-ai/frontend && npm run build` (= `tsc -b && vite build`) | `sandbox-exec: sandbox_apply: Operation not permitted` | 71 | **not executed** |

Also attempted and identically blocked (exit 71, same message): `echo hello`,
`ls -R frontend/src/components frontend/src/pages`,
`ls frontend/public`, `wc -l docs/REVIEW3-VERIFICATION.md`.

The failure is at the OS sandbox layer, before the command itself runs, so it
is not a project or dependency problem and nothing in the repository can be
changed to make it succeed.

**No build, typecheck, test or browser render of this feature has happened.**
Every claim below about TypeScript correctness rests on reading declarations by
hand, which is weaker than a compile — see §5.

### 8.2 Static substitute · imports and named exports

Every import added or changed was checked by opening the declaring file and
confirming the named export exists.

| Importer | Imported from | Bindings confirmed |
|---|---|---|
| `EnergyPage.tsx`, `AnalyticsPage.tsx`, `DashboardPage.tsx`, `AlertsPage.tsx`, `SettingsPage.tsx`, the three new modals | `@/components/ui` | `PageHeader`, `Card`, `CardHeader`, `CardBody`, `Button`, `Badge`, `StatusIndicator`, `Input`, `Select`, `Modal`, `ConfirmDialog`, `LoadingState`, `EmptyState`, `ErrorState`, `useToast` — all 15 present in the 16-name barrel |
| `EnergyPage.tsx` | `@/utils/review3` | `automationDecisionLabel`, `automationDecisionTone`, `deviceStateLabel`, `deviceStateTone`, `formatDuration`, `isOccupancyUnknown`, `occupancyStatusTone`, `renderCount` |
| `DashboardPage.tsx` | `@/utils/review3` | `componentStatusIndicator`, `componentStatusLabel`, `isOccupancyUnknown`, `occupancyStatusTone`, `renderCount`, `renderNumber` |
| `AnalyticsPage.tsx` | `@/utils/review3` | `renderCount` |
| pages | `@/services/occupancyService` | `occupancyService`, `roomService` |
| pages | `@/services/deviceService` | `deviceService` |
| pages | `@/services/automationService` | `automationService` |
| pages | `@/services/energyService` | `energyService` |
| `DashboardPage.tsx` | `@/services/healthService` | `healthService` |
| `AppLayout.tsx` | `@/components/layout/Sidebar` | `Sidebar`, `MobileNav` |
| `EnergyPage.tsx` | the three new modals | `RoomFormModal`, `DeviceFormModal`, `AutomationRuleFormModal` |
| all new services | `./apiClient` | `apiClient` |
| `healthController.js` | `../config/db.js` | `getAttendanceIndexState`, `getOccupancyIndexState`, `getDeviceAutomationIndexState` |
| `healthController.js` | services | `aiClient`, `deviceHealth`, `adapterHealth`, `automationEngineHealth` |
| `healthController.js` | models | `Camera`, `AutomationRule` |
| `alertController.js` | models + services | `Room`, `Device`, `parseDateRange` (from `occupancyRules.js`) |
| `dashboardService.js` | models + services | `Device`, `AutomationRule`, `AutomationLog`, `roomSummary` (occupancyService), `summary` (energyService, aliased `energySummary`), `logger` |

`logger.debug` was confirmed to exist in `backend/src/utils/logger.js` before
the two new suppression log lines were written.

### 8.3 Static substitute · every property read off an API response

Each field the UI reads was traced to the backend expression that produces it,
and to the interface that declares it in `frontend/src/types/index.ts`.

| UI field | Backend producer | Type declared |
|---|---|---|
| `room.count` / `status` / `statusLabel` / `available` / `lastUpdatedAt` / `staleAfterSec` | `serializeRoomState()` in `occupancyService.js` | `Room` |
| `statusLabels` | `getCurrentOccupancy()` spreads `OCCUPANCY_STATUS_LABELS` | `OccupancyCurrent.statusLabels` |
| `reading.count` / `status` / `timestamp` / `aggregation` | `listHistory()` in `occupancyService.js` | `OccupancyReading` |
| `device.reportedState` / `desiredState` / `controlMode` / `adapterType` / `simulated` / `adapterImplemented` / `connectionStatus` / `lastCommand.*` / `override.*` / `powerRatingWatts` / `powerRatingConfigured` | `serializeDevice()` in `deviceService.js` | `Device` |
| `adapters.adapters[]` / `adapters.note` | `getAdapters()` + `adapterHealth()` | `AdapterHealth` |
| `rule.enabled` / `occupancyThreshold` / `unoccupiedForSec` / `allowedHours` / `commandCooldownSec` / `onUnavailableOccupancy` / `unavailableDataBehaviour` / `note` / `devicesInAutomaticMode` | `serializeRule()` in `automationController.js` | `AutomationRule` |
| `log.decision` / `reason` / `occupancyCount` / `occupancyStatus` / `outcome` / `adapterMessage` | `getAutomationHistory()` | `AutomationLog` |
| `engine.running` / `tickIntervalSec` / `lastTickAt` / `lastError` / `note` | `automationEngineHealth()` | `AutomationEngineHealth` |
| `energy.totals.*` / `baseline.{hoursPerDay,description,source}` / `insufficientData` / `requires` / `automation.*` / `window.partialDay` | `summary()` in `energyService.js` | `EnergySummary` |
| `trend.days[].{date,energyKwh,baselineKwh,savedKwh}` | `trend()` in `energyService.js` | `EnergyTrend` |
| `byRoom.rooms[].{roomId,energyKwh,savedKwh,contributingDevices}` | `byRoom()` | `EnergyRoomRollup` |
| `byDevice.devices[].{name,energyKwh,savedKwh,insufficientData}` | `byDevice()` | `EnergyDeviceFigures` |
| `health.{overall,overallNote,simulationInUse,components[]}` | `getComponentHealth()` | `SystemHealth`, `ComponentHealth` |
| `alert.{roomId,roomName,deviceId,deviceName,deviceSimulated}` | `withCameraNames()` in `alertController.js` | `Alert` (all optional) |
| `stats.rooms*/devices*/automation*/energy*` | `computeDashboardStats()` | `DashboardStats` (all optional, `number \| null`) |
| `stats.occupancy` / `occupancy_available` / `occupancy_age_seconds` | ai-service `StreamStats`, relayed verbatim by `GET /api/cameras/:id/stats` | `StreamStats` (optional) |

**One shape trap found and handled.** In `energyService.byRoom()` each room is
built as `{ roomId, ...totalsFor(rows), devices: rows.map(...) }`. The explicit
`devices` key comes **after** the spread, so a room's `devices` is the
per-device **array**, not the device **count** that `totalsFor` put there. The
`EnergyRoomRollup` interface therefore uses
`Omit<EnergyTotals, 'devices'>` and redeclares `devices` as an array, and the
by-room chart reads `contributingDevices` for the count. Typing it the obvious
way would have compiled and then produced a wrong number.

**Recognition health field names** were read from
`ai-service/app/models/schemas.py::RecognitionStatusResponse` rather than
guessed: `detector_available`, `embedder_available`, `cache_loaded`,
`cache_size`, `cache_stale`, `cache_age_seconds`. A first draft of
`healthController.js` used a non-existent `identities` field; it was corrected
against the schema.

### 8.4 `PlaceholderPage` is no longer imported anywhere

Confirmed by grep: after `EnergyPage.tsx` and `AnalyticsPage.tsx` were
rewritten, the only match for `PlaceholderPage` in `frontend/src` is its own
declaration in `frontend/src/components/PlaceholderPage.tsx`. Both pages keep
their named exports (`export function EnergyPage()`,
`export function AnalyticsPage()`), their `/energy` and `/analytics` routes in
`AppRoutes.tsx`, and their existing sidebar entries in `navigation.ts` — no nav
item was added or duplicated.

`PlaceholderPage.tsx` itself was **deliberately left in place**: it is now dead
code, but deleting a file requires a shell, which is unavailable. It is
unreferenced, so it cannot render and `noUnusedLocals` does not flag an unused
module. It should be deleted when a shell is available.

### 8.5 UI polish pass — what was changed

Walked every page reachable from `navigation.ts` plus the person-detail and
not-found routes.

| Problem found | Where | Fix |
|---|---|---|
| **No navigation at all below 768px.** The sidebar is `hidden md:flex` and the topbar carries no nav, so every section was unreachable on a narrow window. | `Sidebar.tsx`, `AppLayout.tsx` | Added `MobileNav`, a horizontally scrollable `md:hidden` strip rendered from the **same** `navItems` list, so it cannot drift from the sidebar or duplicate an entry. `main` padding is now `p-4 md:p-6`. |
| **A tall modal was unreachable.** `Modal` had no height cap and no scroll, so the lower fields and the Save button of a long form (the automation-rule form is the worst case) were clipped off the viewport with no way to reach them. | `ui/Modal.tsx` | Panel is now `flex flex-col max-h-[calc(100vh-2rem)]` with a pinned header/footer and a scrolling body. Width (`max-w-lg`) and spacing are unchanged. Also added `aria-labelledby` wired to the title via `useId`. |
| **A fabricated status indicator.** Settings rendered a hardcoded `StatusIndicator label="DEMO"` regardless of reality, next to copy ("Switch between sample video and live camera streams") implying a control that does not exist on that page. | `SettingsPage.tsx` | Replaced with the real picture: AI-service reachability, whether a detection model is actually loaded, the mode the AI service itself reports, and the real DEMO/REAL camera split — with loading and error states and a link to the page where mode is actually configured. |
| **Filter selects with no label.** Two `Select`s on Alerts and one on Live Monitoring had no `label` and no `name`, so they rendered no `<label>` and had no id to associate one with. | `AlertsPage.tsx`, `LiveMonitoringPage.tsx` | Every filter now has a visible label and a `name` (the `Select`/`Input` primitives wire `htmlFor` to it). Icon-only buttons on Alerts gained `aria-label`. |
| **A row that broke at narrow widths.** The alert list row was a non-wrapping flex of five badges plus three buttons. | `AlertsPage.tsx` | `flex-wrap` plus a `min-w-[12rem] flex-1` text column and a wrapping badge group. |
| **An alert row could read "undefined".** Review 3 alerts reference a room or a device, not a camera, so `alert.cameraName` was empty for them. | `AlertsPage.tsx` | The row and the detail modal show whichever reference the alert actually carries, and a device alert carries a SIMULATED badge. |
| **A dead Retry button.** The Analytics occupancy chart's first draft retried by setting the room to the value it already held; React bails out of an identical state update, so the effect would never re-run. | `AnalyticsPage.tsx` | Replaced with a `readingsReload` counter in the effect's dependency list. |
| **A stale footer label.** The sidebar read "v0.1.0 · Foundation" after all three reviews were implemented. | `Sidebar.tsx` | "v1.0.0 · Detection · Identity · Automation". |

Checked and **deliberately left alone**, with the reason:

* **The `apiClient` port-5000 fallback vs the 5050 fallback in `socket.ts`,
  `cameraService.ts` and `assetUrl.ts`.** A real inconsistency, but the user's
  `.env` files already set `VITE_API_BASE_URL`, which collapses all four. The
  new services read the base URL through `apiClient`, so they add no fifth
  fallback. Changing a working deployment's defaults blind, with no way to run
  it, is a worse risk than the inconsistency. FEAT-001 made the same call.
* **The Review 1 and Review 2 pages' `?? 0` rendering** of
  `peopleDetectedToday`, `presentToday`, `totalPeople` and so on. Those
  counters are plain counts the backend always produces; only the Review 3
  counters are nullable, and only those go through `renderNumber`.
* **`PeoplePage`'s bespoke deactivate-vs-delete modal.** It composes the same
  `Modal` + `Button` primitives `ConfirmDialog` is built from because it needs
  two confirm actions, which the single-action `ConfirmDialog` cannot express.
  That is a correct use of the primitives, not a missing confirmation.
* **`LiveMonitoringPage`'s server-side annotation.** It deliberately draws no
  client-side overlay; the boxes are burned into the MJPEG frames by the AI
  service from its own coordinates. Adding a client overlay would risk drawing
  boxes that do not match the model output.
* **`roomController.updateRoom`'s `Object.assign(room, req.body)` without an
  undefined-strip.** FEAT-003 flagged it. It is a pre-existing Review 3
  backend path outside this feature's scope, it has never been executed, and
  changing it without being able to run the route is not an improvement. Worth
  fixing in a dedicated change.
* **The Topbar has no brand mark on mobile.** Cosmetic only; the nav strip
  below it is the functional gap and that is fixed.

### 8.6 What this feature did **not** prove

Everything about runtime and visual behaviour:

* **No TypeScript diagnostic exists for any of it.** `tsc --noEmit` could not
  run. The hand-checks in §8.2–§8.3 catch missing exports and mistyped
  properties; they do **not** catch a JSX type error, a wrong generic, a
  recharts prop signature mismatch, or an exhaustiveness slip.
* **No page has ever rendered.** Nothing was clicked. The modals, the
  confirmation dialogs, the socket patching and the role gating are unexercised.
* **The responsive check was a code read, not a measurement.** Breakpoints
  were reasoned about from the Tailwind classes; no viewport was resized.
* **`GET /api/health/components` has never been called.** Its graceful-
  degradation branches (AI unreachable, recognition unreadable, camera
  collection unreadable) are untested, as are the two new alert cooldowns.
* **The two alert cooldowns suppress an alert, not a record.** Every failure is
  still written to `DeviceStateHistory` / `AutomationLog` / `lastTickError` on
  every occurrence. The suppression itself has never run.
* **Role gating is a UI convenience, not the control.** The admin-only
  controls are hidden for a non-admin, but the enforcement that matters is
  `requireRole('admin')` on the backend route, which is what actually refuses
  the request.

---

## 9. FEAT-005 · tests, the security and reliability audit, documentation and the final report

Appended by the final feature. Sections 1–5 (FEAT-001), 6 (FEAT-002),
7 (FEAT-003) and 8 (FEAT-004) above are untouched.

### 9.1 Command attempts — the five required commands, re-attempted at the end

Each was attempted **exactly once**, after every source edit in Review 3 was
complete, specifically so the record reflects the final state of the tree. None
was retried and none is reported as passing.

| # | Command | Working directory | Attempted | Result | Verbatim output | Exit |
|---|---|---|---|---|---|---|
| 1 | `npm test` | `backend` | yes | **BLOCKED** | `sandbox-exec: sandbox_apply: Operation not permitted` | 71 |
| 2 | `npm run lint` *(= `tsc --noEmit`)* | `frontend` | yes | **BLOCKED** | `sandbox-exec: sandbox_apply: Operation not permitted` | 71 |
| 3 | `npm run build` *(= `tsc -b && vite build`)* | `frontend` | yes | **BLOCKED** | `sandbox-exec: sandbox_apply: Operation not permitted` | 71 |
| 4 | `python -m unittest discover -s tests -v` | `ai-service` | yes | **BLOCKED** | `sandbox-exec: sandbox_apply: Operation not permitted` | 71 |
| 5 | `python -m compileall app` | `ai-service` | yes | **BLOCKED** | `sandbox-exec: sandbox_apply: Operation not permitted` | 71 |

Each was accompanied by the tool note *"This command failed while running with
the OS sandbox enabled. Sandbox restrictions may have contributed; the exact
cause could not be determined."*

Three further commands were attempted during this feature and blocked
identically, which confirms the loss of shell is wholesale rather than
project-specific:

| # | Command | Working directory | Result | Exit |
|---|---|---|---|---|
| 6 | `git status --short` | `camsense-ai` | **BLOCKED** | 71 |
| 7 | `grep -n "baseline\|estimated\|insufficientData\|Math.random" backend/src/services/energyService.js` | `camsense-ai` | **BLOCKED** | 71 |
| 8 | `grep -c "" README.md docs/REVIEW2-REPORT.md` | `camsense-ai` | **BLOCKED** | 71 |

**No test, build, typecheck, lint, byte-compile, service start, HTTP request or
database operation has been executed at any point in Review 3.** The four
backend test files and the AI-service test file are written, present in the
tree, and have never been run.

### 9.2 Test files added by this feature

| File | Runner | Dependencies needed to run it |
|---|---|---|
| `backend/test/review3-energy.test.js` | `node:test` + `node:assert/strict` | none — no MongoDB, no service |
| `backend/test/review3-routes.test.js` | `node:test` + `node:assert/strict` + `node:fs` | none |
| `ai-service/tests/test_review3_occupancy.py` | stdlib `unittest` + `unittest.mock` | `cv2` and `numpy` for the two worker test classes *(skipped with a reason when absent)*; the settings class is checked without them. **No model weights, no network** |

`review3-occupancy.test.js` (FEAT-002) and `review3-automation.test.js`
(FEAT-003) were read first and **extended rather than duplicated**: the energy
file goes further into composition, multi-transition windows and boundary
timestamps, and the routes file covers the configuration-hygiene and
startup/shutdown surface that neither of the earlier files touches.

### 9.3 Static substitute — every import in the new test files resolves

The required check for this feature: confirm each function a new test imports
is actually exported by the module under test, so the suite would **run** rather
than fail on an `ImportError` once a shell exists.

| Test file | Imports | Target | Verified |
|---|---|---|---|
| `review3-energy.test.js` | `baselineKwh`, `energyKwh`, `hasUsableHistory`, `onSecondsFromHistory`, `roundKwh`, `savingsKwh`, `savingsPercent`, `windowHours` | `services/energyRules.js` | All 8 are `export function` declarations in that file — read and confirmed |
| `review3-routes.test.js` | nothing from `src/` — reads source **as text** via `node:fs` | — | No import to resolve. Every `readSrc(...)` path was confirmed to exist by reading the file |
| `test_review3_occupancy.py` | `Detection` | `app/models/schemas.py` | Declared; `type`/`label`/`confidence`/`bbox` required, `source` defaulted — the fixtures supply all four required fields |
| | `stream_manager`, `_CameraWorker` | `app/services/stream_manager.py` | Both present. `_CameraWorker.__init__(camera_id, source, mode)` matches the fixture call; `YoloModel` is a module-level name, so `mock.patch.object(stream_manager, 'YoloModel', fake)` reaches the exact symbol `_update_occupancy` calls |
| | `Settings` | `app/config.py` | `model_fields` carries all four `occupancy_*` keys |

Signature checks that would have broken the suite:

* `_update_occupancy(detections, settings)` — two positional arguments, and the
  only settings attributes it reads are `occupancy_enabled`,
  `occupancy_track_ttl` and `occupancy_min_track_hits`. The test's
  `_OccupancySettings` is a plain object with exactly those three, so an
  unexpected attribute read would raise rather than silently return a truthy
  `Mock`.
* `_update_stats(now, detections, recognitions=None, recognition_due=True)` —
  the `people`-vs-occupancy test calls it with the first three.
* `_person_track_for(bbox)` returns the **track dict** (not an id string, which
  is what the *face* tracker returns), so the track-identity test reads
  `track['id']`.
* `YoloModel.instance().available` — the fake exposes `available` as a property
  and `instance()` as a method returning `self`, matching the call site exactly.
* `face_service.bbox_iou(a, b)` takes two `[x, y, w, h]` boxes, which is
  `Detection.bbox`'s format.

Assertions in `review3-routes.test.js` that depend on exact source text were
each confirmed against the file before being written, rather than guessed:
`deviceUpdateSchema` exists in `deviceController.js` and no `reportedState: z.`
declaration does; both `device.reportedState =` assignments in
`deviceService.js` take `result.reportedState`; `energyService.js` contains
`.limit(env.energy.historyMaxLimit)` and no second derivation of the kWh
formula; all 15 backend and 4 ai-service Review 3 env keys appear in both their
`.env.example` and their config module; `SEED_ADMIN_PASSWORD=ChangeMe123!`
satisfies the placeholder rule via the case-insensitive `changeme` pattern;
`server.js` contains `startAutomationEngine`, `stopAutomationEngine` and
`httpServer.close` in the asserted order; `backend/package.json`'s dependency
set is exactly the ten packages the test lists; and every `npm run` script the
documentation mentions points at a file that exists.

### 9.4 Security and reliability audit — three real defects found and fixed

The full item-by-item record of the user's Feature H checklist is in
[`REVIEW3-REPORT.md`](REVIEW3-REPORT.md) §D.4. Three items required a code
change:

**1. A per-device command race (`backend/src/services/deviceService.js`).**
`issueCommand` is reached from three concurrent paths: the operator route, the
automation tick, and `onOccupancyUpdated()` — which fires on *every* accepted
occupancy report, and two cameras in one room report independently. The
`tickRunning` flag stops two **ticks** overlapping but does nothing about a
tick overlapping an occupancy event, or about two occupancy events overlapping
each other. Every step in `issueCommand` awaits (the adapter call,
`device.save()`, the history write), so two commands for the **same device**
could interleave: both would read the same `previousState` and both would write
a `DeviceStateHistory` row — and those rows *are* the state timeline the energy
arithmetic reads, so a duplicate produces an on-interval that never happened.

Fixed by renaming the body to `issueCommandUnguarded` and adding a thin
exported `issueCommand` that holds an `inFlightCommands` `Set` keyed by
`deviceId`. The second command is **refused**, not queued, with
`{ ok: false, inFlight: true }` and **no** alert and **no** history row —
nothing failed, it simply was not attempted. The entry is always cleared in a
`finally`, so a throwing adapter cannot leak an entry and wedge a device.
`automationEngine` records the refusal as a `no_change` rather than counting a
failure, and `deviceController` returns **409** rather than 502.

**2. An unguarded Python block on the camera thread
(`ai-service/app/services/stream_manager.py`).** `_run` — the worker thread body
— has no top-level `try/except`, so a raise inside the new `_update_occupancy`
would have killed the thread and taken **Review 1 detection, the MJPEG stream
and detection reporting** down with it. Fixed by wrapping `_update_occupancy`
and both `report_occupancy` call sites individually, matching the pattern face
detection and recognition already use in the same loop: a fault marks occupancy
**unavailable** (never 0), prints a diagnostic, and detection carries on.

**3. An unbounded in-memory map
(`backend/src/services/automationEngine.js`).** `markerClocks` is keyed
`roomId:threshold`, so the key space is bounded by configuration rather than by
traffic — but an operator repeatedly editing a rule's threshold would leave one
dead entry per old value for the life of the process. Added
`MARKER_CLOCK_MAX_KEYS = 500` with oldest-first eviction, matching the Review 2
idiom (`UNKNOWN_STATE_MAX_KEYS`, `THROTTLE_MAX_KEYS`). Evicting an entry only
ever **restarts** a clock, which delays a switch-off rather than bringing one
forward — the direction it is safe to be wrong in.

Nothing from the checklist was found and left unfixed. Three items were
**recorded rather than changed**, each with its reason, in §D.4: the port
5000/5050 default inconsistency, the pre-existing `nodemon ^1.14.10` pin, and
`roomController.updateRoom`'s `Object.assign` without an undefined-strip.

### 9.5 The demo reset tool

`backend/src/utils/resetDemoData.js` + `npm run demo:reset`, modelled on
`dedupeAttendance.js`.

| Property | How it is guaranteed |
|---|---|
| **Report-only without `--apply`** | `parseArgs` reads `--apply`; without it the script prints the plan, logs a warning, disconnects and exits before any write |
| **It prints what it would remove, before removing it** | Every count is taken *first*, then tabulated with "would / will" wording |
| **It never touches people, attendance or users** | It does not import `Person`, `Attendance` or `User` at all. A `review3-routes.test.js` assertion enforces this by source text |
| **It never touches cameras** | `Camera` is imported **read-only**, to decide which rooms count as demo |
| **It never deletes configuration** | No `Room`, `Device` or `AutomationRule` document is deleted. A simulated device's transient **state** is reset; its name, room, type, wattage, adapter and control mode are preserved |
| **It never deletes a real-sourced record** | Occupancy readings are filtered on `source: 'demo'`; device history, energy summaries and automation logs are filtered to **simulated** devices; room state is filtered to rooms whose every assigned camera is in `mode: 'demo'` (a camera id that does not resolve is treated as **not** demo — the safe assumption) |
| **The honest reset value** | `RoomOccupancyState` is reset to `count: null` and `camera_unavailable`, **never** to 0 |
| **It tells the operator what it cannot do** | The simulation adapter holds state in memory per process, so the script's own `resetSimulation()` does not clear the running server's copy. It logs a warning to restart the backend, and that automation stays off by design |

### 9.6 Documentation written or extended

| File | Change |
|---|---|
| `README.md` | **Extended in place.** Status paragraph and honesty note now cover Review 3; the roadmap row flipped from *🔜 Planned* to *✅ Done (written, not yet executed)* with the same qualifier the Review 2 row carries; a full "Review 3 — Teach CCTV to UNDERSTAND & ACT" section (modules, the pipeline diagram, the counting rule and its limits, the unavailable-is-not-zero table, history, the adapter architecture, the automation precedence table, the energy methodology with the worked example, env tables, endpoint tables, socket events, collections and indexes, room/device/automation configuration, demo and reset instructions, testing, 25 known limitations, security notes, and the final demonstration checklist); the seed chain in Quick start; the Configuration reference; a Review 3 API overview; and 20 new troubleshooting rows. Review 1 and Review 2 content is untouched |
| `docs/ARCHITECTURE.md` | New §4.1 (the Review 3 ASCII data-flow diagram), §4.2 (the trust-boundary rationale), §4.3 (an ASCII system workflow following one report end to end, including the stale-data case); §5 extended to say occupancy adds no detector; §6 rewritten for the eight Review 3 collections, the two replaced placeholders and the three index groups; §9 updated to state that the AI service gained **no** new route; §10–12 and the development philosophy extended |
| `docs/OCCUPANCY_ENERGY.md` | **New.** The technical companion to `FACE_RECOGNITION.md`: module and interface map, where each honesty rule is enforced, the counting algorithm in pseudocode, the limitations table, the status-derivation table, aggregation, persistence, the automation precedence table, the fail-safe, the adapter contract and the confirm-before-recording flow, the energy arithmetic with the worked example reproduced from the test, insufficient-data handling, and a "what must never be claimed" table |
| `docs/REVIEW3-REPORT.md` | **New.** All six required sections A–F |
| `docs/REVIEW3-VERIFICATION.md` | This section 9 appended |

Every `npm run`, every file path and every endpoint named in the documentation
was checked against the repository. `review3-routes.test.js` additionally
asserts that each documented script exists in `package.json` and points at a
file that is present, so the docs and the tree cannot drift silently.

### 9.7 What this feature did **not** prove

* **Nothing was executed.** The five required commands were attempted and
  blocked; the three test files added here have never run.
* **The static import check is not a behaviour check.** Confirming that
  `energyRules.js` exports `savingsPercent` proves the test will *load*. It
  does not prove the assertion inside it passes — floating-point comparisons,
  the `_person_track_for` IoU arithmetic on synthetic boxes, and the
  TTL-expiry timing in the Python test (which uses real `time.sleep`) are all
  unverified.
* **The source-text assertions in `review3-routes.test.js` are brittle by
  nature.** They prove a guard is *written*, not that it rejects a real
  request, and an innocent refactor will break them. That trade is deliberate
  and is the same one `review2-routes.test.js` and `review2-security.test.js`
  already make; the runtime counterpart does not exist for Review 3 because no
  service has ever started.
* **The three fixes in §9.4 are unexercised.** The in-flight guard has never
  refused a command, the Python `except` branches have never caught anything,
  and the marker-clock eviction has never evicted.
* **`npm run demo:reset` has never run**, in either mode. Its filters were
  checked against the schemas by reading them; no document has been counted or
  removed.
* **No claim of accuracy, energy saving, build success or test success appears
  in any document written by this feature.** That was checked by re-reading
  each one.



