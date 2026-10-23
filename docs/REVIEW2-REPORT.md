# CamSense AI — Review 2 Final Report

**Review 2 — "Teach CCTV to IDENTIFY": person management, face detection, face
embeddings, identity matching, automated attendance, and unknown-identity
alerts.**

Companion documents: [`ARCHITECTURE.md`](ARCHITECTURE.md) (system design),
[`FACE_RECOGNITION.md`](FACE_RECOGNITION.md) (identity-pipeline technical
reference), and the [`README`](../README.md) (setup, configuration, demo).

> ## Read this first
>
> **Review 2 was implemented but never executed.** Shell execution was
> unavailable for the entire implementation: every command, down to
> `echo hello`, failed at the OS sandbox layer with
> `sandbox-exec: sandbox_apply: Operation not permitted` (exit code 71). So no
> test was run, no build or typecheck was run, no dependency was installed, no
> model weight was downloaded, no database was available, and no service was
> started.
>
> Everything below describes code that exists on disk and was verified
> *statically* — every import traced to its definition, every endpoint and
> environment key grepped in the source, every response shape read off the
> actual serializer. **None of it was verified by running it.** §11 is the
> per-command record. **No recognition-accuracy figure is claimed anywhere in
> this report, because no evaluation was performed.**
>
> A semantic review of the finished change returned NEEDS_CHANGES with 13
> findings. All 13 were fixed; §17 lists them individually, and §§5–14 were
> updated to match the changed behaviour. The fix pass could not be executed
> either — the sandbox still blocks every command.

---

## 1. Summary of changes

Review 2 extends the Review 1 application in place. Nothing was rebuilt,
replaced, or forked: the three-service architecture (React → Node/Express →
MongoDB, with Python/FastAPI reached only by the backend) is unchanged, and
every Review 1 route, model, page and detector is still present with unchanged
behaviour.

What was added, service by service:

- **AI service** gained an identity layer alongside — never inside — the Review 1
  YOLO detector path: a new `app/recognition/` package with load-once YuNet and
  SFace model wrappers, an alignment-and-embedding function, cosine matching
  against a cached identity matrix, a `FaceDetector` that reports presence only,
  three new HTTP endpoints, and a recognition leg in the per-camera stream
  worker that runs at a *lower* cadence than object detection.
- **Backend** gained the trust boundary: person CRUD with admin-gated mutations,
  face enrollment that delegates embedding generation to the AI service, a
  trusted recognition-ingest workflow that independently re-verifies every
  identity claim, database-enforced attendance duplicate prevention, recognition
  events, unknown-identity alerts folded into the *existing* alert system, and
  one shared-secret endpoint that emits embeddings to the AI service and to
  nothing else.
- **Frontend** gained a real People module (list, register, face enrollment,
  edit, detail) and a real Attendance dashboard — both replacing
  `PlaceholderPage` — plus recognition overlays and an extended service-status
  panel in Live Monitoring, `unknown_identity` presentation on the existing
  Alerts page, Review 2 KPIs on the Dashboard, and a dependency-free Toast
  primitive.

Three constraints shaped the implementation and are worth stating up front:

1. **Zero new dependencies.** No pip package, no npm package. Face recognition
   runs on the already-pinned `opencv-python-headless==4.10.0.84`; the tests use
   Node's built-in `node:test` and Python's stdlib `unittest`.
2. **The backend never trusts a client or the AI service.** A browser cannot
   assert an identity or create an attendance record — there is no route for it.
   The backend re-checks the person's eligibility and the similarity threshold
   itself before persisting anything.
3. **Review 3 was not implemented.** See §16.

---

## 2. New features implemented

| Feature | Behaviour |
|---|---|
| Person management | Create, search, filter (category / recognition / active), edit, enable or disable recognition, deactivate, or hard-delete. All mutations require the `admin` role. |
| Face registration | Stepwise enrollment: details → upload photograph → validate → register → confirm. Requires exactly one usable face. An embedding is stored **only** on an `OK` outcome; otherwise the person stays visibly not recognition-ready. |
| Face detection | YuNet reports face presence, location and 5 landmarks through the existing `Detector` interface, so face boxes travel the same pipeline and overlay path as human/weapon boxes. It never attaches identity. |
| Face embeddings | `alignCrop` (using YuNet's landmarks) → SFace → 128-d vector → L2-normalized. One code path shared by enrollment and live frames. |
| Identity matching | Cosine similarity against a cached stacked matrix of enrolled identities, in a single dot product, gated by a configurable threshold. Below threshold is `UNKNOWN`, even for the closest candidate. |
| Automated attendance | One record per person per calendar date, created only by the trusted recognition workflow after independent re-verification. |
| Duplicate prevention | A unique compound index plus a single atomic upsert, with the concurrent-insert `E11000` path handled. |
| Unknown-identity alerts | Temporal persistence then per-camera cooldown, raised through the **existing** `Alert` model and Alerts page at `severity: 'warning'`, never `critical`. |
| Recognition events | Every outcome worth persisting is stored as a `RecognitionEvent` and is readable through a GET-only API. |
| Honest service status | Face detection, face recognition and the attendance-reporting leg each appear as a real detector status entry: ACTIVE / INACTIVE / UNAVAILABLE / ERROR, never optimistic. |
| Real-time updates | Four new Socket.IO events, carrying only ids, names, similarity, bbox, status and a snapshot URL — never an embedding, never image bytes. |
| Graceful degradation | With the ONNX weights absent, the AI service still starts, YOLO human/weapon detection still works, and the identity layer reports itself unavailable. |

---

## 3. Files and modules modified

### AI service

**New**

- `ai-service/app/recognition/__init__.py`
- `ai-service/app/recognition/face_model.py` — `FaceDetectorModel`, `FaceEmbedderModel` (the only places `cv2.FaceDetectorYN` / `cv2.FaceRecognizerSF` are constructed)
- `ai-service/app/recognition/face_service.py` — detection, embedding, similarity, matching, registration, per-frame recognition, status
- `ai-service/app/recognition/embedding_cache.py` — thread-safe enrolled-identity cache
- `ai-service/app/recognition/face_detection.py` — `FaceDetector(Detector)`
- `ai-service/app/api/security.py` — `require_service_secret`, the shared-secret FastAPI dependency (constant-time, fail-closed)
- `ai-service/tests/test_face_recognition.py` — 37 test methods across 8 `TestCase` classes
- `ai-service/tests/test_review2_fixes.py` — 24 test methods across 7 `TestCase` classes (post-review fix pass; see §17)

**Modified**

- `ai-service/app/config.py` — fifteen Review 2 settings; the bind address now defaults to `127.0.0.1`
- `ai-service/app/main.py` — lifespan initialises both face models; identity prefetch failure is non-fatal
- `ai-service/app/api/routes.py` — `POST /api/faces/register`, `POST /api/faces/cache/refresh`, `GET /api/faces/status`; every route except `/api/health` moved onto the secret-gated `secured` router
- `ai-service/app/models/schemas.py` — `FaceBox`, `FaceRecognitionResult`, `FaceRegistrationRequest`, `FaceRegistrationResponse`, `RecognitionStatusResponse` (incl. `cache_stale`); extended `SystemStatus` and `StreamStats`
- `ai-service/app/recognition/embedding_cache.py` — `is_stale()`, non-blocking background refresh, single in-flight refresh
- `ai-service/app/services/pipeline.py` — `FaceDetector` registered; `annotate()` draws identity labels only for threshold-clearing results, and withdraws names entirely once the identity cache is past its TTL
- `ai-service/app/services/stream_manager.py` — face detection and recognition both on every *N*th processed frame, individually `try/except`-wrapped; transient bbox-IoU track handle; new counters
- `ai-service/app/services/event_reporter.py` — `report_recognition()` on its own rate limiter; both legs POST from background threads with an in-flight cap
- `ai-service/app/detection/base.py` — docstring only (documents the `inactive` / `error` status values)
- `ai-service/download_assets.py` — `fetch_face_models()` for both ONNX files
- `ai-service/requirements.txt` — **no package added or removed**; the obsolete `# face-recognition==1.3.0` placeholder was replaced with the real rationale
- `ai-service/.env.example` — all new keys, no secret values, loopback bind

### Backend

**New**

- `backend/src/models/RecognitionEvent.js`
- `backend/src/services/identityRules.js` — pure, dependency-free decision rules
- `backend/src/services/personService.js`
- `backend/src/services/attendanceService.js`
- `backend/src/services/recognitionService.js`
- `backend/src/controllers/personController.js`
- `backend/src/controllers/attendanceController.js`
- `backend/src/controllers/recognitionEventController.js`
- `backend/src/routes/peopleRoutes.js`
- `backend/src/routes/attendanceRoutes.js`
- `backend/src/routes/recognitionEventRoutes.js`
- `backend/test/smoke.test.js` (3 cases), `backend/test/review2-identity.test.js` (44 cases), `backend/test/review2-routes.test.js` (7 cases), `backend/test/review2-security.test.js` (12 cases)

**Modified**

- `backend/src/models/Person.js` — `email` (sparse unique), `category`, `active`, `registeredAt`, `embeddingModel`, `embeddingDim`, `faceRegisteredAt`; `faceEmbedding` made `select: false` plus a `toJSON`/`toObject` transform that deletes it; search and filter indexes
- `backend/src/models/Attendance.js` — `source`, `recognitionEventId`, `similarity`, `sessionKey`; the pre-existing unique `{ personId, date }` index preserved
- `backend/src/models/Alert.js` — `unknown_identity` added to the type enum; `unknown_person` retained
- `backend/src/config/env.js` — the `recognition` block, plus a loopback `host` default
- `backend/src/config/db.js` — `ensureCriticalIndexes()`: builds and verifies the unique attendance index, refusing to start without it
- `backend/src/app.js` — `/uploads` moved behind `requireAuthQueryOrHeader`
- `backend/src/server.js` — binds `env.host` (loopback by default) and warns when it is widened
- `backend/.env.example` — the new keys with placeholder values
- `backend/src/services/aiClient.js` — `registerFace`, `refreshFaceCache`, `getFaceStatus`; the `x-ai-secret` credential attached to every AI-service call
- `backend/src/services/identityRules.js` — `toQueryString`, `cooldownElapsed`, `interpretUpsertResult`, `isPersistableRecognitionStatus`; `validateIdentityClaim` gained the `expectedModel` check
- `backend/src/services/recognitionService.js` — known-event cooldown, empty-roster suppression, model metadata passed at the trust boundary
- `backend/src/services/attendanceService.js` — throttle recorded after the write and pruned by date
- `backend/src/controllers/{attendanceController,recognitionEventController,detectionController,alertController}.js` — query values coerced before they reach a Mongo filter
- `backend/src/services/dashboardService.js` — `totalPeople`, `recognitionEnabledPeople`, `presentToday`, `unknownIdentitiesToday` (additive)
- `backend/src/sockets/index.js` — four new event names
- `backend/src/controllers/aiController.js` — recognition ingest, embeddings list, extended status
- `backend/src/routes/aiRoutes.js` — `POST /recognition`, `GET /face-embeddings`
- `backend/src/routes/index.js` — Review 2 mounts uncommented; Review 3 mounts left commented out
- `backend/src/utils/snapshot.js` — optional `subdir`, `parseImageDataUrl`, `removeStoredImage` (extended, not duplicated)
- `backend/package.json` — one line: `"test": "node --test test/"`

### Frontend

**New**

- `frontend/src/components/ui/Toast.tsx`
- `frontend/src/components/PersonFormModal.tsx`
- `frontend/src/components/FaceRegistrationStep.tsx`
- `frontend/src/pages/PersonDetailPage.tsx`
- `frontend/src/services/peopleService.ts`, `attendanceService.ts`, `recognitionService.ts`

**Rewritten from placeholder to real page**

- `frontend/src/pages/PeoplePage.tsx`
- `frontend/src/pages/AttendancePage.tsx`

**Modified**

- `frontend/src/types/index.ts` — Review 2 types; `DetectorStatus` union widened; `DashboardStats` / `StreamStats` extended with optional fields
- `frontend/src/services/socket.ts` — the four new event names
- `frontend/src/components/ui/index.ts` — Toast export
- `frontend/src/App.tsx` — `ToastProvider` mounted
- `frontend/src/routes/AppRoutes.tsx` — nested `people/:id` route
- `frontend/src/pages/LiveMonitoringPage.tsx` — extended AI System panel, Identity Results panel, recognition-event seeding, explicit "Detection confidence" label
- `frontend/src/pages/AlertsPage.tsx` — `unknown_identity` presentation, recognition status, plain-language caveat
- `frontend/src/pages/DashboardPage.tsx` — three Review 2 KPI tiles; widened detector-status mapping
- `frontend/src/utils/assetUrl.ts` — appends the signed-in user's token, since `/uploads` is now authenticated and an `<img>` cannot send a header

### Documentation

- `README.md` — Review 2 section added (nothing deleted; the Review 1 honesty note about firearms is preserved verbatim)
- `docs/ARCHITECTURE.md` — sections 5, 6, 9 and the results section refreshed
- `docs/FACE_RECOGNITION.md` — new
- `docs/REVIEW2-REPORT.md` — this document

### Deliberately untouched

Review 1 controllers (`camera`, `auth`, `dashboard`, `health`),
`eventService.js` (imported from only), the auth and validation middleware, the
Review 1 route files, `Camera.js` / `Detection.js` / `User.js`,
`frontend/src/routes/navigation.ts`, `CameraFormModal.tsx`, `CamerasPage.tsx`,
`tailwind.config.js`, and `PlaceholderPage.tsx` — which is still used by the
Review 3 Energy and Analytics pages.

`app.js`, `server.js`, `detectionController.js` and `alertController.js` were
untouched by the original implementation and were edited only by the
post-review fix pass (§17), for the `/uploads` gate, the loopback bind, and the
query-value coercion that Review 1's read filters needed too.

**Nothing was committed.** Git could not run in this environment, so all of the
above sits uncommitted in the working tree on branch `main`.

---

## 4. New database models and indexes

| Collection | Model | Key fields |
|---|---|---|
| `people` | `Person` | `personId`, `name`, `email`, `category`, `department`, `role`, `photo`, `recognitionEnabled`, `active`, `registeredAt`, `faceEmbedding` (**protected**), `embeddingModel`, `embeddingDim`, `faceRegisteredAt` |
| `attendances` | `Attendance` | `personId`, `date`, `sessionKey`, `cameraId`, `firstSeen`, `lastSeen`, `status`, `source`, `similarity`, `recognitionEventId` |
| `recognitionevents` | `RecognitionEvent` | `cameraId`, `personId`, `personName`, `status`, `similarity`, `boundingBox`, `snapshot` (URL reference), `trackId`, `source`, `acknowledged`, `alertId`, `timestamp` |

Indexes:

| Collection | Indexes |
|---|---|
| `people` | `personId` unique · `email` unique **sparse** · `name` · `category` · `recognitionEnabled` · `active` · `{ category, active }` |
| `attendances` | **`{ personId, date }` unique** ← the duplicate-prevention mechanism · `{ date, personId }` · `personId` · `source` |
| `recognitionevents` | `cameraId` · `personId` · `status` · `timestamp` · `{ cameraId, timestamp: -1 }` |

Mongoose declares these on model registration, and `config/db.js` builds them
explicitly at startup (`syncIndexes()`) and then VERIFIES that a *unique* index
exists on exactly `{ personId: 1, date: 1 }`, refusing to start the backend if
it does not — duplicate attendance prevention depends on that index, and an
implicitly created index can fail silently. There is no separate migration
step. `Alert` and `Detection` were extended in place rather than replaced —
`Alert.type` gained `unknown_identity` (and kept `unknown_person`, because
removing an enum value would invalidate already-stored documents), and
`Detection.type` already contained `face`.

`Person.faceEmbedding` is protected two ways: `select: false`, so it is excluded
from every query unless explicitly requested with `.select('+faceEmbedding')`,
and a `toJSON` / `toObject` transform that deletes it, so it cannot leak through
an over-selecting query. Client-facing payloads are additionally built by a
field whitelist (`serializePerson`).

`Occupancy`, `EnergyRecord` and `Notification` remain **unwired Review 3
scaffolding**. No Review 2 code reads or writes them.

---

## 5. New API endpoints

### Backend (operator-facing, JWT required)

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/api/people` | JWT | search, category, recognition and active filters; paginated |
| `POST` | `/api/people` | JWT + **admin** | 409 on a duplicate `personId` |
| `GET` | `/api/people/:id` | JWT | resolves by `_id` **or** `personId` |
| `PUT` | `/api/people/:id` | JWT + **admin** | |
| `PATCH` | `/api/people/:id/recognition` | JWT + **admin** | enable / disable recognition |
| `DELETE` | `/api/people/:id` | JWT + **admin** | `?deactivate=true` deactivates instead of deleting; a hard delete also clears the embedding and removes the stored photo |
| `POST` | `/api/people/:id/face-registration` | JWT + **admin** | JSON body with a base64 image data URL |
| `GET` | `/api/attendance` | JWT | date, person, camera, department, category, status, search; paginated |
| `GET` | `/api/attendance/summary` | JWT | registered as a separate route *before* `/:id` |
| `GET` | `/api/attendance/:id` | JWT | |
| `GET` | `/api/recognition-events` | JWT | camera, status, person and date-range filters |
| `GET` | `/api/recognition-events/:id` | JWT | |

The attendance and recognition-event routers are **GET-only by design.** There
is deliberately no client-facing `POST /api/attendance`: attendance records and
verified-identity events are created solely by the trusted recognition workflow.

### Backend (service-to-service, `x-ai-secret` shared secret)

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/ai/recognition` | The only write path for recognition events and attendance |
| `GET` | `/api/ai/face-embeddings` | **The only endpoint in this API that emits embeddings.** Never reachable from the browser. (On the AI service, `POST /api/faces/register` also returns a vector — see below — and is gated by the same secret; those two are the complete set) |

`GET /api/ai/status` (JWT, Review 1) was extended additively with the
recognition and attendance service state, degrading gracefully when the AI
service is unreachable.

Stored images are served at `/uploads/...` behind `requireAuthQueryOrHeader`
(JWT in the header, or in a `token` query parameter for `<img>` tags). That
mount covers detection snapshots, cropped unknown-face snapshots and
registration portraits; anonymous callers get 401.

### AI service (called by the backend only, never by the browser)

**Every route below requires the `x-ai-secret` shared service secret**, verified
in constant time and failing closed (503) when no secret is configured.
`GET /api/health` is the only unauthenticated route on this service.

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/faces/register` | 200 with a structured `INVALID_IMAGE` / `NO_FACE` / `MULTIPLE_FACES` / `LOW_QUALITY` / `OK` outcome; 401 without the secret; 503 when the models are unavailable. Returns the generated embedding for the backend to store |
| `POST` | `/api/faces/cache/refresh` | Invalidates the identity cache and returns the resulting candidate count (synchronous, so the backend learns whether it succeeded) |
| `GET` | `/api/faces/status` | Honest readiness: model availability, embedding dim, model names, threshold, cache size, `cache_stale`, and last error |

The Review 1 stream and status routes on this service now require the same
secret — an inherited missing guard is still a missing guard — and the backend's
`aiClient` sends it on every call, including the MJPEG proxy.

`GET /api/health` and `GET /api/status` were extended additively only — no field
was renamed or removed, because the backend and frontend already consume them.

### New Socket.IO events

`person:recognized`, `identity:unknown`, `attendance:marked`,
`recognition:status`. All four names are value-for-value identical in
`backend/src/sockets/index.js` and `frontend/src/services/socket.ts`. Payloads
carry only ids, names, similarity, bbox, status and a snapshot URL reference —
never an embedding, never raw image data.

---

## 6. Face-recognition model and dependencies

| Role | Model | File | Size |
|---|---|---|---|
| Face detection + 5 landmarks | YuNet, via `cv2.FaceDetectorYN` | `models/face_detection_yunet_2023mar.onnx` | ~230 KB |
| Face embedding (128-d) | SFace, via `cv2.FaceRecognizerSF` | `models/face_recognition_sface_2021dec.onnx` | ~37 MB |

**Dependencies added: none.** Both classes ship inside the already-pinned
`opencv-python-headless==4.10.0.84` (`dnn` / `objdetect`). No pip package and no
npm package was added anywhere in Review 2.

Why this pair was chosen:

- It introduces **zero** new installable dependencies, which matters because no
  install could be performed in this environment at all.
- It runs on CPU and is compatible with the existing `numpy<2` pin.
- YuNet returns exactly the 5 facial landmarks that
  `cv2.FaceRecognizerSF.alignCrop` consumes, so the pipeline performs genuine
  face **alignment** rather than a naive crop.
- It keeps the project on **one** vision library instead of layering several
  overlapping recognition stacks.

Why the alternatives were rejected *in this environment*:

- `face-recognition` / dlib — requires a native dlib compile with no wheel for
  this platform/Python combination. The stale `# face-recognition==1.3.0`
  placeholder comment in `requirements.txt` was removed for this reason.
- `insightface` — requires a native/Cython build step.
- `deepface` — pulls TensorFlow, which conflicts with the CPU torch stack
  `ultralytics` installs and with the `numpy<2` pin.

The same rationale is recorded in the module docstring of
`ai-service/app/recognition/face_model.py`.

**Neither ONNX file is present in this environment** and neither could be
downloaded. `python download_assets.py` fetches both from the OpenCV Zoo into
`models/` at the repository root, skips files already present, and fails softly
with the exact target path so a file can be placed by hand. `.gitignore` already
excludes `models/*.onnx`, so the weights stay out of git.

---

## 7. How embeddings are generated and stored

### Generated

```
image / frame → YuNet detect            (bbox + detection score + 5 landmarks)
              → alignCrop(frame, landmark row)      ← genuine alignment
              → SFace feature()                     ← 128-d vector
              → L2-normalize                        ← so cosine == dot product
```

`generate_embedding()` in `ai-service/app/recognition/face_service.py` is the
**only** producer, and both callers reach it: `register_face()` for enrollment
and `recognize_frame()` for live frames. One code path means a registration
embedding and a live embedding are always dimensionally and normalizationally
compatible — this was a hard design requirement, not an optimisation.

Each model is constructed exactly once behind a lock-guarded `instance()`
classmethod. Nothing is reloaded per frame or per request. `FaceDetectorYN`
needs `setInputSize(w, h)` before detecting on a differently-sized frame; that
happens inside the wrapper under the same lock, because the per-camera workers
are threads sharing one object.

### Stored

The embedding travels from the AI service to the backend **once**, in the
registration response, and is stored on the `Person` document in
`faceEmbedding`, alongside `embeddingModel`, `embeddingDim` and
`faceRegisteredAt` so a stored vector can later be validated against the live
model. The stored photograph goes to disk under the backend's `uploads/` tree
through the existing `utils/snapshot.js`; only its URL reference is stored on
`person.photo`. Image bytes are never embedded in a MongoDB document.

**An embedding is stored only on an `OK` result.** If the photograph was
undecodable, contained no usable face, contained multiple faces, or the AI
service was unavailable, `faceEmbedding` is left unset and the person stays
visibly not recognition-ready. There is no partial success and no embedding
taken from an arbitrary region of the image.

Protection of the stored vector, and the explicit statement that embeddings must
**not** be described as anonymous or irreversible, are covered in the README's
*Biometric data handling* section. In short: `select: false`, a `toJSON`
transform that deletes it, a whitelist serializer, two shared-secret
service-to-service endpoints that may emit it (`GET /api/ai/face-embeddings` on
the backend, `POST /api/faces/register` on the AI service — neither reachable
from a browser), no embedding in any log or socket payload, and a frontend
`Person` type with no embedding field at all. The stored photograph is served
only through the authenticated `/uploads` mount.

---

## 8. How identity matching works

1. The AI service holds enrolled embeddings in a thread-safe cache fetched from
   `GET /api/ai/face-embeddings`, stored as one stacked NumPy matrix plus
   parallel metadata (`personId`, `name`, model, dim). The backend pre-filters
   to active, recognition-enabled people with a valid embedding.
2. A probe embedding is compared against **all** candidates in a single matrix
   dot product — not a Python loop per person. A registered person's embedding
   is never recomputed at match time.
3. A candidate whose embedding dimension or model name disagrees with the live
   embedder is **dropped and counted** — never padded, truncated, or scored.
4. The best similarity is compared to `AI_SERVICE_FACE_MATCH_THRESHOLD`.
   **Being the closest candidate is not a match.** Below threshold is `UNKNOWN`.
   The runner-up similarity is returned for diagnostics only and can never
   promote a sub-threshold best.
5. The outcome is exactly one of `KNOWN` / `UNKNOWN` / `LOW_QUALITY` /
   `NO_FACE` / `RECOGNITION_UNAVAILABLE`. An unavailable model, a never-loaded
   identity cache, or a cache that has gone **stale** (past its TTL plus grace
   because refreshes keep failing) yields `RECOGNITION_UNAVAILABLE`, **never**
   `UNKNOWN` — so missing weights, an unreachable backend, or data we no longer
   vouch for can never manufacture an unknown-person alert.
6. A cache refresh **replaces** the identity set wholesale rather than merging,
   so a deleted or recognition-disabled person disappears from matching. If the
   backend is unreachable during a refresh, the previous cache is kept and the
   error is surfaced; identities are never silently cleared — but once that
   generation is past its TTL, matching withdraws and the video overlay stops
   drawing names (*IDENTITY UNVERIFIED*) rather than naming someone from data
   that may be out of date.
7. The backend then **re-verifies independently** in
   `recognitionService.ingestRecognition`: it reloads the person (`active`,
   `recognitionEnabled`), confirms the stored embedding's dimension against its
   own declaration and against `RECOGNITION_EMBEDDING_DIM`, confirms
   `embeddingModel` matches the `model_name` the reporter sent, and re-checks
   the similarity against its own `RECOGNITION_MATCH_THRESHOLD`. If any check
   fails the result is **downgraded to unknown** rather than accepted.
8. A verified match is then rate-limited: `KNOWN_EVENT_COOLDOWN` (default 30 s
   per camera and person) bounds how often a recognition event is stored and a
   socket payload pushed. Attendance still refreshes inside the cooldown, under
   its own throttle.

### On the threshold

The default is `0.363`, the figure OpenCV publishes for SFace cosine matching.
**It is a documented starting point, not a validated or calibrated value.** It
has not been tuned against this project's enrolled population, cameras, or
lighting, and no accuracy evaluation of any kind was performed here. A cosine
similarity is **not a probability** and is never presented as one: the frontend
labels it "face similarity", keeps it in a different panel from object-detection
confidence, and states in the attendance and alert detail views that a cosine
similarity is neither a detector confidence nor a probability. Both services
read the threshold from the environment specifically so it can be tuned without
a code change.

---

## 9. How attendance duplication is prevented

Policy: **one attendance record per person per calendar date.** The session key
is the local day as `YYYY-MM-DD`, and `Attendance.sessionKey` mirrors
`Attendance.date` so finer granularity later needs a new key generator and
index, not a migration.

Enforcement lives in the **database**, not the frontend:

- a unique compound index **`{ personId: 1, date: 1 }`** on `Attendance` (this
  index pre-dates Review 2 and was deliberately preserved, not replaced), built
  and **verified at startup** by `config/db.js`, which refuses to let the
  backend run without it;
- a single **atomic** `findOneAndUpdate` upsert on that key —
  `$setOnInsert` writes `firstSeen`, `cameraId`, `source`, `similarity`,
  `recognitionEventId` and `status: 'present'`; `$set` always refreshes
  `lastSeen`;
- created-versus-updated is read from the upsert's own result metadata
  (`includeResultMetadata: true`, then `lastErrorObject.upserted` /
  `updatedExisting`), with a documented fallback that infers it from
  `firstSeen === lastSeen` — exact here, because `$setOnInsert` sets `firstSeen`
  only on insert while `$set` always sets `lastSeen` in the same call. That
  logic lives in the pure `interpretUpsertResult()` and is unit-tested across
  every result shape;
- a genuinely concurrent insert that still trips **`E11000`** is caught, the
  existing record re-read, and returned as `created: false`.

Before any of that, `markAttendance` runs the full validation sequence in order:
the person exists → is `active` → has recognition enabled → has a stored
embedding whose dimension matches both its own declaration and
`RECOGNITION_EMBEDDING_DIM`, from the same embedding model the reporter used →
the supplied similarity is a number that clears the backend's own threshold →
the `cameraId` resolves to a real `Camera` document. Failing any step means no
record is written. Unknown, low-quality and recognition-unavailable results
never create attendance, and a rejected identity claim is downgraded to unknown
rather than accepted.

`ATTENDANCE_UPDATE_COOLDOWN` (default 30 s) throttles how often `lastSeen` is
rewritten. It is an in-memory efficiency guard **only** — it is explicitly not
the duplicate-prevention mechanism, and an empty map after a restart simply
means the next sighting performs one upsert that finds the existing record. Its
timestamp is recorded after a successful write, so a failed write does not block
retries, and the map is pruned by date so it cannot grow as days pass.

Attendance summaries (`GET /api/attendance/summary`) are computed from persisted
documents with real aggregation — `totalRegistered`, `presentToday`,
`notMarked`, `attendancePercentage`. Nothing is hardcoded and nothing is derived
in the frontend from the rows currently on screen.

---

## 10. How unknown-identity alerts work

An unknown-identity event requires **all** of: a usable face was detected, the
recognition pipeline was available (models loaded and the identity set fresh),
**somebody is actually enrolled**, and no enrolled identity cleared the
threshold. A rejected identity claim (disabled person, deactivated person,
dimension or model mismatch, sub-threshold similarity) is downgraded into this
same path rather than being accepted.

With nobody enrolled, nothing is written at all: every face would legitimately
fail to match, so a freshly deployed system would otherwise alert on every
visitor and look identical to one detecting intruders. The backend checks that
count itself (cached for `ENROLLED_COUNT_TTL`, default 30 s) rather than
trusting a reason code from the AI service.

Two further gates then apply, both configurable in `backend/.env`:

| Gate | Key | Default |
|---|---|---|
| Sightings required before alerting | `UNKNOWN_PERSISTENCE_COUNT` | `2` |
| Window those sightings must fall inside | `UNKNOWN_PERSISTENCE_WINDOW` | `10` s |
| Suppression after an alert, per camera + track | `UNKNOWN_ALERT_COOLDOWN` | `60` s |

State is an in-memory `Map` keyed by camera + track, following the same pattern
Review 1's `eventService.js` already uses for detection cooldowns rather than
inventing a second mechanism. A restart clears it, which costs at most one extra
alert.

When both gates are satisfied: the snapshot is saved through the **existing**
`utils/snapshot.js` (URL reference only), a `RecognitionEvent` with
`status: 'unknown'` is created, and an `Alert` is created with
`type: 'unknown_identity'` and **`severity: 'warning'`, never `critical`** — an
unmatched face is not proof of wrongdoing, and the alert message says so. The
`alertId` is linked back onto the event, then the existing `alert:new` event and
the new `identity:unknown` event are emitted, so the existing Alerts page picks
it up with zero new alert machinery. Acknowledge and resolve go through the
unchanged `alertController` PATCH.

`confidence` and `objectClass` are deliberately passed as `undefined` on these
alerts, so a face similarity is never rendered in the detector-confidence
column.

Two things that never raise an alert: a `recognition_unavailable` result (the
pipeline being down cannot manufacture a security event) and a `no_face` or
`low_quality` result (a measurement statement, not a security one). The track
identifier is a transient per-worker bbox-IoU handle used only to de-duplicate
repeated sightings of one continuously visible face; it makes no claim about
anyone's real identity.

---

## 11. Tests executed and their actual results

This section is the integrity-critical part of the report. It is assembled from
the per-command records written during each implementation feature, not from
memory.

### (a) Tests that actually ran

**None.** Not one test, build, typecheck, install, compile check, import-graph
resolution, service start, or database operation was executed at any point in
Review 2. There is no passing result to report, and no test output exists.

### (b) Tests that are written and committed to the tree but could not be executed

**The blocker, verbatim.** Every shell command attempted in this environment
failed at the OS sandbox layer *before the command itself ran*:

```
sandbox-exec: sandbox_apply: Operation not permitted

Exit Code: 71
```

accompanied by the tool note *"This command failed while running with the OS
sandbox enabled. Sandbox restrictions may have contributed; the exact cause
could not be determined."*

`echo hello` fails identically. That is what establishes this as a wholesale
loss of shell execution rather than a project, dependency, or syntax problem.

**Per-command record.** Every command below was genuinely attempted; every one
was BLOCKED with the error above.

| # | Command | Working directory | Result |
|---|---|---|---|
| 1 | `echo hello` | repo root / backend | BLOCKED |
| 2 | `git status --porcelain` | `camsense-ai` | BLOCKED |
| 3 | `git -P log --oneline -n 5` | `camsense-ai` | BLOCKED |
| 4 | `npm install` | `backend` | BLOCKED |
| 5 | `npm install && npm run lint` | `frontend` | BLOCKED |
| 6 | `python -m compileall app` | `ai-service` | BLOCKED |
| 7 | `npm test` | `backend` | BLOCKED |
| 8 | `node --test test/smoke.test.js` | `backend` | BLOCKED |
| 9 | `node --check src/services/recognitionService.js` | `backend` | BLOCKED |
| 10 | `node -e "import('./src/routes/index.js')…"` | `backend` | BLOCKED |
| 11 | `/usr/bin/env node --test test/` | `backend` | BLOCKED |
| 12 | `ls -d backend/node_modules` | repo root | BLOCKED |
| 13 | `python -m unittest discover -s tests -v` | `ai-service` | BLOCKED |
| 14 | `/usr/bin/python3 -m unittest discover -s tests -v` | `ai-service` | BLOCKED |
| 15 | `python3 -m compileall -q app tests download_assets.py` | `ai-service` | BLOCKED |
| 16 | `npm run lint` | `frontend` | BLOCKED |
| 17 | `npm run build` | `frontend` | BLOCKED |
| 18 | `./node_modules/.bin/tsc --noEmit` | `frontend` | BLOCKED |
| 19 | `ls -la .agents/tasks/…` | repo root | BLOCKED |

**Post-review fix pass (review iteration 1).** A semantic review of the whole
change returned NEEDS_CHANGES with 13 findings; the fixes are described in §17.
Every verification command was attempted again afterwards, and every one was
BLOCKED with the identical error and exit code:

| # | Command | Working directory | Result |
|---|---|---|---|
| 20 | `echo hello` | repo root | BLOCKED |
| 21 | `npm test` | `backend` | BLOCKED |
| 22 | `python -m unittest discover -s tests -v` | `ai-service` | BLOCKED |
| 23 | `npm run build` | `frontend` | BLOCKED |
| 24 | `npm run lint` | `frontend` | BLOCKED |
| 25 | `python -c "import ast; ast.parse(…)"` over the nine edited Python files | `camsense-ai` | BLOCKED |

Row 25 is worth noting: even a pure-stdlib syntax check of the edited Python
files could not run, so the fix pass is in exactly the same position as the
original implementation — written and statically re-read, never executed.

Rows 7, 13, 16 and 17 were re-attempted once more at the very end of the work,
after every source edit was complete, specifically so this report reflects the
final state of the tree rather than a mid-task snapshot. All four were BLOCKED
again with the identical error and exit code.

Alternate launchers (an absolute interpreter path, `/usr/bin/env`, the local
`tsc` binary, a single-file `node --check`) were tried deliberately to rule out
a `PATH`, venv, or npm-script cause. They fail identically.

**The test suites that exist and are waiting to be run.** The case counts below
are those recorded when each suite was written; since no runner has ever
executed them, no runner has ever confirmed the totals.

| Suite | File(s) | Cases | Command to run it |
|---|---|---|---|
| Backend — Review 1 smoke | `backend/test/smoke.test.js` | 3 | `cd backend && npm test` |
| Backend — Review 2 identity rules | `backend/test/review2-identity.test.js` | 44 | `cd backend && npm test` |
| Backend — Review 2 route surface | `backend/test/review2-routes.test.js` | 7 | `cd backend && npm test` |
| Backend — Review 2 exposure & auth surface | `backend/test/review2-security.test.js` | 12 | `cd backend && npm test` |
| AI service — Review 1 smoke | `ai-service/tests/test_smoke.py` | 4 | `cd ai-service && python -m unittest discover -s tests -v` |
| AI service — Review 2 recognition logic | `ai-service/tests/test_face_recognition.py` | 37 across 8 `TestCase` classes | `cd ai-service && python -m unittest discover -s tests -v` |
| AI service — Review 2 fix pass (staleness, non-blocking refresh, `register_face`, the service-secret gate) | `ai-service/tests/test_review2_fixes.py` | 24 across 7 `TestCase` classes | `cd ai-service && python -m unittest discover -s tests -v` |
| Frontend — typecheck | — | — | `cd frontend && npm run lint` |
| Frontend — build | — | — | `cd frontend && npm run build` |

The fix pass added coverage for four of the paths the review named as untested:
`register_face`'s validation outcomes (with the models stubbed, so no ONNX
weight is needed), the embedding cache's staleness and refresh-failure
behaviour, the `created` detection inside the attendance upsert (extracted into
the pure `interpretUpsertResult`, tested across every result shape including the
fallback), and the status-routing rule that `recognition_unavailable` /
`no_face` / `low_quality` can never be persisted (extracted into
`isPersistableRecognitionStatus`). Two gaps remain by nature: the `E11000`
concurrency path still needs a real MongoDB, and the route tests still inspect
source text rather than issuing HTTP requests.

Both suites were written to need **no new dependency**: the backend tests use
Node's built-in `node:test` (and the identity tests import only
`identityRules.js`, which imports nothing at all), and the Python tests use
stdlib `unittest` and avoid importing `cv2`, `ultralytics`, `torch`, `app.main`
and `pipeline`, so they run without model weights or the heavy CV stack. The one
test class that needs `fastapi` (the service-secret gate) skips itself when
`fastapi` is not installed rather than failing.

Two further environment facts a developer should expect: `backend/node_modules`
and `frontend/node_modules` do not exist in this tree, so `npm install` must run
first. `npm test` should then work (`node:test` needs no package), but
`npm run lint` / `npm run build` need the frontend install, and any check that
resolves the backend's full import graph needs `express` / `mongoose` /
`socket.io` present.

**What was done instead of executing.** Static verification only, and it did
find real defects — for example a `str_replace` that had truncated a frontend
component to a bare `function DetectorRow({`, caught by re-reading the file
after writing it. The static work comprised: re-reading every new and modified
file after writing it; tracing every import to the file that defines it and
confirming each referenced symbol by reading its export; checking for import
cycles in both directions; grepping every endpoint path, environment key, socket
event name, model path, default value and npm script quoted in the documentation
against the actual source; confirming by grep that `faceEmbedding` has no
non-whitelisted read path, that no diagnostic interpolates an embedding, that
the attendance and recognition-event routers register GET only, that no new
`process.env` use was introduced outside `config/env.js`, that no hex colour
literal exists in the frontend, and that the frontend holds no embedding field;
and cross-checking the two `SocketEvents` maps line by line. Static verification
catches a wrong name or a missing export. **It cannot catch a logic error, a
type error, or a runtime crash.** Treat the whole of Review 2 as statically
reviewed, never demonstrated.

### (c) The instruction's 30 test cases, mapped individually

Every one of the 30 is **unverified by execution.** The middle column records
what coverage *exists on disk*, and the right column what a developer needs in
order to actually verify it.

**Person management**

| # | Case | Coverage written | Verified? | Needs |
|---|---|---|---|---|
| 1 | Register a person | Route + controller + Zod schema; route-surface test asserts admin gating | **No** | MongoDB, running backend |
| 2 | Reject an invalid image | Mime and byte-length validation in `registerPersonFace`; AI-service `INVALID_IMAGE` path | **No** | Running backend + AI service |
| 3 | Reject an image without a usable face | `NO_FACE` path and its verbatim operator message | **No** | Running AI service **+ ONNX weights** |
| 4 | Generate an embedding when a suitable model is available | `generate_embedding()` single code path | **No** | **ONNX weights** — none present, none downloadable here |
| 5 | Edit person information | `PUT /api/people/:id` + `personUpdateSchema` | **No** | MongoDB, running backend |
| 6 | Disable recognition | `PATCH /api/people/:id/recognition` + AI cache refresh | **No** | MongoDB, running backend, running AI service |
| 7 | Delete or deactivate a person | `DELETE /api/people/:id` with `?deactivate=true`; hard delete clears the embedding and removes the photo file | **No** | MongoDB, running backend, filesystem |
| 8 | Disabled/deleted people cannot be recognized | **Unit tests written** (backend: inactive and recognition-disabled claims rejected; AI service: cache replaces rather than merges) — *never executed* | **No** | Run `npm test` and `python -m unittest` |

**Face recognition**

| # | Case | Coverage written | Verified? | Needs |
|---|---|---|---|---|
| 9 | Recognize a registered person from a suitable test image | Full pipeline | **No** | **ONNX weights**, MongoDB, all three services, a consented face image |
| 10 | Return UNKNOWN when nothing meets the threshold | **Unit tests written** (just-below → UNKNOWN, just-above → KNOWN) — *never executed* | **No** | Run `python -m unittest` |
| 11 | Correct service status when the model is unavailable | **Unit test written** (unavailable embedder → `RECOGNITION_UNAVAILABLE`, not `UNKNOWN`); `GET /api/faces/status` | **No** | Run `python -m unittest`; running AI service |
| 12 | Similarity is not treated as a calibrated probability | Enforced by construction: no code converts similarity to a percentage-confidence; the UI labels it "face similarity", keeps it in a separate panel from detection confidence, and states the caveat in the attendance and alert detail views. Documented as an unvalidated starting point in `config.py`, `env.js`, `.env.example`, the README and here | **No** (verified by reading, not by running) | A browser against a running stack |
| 13 | Recognition boxes use actual face coordinates | Boxes come from YuNet's real bbox, drawn server-side onto the MJPEG frame. **No client-side box is drawn at all**, deliberately — a misaligned identity box is worse than none | **No** | **ONNX weights**, running AI service, a browser |

**Attendance**

| # | Case | Coverage written | Verified? | Needs |
|---|---|---|---|---|
| 14 | Mark attendance for a valid recognized person | `markAttendance` validation sequence + atomic upsert | **No** | MongoDB, running backend |
| 15 | Reject attendance from an unknown identity | **Unit tests written** (sub-threshold, non-numeric, disabled, inactive, dim-mismatch all rejected) — *never executed* | **No** | Run `npm test` |
| 16 | Prevent duplicate attendance for the same person and date | Single upsert on `{ personId, date }` | **No** | **MongoDB** — the index is the mechanism and cannot be exercised without a database |
| 17 | Database-level duplicate protection | Unique compound index `{ personId: 1, date: 1 }` | **No** | **MongoDB** |
| 18 | Handle concurrent attendance requests | `E11000` caught, record re-read, returned as `created: false` | **No** | **MongoDB** + genuinely concurrent requests |
| 19 | Attendance summaries use persisted data | Real aggregation in `getAttendanceSummary`; the four UI tiles read it directly and are never computed from the rows on screen | **No** | MongoDB with real records |

**Alerts**

| # | Case | Coverage written | Verified? | Needs |
|---|---|---|---|---|
| 20 | Generate an unknown-identity event when the configured conditions are met | **Unit test written** (persistence rule does not fire on the first sighting, fires once the count is met inside the window) — *never executed* | **No** | Run `npm test`; then MongoDB + a live face for end-to-end |
| 21 | Avoid repeated alerts for the same ongoing event | **Unit test written** (cooldown suppresses the second alert for the same camera/track) — *never executed* | **No** | Run `npm test` |
| 22 | Alert acknowledgement | Reuses the **unchanged** Review 1 `PATCH /api/alerts/:id/status`; no second workflow was built | **No** | MongoDB, running backend, a browser |
| 23 | Alert resolution | Same unchanged path | **No** | MongoDB, running backend, a browser |

**Integration**

| # | Case | Coverage written | Verified? | Needs |
|---|---|---|---|---|
| 24 | Existing human detection still works | Regression checked by **full re-read** of `stream_manager.py` and `pipeline.py`: `pipeline.run(frame, faces=…)` still runs the Review 1 detectors on every processed frame, the human detector and its colour are unchanged, and the identity work is additive, lower-cadence and performs no blocking I/O on that thread | **No** | YOLO weights, running AI service |
| 25 | Existing weapon detection still works | Same re-read; the demo-weapon injection is untouched. Review 1's firearm limitation is unchanged | **No** | YOLO weights, running AI service |
| 26 | Camera management still works | `cameraController.js` and `cameraRoutes.js` were not edited | **No** | MongoDB, running backend |
| 27 | Existing alerts still work | `Alert.type` was extended additively (`unknown_person` retained); `alertController` and the weapon/intrusion flow were not edited | **No** | MongoDB, running backend |
| 28 | Authentication and authorization | Middleware unedited; `requireRole('admin')` now actually used on all five mutating person routes — **asserted by a written route-surface test**, *never executed*. Note: `requireRole` had never been exercised anywhere before Review 2, and still has not been | **No** | Run `npm test`; then real requests |
| 29 | Frontend / backend / AI-service communication | Every frontend API path and both `SocketEvents` maps cross-checked against the actual route and socket source | **No** | All three services running plus a browser |
| 30 | A recognition-service failure does not crash the application | Designed in and verified by reading: both model constructors catch failure and set `available = False` instead of raising; the startup identity prefetch is non-fatal; each recognition call in the worker is individually `try/except`-wrapped and counted; a backend-unreachable cache refresh keeps the previous cache; `aiClient` maps AI unavailability to a 503 | **No** | Running services, then deliberate fault injection |

**Summary: 0 of 30 verified by execution.** 8 cases (8, 10, 11, 15, 20, 21, 28,
and parts of 30) have purpose-written unit tests sitting in the tree that would
exercise their decision logic as soon as a shell is available. The remaining 22
need some combination of MongoDB, the ONNX weights, a running three-service
stack, a browser, and consented face images or suitable test images.

**No claim of production-grade recognition accuracy is made, because no
evaluation was performed.** There is no measured accuracy, no false-match rate,
no false-non-match rate, and no threshold validation of any kind in this
project.

---

## 12. How to run the complete application

Four services, in this order. Full detail — including the macOS port-5000
caveat — is in the [README quick start](../README.md#quick-start).

```bash
# 0. clone
git clone https://github.com/Ayushdas1904/camsense-ai.git
cd camsense-ai

# 1. MongoDB — reachable at mongodb://127.0.0.1:27017 (loopback only)
mkdir -p ~/.camsense/mongo-data
mongod --dbpath ~/.camsense/mongo-data --port 27017 --bind_ip 127.0.0.1

# 2. AI service → http://localhost:8000
cd ai-service
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt       # OpenCV + YOLO (pulls PyTorch, ~1 GB)
python download_assets.py             # yolov8n.pt, vtest.avi, BOTH face ONNX files
cp .env.example .env
uvicorn app.main:app --reload

# 3. Backend → http://localhost:5050
cd ../backend
cp .env.example .env                  # set MONGODB_URI, JWT_SECRET, AI_INGEST_SECRET
npm install
npm run seed                          # creates the admin account (needs MongoDB)
npm run seed:cameras                  # creates CAM-01 and CAM-02
npm run dev

# 4. Frontend → http://localhost:5173
cd ../frontend
cp .env.example .env                  # VITE_API_BASE_URL → the backend (5050)
npm install
npm run dev
```

Sign in at <http://localhost:5173> with the `SEED_ADMIN_EMAIL` and
`SEED_ADMIN_PASSWORD` values from `backend/.env`.

**`AI_INGEST_SECRET` in `backend/.env` must equal `AI_SERVICE_INGEST_SECRET` in
`ai-service/.env`.** That one shared secret authenticates the detection leg, the
recognition leg, the embeddings endpoint, **and every call the backend makes to
the AI service** — the AI service requires it on all of its routes except
`GET /api/health`. If the two differ, monitoring and face registration fail with
an authentication error. Set it yourself; no real secret is committed anywhere in
this repository.

Both services bind `127.0.0.1` by default (`HOST`, `AI_SERVICE_HOST`), and
MongoDB is reached over loopback. Nothing in this stack is reachable from
another machine unless you change that deliberately.

Health checks: <http://localhost:8000/api/health> ·
<http://localhost:5050/api/health> · AI readiness at
<http://localhost:8000/api/faces/status>.

Tests, once dependencies are installed:

```bash
cd backend    && npm test                                    # node:test
cd ai-service && python -m unittest discover -s tests -v      # stdlib unittest
cd frontend   && npm run lint && npm run build                # tsc --noEmit, then vite build
```

None of these has ever been run — see §11.

---

## 13. Review 2 demonstration instructions

**Use consenting participants or suitable test images only.** Face recognition
processes sensitive biometric data; see the README's *Biometric data handling*
section before demonstrating with anyone's face.

Prerequisite: `python download_assets.py` must have fetched both ONNX files, or
the identity steps will honestly report *face recognition unavailable*.

1. **Log in** and show the Review 1 Dashboard — real camera, AI and alert counts,
   plus the Review 2 KPI tiles (registered people, present today, unknown
   identities today).
2. **People → Register Person.** Enroll a consenting participant. Only *Name* and
   *Person ID* are required.
3. **Register face.** Walk the stepwise panel: details → upload a photograph →
   validate → register → confirm. Show the structured outcome message verbatim,
   and the person flipping to *recognition ready*. Then demonstrate the rejection
   paths with a multi-face photo and a photo with no usable face — note that no
   embedding is stored in either case.
4. **Live Monitoring.** Select a camera and **Start Stream** (DEMO mode plays the
   bundled pedestrian video; REAL mode takes an RTSP/IP URL). Point out the
   extended AI System panel: Human Detection, Weapon Detection, Face Detection,
   Face Recognition, Attendance Service — each showing its real state.
5. **Recognition.** With the enrolled person in frame, the Identity Results panel
   shows the matched name **only** when the similarity clears the threshold,
   labelled *face similarity* and kept visually separate from detection
   confidence.
6. **Attendance.** A verified match creates exactly one record; the Attendance
   page updates live over `attendance:marked`.
7. **Duplicate prevention.** Keep the same person in frame. Repeated matches
   refresh `lastSeen` and create **no** second record — enforced by the unique
   `{ personId, date }` index, not by a frontend check.
8. **Unknown identity.** Show an unenrolled face. With the pipeline available and
   no candidate clearing the threshold, the result is `UNKNOWN` — and no name is
   displayed anywhere for it.
9. **Alert.** Once the persistence and cooldown rules are satisfied, the
   `unknown_identity` alert appears on the Dashboard and on the **existing**
   Alerts page at severity *warning*, with its snapshot. Acknowledge and resolve
   it using the unchanged Review 1 actions.
10. **Attendance review.** Open Attendance and show the persisted record plus the
    four summary tiles, all read from `GET /api/attendance/summary`.
11. **Review 1 intact.** Human detection, the demo-weapon critical alert, camera
    management, and alert acknowledge/resolve all still work.

Optional, and worth showing: **disable recognition** on the enrolled person (or
deactivate them) and demonstrate that they are no longer matched — the backend
forces an AI-service cache refresh on every person change, so the identity stops
being matchable immediately rather than at TTL expiry.

Also worth showing deliberately: **stop the AI service**, or run with the ONNX
weights absent. Face Detection and Face Recognition report **UNAVAILABLE**,
registration explicitly states that no face data was stored and the person is
not recognition-ready, no unknown-identity alert is raised, and the Review 1
detection UI keeps working. That is designed behaviour, not a workaround.

---

## 14. Known limitations

- **Nothing in Review 2 has been executed.** No test, build, typecheck,
  dependency install, model download, database operation, or service start. The
  identity layer is statically reviewed, not demonstrated. See §11.
- **The `0.363` match threshold is an unvalidated default.** It is OpenCV's
  published starting point for SFace, not a value tuned for this system's
  enrolled population, cameras, or lighting.
- **No accuracy claim is made, and none should be inferred.** YuNet and SFace
  behaviour under pose, lighting, occlusion, masks, and low resolution is
  entirely untested here. No evaluation was performed.
- **A cosine similarity is not a probability** and must never be presented as a
  calibrated confidence.
- **No liveness or anti-spoofing detection.** A printed photograph or a face on
  a phone screen held up to the camera may well match. Recognition is not proof
  of physical presence.
- **No real face tracking.** The `trackId` is a transient per-worker bbox-IoU
  session handle with a short expiry, used only to de-duplicate repeated
  sightings. It makes no claim about anyone's identity and does not survive a
  worker restart.
- **Attendance is daily only.** There is no timetable and no late-arrival rule,
  so `late` is modelled in the enum but never written, and `absent` is likewise
  unused. Inventing a schedule would have fabricated policy the project does not
  define.
- **Snapshots and registration photographs live on local disk** behind the
  backend's authenticated `/uploads` mount, not in object storage, and there is
  **no automatic retention or expiry job** — face images would accumulate until
  something removes them.
- **Image URLs carry the auth token as a query parameter.** An `<img>` tag
  cannot send an `Authorization` header, so `assetUrl()` appends the signed-in
  user's token (the same approach the MJPEG stream already used). The
  consequence: a snapshot URL copied out of the DOM stays usable until the token
  expires, and the token can end up in a reverse proxy's access log. Short-lived
  signed URLs, or a cookie scoped to `/uploads`, would be the next step.
- **Recognition is withdrawn rather than degraded when the identity cache goes
  stale.** Past `AI_SERVICE_EMBEDDING_CACHE_TTL` +
  `AI_SERVICE_EMBEDDING_CACHE_STALE_GRACE` of failed refreshes, matching returns
  `RECOGNITION_UNAVAILABLE` and the overlay stops drawing names. That is the
  deliberate fail-closed choice (a stale set may still contain a person who has
  since been disabled or deleted), but it means a prolonged backend outage
  disables recognition entirely.
- **Unknown-identity alerting is suppressed while nobody is enrolled**, so an
  empty system is silent by design. The enrolled count is cached for
  `ENROLLED_COUNT_TTL` seconds, so enrolling the first person can take up to
  that long to re-enable alerting.
- **`KNOWN_EVENT_COOLDOWN` bounds the recognition event stream** to roughly one
  stored event and one socket update per person per camera per 30 s. The live
  overlay still updates every recognition pass, but the Identity Results panel
  and the `recognitionevents` collection are deliberately coarser than the
  camera.
- **The AI service's report POSTs are dropped, not queued, under pressure.**
  Once `MAX_IN_FLIGHT_REPORTS` (4) POSTs are outstanding per leg, further
  reports are discarded with a log line, on the basis that a stale report is
  worth less than a responsive camera.
- **Review 1's firearm limitation is unchanged.** The bundled `yolov8n` (COCO)
  model can genuinely detect knife and scissors but **not** firearms, because
  COCO has no gun class. The demo-weapon button injects a clearly labelled DEMO
  event so the critical-alert pipeline is demonstrable.
- **Recognition overlays may lag the live frame** by up to one recognition
  interval, because face detection and recognition run on every *N*th processed
  frame and the identity labels are drawn server-side with a short TTL. The grey
  face boxes and the `faces` stat update at that same cadence. No client-side
  box is drawn, deliberately.
- **Face-image quality assessment is a minimum-size check only** — there is no
  blur, pose, or illumination scoring.
- **The in-memory unknown-alert and attendance-throttle state does not survive a
  restart**, costing at most one extra alert or one extra upsert.
- **The mongoose 8 upsert-metadata field names could not be confirmed against
  installed source** (`node_modules` is absent), so a documented fallback path
  infers created-versus-updated from `firstSeen === lastSeen`. That logic now
  lives in the pure `interpretUpsertResult()` and has unit tests for every
  result shape — but the tests encode the *assumed* mongoose shape, so only a
  run against a real database settles it.
- **`recognition:status` is emitted only from `GET /api/ai/status`**, which no
  frontend page currently polls on its own, so in practice that event fires when
  something else hits that endpoint.
- **No seed data for people was created.** Seeding people would mean inventing
  identities, and in a biometric system an invented enrolment record is
  fabricated data that would also make the dashboard report enrolments that
  never happened. The People list starts genuinely empty.
- **This is an academic project, not a deployable biometric system.** Real
  deployment needs informed consent, lawful authorization, a retention and
  deletion policy, and human review before any consequential action.

---

## 15. Setup steps requiring manual intervention

1. **Install dependencies.** `backend/node_modules` and
   `frontend/node_modules` do not exist in this tree, and the AI-service venv
   was never created. Run `npm install` in `backend/` and `frontend/`, and
   `pip install -r requirements.txt` in `ai-service/`. Nothing Review 2 added
   requires a *new* package — but the pre-existing ones must be present.
2. **Download the model weights.** `python download_assets.py` in `ai-service/`
   fetches `yolov8n.pt`, the demo video, and both face ONNX files. **Neither
   ONNX file is present here**; if you set up the AI service before Review 2,
   re-run the script. It is idempotent and fails softly with the exact target
   path, so a file can be dropped into `models/` by hand if the download is
   blocked.
3. **Create the three `.env` files** from their `.env.example` templates. No
   secret is committed, so you must set `JWT_SECRET` and the shared ingest
   secret yourself.
4. **Make `AI_INGEST_SECRET` (backend) equal `AI_SERVICE_INGEST_SECRET`
   (AI service).** The recognition leg and the embeddings endpoint both depend on
   it. A mismatch means recognition results and identity fetches silently fail
   authentication.
5. **Resolve the port inconsistency.** The committed defaults disagree:
   `backend/.env.example` ships `PORT=5000` and `frontend/.env.example` points at
   port 5000, while the AI service's default `AI_SERVICE_BACKEND_URL` is
   `http://127.0.0.1:5050`. On macOS port 5000 is taken by the AirPlay Receiver.
   Pick one port and set it in all three services.
6. **Start MongoDB before the backend**, and run `npm run seed` and
   `npm run seed:cameras` once to create the admin account and the two demo
   cameras. Both need a reachable database.
7. **Enroll people manually.** There is no people seed script, by design (§14).
   Every person and every face must be registered through the UI by an
   administrator, with consent.
8. **Tune the match threshold on your own data** before trusting any recognition
   result. `RECOGNITION_MATCH_THRESHOLD` (backend) and
   `AI_SERVICE_FACE_MATCH_THRESHOLD` (AI service) both default to the unvalidated
   `0.363`.
9. **Run the test suites and the build.** Nothing in Review 2 has been executed.
   `cd backend && npm test`, `cd ai-service && python -m unittest discover -s
   tests -v`, `cd frontend && npm run lint && npm run build` — expect to fix
   whatever static review could not catch.
10. **Review and commit.** All Review 2 changes are uncommitted in the working
    tree on branch `main`; git could not run in this environment.
11. **Put a retention policy in place** before enrolling any real person. There
    is no automatic expiry job for stored face images or embeddings.

---

## 16. Recommended implementation plan for Review 3

**This is a recommendation only. No part of Review 3 has been implemented.** The
Review 3 route mounts remain commented out in `backend/src/routes/index.js`; the
`Occupancy`, `EnergyRecord` and `Notification` models remain unwired scaffolding;
and `EnergyPage.tsx` and `AnalyticsPage.tsx` still render `PlaceholderPage`.

Review 3 — *"Teach CCTV to UNDERSTAND & ACT"* — should reuse the existing
scaffolding rather than add a fourth service.

**Occupancy.** Derive room occupancy from the human detections Review 1 already
produces, rather than adding a new model. Wire the existing `Occupancy` schema
(add a camera/zone reference, a people count, and a timestamp with a
`{ cameraId, timestamp: -1 }` index), have the AI service report a per-frame
count on its own rate limiter — a third reporting leg alongside detections and
recognition, following the same `event_reporter` pattern — and persist a
time-bucketed count in the backend rather than one document per frame. Add
`GET /api/occupancy` and `GET /api/occupancy/summary`, both read-only, and a
capacity-threshold alert that goes through the **existing** `Alert` model with a
new type value, exactly as `unknown_identity` did. Occupancy is a *count*, not an
identity: it must not be derived from recognition, and a zone count must never
be presented as a list of who is present.

**Energy.** Wire the existing `EnergyRecord` schema and uncomment
`router.use('/energy', energyRoutes)`. Model device automation as **simulated
state transitions** driven by occupancy thresholds, persisted as records with an
explicit `simulated: true` marker — the project controls no real IoT hardware,
and an energy saving that was never measured must be labelled as a projection,
not reported as a measurement. Build out `EnergyPage.tsx` in place of its
placeholder.

**Analytics.** Uncomment `router.use('/analytics', analyticsRoutes)` and add
aggregation-only endpoints over the data already persisted — detection and alert
trends, attendance over time, occupancy patterns, energy projections. Everything
should be a real MongoDB aggregation, never a frontend-side computation and never
a hardcoded figure. Recharts is already a frontend dependency, so
`AnalyticsPage.tsx` needs no new package.

**Notifications.** The `Notification` model is the natural home for the
cross-cutting delivery layer (in-app, and optionally email) that Reviews 1 and 2
currently handle through Socket.IO alone.

Constraints that should carry forward: extend, never replace; one trusted write
path per data class, gated by the shared secret; no number in the UI that did
not come from a real query; no simulated output presented as measured; and
occupancy and energy data kept strictly separate from identity data.

---

## 17. Post-review fix pass (review iteration 1)

A semantic review of the whole Review 2 change returned **NEEDS_CHANGES** with
13 findings. All 13 were addressed in the working tree; none were declined. The
fixes are listed here with what changed, because several of them alter
behaviour that §§5–10 describe.

| # | Finding | Fix |
|---|---|---|
| 1 | `POST /api/faces/register` returned a raw 128-d embedding with no authentication, and the AI service bound `0.0.0.0` | New `ai-service/app/api/security.py` — a FastAPI dependency verifying `x-ai-secret` in constant time against `settings.ingest_secret`, failing closed (503) when no secret is configured. Applied to every route except `/api/health` via a `secured` router. `Settings.host` now defaults to `127.0.0.1`, as does `AI_SERVICE_HOST` in `.env.example`. The backend's `aiClient` attaches the credential to every call, including the MJPEG proxy fetch that bypasses `aiFetch` |
| 2 | `POST /api/faces/cache/refresh` was unauthenticated and state-changing | Same gate |
| 3 | Registration portraits were served by an unauthenticated `express.static('/uploads')` mount | `/uploads` is now mounted behind `requireAuthQueryOrHeader` with `Cache-Control: private, max-age=60`. That covers registration portraits, cropped unknown-face snapshots and Review 1 detection snapshots. The frontend's `assetUrl()` appends the signed-in user's token, because an `<img>` cannot send an `Authorization` header — the same mechanism the MJPEG stream URL already used. Its cost is recorded in §14 |
| 4 | `known` events had no cooldown: ≈1 event + 1 socket emit per second per camera, indefinitely | `KNOWN_EVENT_COOLDOWN` (default 30 s), keyed per camera + person, with a pruned state map. Inside the cooldown the sighting still refreshes attendance but writes no event and emits nothing. `recognitionEventId` is linked only when an event was actually written |
| 5 | `ensure_fresh` (6 s) and `report_recognition` (4 s) ran inline on the thread that also runs YOLO | The identity-cache refresh is dispatched to a background thread (`blocking=False`, one refresh in flight at a time); both report legs POST from background threads with an in-flight cap of 4 and configurable sub-frame timeouts (`AI_SERVICE_REPORT_TIMEOUT` 2 s, `AI_SERVICE_EMBEDDING_FETCH_TIMEOUT` 3 s) |
| 6 | YuNet ran on every frame via the pipeline's `faces=None` fallback, contradicting the docs | The worker now passes an empty list on non-recognition frames, so the face detector does not run; `faces` stats update on recognition frames only. The docstrings, the README and `FACE_RECOGNITION.md` §7 were corrected to say face **detection and** recognition share the cadence |
| 7 | Nothing verified the unique `{ personId, date }` index existed | `ensureCriticalIndexes()` in `config/db.js` runs `syncIndexes()` and then confirms a *unique* index on exactly that key, throwing — and so refusing to start the backend — if it is absent |
| 8 | Re-verification ignored `expectedDim` and never compared `model_name` with `embeddingModel` | Both are now passed at the trust boundary: `RECOGNITION_EMBEDDING_DIM` (default 128) and the reporter's `model_name`. A new `embedding_model_mismatch` reason downgrades the claim. The comparison applies only when both sides know their model, so a person enrolled before the field existed is unaffected |
| 9 | `date`, `cameraId`, `status`, `personId`, `category` went from `req.query` into Mongo filters untyped (`?date[$ne]=x` becomes an operator) | New pure `toQueryString()` coerces strings and finite numbers and drops everything else. Applied in `buildPersonFilter`, `buildAttendanceFilter`, the attendance summary, `listRecognitionEvents` — and in Review 1's `listDetections` and `listAlerts`, which had the same shape |
| 10 | A disabled person's name could still be drawn from a stale AI-side cache | `EmbeddingCache.is_stale()`. Past TTL + grace, `match_embedding` returns `RECOGNITION_UNAVAILABLE` / `IDENTITY_CACHE_STALE` instead of matching; past TTL with no grace, the overlay draws *IDENTITY UNVERIFIED* rather than a name. `cache_stale` is reported in the recognition status and relayed by `GET /api/ai/status` |
| 11 | A loaded-but-empty enrolled set produced unknown-identity alerts on every persistent face | The backend counts matchable people (cached for `ENROLLED_COUNT_TTL`) and, at zero, counts the sighting and writes nothing — no event, no alert |
| 12 | The attendance throttle map was never pruned and was set before the write | Pruned by date with a size cap, and the timestamp is recorded only after a successful write (or after an `E11000` where the record demonstrably exists) |
| 13 | Untested paths, and nothing executed | New `ai-service/tests/test_review2_fixes.py` (staleness and fail-closed matching, non-blocking refresh, `register_face` outcomes with the models stubbed, the service-secret gate including its fail-closed branch) and `backend/test/review2-security.test.js` (the exposure and auth surface), plus new cases in `review2-identity.test.js` for `toQueryString`, `cooldownElapsed`, `interpretUpsertResult`, `isPersistableRecognitionStatus` and the model-metadata checks. §11 records that **none of it has been executed** — the sandbox still blocks every command, including `python -c "import ast"` |

Two of the review's observations were deliberately left as they are, and are
recorded rather than fixed:

- **The `E11000` concurrency path still has no automated test.** It cannot have
  one without a real MongoDB; the surrounding logic was extracted into
  `interpretUpsertResult()` so the part that *can* be tested without a database
  now is.
- **The route tests still read source text rather than issuing HTTP requests.**
  Issuing requests needs `express` and `mongoose` installed and a shell to run
  them in; neither exists here. §11 states plainly that a text assertion proves
  a guard is written, not that it rejects a real request.

---

**Work stops here, after Review 2, and awaits further instructions.**
