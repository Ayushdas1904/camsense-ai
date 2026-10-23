# CamSense AI — Face Recognition Pipeline (Review 2)

Technical reference for the identity layer. Companion to
[`ARCHITECTURE.md`](ARCHITECTURE.md) (system design) and
[`REVIEW2-REPORT.md`](REVIEW2-REPORT.md) (what was delivered and what was
verified).

**Status: implemented, never executed.** No ONNX weights were downloaded, no
MongoDB was available, and no test or service run was possible in the
environment this was built in. Nothing here is an accuracy claim.

---

## 1. The flow

```
FACE IMAGE
    |
    v
FACE DETECTION            YuNet — is a face present, and where?
    |
    v
EMBEDDING GENERATION      alignCrop (5 landmarks) -> SFace -> 128-d -> L2-normalize
    |
    v
IDENTITY MATCHING         cosine similarity vs. cached enrolled identities,
    |                     gated by a configurable threshold
    +------------------+
    |                  |
    v                  v
  KNOWN            UNKNOWN
    |                  |
    v                  v
ATTENDANCE       SECURITY EVENT
```

Face **detection** and face **recognition** are logically separate and stay
separate. Detection answers *is a face here*. Recognition answers *does it match
an enrolled identity*. YOLO provides person boxes; it is never asked to identify
anyone.

---

## 2. Module and interface map

### AI service (Python / FastAPI)

| File | Interface |
|---|---|
| `app/recognition/face_model.py` | `FaceDetectorModel` (`cv2.FaceDetectorYN`, `model_name = "yunet_2023mar"`) and `FaceEmbedderModel` (`cv2.FaceRecognizerSF`, 128-d). Each exposes a lock-guarded `instance()` classmethod, `available`, `last_error`, `model_name`, `embedding_dim`. These are the **only** places either OpenCV class is constructed. |
| `app/recognition/face_service.py` | `detect_faces(frame)`, `generate_embedding(frame, face)`, `cosine_similarity(a, b)`, `bbox_iou(a, b)`, `is_low_quality(face)`, `match_embedding(embedding, …)`, `register_face(image_bgr)`, `recognize_frame(frame, camera_id, …)`, `decode_image(data)`, `refresh_identity_cache(force)`, `recognition_available()`, `identity_labels_trustworthy()`, `recognition_status()`, plus the `RecognitionStatus` and `RegistrationStatus` vocabularies. |
| `app/recognition/embedding_cache.py` | `EmbeddingCache` / `embedding_cache` singleton: `ensure_fresh(blocking=…)`, `refresh_blocking()`, `is_stale(grace=…)`, `age_seconds()` / `attempt_age_seconds()`, `snapshot()`, `replace()`, `invalidate()`, `state()`. Holds one stacked NumPy matrix plus parallel metadata. Keeps **two clocks**: when data was last successfully loaded (freshness) and when a refresh was last attempted (back-off). |
| `app/recognition/face_detection.py` | `FaceDetector(Detector)` with `type = "face"`, `label = "Face Detection"` — a normal pipeline detector so face boxes travel the same path and overlay as human/weapon boxes. Reports **presence only**; it never attaches identity. |
| `app/services/pipeline.py` | `DetectionPipeline.run(frame, faces=None)`, `detector_status()`, `annotate(frame, detections, recognitions=None)`. Composes `HumanDetector`, `WeaponDetector`, `FaceDetector`. |
| `app/services/stream_manager.py` | Per-camera worker thread. Runs `pipeline.run()` on every processed frame; face detection and recognition run on every *N*th, with no blocking network I/O on this thread. |
| `app/services/event_reporter.py` | `report()` (Review 1 detections) and `report_recognition()` — separate rate limiters so neither leg starves the other, both POST from a background thread, with a **per-camera** in-flight cap, counted drops (`dropped_reports`) and a `shutdown()` drain. |
| `app/api/routes.py` | `POST /api/faces/register`, `POST /api/faces/cache/refresh`, `GET /api/faces/status`. Every route here except `/api/health` requires the shared service secret. |
| `app/api/security.py` | `require_service_secret` — the FastAPI dependency that verifies `x-ai-secret` (constant-time) and fails closed when no secret is configured. |
| `app/models/schemas.py` | The AI↔backend contract: `FaceBox`, `FaceRecognitionResult`, `FaceRegistrationRequest`, `FaceRegistrationResponse`, `RecognitionStatusResponse`, plus extended `SystemStatus` and `StreamStats`. |

> `app/recognition/face_recognition_service.py` is pre-Review-2 scaffolding whose
> methods raise `NotImplementedError`. It is superseded by `face_service.py` and
> is not part of the live pipeline.

### Backend (Node / Express)

| File | Interface |
|---|---|
| `src/services/identityRules.js` | Pure, dependency-free decision rules: `escapeRegex`, `toQueryString`, `buildPersonFilter`, `serializePerson`, `validateIdentityClaim`, `shouldRaiseUnknownAlert`, `cooldownElapsed`, `attendanceWriteDue`, `interpretUpsertResult`, `isPersistableRecognitionStatus`, `attendanceDuplicatePreventionReady`, `attendanceDateKey`, `normalizeRecognitionStatus`. Imports nothing — which is what makes the trust boundary unit-testable without MongoDB. |
| `src/services/personService.js` | `findPersonOrThrow`, `findPersonForVerification`, `listEnabledEmbeddings`, `notifyAiCacheRefresh`. |
| `src/services/attendanceService.js` | `markAttendance({ person, cameraId, similarity, recognitionEventId })`, `resetAttendanceThrottle`. |
| `src/services/recognitionService.js` | `ingestRecognition(payload)` — the single trusted path from a recognition result to persisted state. `resetUnknownState`. |
| `src/services/aiClient.js` | The only backend→AI door: `registerFace`, `refreshFaceCache`, `getFaceStatus` alongside the Review 1 methods. Attaches the `x-ai-secret` service credential to every call. |
| `src/config/db.js` | `connectDatabase`, `ensureCriticalIndexes`, `getAttendanceIndexState` — builds (`createIndexes`, which never drops an index it did not declare) and verifies the unique attendance index at startup, and records the outcome. |
| `src/utils/dedupeAttendance.js` | `npm run dedupe:attendance` — reports (and with `-- --apply` removes) duplicate `{ personId, date }` records so the unique index can be built. |
| `src/models/` | `Person.js`, `Attendance.js`, `RecognitionEvent.js`; `Alert.js` extended with `unknown_identity`. |
| `src/controllers/` | `personController.js` (CRUD + `registerPersonFace`), `attendanceController.js` (list / summary / detail), `recognitionEventController.js`, `aiController.js` (recognition ingest + embeddings). |
| `src/utils/snapshot.js` | `parseImageDataUrl`, `saveSnapshot` (optional `subdir`), `removeStoredImage`. Extended, not duplicated. |

### Frontend (React / TypeScript)

`pages/PeoplePage.tsx`, `pages/PersonDetailPage.tsx`,
`pages/AttendancePage.tsx`, `components/PersonFormModal.tsx`,
`components/FaceRegistrationStep.tsx`, `components/ui/Toast.tsx`, and
`services/{peopleService,attendanceService,recognitionService}.ts`. The
frontend `Person` type has **no embedding field**, so the type system itself
forbids the browser from holding a biometric vector.

---

## 3. Event flow, end to end

```
CAMERA FRAME (AI service worker thread)
    |  every processed frame: pipeline.run(frame, faces=…)        -> human / weapon (+ face on recognition frames)
    |  every Nth processed frame: face detection + recognize_frame -> FaceRecognitionResult[]
    v
POST {backend}/api/ai/recognition          header: x-ai-secret   (dispatched off the worker thread)
    |   { cameraId, mode, results: [ … + optional snapshot data URL ] }
    |   snapshots attached ONLY to non-KNOWN results, cropped to the face, max 3 per POST
    |   NO embedding is ever in this payload
    v
BACKEND VALIDATION  (recognitionService.ingestRecognition)
    |   independent re-verification: person active? recognition enabled?
    |   embedding dim == RECOGNITION_EMBEDDING_DIM? embeddingModel == reported model_name?
    |   similarity >= RECOGNITION_MATCH_THRESHOLD?
    |   any failure => DOWNGRADE to unknown
    |
    +-- KNOWN ---> RecognitionEvent(status:'known')        [once per KNOWN_EVENT_COOLDOWN
    |                   |                                  per camera+person]
    |                   v
    |              attendanceService.markAttendance()  -> atomic upsert on { personId, date }
    |                   |
    |                   v
    |              emit person:recognized  (+ attendance:marked only when created)
    |
    +-- UNKNOWN -> nobody enrolled? -> counted, nothing written
    |              otherwise: persistence rule, then cooldown
    |                   |
    |                   v
    |              snapshot saved via utils/snapshot.js (URL reference only)
    |              RecognitionEvent(status:'unknown') + Alert(type:'unknown_identity', severity:'warning')
    |                   |
    |                   v
    |              emit alert:new + identity:unknown      (EXISTING alert machinery)
    |
    +-- LOW_QUALITY / NO_FACE / RECOGNITION_UNAVAILABLE -> counted, nothing persisted, no alert
    v
MONGODB  (people, attendances, recognitionevents, alerts)
    v
SOCKET.IO -> REACT DASHBOARD
```

Real-time events **supplement** persistence, they do not replace it. A client
that reconnects re-fetches from `GET /api/attendance`,
`GET /api/recognition-events` and `GET /api/alerts`, so nothing is lost by
missing a socket message.

**Trust boundary.** The only write path for a verified identity or an attendance
record is `POST /api/ai/recognition`, gated by the `x-ai-secret` shared secret.
No authenticated browser client can create either. The attendance and
recognition-event routers are GET-only by design.

**Both directions of that boundary are authenticated.** The AI service requires
the same shared secret on every route except `GET /api/health` — including
`POST /api/faces/register`, which returns a newly generated embedding, and
`POST /api/faces/cache/refresh`, which is state-changing. The gate
(`app/api/security.py`) compares the credential in constant time and rejects
every request when no secret is configured, rather than falling open. Both
services bind `127.0.0.1` by default.

**Stored images are authenticated too.** Registration portraits and cropped
face snapshots live under the backend's `uploads/` tree and are served only
through the gated `/uploads` mount. An `<img>` tag cannot send an
`Authorization` header, so that mount also accepts a **narrowed** token in
`?token=` — scoped to asset reads, shorter-lived than the session
(`ASSET_TOKEN_EXPIRES_IN`, default 1 d), and minted alongside the session by
`POST /api/auth/login` and `GET /api/auth/me`. A full session token presented
there is **rejected**, because an image URL ends up in browser history and any
fronting proxy's log.

---

## 4. Recognition status state machine

| Status | Condition | Attendance? | Alert? |
|---|---|---|---|
| `KNOWN` | A candidate cleared the configured threshold **and** survived the backend's independent re-verification | Yes | No |
| `UNKNOWN` | A usable face was detected, the pipeline was available, and no candidate cleared the threshold | **Never** | Yes, after persistence + cooldown — and only if somebody is enrolled |
| `LOW_QUALITY` | A face was found but its shortest side is below `AI_SERVICE_FACE_MIN_SIZE` (default 60 px) — too few pixels to judge | No | No |
| `NO_FACE` | No usable face in the frame or image | No | No |
| `RECOGNITION_UNAVAILABLE` | A model is unavailable, the identity cache has never loaded, or the cache is **stale** — last *successfully* loaded more than TTL + grace ago, or superseded by an invalidation that has not been replaced | No | **Never** |

Four rules this encodes:

1. **The closest candidate is not a match.** Below threshold is `UNKNOWN`, full
   stop. `match_embedding()` returns the runner-up similarity for diagnostics but
   never promotes a sub-threshold best.
2. **An unavailable pipeline never produces an unknown-person alert.** It
   returns `RECOGNITION_UNAVAILABLE`, not `UNKNOWN`. Missing weights, an
   unreachable backend, or an identity cache that never loaded can never
   manufacture a security event. Nor can a camera connection failure — that is a
   camera error, handled by the Review 1 stream worker.
3. **A poor-quality or partially visible face is not a threat.** It is
   `LOW_QUALITY`, which is a *measurement* statement, not a *security* one.
4. **An untrustworthy identity set withdraws recognition rather than guessing.**
   Staleness is measured from the last **successful** load, not the last
   refresh *attempt* — that distinction is the whole gate: while it was
   measured from the attempt, every failed refresh reset the clock, so a cache
   whose refreshes kept failing never aged past the threshold and the gate
   could not fire. A set is therefore untrustworthy when either

   * `AI_SERVICE_EMBEDDING_CACHE_TTL` + `AI_SERVICE_EMBEDDING_CACHE_STALE_GRACE`
     have passed since it was last loaded successfully (refreshes have been
     failing for roughly two TTL cycles), or
   * the backend has told us it changed (`POST /api/faces/cache/refresh`, sent
     on every person create / edit / disable / delete) and the replacement has
     not landed yet — the current generation may still name somebody who must
     no longer be matched, so it is distrusted immediately rather than until
     its TTL runs out.

   In either case matching fails closed (`IDENTITY_CACHE_STALE`) and the video
   overlay stops drawing names — the box reads *IDENTITY UNVERIFIED* (the
   overlay withdraws at TTL with no grace, since it is cosmetic). The
   recognition status reports `cache_stale` so an operator can see why. The
   data itself is kept, not erased: a refresh that succeeds restores matching
   immediately.

   A forced refresh is also never lost to one already in flight. It supersedes
   it, and a fetch whose result predates a known change is discarded instead of
   installed — otherwise the list read *before* a person was deleted could
   overwrite the list read after.

**Nobody enrolled is a special case.** With an empty enrolled set every face
legitimately produces `UNKNOWN` / `NO_ENROLLED_IDENTITIES`. The backend counts
those sightings and writes nothing: alerting there would make a freshly deployed
system indistinguishable from one detecting intruders.

An embedding whose dimension or model name disagrees with the live embedder is
**dropped and counted** — never padded, truncated, or scored. The backend
re-applies both checks at its own trust boundary, against
`RECOGNITION_EMBEDDING_DIM` and the `model_name` the reporter sent.

---

## 5. Unknown-identity persistence and cooldown

Two gates, both configurable in `backend/.env`:

| Rule | Key | Default |
|---|---|---|
| Sightings required before alerting | `UNKNOWN_PERSISTENCE_COUNT` | `2` |
| Window those sightings must fall inside | `UNKNOWN_PERSISTENCE_WINDOW` | `10` s |
| Suppression after an alert, per camera + track | `UNKNOWN_ALERT_COOLDOWN` | `60` s |

Before either gate, an empty enrolled set suppresses the event entirely
(`ENROLLED_COUNT_TTL`, default 30 s, controls how often that count is
re-checked).

The symmetric gate on the other status is `KNOWN_EVENT_COOLDOWN` (default
30 s), per camera and person: a verified match inside the cooldown still
refreshes attendance but writes no second recognition event and pushes no
second socket payload. Without it one recognised person standing in view
produces an event per recognition report, indefinitely.

State is an in-memory `Map` keyed by camera + track, following the same pattern
Review 1's `eventService.js` uses for detection cooldowns. A restart clears it,
which costs at most one extra alert.

Every cooldown and persistence window is measured on the **backend's own
clock**, not the reported timestamp: a reporting host whose clock ran ahead
would otherwise write a future time into the map and suppress every later
sighting until local time caught up. The reported timestamp is what gets stored
on the event — clamped to local time, with a warning, if it is more than two
minutes in the future.

The **track id** is a transient per-worker handle assigned by greedy bbox-IoU
association against the previous recognition pass, with a short expiry. Its only
job is de-duplicating repeated sightings of one continuously visible face. **It
makes no claim about anyone's real identity.**

An unknown-identity alert is `severity: 'warning'`, never `critical`, and its
message states that the face could not be matched to a registered person. An
unmatched face is not evidence of wrongdoing.

---

## 6. Attendance session policy

**One record per person per calendar date.** The session key is the local day as
`YYYY-MM-DD`; `Attendance.sessionKey` mirrors `Attendance.date` so a future
finer granularity (morning/afternoon) needs only a new key generator and index,
not a migration.

Duplicate prevention is enforced by the **database**:

- unique compound index **`{ personId: 1, date: 1 }`**, built and verified at
  startup by `ensureCriticalIndexes()` in `backend/src/config/db.js`. It is
  built with `createIndexes()` (never `syncIndexes()`, which would also drop
  any index an operator added out of band) and then read back to confirm a
  *unique* index exists on exactly that key. If it cannot be built or verified
  — duplicates already in the collection, or a database user without index
  privileges — **attendance writes are disabled** and every attempt is
  rejected with `duplicate_prevention_unverified`, rather than running with the
  upsert as its only protection. Everything that does not depend on attendance
  (detection, alerts, cameras, people) keeps working; `npm run dedupe:attendance`
  reports the duplicate keys, and `npm run dedupe:attendance -- --apply`
  removes them and re-verifies the index;
- a single atomic `findOneAndUpdate` upsert on that key — `$setOnInsert` writes
  `firstSeen`, `cameraId`, `source`, `similarity`, `recognitionEventId`,
  `status: 'present'`; `$set` always refreshes `lastSeen`;
- the **`E11000`** duplicate-key error from a genuinely concurrent insert is
  caught, the existing record re-read, and returned as `created: false`;
- whether this call inserted is read by the pure `interpretUpsertResult()` in
  `identityRules.js`, which has unit tests for every result shape including the
  fallback.

No frontend check participates in this. `ATTENDANCE_UPDATE_COOLDOWN` (default
30 s) throttles how often `lastSeen` is rewritten and is an efficiency guard
only; its timestamp is recorded **after** a successful write, so a failed write
does not block retries.

`status` is `'present'` for everything this implementation writes. `'late'` and
`'absent'` remain in the enum but are **not implemented**: the project defines no
timetable and no late-arrival rule, and inventing one would fabricate policy.

---

## 7. Performance measures

| Measure | Where |
|---|---|
| Models constructed exactly once, behind a lock-guarded `instance()` | `face_model.py` |
| Face detection AND recognition run on every *N*th processed frame (default 3); object detection on every one | `stream_manager.py` + `AI_SERVICE_FACE_RECOGNITION_EVERY_N_FRAMES` |
| Frame skipping to `AI_SERVICE_TARGET_FPS` and resize to `AI_SERVICE_FRAME_WIDTH` before inference | `stream_manager.py` (Review 1, reused) |
| Enrolled embeddings cached, never recomputed at match time | `embedding_cache.py` |
| Similarity computed as one matrix dot product over stacked candidates | `face_service.match_embedding` |
| On a recognition frame, YuNet runs **once** and the records are shared with `pipeline.run(frame, faces=…)`; on other frames an empty list is passed, so it does not run at all | `stream_manager.py` |
| Identity-cache refresh dispatched to a background thread; unforced refreshes deduplicate to one in flight, a forced one always runs | `embedding_cache.ensure_fresh(blocking=False)` |
| Both report legs POST from a background thread, with a per-camera in-flight cap and sub-frame timeouts | `event_reporter._dispatch` + `AI_SERVICE_REPORT_TIMEOUT` |
| Recognition reporting rate-limited per camera, on its **own** limiter | `event_reporter.report_recognition` |
| Stored `known` events and their socket emits throttled per camera + person | `KNOWN_EVENT_COOLDOWN` |
| Attendance `lastSeen` writes throttled | `ATTENDANCE_UPDATE_COOLDOWN` |
| Alert writes gated by persistence + cooldown, and by an empty-roster check | `recognitionService.js` |
| "Is anybody enrolled?" counted once per TTL, not per reported face | `ENROLLED_COUNT_TTL` |

Recognition work is additive to the Review 1 loop, individually wrapped in
`try/except`, and performs **no blocking network I/O on the camera thread** —
the identity-cache fetch and the report POST both run on background threads, so
a backend that accepts connections but stalls cannot hold up human and weapon
detection.

The visible cost of gating face detection on the recognition cadence: the grey
face boxes and the `faces` stat update every *N*th processed frame rather than
every frame. Identity labels from the most recent pass are redrawn for a short
TTL so they do not flicker.

---

## 8. Failure modes handled

| Failure | Behaviour |
|---|---|
| ONNX model file missing or unreadable | `available = False` + diagnostic; service starts; YOLO active; status reports UNAVAILABLE |
| OpenCV build without `FaceDetectorYN` / `FaceRecognizerSF` | Same path — caught at construction, never raised |
| Undecodable or non-image upload | `INVALID_IMAGE`, returned as a 200 structured result, relayed verbatim |
| No face in a registration photograph | `NO_FACE` → *"No usable face was detected. Please upload another image."* |
| Multiple faces in a registration photograph | `MULTIPLE_FACES` → *"Registration photograph contains multiple faces."* No embedding from an arbitrary region |
| Face too small to embed | `LOW_QUALITY`; not enrolled, not matched |
| Embedding dimension / model mismatch | Candidate dropped and counted; never compared |
| Backend unreachable during a cache refresh | Previous cache **kept**, error surfaced, refresh retried at the next TTL. Never silently cleared, never crashes the worker, never blocks the camera thread (the fetch runs on a background thread) |
| Backend unreachable for longer than TTL + grace **since the last successful load** | Cache treated as stale: matching reports `RECOGNITION_UNAVAILABLE` / `IDENTITY_CACHE_STALE` and the overlay stops drawing names. Fail closed, because a stale set may still contain a disabled or deleted person |
| A cache-invalidation notification cannot be satisfied (the forced refresh fails) | The current generation is marked superseded and treated as stale immediately — distrusted until a replacement is installed, rather than trusted for the rest of its TTL |
| A refresh returns data read **before** a person was deleted or disabled | Discarded, not installed: an invalidation bumps a generation counter and any fetch that predates it is dropped. `POST /api/faces/cache/refresh` reports `refreshed: false` so the backend does not log a refresh that did not happen |
| Identity cache never loaded | `RECOGNITION_UNAVAILABLE` — not `UNKNOWN` |
| Nobody enrolled | Faces still report `UNKNOWN`; the backend counts them and writes no event or alert |
| Wrong or missing `x-ai-secret` | The AI service returns 401 and the backend reports a credential-mismatch message naming the two variables (never their values). With no secret configured at all, the AI service has no default to compare against and returns 503 naming the variable to set |
| Unique attendance index cannot be built | Attendance writes are refused (`duplicate_prevention_unverified`) and the reason is logged with its remediation. The process keeps running, so detection, alerts and camera control are unaffected |
| Backend stalls mid-POST | The POST is already on a background thread with a sub-frame timeout. Once the per-camera in-flight cap is reached further reports are dropped — counted in `recognition_reports_dropped`, and the Attendance Service status goes to ERROR, because a dropped report means the backend never learned about that sighting. Detection cadence is unaffected |
| Service exits with POSTs in flight | `reporter.shutdown()` waits briefly (2 s) so a pending unknown-identity report and its snapshot are delivered rather than abandoned |
| AI service unreachable from the backend | `aiClient` maps it to a 503 "temporarily unavailable"; registration explicitly reports the person was **not** marked recognition-ready |
| Recognition raises inside a stream worker | Counted in `recognition_errors`, logged; YOLO detection, the MJPEG stream, and detection reporting continue |
| Concurrent attendance writes | Unique index + `E11000` handling → exactly one record |
| Recognition result for a deleted/disabled person | Backend re-verification rejects it and downgrades to unknown |
| Model initialisation error at startup | Caught in the lifespan; the identity prefetch failure is non-fatal |

A recognition-module failure degrades the identity layer only. It does not take
down the application.
