# CamSense AI — Smart CCTV Intelligence Platform

CamSense AI adds an intelligence layer on top of ordinary CCTV cameras:

> **CAMERA → SEE → UNDERSTAND → GENERATE EVENT → TAKE ACTION**

Instead of recording video for humans to watch, the platform understands what
is happening in a feed — detecting people and weapons, recognizing registered
individuals, automating attendance, monitoring occupancy, optimizing energy,
and raising security alerts.

**Current status: Review 1 — "Teach CCTV to SEE" and Review 2 — "Teach CCTV to
IDENTIFY" are implemented.** Review 1 is a working AI surveillance pipeline:
cameras → video → YOLO detection → events → alerts → live dashboard. Review 2
adds the identity layer on top of it: person registration, face detection, face
embeddings, identity matching, automated attendance, and unknown-identity
alerts.

> **Read this before evaluating Review 2:** the Review 2 code was written but
> **never executed** — no test, build, typecheck, install, or service start has
> been run, because shell execution was unavailable in the environment it was
> written in. See [`docs/REVIEW2-REPORT.md`](docs/REVIEW2-REPORT.md) §11 for the
> exact, per-command record of what was and was not verified. Nothing in this
> README should be read as a claim of measured accuracy.

---

## Development roadmap

| Phase | Theme | Status |
|-------|-------|--------|
| **Foundation** | Architecture & scaffolding | ✅ Done |
| **Review 1** | *Teach CCTV to SEE* — cameras, streaming, human & weapon detection, events, alerts, live dashboard | ✅ Done |
| **Review 2** | *Teach CCTV to IDENTIFY* — person management, face recognition, attendance, unknown-identity alerts | ✅ Done (written, not yet executed — see the note above) |
| **Review 3** | *Teach CCTV to UNDERSTAND & ACT* — occupancy, energy, analytics | 🔜 Planned |

---

## Architecture

Two decoupled data paths keep AI models away from the UI:

```
FRONTEND  ──►  APPLICATION BACKEND  ──►  DATABASE
(React)        (Node + Express)          (MongoDB)

VIDEO/CAMERA ──► AI SERVICE ──► APPLICATION BACKEND ──► FRONTEND
                 (Python/FastAPI)  (Node)                (React)
```

The React frontend talks **only** to the Node backend (including the video
stream, which the backend proxies). The Node backend is the only thing that
talks to the Python AI service. Swapping a detection model is an
AI-service-internal change — the frontend never sees it.

```
camsense-ai/
├── frontend/     React + Vite + TS + Tailwind (UI)
├── backend/      Node + Express + Mongoose (API, auth, data, real-time)
├── ai-service/   Python + FastAPI + OpenCV + YOLOv8 (computer vision)
├── models/       Model weights (downloaded, not committed)
├── docs/         Architecture notes
└── README.md
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design,
[`docs/FACE_RECOGNITION.md`](docs/FACE_RECOGNITION.md) for the Review 2 identity
pipeline, and [`docs/REVIEW2-REPORT.md`](docs/REVIEW2-REPORT.md) for the Review 2
delivery report (including exactly what was and was not verified).

---

## Technology stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite, TypeScript, Tailwind CSS, React Router, Redux Toolkit, Axios, Socket.IO client, Lucide, Recharts |
| Backend | Node.js, Express, Mongoose, JWT, bcryptjs, Zod, Socket.IO, Helmet |
| AI service | Python 3, FastAPI, Uvicorn, OpenCV, Ultralytics YOLOv8, Pydantic |
| Database | MongoDB |
| Real-time | Socket.IO |

---

## Prerequisites

- **Node.js** ≥ 18 and npm
- **Python** ≥ 3.10 (3.12 recommended)
- **MongoDB** ≥ 6 — local `mongod`, or a free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster
- ~1.5 GB free disk (the AI stack pulls PyTorch on first install)
- Internet on first run (to download Python/JS packages, YOLO weights, and the sample video)

> **macOS note:** port `5000` is used by the AirPlay Receiver, so this project
> is documented as running the backend on **5050**. The committed defaults are
> *not* consistent on this point and you should set them explicitly:
> `backend/.env.example` ships `PORT=5000` (and `backend/src/config/env.js`
> falls back to `5000`), `frontend/.env.example` points at
> `http://localhost:5000/api`, while the AI service's default
> `AI_SERVICE_BACKEND_URL` is `http://127.0.0.1:5050`. Pick one port and set it
> in all three: either put `PORT=5050` in `backend/.env` and
> `VITE_API_BASE_URL=http://localhost:5050/api` in `frontend/.env` (the
> arrangement the rest of this README assumes), or set
> `AI_SERVICE_BACKEND_URL=http://127.0.0.1:5000` instead.

---

## Quick start

Clone the repo, then set up **three services**. Each has its own `.env.example`.

```bash
git clone https://github.com/Ayushdas1904/camsense-ai.git
cd camsense-ai
```

### 1. MongoDB

Make sure MongoDB is running and reachable at `mongodb://127.0.0.1:27017`
(or set your own `MONGODB_URI` in `backend/.env`).

<details>
<summary>Run a local MongoDB with Homebrew (macOS)</summary>

```bash
brew tap mongodb/brew
brew install mongodb-community
# run it (foreground, data in a folder you choose):
mkdir -p ~/.camsense/mongo-data
mongod --dbpath ~/.camsense/mongo-data --port 27017 --bind_ip 127.0.0.1
```

`--bind_ip 127.0.0.1` is mongod's own default and is stated explicitly here on
purpose: a database must not be reachable from other machines. Do not replace it
with `--bind_ip_all`.
</details>

### 2. AI service — `http://localhost:8000`

```bash
cd ai-service
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt    # installs OpenCV + YOLO (pulls PyTorch, ~1 GB)
python download_assets.py          # downloads yolov8n.pt + the demo video (one-time)
cp .env.example .env
uvicorn app.main:app --reload
```

Health: <http://localhost:8000/api/health> · API docs: <http://localhost:8000/docs>

### 3. Backend — `http://localhost:5050`

```bash
cd backend
cp .env.example .env               # then set MONGODB_URI, JWT_SECRET, AI_INGEST_SECRET
npm install
npm run seed                       # creates the admin account (needs MongoDB)
npm run seed:cameras               # creates two demo cameras (CAM-01, CAM-02)
npm run dev                        # http://localhost:5050
```

Health: <http://localhost:5050/api/health>

> **Important:** `AI_INGEST_SECRET` in `backend/.env` **must equal**
> `AI_SERVICE_INGEST_SECRET` in `ai-service/.env`. That shared secret
> authenticates the traffic in **both** directions: the AI service sends it when
> reporting detections and recognition results to the backend, and the AI
> service **requires** it on every one of its own routes except
> `/api/health` — including `POST /api/faces/register`, which returns a face
> embedding. **Neither side has a default value**, on purpose: a default could
> never match the other side's, so an unset secret makes both ends fail closed
> with a message naming the variable instead of 401ing every call. Set it and
> keep the two in step; if they differ, monitoring and face registration fail
> with an authentication error rather than silently working.
>
> **Both services bind `127.0.0.1` by default.** They are not reachable from
> other machines unless you set `HOST` / `AI_SERVICE_HOST` deliberately.

### 4. Frontend — `http://localhost:5173`

```bash
cd frontend
cp .env.example .env               # VITE_API_BASE_URL should point at the backend (5050)
npm install
npm run dev
```

Open **<http://localhost:5173>** and sign in:

- **Email:** the `SEED_ADMIN_EMAIL` from `backend/.env` (default `admin@camsense.ai`)
- **Password:** the `SEED_ADMIN_PASSWORD` from `backend/.env` (default `ChangeMe123!`)

---

## Try the demo (Review 1)

1. **Login** → land on the **Dashboard** (real camera / AI / alert counts).
2. **Cameras** → see the two seeded cameras; add / edit / delete your own.
3. **Live Monitoring** → pick *Main Entrance (CAM-01)* → **Start Stream**.
   - The bundled pedestrian video streams with **real YOLO person boxes**, plus
     live FPS, inference time, and people count.
4. Click **“Trigger demo weapon (DEMO)”** → a **CRITICAL** alert appears live on
   the Dashboard and Alerts page (clearly labelled DEMO — see below).
5. **Alerts** → open the alert to see its snapshot, then **Acknowledge / Resolve**.

### DEMO mode vs REAL mode

The system runs without CCTV hardware. A camera's **mode** selects the source:

- **DEMO** — processes the bundled `vtest.avi` sample video (real detections on real pedestrians).
- **REAL** — set the camera's mode to `real` and give it an RTSP/IP `streamUrl`.

Every detection carries a `source` (`real` / `demo`). Simulated detections are
always labelled `demo` and never presented as real AI output.

### About weapon detection (honest note)

The bundled `yolov8n` (COCO) model can genuinely detect **knife / scissors**,
but **not firearms** — COCO has no gun class. So real weapon detection is
limited to bladed objects, and the *“Trigger demo weapon (DEMO)”* button injects
a clearly-labelled demo event so the critical-alert pipeline is demonstrable.
---

## Review 2 — "Teach CCTV to IDENTIFY"

Review 1 taught the system to **see**. Review 2 teaches it to **identify**: who
is in frame, whether they are enrolled, and whether that justifies an
attendance record or a review-this-face alert.

> **Honesty note, up front.** Everything in this section describes code that
> exists and was statically verified against the sources it calls. **None of it
> has been run.** No ONNX weights were downloaded, no MongoDB was available, no
> service was started, and no test was executed — shell execution was blocked by
> the OS sandbox for the whole implementation. No accuracy figure is claimed
> anywhere, because no evaluation was performed. See
> [`docs/REVIEW2-REPORT.md`](docs/REVIEW2-REPORT.md).

### Objective and new modules

| Module | Where | What it does |
|---|---|---|
| Person management | `frontend/src/pages/PeoplePage.tsx`, `PersonDetailPage.tsx`, `backend/.../personController.js` | Register, search, filter, edit, enable/disable recognition, deactivate or delete people |
| Face registration | `frontend/src/components/FaceRegistrationStep.tsx`, `POST /api/people/:id/face-registration` | Validates a photograph, requires exactly one usable face, enrolls an embedding |
| Face detection | `ai-service/app/recognition/face_detection.py` | Presence and location only — answers *is a face here, and where* |
| Face recognition | `ai-service/app/recognition/face_service.py` | Embedding + threshold-gated matching — answers *does this face match an enrolled identity* |
| Identity cache | `ai-service/app/recognition/embedding_cache.py` | Holds enrolled embeddings as one stacked matrix for vectorized comparison |
| Attendance | `backend/src/services/attendanceService.js`, `frontend/src/pages/AttendancePage.tsx` | One record per person per day, created only from a verified match |
| Recognition events | `backend/src/models/RecognitionEvent.js`, `GET /api/recognition-events` | The structured outcome of every recognition attempt worth persisting |
| Unknown-identity alerts | `backend/src/services/recognitionService.js` → existing `Alert` model | Folded into the **existing** Alerts page, acknowledge/resolve flow unchanged |

The identity pipeline:

```
CAMERA / VIDEO ──► FACE DETECTION ──► ALIGN ──► EMBEDDING ──► MATCH
                                                                │
                                        ┌───────────────────────┴───────────────┐
                                        ▼                                       ▼
                                   KNOWN PERSON                          UNKNOWN IDENTITY
                                        │                                       │
                                   ATTENDANCE CHECK                      SECURITY ALERT
                                        │                                       │
                                        └──────────► NODE BACKEND ◄─────────────┘
                                                          │
                                                       MONGODB
                                                          │
                                                   REACT DASHBOARD
```

Full technical detail: [`docs/FACE_RECOGNITION.md`](docs/FACE_RECOGNITION.md).

### Face-recognition model: YuNet + SFace, via OpenCV

| Role | Model | File | Size |
|---|---|---|---|
| Face **detection** + 5 landmarks | YuNet (`cv2.FaceDetectorYN`) | `models/face_detection_yunet_2023mar.onnx` | ~230 KB |
| Face **embedding** (128-d) | SFace (`cv2.FaceRecognizerSF`) | `models/face_recognition_sface_2021dec.onnx` | ~37 MB |

**Why this pair.** It adds **zero new pip packages**. Both classes ship inside
the already-pinned `opencv-python-headless==4.10.0.84` (its `objdetect`/`dnn`
modules), it runs on CPU, it is compatible with the existing `numpy<2` pin, and
YuNet's 5 landmarks are exactly what `cv2.FaceRecognizerSF.alignCrop` consumes —
so the pipeline gets genuine face **alignment**, not a naive crop. One library,
not three.

**Why not the alternatives**, in this environment:

- `face-recognition` / dlib — needs a native dlib compile; no wheel for this
  platform/Python combination. The old `# face-recognition==1.3.0` placeholder
  in `requirements.txt` was removed for this reason.
- `insightface` — needs a native/Cython build step.
- `deepface` — pulls TensorFlow, which conflicts with the CPU torch stack
  `ultralytics` installs and with `numpy<2`.

The full rationale also lives in the module docstring of
`ai-service/app/recognition/face_model.py`.

### Installing the model files

```bash
cd ai-service
source .venv/bin/activate
python download_assets.py     # fetches yolov8n.pt, vtest.avi, and BOTH face ONNX files
```

The script is idempotent (it skips files already present) and fails *softly*,
printing the exact target path so you can drop a file in by hand. Both weights
land in `models/` at the repository root and are **not committed** —
`.gitignore` already excludes `models/*.pt`, `models/*.onnx` and
`models/*.weights`.

**If the weights are absent the service still starts.** `FaceDetectorModel` and
`FaceEmbedderModel` catch the load failure, set `available = False`, and print a
diagnostic instead of raising. YOLO human/weapon detection keeps working, and
the status panel reports face detection and face recognition as **UNAVAILABLE**
rather than pretending otherwise.

### New environment variables

**`ai-service/.env`** (every key carries the `AI_SERVICE_` prefix):

| Key | Default | Meaning |
|---|---|---|
| `AI_SERVICE_FACE_DETECTION_MODEL_PATH` | `../models/face_detection_yunet_2023mar.onnx` | YuNet weights |
| `AI_SERVICE_FACE_RECOGNITION_MODEL_PATH` | `../models/face_recognition_sface_2021dec.onnx` | SFace weights |
| `AI_SERVICE_FACE_DETECTION_CONFIDENCE` | `0.80` | YuNet score below which a face box is discarded |
| `AI_SERVICE_FACE_MATCH_THRESHOLD` | `0.363` | Cosine similarity a candidate must clear to be KNOWN |
| `AI_SERVICE_FACE_MIN_SIZE` | `60` | Minimum face side in px; smaller → `LOW_QUALITY`, never matched |
| `AI_SERVICE_FACE_RECOGNITION_EVERY_N_FRAMES` | `3` | Recognition cadence, in processed frames |
| `AI_SERVICE_FACE_REGISTRATION_MAX_FACES` | `1` | Faces a registration photograph must contain |
| `AI_SERVICE_EMBEDDING_CACHE_TTL` | `60.0` | Seconds before enrolled identities are re-fetched |
| `AI_SERVICE_EMBEDDING_CACHE_STALE_GRACE` | `30.0` | Extra seconds past the TTL before a cache that keeps failing to refresh is withdrawn from matching (fail closed) |
| `AI_SERVICE_EMBEDDING_FETCH_TIMEOUT` | `3.0` | HTTP timeout for fetching enrolled identities (runs off the camera thread) |
| `AI_SERVICE_EMBEDDING_SOURCE_URL` | *(blank)* | Where embeddings are fetched from; blank → `AI_SERVICE_BACKEND_URL` |
| `AI_SERVICE_RECOGNITION_REPORT_INTERVAL` | `1.0` | Min seconds between recognition POSTs per camera |
| `AI_SERVICE_REPORT_TIMEOUT` | `2.0` | HTTP timeout for reporting to the backend (POSTs run off the camera thread) |
| `AI_SERVICE_HOST` | `127.0.0.1` | Bind address. Loopback by default — this service returns face embeddings to its one caller |

**`backend/.env`**:

| Key | Default | Meaning |
|---|---|---|
| `RECOGNITION_MATCH_THRESHOLD` | `0.363` | The backend's **own** threshold; it re-checks rather than trusting the AI verdict |
| `RECOGNITION_EMBEDDING_DIM` | `128` | Dimension the configured model produces; a stored vector of another size is rejected, not scored |
| `UNKNOWN_PERSISTENCE_COUNT` | `2` | Unknown sightings required before an alert |
| `UNKNOWN_PERSISTENCE_WINDOW` | `10` | Seconds those sightings must fall inside |
| `UNKNOWN_ALERT_COOLDOWN` | `60` | Seconds before the same camera/track can alert again |
| `KNOWN_EVENT_COOLDOWN` | `30` | Seconds before the same person on the same camera produces another stored recognition event + socket emit |
| `ENROLLED_COUNT_TTL` | `30` | Seconds the "is anybody enrolled?" count is cached for (with nobody enrolled, unknown-identity alerts are suppressed) |
| `ATTENDANCE_UPDATE_COOLDOWN` | `30` | Min gap between `lastSeen` writes for an already-marked person |
| `FACE_UPLOAD_MAX_BYTES` | `5000000` | Max decoded size of a registration photograph |
| `HOST` | `127.0.0.1` | Bind address. Loopback by default — the backend serves snapshots and registration portraits |

`frontend/.env` gains nothing — it still holds only `VITE_API_BASE_URL`. The
frontend never receives a credential and never calls the AI service.

### How to register a person

1. **People → Register Person.** Only *Name* and *Person ID* are required;
   email, category, department and role are optional.
2. Open the person and choose **Register face**. The stepwise panel walks
   through: enter details → upload a photograph → validate → register → confirm.
3. The image is read client-side into a base64 data URL and POSTed as JSON to
   `POST /api/people/:id/face-registration` (admin only). Multipart upload was
   deliberately avoided — `express.json` already permits 10 MB and the AI service
   already speaks base64, so no file-upload dependency was added.
4. The backend validates the declared mime (`png` / `jpeg` / `jpg` / `webp`) and
   the decoded byte length, then forwards the image to the AI service.
5. The AI service decodes it, detects faces, and returns a structured outcome.
   You will see one of these messages verbatim:
   - *"Face detected successfully."* then *"Face registration completed successfully."*
   - *"Registration photograph contains multiple faces."*
   - *"No usable face was detected. Please upload another image."*
   - or an explicit "face recognition is unavailable" message when the ONNX
     weights are missing.
6. **An embedding is stored only on `OK`.** If no valid embedding was produced
   the person stays visibly **not recognition-ready** — no partial success, and
   no embedding taken from an arbitrary region of the image.

### How embeddings are generated

```
image/frame → YuNet detect (bbox + 5 landmarks)
            → alignCrop(frame, landmark row)        ← genuine alignment
            → SFace feature()                       ← 128-d vector
            → L2-normalize                          ← so cosine == dot product
```

`generate_embedding()` in `ai-service/app/recognition/face_service.py` is the
**only** producer, and **both** callers — `register_face()` for enrollment and
`recognize_frame()` for live frames — go through it. One code path means
registration and recognition embeddings are always dimensionally and
normalizationally compatible. Each model is constructed exactly once behind a
lock-guarded `instance()` classmethod; nothing is reloaded per frame or per
request.

### How identity matching works

1. The AI service holds enrolled embeddings in a cache, fetched from the
   backend's shared-secret `GET /api/ai/face-embeddings`, stored as one stacked
   NumPy matrix plus parallel metadata.
2. A probe embedding is compared against **all** candidates in a single matrix
   dot product — not a Python loop per person. A registered person's embedding is
   never recomputed at match time.
3. A candidate whose embedding dimension or model name disagrees with the live
   embedder is **dropped and counted**, never padded, truncated, or scored.
4. The best similarity is compared to the threshold. **Being the closest
   candidate is not a match.** Below threshold → `UNKNOWN`.
5. Outcome is one of `KNOWN` / `UNKNOWN` / `LOW_QUALITY` / `NO_FACE` /
   `RECOGNITION_UNAVAILABLE`. An unavailable pipeline returns
   `RECOGNITION_UNAVAILABLE`, never `UNKNOWN` — so missing weights can never
   manufacture an unknown-person alert. The same applies to a **stale** identity
   cache: if refreshes keep failing for longer than
   `AI_SERVICE_EMBEDDING_CACHE_TTL` + `AI_SERVICE_EMBEDDING_CACHE_STALE_GRACE`,
   matching **fails closed** rather than scoring against a set that may still
   contain someone who has since been disabled or deleted, and the live video
   stops drawing names (the box reads *IDENTITY UNVERIFIED*).
6. The backend then **re-verifies independently**: it reloads the person
   (`active` and `recognitionEnabled`), checks the stored vector's dimension
   against `RECOGNITION_EMBEDDING_DIM` and its `embeddingModel` against the
   model the AI service says produced the probe, re-checks the similarity
   against its own `RECOGNITION_MATCH_THRESHOLD`, and **downgrades the result to
   unknown** if any check fails. A client can never assert an identity; the only
   write path is the shared-secret `POST /api/ai/recognition`.
7. A verified match is then subject to `KNOWN_EVENT_COOLDOWN` (default 30 s) per
   camera and person. Inside that window the sighting still refreshes
   attendance, but no second recognition event is stored and no second socket
   payload is pushed — one person standing in a doorway must not write an event
   per second forever.

### Configuring the recognition threshold

The default is **`0.363`**, set in both `ai-service/app/config.py`
(`AI_SERVICE_FACE_MATCH_THRESHOLD`) and `backend/src/config/env.js`
(`RECOGNITION_MATCH_THRESHOLD`).

**This is a documented starting point, not a validated or calibrated value.**
It is the figure OpenCV publishes for SFace cosine matching. It has **not** been
tuned against this project's enrolled population, cameras, or lighting, and no
accuracy evaluation of any kind has been performed here. A cosine similarity is
**not a probability** and must not be shown as one. Raise it to reduce false
matches, lower it to reduce missed matches, and validate on your own data before
trusting any number. Both services read it from the environment precisely so it
can be tuned without a code change.

### How attendance duplicate prevention works

Policy: **one attendance record per person per calendar date.** The date is the
local day as a `YYYY-MM-DD` string, and `sessionKey` mirrors it so a finer
session granularity later needs no migration.

Enforcement is in the **database**, not the frontend:

- `Attendance` carries a **unique compound index `{ personId: 1, date: 1 }`**.
- That index is **built and verified at startup** (`ensureCriticalIndexes()` in
  `backend/src/config/db.js` calls `createIndexes()` — never `syncIndexes()`,
  which would also drop any index an operator added out of band — and then
  reads the collection's indexes back to confirm a *unique* index on exactly
  that key).
- If it cannot be built or verified — because the collection already contains
  duplicate pairs, say, or the database user lacks index privileges —
  **attendance writes are refused** (`duplicate_prevention_unverified`) and the
  reason is logged with its remediation. The backend keeps running, so Review 1
  detection, alerts, camera control and people management are unaffected;
  only attendance, which is the thing that needs the guarantee, stops.
  `npm run dedupe:attendance` lists the duplicate keys (report only), and
  `npm run dedupe:attendance -- --apply` removes the extra records — keeping
  the earliest `firstSeen` and the latest `lastSeen` — then re-verifies the
  index.
- `attendanceService.markAttendance()` performs a single **atomic**
  `findOneAndUpdate` upsert on that key: `$setOnInsert` writes `firstSeen`,
  `cameraId`, `source`, `similarity`, `recognitionEventId` and
  `status: 'present'`; `$set` always refreshes `lastSeen`.
- A genuinely concurrent insert that still trips **`E11000`** is caught, the
  existing record re-read, and returned as `created: false`.
- Before any of that, the full validation sequence runs: person exists → is
  active → has recognition enabled → has a stored embedding of matching
  dimension → the similarity clears the backend threshold → the `cameraId`
  resolves to a real camera. Failing any step means no record.
- Unknown, low-quality and unavailable results **never** create attendance.
- There is deliberately **no client-facing `POST /api/attendance`**.

`ATTENDANCE_UPDATE_COOLDOWN` throttles how often `lastSeen` is rewritten. That
is an efficiency guard only — it is *not* the duplicate-prevention mechanism.

### How unknown-identity alerts work

An unknown-identity event requires **all** of: a usable face was detected, the
recognition pipeline was available (models loaded and the identity cache fresh),
**somebody is actually enrolled**, and no enrolled identity cleared the
threshold. Then two further gates apply:

- **Temporal persistence** — the same camera + transient track must be seen
  unknown `UNKNOWN_PERSISTENCE_COUNT` times inside
  `UNKNOWN_PERSISTENCE_WINDOW` seconds.
- **Cooldown** — `UNKNOWN_ALERT_COOLDOWN` seconds before the same camera/track
  can alert again, so one continuously visible face yields one alert.

**With nobody enrolled, nothing is raised at all.** An empty enrolled set means
every face legitimately fails to match, so a freshly deployed system would
otherwise alert on every visitor and look identical to one detecting intruders.
The backend counts those sightings and writes nothing (`ENROLLED_COUNT_TTL`
controls how often it re-checks).

The alert is created through the **existing** alert system: `Alert.type` gained
`unknown_identity` (the pre-existing `unknown_person` value was kept so stored
documents stay valid), severity is **`warning`, never `critical`**, and the
message states that the face could not be matched to a registered person. The
existing Alerts page, acknowledge and resolve actions are reused unchanged — no
second alert surface was built.

The track identifier is a **transient bbox-IoU session handle** used only to
de-duplicate repeated sightings. It makes no claim about anyone's real identity.

### New API endpoints (Review 2)

| Area | Endpoints |
|------|-----------|
| People | `GET/POST /api/people`, `GET/PUT/DELETE /api/people/:id`, `PATCH /api/people/:id/recognition` |
| Face registration | `POST /api/people/:id/face-registration` *(admin only; JSON body with a base64 image data URL)* |
| Attendance | `GET /api/attendance`, `GET /api/attendance/summary`, `GET /api/attendance/:id` *(read-only by design)* |
| Recognition events | `GET /api/recognition-events`, `GET /api/recognition-events/:id` |
| AI (service-to-service) | `POST /api/ai/recognition`, `GET /api/ai/face-embeddings` *(both shared-secret gated)* |

Reads need a JWT; **every person mutation additionally requires the `admin`
role**. New Socket.IO events: `person:recognized`, `identity:unknown`,
`attendance:marked`, `recognition:status`.

New endpoints on the **AI service** (called by the backend only, never the
browser, and **all three require the `x-ai-secret` service secret**):
`POST /api/faces/register`, `POST /api/faces/cache/refresh`,
`GET /api/faces/status`. The Review 1 stream endpoints on that service now
require the same secret; only `GET /api/health` is unauthenticated.

### New collections and indexes

| Collection | Indexes |
|---|---|
| `people` | `personId` unique · `email` unique **sparse** · `name` · `category` · `recognitionEnabled` · `active` · `{ category, active }` |
| `attendances` | **`{ personId, date }` unique** ← the duplicate-prevention mechanism · `{ date, personId }` · `personId` · `source` |
| `recognitionevents` | `cameraId` · `personId` · `status` · `timestamp` · `{ cameraId, timestamp: -1 }` |

Mongoose creates these on model registration; no separate migration step is
needed. `Alert` and `Detection` were extended in place — `Alert.type` gained
`unknown_identity`, and `Detection.type` already contained `face`.

### Running Review 2

The quick start above is unchanged — Review 2 adds exactly two things to it:

1. `python download_assets.py` now also fetches the two face ONNX files. If you
   set up the AI service before Review 2, re-run it.
2. Set the Review 2 keys in `backend/.env` and `ai-service/.env` if you want to
   depart from the defaults above. `AI_INGEST_SECRET` must still equal
   `AI_SERVICE_INGEST_SECRET` — the recognition leg and the embeddings endpoint
   both use that same shared secret.

No new npm package and no new pip package is required. Backend tests run with
`cd backend && npm test`; AI-service tests with
`cd ai-service && python -m unittest discover -s tests -v`. **Neither has ever
been executed** — see `docs/REVIEW2-REPORT.md` §11.

### Demonstrating Review 2

Use **consenting participants or suitable test images only.**

1. **Log in** and show the Review 1 dashboard.
2. **People → Register Person** — enroll a consenting participant.
3. **Register face** — show the detection message and the person flipping to
   *recognition ready*. An embedding exists only if this step reports `OK`.
4. **Live Monitoring** — select a camera and **Start Stream** (DEMO mode uses the
   bundled video; REAL mode uses an RTSP/IP URL).
5. **Recognition** — the Identity Results panel shows the matched name *only*
   when the similarity clears the threshold, labelled **face similarity** and
   kept visually separate from detection confidence.
6. **Attendance** — a verified match creates one record; the page updates live
   over `attendance:marked`.
7. **Duplicate prevention** — keep the same person in frame; repeated matches
   update `lastSeen` and create **no** second record.
8. **Unknown identity** — show an unenrolled face; with the pipeline available
   and no candidate clearing the threshold, the result is `UNKNOWN`.
9. **Alert** — after the persistence and cooldown rules are satisfied, the
   `unknown_identity` alert appears on the Dashboard and the existing Alerts page.
10. **Attendance review** — open Attendance and show the persisted record and the
    summary tiles, all read from `GET /api/attendance/summary`.
11. **Review 1 intact** — human detection, weapon detection, camera management,
    alert acknowledge/resolve and the demo-weapon button all still work.

If the ONNX weights are missing, steps 3, 5–9 will honestly report **face
recognition unavailable** and steps 1–2, 4, 10–11 still work. That is the
designed behaviour, not a workaround.

### Known limitations (Review 2)

- **Nothing in Review 2 has been executed.** No test, build, typecheck,
  install, service start, or database operation. Treat every behaviour described
  here as designed and statically reviewed, not demonstrated.
- **The `0.363` threshold is unvalidated** for this system.
- **No accuracy claim is made.** YuNet/SFace behaviour under pose, lighting,
  occlusion, masks and low resolution is untested here.
- **No liveness or anti-spoofing detection.** A printed photo or a phone screen
  held up to the camera may well match. Do not treat recognition as proof of
  physical presence.
- **No real face tracking** — only a transient bbox-IoU session handle for
  de-duplication within a camera worker.
- **Attendance is daily only.** No timetable, no late-arrival rule, so `late`
  is modelled in the enum but never written. Inventing a schedule would have
  fabricated policy.
- **Snapshots live on local disk** behind the backend's authenticated
  `/uploads` mount, with **no automatic retention or expiry job** — face images
  would accumulate until something removes them.
- **Image URLs carry a credential as a query parameter**, because an `<img>`
  tag cannot send an `Authorization` header. It is a **narrowed** token —
  scoped to `/uploads` reads and expiring on `ASSET_TOKEN_EXPIRES_IN` (default
  `1d`) rather than the 7-day session — and the session token itself is
  rejected there. The residual exposure: a snapshot URL copied out of the DOM
  stays usable for image reads until that token expires, and it can be recorded
  in a reverse proxy's access log. Per-path, per-object signed URLs (or a
  cookie restricted to `/uploads`) would narrow it further. **The MJPEG stream
  URL still carries the full session token** — that is inherited Review 1
  behaviour, left untouched here, and the next thing to narrow.
- **Recognition is withdrawn, not degraded, when the identity cache goes
  stale.** If the AI service cannot refresh its enrolled set for longer than the
  TTL plus grace *since its last successful load*, matching reports
  `RECOGNITION_UNAVAILABLE` and no names are drawn; a cache-refresh
  notification the service cannot satisfy withdraws matching immediately. That
  is deliberate (a stale set may still contain a disabled person), but it does
  mean a prolonged backend outage disables recognition rather than running on
  old data.
- **Unknown-identity alerting is suppressed entirely while nobody is enrolled**,
  so an empty system is quiet by design rather than alerting on everyone.
- **`KNOWN_EVENT_COOLDOWN` bounds the recognition event stream**, so the
  Identity Results panel and the `recognitionevents` collection record a
  recognised person about once every 30 s rather than continuously. The live
  video overlay still updates at the recognition cadence.
- **Recognition reports are dropped, not queued, under pressure.** Once four
  POSTs are in flight for a camera's recognition leg, further reports are
  discarded (a stale report is worth less than a responsive camera). Each drop
  is counted in `recognition_reports_dropped` on the camera's stats, and the
  **Attendance Service** status goes to ERROR for a minute afterwards, so the
  loss is visible rather than silent.
- **Attendance writes are disabled if the unique index cannot be verified.**
  That is fail-closed by design — see *How attendance duplicate prevention
  works* and `npm run dedupe:attendance`.
- **Review 1's firearm limitation is unchanged** (see the honest note above).
- Recognition overlays come from the server-drawn MJPEG frames and may lag the
  live frame by up to one recognition interval; no client-side box is drawn,
  deliberately, because a misaligned identity box is worse than none.
- Face-image quality assessment is a minimum-size check only.

### Biometric data handling

Face recognition processes **sensitive biometric information.** What this
implementation actually does:

- **Administrator-only enrollment.** Every person mutation — create, edit,
  recognition toggle, delete, and face registration — requires `requireAuth`
  **and** `requireRole('admin')`. Reads require authentication.
- **Protected storage.** `Person.faceEmbedding` is `select: false`, so it is
  excluded from every query unless explicitly requested, *and* a
  `toJSON`/`toObject` transform deletes it, so it cannot leak through an
  over-selecting query. Client responses are built by a field **whitelist**
  (`serializePerson`) that exposes only derived readiness metadata —
  `faceRegistered`, `recognitionReady`, `embeddingModel`, `embeddingDim`,
  `faceRegisteredAt`.
- **One emitting endpoint per service, both service-to-service.**
  `GET /api/ai/face-embeddings` is the only endpoint in the Node API that
  returns embeddings; on the Python AI service, `POST /api/faces/register`
  returns the vector it has just generated so the backend can store it. **Both**
  are gated by the `x-ai-secret` shared secret and neither is ever called by a
  browser. The frontend `Person` type has **no** embedding field at all, so the
  type system itself forbids the browser from holding a biometric vector.
- **No embedding or face image is logged.** Diagnostics print availability
  flags, candidate *counts*, model paths and exception messages only.
- **Uploads are validated** by declared mime type (`png`/`jpeg`/`jpg`/`webp`)
  and decoded byte length (`FACE_UPLOAD_MAX_BYTES`, default 5 MB).
- **Face images are stored by reference, and served only to signed-in users.**
  Registration photographs and event snapshots are written to disk under the
  backend's `uploads/` tree and referenced by URL. Image bytes are never
  embedded in a MongoDB document and nothing is placed in a public bucket. The
  `/uploads` mount requires authentication, so a portrait URL that has appeared
  in an `<img src>` does not keep working for anonymous callers.
- **The credential in an image URL is narrowed, not the session token.** An
  `<img>` tag cannot send an `Authorization` header, so `/uploads` also accepts
  a token in `?token=` — and that one must be the **asset token** the backend
  mints alongside the session (scoped to image reads, no role, no writes,
  `ASSET_TOKEN_EXPIRES_IN`, default `1d`). A full session token is **rejected**
  there, because an image URL ends up in browser history, devtools and any
  fronting proxy's log, and what leaks that way must not be a credential for
  the whole API. A long-open tab whose asset token expires shows broken
  thumbnails until it is reloaded; that is the intended trade.
- **Both services are private by default.** The backend and the AI service bind
  `127.0.0.1` unless `HOST` / `AI_SERVICE_HOST` is set deliberately, and MongoDB
  is reached over loopback.
- **Revocation exists.** Recognition can be disabled per person
  (`PATCH /api/people/:id/recognition`), and a person can be deactivated
  (`?deactivate=true`) or hard-deleted — which also clears the stored embedding
  and removes the stored photo file. Every such change triggers an AI-service
  cache refresh, so a disabled or deleted identity stops being matchable
  immediately rather than at TTL expiry.
- **Internal credentials stay server-side.** The shared secret lives only in
  backend and AI-service environment variables; no `.env.example` in this repo
  contains a real secret.

**What must not be claimed about this data.** Face embeddings are **not
anonymous and must not be described as impossible to reverse.** They are
derived from a person's face, they identify that person by design, and research
has repeatedly shown that recognizable face images can be reconstructed from
embedding vectors. Treat the `faceEmbedding` field with the same care as any
other identifying personal record.

**For real-world deployment** — beyond this academic project — you need informed
**consent** from every enrolled person, **lawful authorization** for biometric
processing in your jurisdiction, a written **retention and deletion policy**
(this implementation has no automatic expiry job), and **human review** before
any consequential action is taken on a recognition result. An unknown identity
means only that the system could not confidently match a face to a registered
person. It is **not** evidence that someone is unauthorized, and certainly not
that they are dangerous. Demonstrate with consenting participants or suitable
test images.



## Configuration reference

Each service ships a `.env.example`; copy it to `.env`. **No secrets are
committed** — never hardcode passwords, JWT secrets, or the ingest secret.

**`backend/.env`** — `PORT` (5050), `HOST` (`127.0.0.1`), `MONGODB_URI`,
`JWT_SECRET`, `JWT_EXPIRES_IN`, `ASSET_TOKEN_EXPIRES_IN` (`1d` — the narrowed
token used in `/uploads` image URLs), `AI_SERVICE_URL`, `AI_INGEST_SECRET` (no
default; must match the AI service), and throttling knobs:
`DETECTION_EVENT_COOLDOWN`, `WEAPON_ALERT_COOLDOWN`, `PERSON_ALERT_COOLDOWN`.
*Review 2 adds:* `RECOGNITION_MATCH_THRESHOLD`, `RECOGNITION_EMBEDDING_DIM`,
`UNKNOWN_PERSISTENCE_COUNT`, `UNKNOWN_PERSISTENCE_WINDOW`,
`UNKNOWN_ALERT_COOLDOWN`, `KNOWN_EVENT_COOLDOWN`, `ENROLLED_COUNT_TTL`,
`ATTENDANCE_UPDATE_COOLDOWN`, `FACE_UPLOAD_MAX_BYTES`.

**`ai-service/.env`** — `AI_SERVICE_HOST` (`127.0.0.1`), `AI_SERVICE_PORT`
(8000), `AI_SERVICE_DETECTION_MODE`, `AI_SERVICE_MODEL_PATH`,
`AI_SERVICE_PERSON_CONFIDENCE`, `AI_SERVICE_WEAPON_CONFIDENCE`,
`AI_SERVICE_TARGET_FPS`, `AI_SERVICE_BACKEND_URL`,
`AI_SERVICE_INGEST_SECRET` (must match the backend).
*Review 2 adds:* `AI_SERVICE_FACE_DETECTION_MODEL_PATH`,
`AI_SERVICE_FACE_RECOGNITION_MODEL_PATH`, `AI_SERVICE_FACE_DETECTION_CONFIDENCE`,
`AI_SERVICE_FACE_MATCH_THRESHOLD`, `AI_SERVICE_FACE_MIN_SIZE`,
`AI_SERVICE_FACE_RECOGNITION_EVERY_N_FRAMES`,
`AI_SERVICE_FACE_REGISTRATION_MAX_FACES`, `AI_SERVICE_EMBEDDING_CACHE_TTL`,
`AI_SERVICE_EMBEDDING_CACHE_STALE_GRACE`, `AI_SERVICE_EMBEDDING_FETCH_TIMEOUT`,
`AI_SERVICE_EMBEDDING_SOURCE_URL`, `AI_SERVICE_RECOGNITION_REPORT_INTERVAL`,
`AI_SERVICE_REPORT_TIMEOUT`.

**`frontend/.env`** — `VITE_API_BASE_URL` only (browser-exposed; no secrets).
Review 2 adds nothing here, by design.

---

## API overview (Review 1)

| Area | Endpoints |
|------|-----------|
| Auth | `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` |
| Cameras | `GET/POST /api/cameras`, `GET/PUT/DELETE /api/cameras/:id`, `POST /api/cameras/:id/monitor`, `GET /api/cameras/:id/stream`, `GET /api/cameras/:id/stats` |
| Detections | `GET /api/detections`, `GET /api/detections/:id` |
| Alerts | `GET /api/alerts`, `GET /api/alerts/:id`, `PATCH /api/alerts/:id/status` |
| Dashboard | `GET /api/dashboard/stats`, `GET /api/dashboard/recent-events` |
| AI | `GET /api/ai/status`, `POST /api/ai/ingest` *(service-to-service, shared secret)* |

All operator endpoints require a JWT (`Authorization: Bearer <token>`). Real-time
updates (`detection:new`, `alert:new`, `alert:updated`, `camera:status`,
`dashboard:update`) are pushed over Socket.IO.

## API overview (Review 2)

| Area | Endpoints |
|------|-----------|
| People | `GET/POST /api/people`, `GET/PUT/DELETE /api/people/:id`, `PATCH /api/people/:id/recognition` |
| Face registration | `POST /api/people/:id/face-registration` *(admin only)* |
| Attendance | `GET /api/attendance`, `GET /api/attendance/summary`, `GET /api/attendance/:id` |
| Recognition events | `GET /api/recognition-events`, `GET /api/recognition-events/:id` |
| AI | `POST /api/ai/recognition`, `GET /api/ai/face-embeddings` *(both service-to-service, shared secret)* |

Person **mutations** require the `admin` role in addition to a JWT. Attendance
and recognition-event routers are **GET-only**: attendance and verified identity
records are created solely by the trusted recognition workflow behind
`POST /api/ai/recognition`. Review 2 Socket.IO events: `person:recognized`,
`identity:unknown`, `attendance:marked`, `recognition:status`.

On the AI service (backend-only callers, all requiring `x-ai-secret`):
`POST /api/faces/register`, `POST /api/faces/cache/refresh`,
`GET /api/faces/status`. Its Review 1 stream and status endpoints require the
same secret; `GET /api/health` is the only unauthenticated route on that
service.

Stored images (`/uploads/...` — detection snapshots, cropped face snapshots and
registration portraits) are served through an **authenticated** static mount.
Because an `<img>` tag cannot send an `Authorization` header, the frontend's
`assetUrl()` appends the **asset token** (`ASSET_TOKEN_EXPIRES_IN`, default
`1d`) — a narrowed credential the backend issues with the session and accepts
only on that mount. The full session token is rejected in that query parameter.
`GET /api/auth/me` returns a fresh asset token on every session restore.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Backend exits on start | MongoDB isn't running / `MONGODB_URI` is wrong. |
| Log says "Attendance duplicate-prevention index NOT verified" and attendance is never marked | The unique `{ personId, date }` index could not be built — usually because the `attendances` collection already holds duplicate person+date records, sometimes because the database user cannot create indexes. Run `npm run dedupe:attendance` to see the duplicates, `npm run dedupe:attendance -- --apply` to remove them, then restart. Attendance writes stay disabled until the index verifies, because that index is what prevents duplicates; everything else (detection, alerts, cameras, people) keeps working. |
| Dashboard shows "AI Degraded" | The AI service isn't running, or `AI_SERVICE_URL` is wrong. |
| Alerts never appear when monitoring | `AI_INGEST_SECRET` (backend) ≠ `AI_SERVICE_INGEST_SECRET` (ai-service), or one of them is unset — neither has a default, so an unset value fails closed with a message naming the variable. |
| "The AI service rejected our service credentials" | Same cause, seen from the other direction: the AI service now requires the shared secret on every route except `/api/health`. Make the two values equal and restart both. |
| "AI_INGEST_SECRET is not set" / the AI service answers 503 naming `AI_SERVICE_INGEST_SECRET` | The shared secret is unset on that side. Set the same value in both `.env` files and restart. |
| Snapshots and registration portraits show as broken images | `/uploads` is authenticated. Make sure you are signed in — the frontend appends your **asset token** to image URLs, and it is refreshed on every page load. If a tab has been open longer than `ASSET_TOKEN_EXPIRES_IN`, reload it. A URL pasted into a private window will correctly return 401. |
| Live stream stays black | Run `python download_assets.py` — the model/video weren't downloaded. |
| First detection is slow | Normal — the model warms up once at AI-service startup. |
| Port 5000 conflict (macOS) | Expected; use 5050 for the backend. See the macOS note under *Prerequisites* — the committed defaults are inconsistent, so set `PORT` and `VITE_API_BASE_URL` explicitly. |
| Another machine cannot reach the backend or AI service | By design: both bind `127.0.0.1`. Use an SSH port-forward, or set `HOST` / `AI_SERVICE_HOST` deliberately and only on a private network. |
| Face Detection / Face Recognition show UNAVAILABLE | The ONNX weights are missing. Run `python download_assets.py` in `ai-service/` and restart it. Human and weapon detection keep working meanwhile. |
| "Face recognition is unavailable" on registration | Same cause. No embedding was stored and the person is correctly **not** recognition-ready. |
| Recognition shows UNAVAILABLE although the models loaded | The enrolled-identity cache could not be refreshed and has gone stale, so matching is failing closed. Check that the backend is reachable from the AI service and that the shared secret matches; `GET /api/ai/status` reports `cache_stale`. |
| A registered person is never recognized | Check: recognition enabled, person active, a face actually enrolled (`recognitionReady`), and the similarity threshold — `0.363` is an unvalidated default and may need tuning for your cameras. |
| Recognition works but no attendance appears | Attendance needs the similarity to clear the **backend's** `RECOGNITION_MATCH_THRESHOLD` *and* the `cameraId` to resolve to a real camera. One record per person per day — a second sighting only updates `lastSeen`. |
| A recognised person appears only intermittently in the Identity Results panel | Expected: `KNOWN_EVENT_COOLDOWN` (default 30 s) limits how often the same person on the same camera produces a stored event and a socket update. The video overlay still updates every recognition pass. |
| Unknown-identity alerts never fire | They require somebody to be enrolled (an empty roster suppresses them), then persistence (`UNKNOWN_PERSISTENCE_COUNT` sightings inside `UNKNOWN_PERSISTENCE_WINDOW`), and are then suppressed for `UNKNOWN_ALERT_COOLDOWN`. An unavailable pipeline never alerts, by design. |
| A deleted or disabled person is still matched | The AI service caches identities for `AI_SERVICE_EMBEDDING_CACHE_TTL` seconds. The backend forces a refresh on every person change; if that refresh fails (the AI service reports `refreshed: false` and the backend logs it), the cached set is marked out of date and matching stops using it until a replacement arrives, rather than trusting it for the rest of the TTL. |
| Attendance Service shows ERROR while the AI service and backend are both up | Recognition reports are being dropped because too many POSTs are in flight for that camera — usually a slow backend. Check `recognition_reports_dropped` on the camera's stats. |
