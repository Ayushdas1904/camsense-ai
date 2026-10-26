# CamSense AI — Smart CCTV Intelligence Platform

CamSense AI adds an intelligence layer on top of ordinary CCTV cameras:

> **CAMERA → SEE → UNDERSTAND → GENERATE EVENT → TAKE ACTION**

Instead of recording video for humans to watch, the platform understands what
is happening in a feed — detecting people and weapons, recognizing registered
individuals, automating attendance, monitoring occupancy, optimizing energy,
and raising security alerts.

**Current status: all three reviews are implemented.** Review 1 — *"Teach CCTV
to SEE"* — is a working AI surveillance pipeline: cameras → video → YOLO
detection → events → alerts → live dashboard. Review 2 — *"Teach CCTV to
IDENTIFY"* — adds the identity layer: person registration, face detection, face
embeddings, identity matching, automated attendance, and unknown-identity
alerts. Review 3 — *"Teach CCTV to UNDERSTAND & ACT"* — adds occupancy
estimation, room monitoring, occupancy-driven device automation through a
simulated adapter, transparent energy analytics, and the integrated dashboard.

> **Read this before evaluating any claim in this README.** The three reviews
> were written in an environment where shell execution was blocked, so for a
> long time nothing in Review 2 or Review 3 had ever been run. That has
> **partly** changed: the stack has since been started end to end and the
> automated suites have been executed. What is now actually known:
>
> | Checked | Result |
> |---|---|
> | `cd backend && npm test` | **192 tests, 192 pass, 0 fail** |
> | `cd frontend && npm run lint` | clean (no output) |
> | `cd frontend && npm run build` | succeeded — 2499 modules, ~1.9 s, with an advisory chunk-size warning |
> | `cd ai-service && python -m compileall app` | clean |
> | `cd ai-service && python -m unittest discover -s tests -v` | 91 tests collected; last observed run **90 pass / 1 fail**. The failure (`test_failed_refresh_keeps_previous_identities_and_records_the_error`) has since been fixed, but **the re-run has not been observed**, so this is not reported as 91/91 |
> | All four processes started; `GET /api/health` on 5050 and 8000 | both answered `ok` |
>
> What is **still** unverified: **no end-to-end camera, recognition,
> attendance, occupancy, device or energy workflow has been exercised through
> the UI.** No real physical device has ever been switched — device control is
> simulation-only. Every energy figure is an **estimate** from an
> operator-typed wattage against a declared baseline; there is no power meter
> and no measured saving is claimed. The `0.363` recognition threshold is
> OpenCV's published starting point and is **uncalibrated** for this
> deployment. Nothing here is a claim of measured accuracy.
>
> [`docs/REVIEW2-REPORT.md`](docs/REVIEW2-REPORT.md) §11,
> [`docs/REVIEW3-REPORT.md`](docs/REVIEW3-REPORT.md) §D and
> [`docs/REVIEW3-VERIFICATION.md`](docs/REVIEW3-VERIFICATION.md) record the
> per-command state **at implementation time**, when none of these commands had
> been executed. The table above supersedes them for the suites it lists, and
> nothing else.

---

## Development roadmap

| Phase | Theme | Status |
|-------|-------|--------|
| **Foundation** | Architecture & scaffolding | ✅ Done |
| **Review 1** | *Teach CCTV to SEE* — cameras, streaming, human & weapon detection, events, alerts, live dashboard | ✅ Done |
| **Review 2** | *Teach CCTV to IDENTIFY* — person management, face recognition, attendance, unknown-identity alerts | ✅ Done (unit tests run; no UI workflow exercised — see the note above) |
| **Review 3** | *Teach CCTV to UNDERSTAND & ACT* — occupancy, rooms, device automation, energy analytics, integrated dashboard | ✅ Done (unit tests run; no UI workflow exercised — see the note above) |

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
├── docs/         Architecture, face recognition, occupancy & energy, review reports
└── README.md
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design,
[`docs/FACE_RECOGNITION.md`](docs/FACE_RECOGNITION.md) for the Review 2 identity
pipeline, [`docs/OCCUPANCY_ENERGY.md`](docs/OCCUPANCY_ENERGY.md) for the Review 3
occupancy, automation and energy pipeline, and
[`docs/REVIEW2-REPORT.md`](docs/REVIEW2-REPORT.md) /
[`docs/REVIEW3-REPORT.md`](docs/REVIEW3-REPORT.md) for the delivery reports
(including exactly what was and was not verified).

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

| Requirement | Version | Notes |
|---|---|---|
| **Node.js** + npm | ≥ 18 | `backend/package.json` declares `engines.node >= 18` |
| **Python** | ≥ 3.10 | 3.12 is what this project was last run on |
| **MongoDB** | ≥ 6 | a local `mongod`, or a free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster |
| Free disk | ~1.5 GB | `pip install -r requirements.txt` pulls PyTorch transitively through `ultralytics` |
| Internet | first run only | npm + pip packages, YOLO weights, the sample video, and the two face ONNX files |

The first `pip install` takes several minutes and downloads roughly 1 GB. That
is normal and happens once.

### Ports

| Port | Process | Started by |
|---|---|---|
| `27017` | MongoDB | `mongod` (or Atlas, in which case set `MONGODB_URI`) |
| `8000` | Python AI service | `uvicorn app.main:app --reload` |
| `5050` | Node backend + Socket.IO | `npm run dev` in `backend/` |
| `5173` | Vite dev server (frontend) | `npm run dev` in `frontend/` |

**The backend runs on 5050, not 5000** — on macOS the AirPlay Receiver occupies
5000. This is the single most common cause of a half-working setup, so it has
its own section below.

---

## Setup from a fresh clone

Four processes have to be running: **MongoDB, the AI service, the backend, the
frontend.** Each needs **its own terminal**, and **MongoDB must be up before
the backend starts** — every backend command, including the seeds, dies
immediately without it:

```
[ERROR] Seed failed connect ECONNREFUSED 127.0.0.1:27017
```

That is exactly what happened on the first attempt here. Start Mongo first.

### Step 1 — Clone

```bash
git clone https://github.com/Ayushdas1904/camsense-ai.git
cd camsense-ai
```

Each block below starts from this repository root, so open a new terminal (or
`cd` back here) between them.

### Step 2 — Start MongoDB (first, and leave it running)

The backend expects `mongodb://127.0.0.1:27017/camsense`. Point
`MONGODB_URI` in `backend/.env` somewhere else if you prefer.

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

### Step 3 — AI service → `http://127.0.0.1:8000`

```bash
cd ai-service
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt    # OpenCV + YOLO; pulls PyTorch (~1 GB, several minutes)
python download_assets.py          # one-time, idempotent — see below
cp .env.example .env               # then set AI_SERVICE_INGEST_SECRET
uvicorn app.main:app --reload
```

> **Activate the virtualenv before running anything Python, and check that your
> prompt shows `(.venv)`.** Running the system (or `mise`-managed) Python
> instead fails in two ways that look unrelated to each other: `uvicorn` dies
> with `ModuleNotFoundError: No module named 'pydantic_settings'`, and the test
> suite **silently skips 17 occupancy tests** with *"cv2 and numpy are not
> installed in this environment"* — a green-looking run that checked far less
> than it appears to. This genuinely happened here. Re-activate the venv in
> every new terminal.

`python download_assets.py` fetches four files, skips anything already present,
and never raises — on failure it prints the exact target path so you can drop a
file in by hand. All four are gitignored and none is committed:

| File | Size | Used for |
|---|---|---|
| `models/yolov8n.pt` | ~6 MB | YOLOv8n — human and weapon detection, and the occupancy headcount |
| `ai-service/samples/vtest.avi` | ~8 MB | the bundled pedestrian video used by DEMO-mode cameras |
| `models/face_detection_yunet_2023mar.onnx` | ~230 KB | YuNet face detector (Review 2) |
| `models/face_recognition_sface_2021dec.onnx` | ~37 MB | SFace 128-d face embedder (Review 2) |

Health: <http://127.0.0.1:8000/api/health> · API docs: <http://127.0.0.1:8000/docs>

### Step 4 — Backend → `http://127.0.0.1:5050`

With MongoDB running:

```bash
cd backend
cp .env.example .env    # then set PORT=5050, MONGODB_URI, JWT_SECRET, AI_INGEST_SECRET
npm install             # do not skip this — see the note below
npm run seed            # admin account, from SEED_ADMIN_* in .env
npm run seed:cameras    # CAM-01, CAM-02
npm run seed:rooms      # ROOM-01, wired to both cameras (Review 3)
npm run seed:devices    # DEV-LIGHT-01 (108 W), DEV-FAN-01 (75 W), RULE-LAB-01 — all created DISABLED
npm run dev             # nodemon; http://127.0.0.1:5050
```

> **Run `npm install` even on an existing clone.** The `nodemon` pin was
> recently corrected from `^1.14.10` back to `^3.1.4`, and a stale
> `node_modules` may still hold the old one, which breaks `npm run dev`.

Every seed script is an **idempotent upsert** and deletes nothing, so re-running
them is safe. The seeded devices and the seeded automation rule are created
**disabled** on purpose — nothing is ever switched until you enable them
yourself.

**Indexes need no migration step.** Mongoose creates the collection indexes on
model registration, and `ensureCriticalIndexes()` in `backend/src/config/db.js`
builds the unique ones with `createIndexes()` and then reads them back to
verify. If a verification fails the backend still boots and only the affected
writes are refused — see *Verify it is working* below. The one repair tool is
`npm run dedupe:attendance` (report-only; `-- --apply` to act).

Health: <http://127.0.0.1:5050/api/health>

### Step 5 — Frontend → `http://localhost:5173`

```bash
cd frontend
cp .env.example .env    # then set VITE_API_BASE_URL=http://localhost:5050/api
npm install
npm run dev
```

Open **<http://localhost:5173>** and sign in with the seeded admin:

- **Email:** `SEED_ADMIN_EMAIL` from `backend/.env` (default `admin@camsense.ai`)
- **Password:** `SEED_ADMIN_PASSWORD` from `backend/.env` (default `ChangeMe123!`)

Change both before showing this to anyone.

---

## The three settings that actually break setup

Everything else has a working default. These three do not, and each fails in a
way that does not obviously point at the cause.

### 1. The port — set it explicitly in both `.env` files

**The committed defaults disagree with each other.** This is a real
inconsistency in the repository, not a documentation slip:

| File | Says |
|---|---|
| `backend/src/config/env.js` | `port` falls back to **5000** |
| `backend/.env.example` | `PORT=5000` |
| `frontend/.env.example` | `VITE_API_BASE_URL=http://localhost:5000/api` |
| `frontend/src/services/apiClient.ts` | fallback `http://localhost:5000/api` |
| `frontend/src/services/socket.ts`, `cameraService.ts`, `utils/assetUrl.ts` | fallback `http://localhost:5050/api` — **note the difference** |
| `ai-service/app/config.py` | `backend_url` → `http://127.0.0.1:5050` — **5050 again** |

So with `VITE_API_BASE_URL` **unset**, REST calls go to 5000 while Socket.IO,
the MJPEG stream and `/uploads` image URLs go to 5050 — you get a dashboard that
loads but never updates, a black player, and broken thumbnails. Set both sides:

```bash
# backend/.env
PORT=5050

# frontend/.env
VITE_API_BASE_URL=http://localhost:5050/api
```

(Choosing 5000 instead also works, but then you must also set
`AI_SERVICE_BACKEND_URL=http://127.0.0.1:5000` in `ai-service/.env`. 5050 is
less work and avoids AirPlay.) Recorded in
[`docs/REVIEW3-VERIFICATION.md`](docs/REVIEW3-VERIFICATION.md) §4 item 1.

### 2. The shared service secret — the two values must be identical

```bash
# backend/.env
AI_INGEST_SECRET=<your-own-long-random-value>

# ai-service/.env
AI_SERVICE_INGEST_SECRET=<the-same-value>
```

That one secret authenticates traffic in **both** directions: the AI service
sends it when reporting detections, recognition results and occupancy to the
backend, and it **requires** it on every one of its own routes except
`GET /api/health` — including `POST /api/faces/register`, which returns a face
embedding.

**Both sides default to empty, deliberately.** A non-empty default could never
match the other side's, so a half-configured install would 401 every call with
nothing to go on. Empty instead fails closed with a message naming the exact
variable to set. If the two differ, camera monitoring and face registration
fail with an authentication error rather than silently half-working.

### 3. The bind address — leave it on loopback

`HOST` (backend) and `AI_SERVICE_HOST` (AI service) both default to
`127.0.0.1`, in code and in both `.env.example` files. **Keep it that way.** The
backend serves detection snapshots and enrolled people's registration
portraits, and the AI service returns face embeddings; binding `0.0.0.0`
publishes those to every machine on your network. If a remote browser must
reach the UI, use an SSH port-forward rather than widening the bind.

---

## Running it: four terminals

Start them in this order. Terminal 1 must be up before terminal 3.

| # | Directory | Command | Serves |
|---|---|---|---|
| 1 | anywhere | `mongod --dbpath ~/.camsense/mongo-data --port 27017 --bind_ip 127.0.0.1` | `27017` |
| 2 | `ai-service/` | `source .venv/bin/activate && uvicorn app.main:app --reload` | `8000` |
| 3 | `backend/` | `npm run dev` | `5050` |
| 4 | `frontend/` | `npm run dev` | `5173` |

`npm start` in `backend/` runs the same server without nodemon's file watching,
if you prefer that for a demo.

---

## Verify it is working

```bash
curl -s http://127.0.0.1:8000/api/health
curl -s http://127.0.0.1:5050/api/health
```

Real responses observed from a running stack (abridged):

```json
{"service":"camsense-ai-service","status":"ok","mode":"demo","model_loaded":true}
```

```json
{"success":true,"data":{"service":"camsense-backend","status":"ok",
 "environment":"development","database":{"status":"connected"}}}
```

Then sign in at <http://localhost:5173> and confirm the dashboard renders the
component-health panel, which is `GET /api/health/components` (JWT required).
It reports **11 components**, including the three index-state groups, the device
adapter and the automation engine.

> **Both liveness endpoints answer `ok` even when subsystems are degraded**, and
> that is by design: this system degrades rather than crashing. If a unique
> index fails to verify, only the writes that depend on it are refused —
> attendance writes, device commands, or the automation tick — while Review 1
> detection, alerts and camera management carry on. `/api/health/components` is
> where you find that out. A green `/api/health` is not a statement that
> everything works.

---

## Script reference

Every script below exists in the relevant `package.json`.

**`backend/`**

| Command | What it does |
|---|---|
| `npm run dev` | nodemon dev server |
| `npm start` | plain `node src/server.js` |
| `npm run seed` | creates/updates the admin account from `SEED_ADMIN_*` |
| `npm run seed:cameras` | CAM-01, CAM-02 |
| `npm run seed:rooms` | ROOM-01, assigned both cameras |
| `npm run seed:devices` | DEV-LIGHT-01 (108 W), DEV-FAN-01 (75 W), RULE-LAB-01 — all **disabled** |
| `npm run dedupe:attendance` | lists duplicate `{personId, date}` records. **Report-only** unless you add `-- --apply` |
| `npm run demo:reset` | clears simulated/demo Review 3 state. **Report-only** unless you add `-- --apply`; restart the backend afterwards |
| `npm test` | `node --test test/` — no MongoDB and no model weights needed |

**`frontend/`**

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server on 5173 |
| `npm run build` | `tsc -b && vite build` |
| `npm run preview` | serves the built bundle |
| `npm run lint` | `tsc --noEmit` — a **typecheck**; there is no ESLint config in this project |

**`ai-service/`** (activate `.venv` first)

| Command | What it does |
|---|---|
| `python download_assets.py` | fetches the four model/sample files; idempotent |
| `uvicorn app.main:app --reload` | starts the service on 8000 |
| `python -m unittest discover -s tests -v` | the stdlib test suite |
| `python -m compileall app` | byte-compile check |

---

## Tests and builds — with the results actually recorded

```bash
cd backend     && npm test
cd frontend    && npm run lint
cd frontend    && npm run build
cd ai-service  && source .venv/bin/activate && python -m compileall app
cd ai-service  && source .venv/bin/activate && python -m unittest discover -s tests -v
```

| Command | Last observed result |
|---|---|
| `backend` → `npm test` | **192 tests, 192 pass, 0 fail** |
| `frontend` → `npm run lint` | clean, no output |
| `frontend` → `npm run build` | succeeded — 2499 modules, ~1.9 s. Emits an advisory *"chunk exceeds 500 kB"* **warning**, which is not an error |
| `ai-service` → `python -m compileall app` | clean |
| `ai-service` → `python -m unittest discover -s tests -v` | 91 tests collected; last observed **90 pass / 1 fail**. The one failure has since been fixed, but **that re-run has not been observed**, so this is not 91/91 |

The backend and AI-service suites need **no MongoDB, no running service and no
model weights**, because the decision rules are deliberately factored into
dependency-free modules and the AI-service tests mock `YoloModel`. If the AI
suite reports skipped tests, your virtualenv is not activated.

**What these results do not cover:** no end-to-end camera, recognition,
attendance, occupancy, device or energy workflow has been exercised through the
UI. The suites are unit and rule-level tests.

---

## Demo walkthrough — all three reviews in one pass

A full run-through, in the order the reviews build on each other. Each step
links to the detailed script further down.

1. **Review 1 — SEE.** Log in → *Cameras* (two seeded cameras) → *Live
   Monitoring* → **Start Stream** on *Main Entrance (CAM-01)*. Real YOLO person
   boxes with live FPS, inference time and people count. Then *Trigger demo
   weapon (DEMO)* → a CRITICAL alert arrives live → acknowledge/resolve it on
   *Alerts*. Detail: [Try the demo (Review 1)](#try-the-demo-review-1).
2. **Review 2 — IDENTIFY.** *People → Register Person* → *Register face* with a
   **consenting participant or a suitable test image** → stream again → the
   Identity Results panel names the match only when it clears the threshold →
   *Attendance* gains exactly one record per person per day → an unenrolled
   face becomes `UNKNOWN` and, after persistence and cooldown, an
   `unknown_identity` warning on the existing Alerts page. Detail:
   [Demonstrating Review 2](#demonstrating-review-2).
3. **Review 3 — UNDERSTAND & ACT.** *Occupancy & Energy* → ROOM-01 shows the
   headcount from distinct person tracks → enable RULE-LAB-01 **and** set each
   device to `automatic` (both are seeded disabled, deliberately) →
   `POST /api/automation/rules/:id/evaluate` forces one evaluation instead of
   waiting for the 30 s tick → the activity list shows every decision,
   including the skips → *Analytics* shows consumed-vs-baseline. Detail:
   [Demo instructions (Review 3)](#demo-instructions-review-3) and the
   [Final demonstration checklist](#final-demonstration-checklist).

Say out loud what the system is not: the demo weapon event is labelled DEMO
because `yolov8n` (COCO) has no firearm class, the devices are **SIMULATED**,
and every energy number is an **estimate against a declared baseline**.

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
> exists and was statically verified against the sources it calls. The
> **unit-level rules have since been executed** — the backend suite runs
> 192/192 and the AI-service suite runs (see *Tests and builds* above) — but
> **no identity workflow has been exercised through the UI**: no face has been
> enrolled, matched or turned into an attendance record on a running system
> here. No accuracy figure is claimed anywhere, because no evaluation was
> performed. See [`docs/REVIEW2-REPORT.md`](docs/REVIEW2-REPORT.md), which
> records the state at implementation time, when nothing had been run at all.

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

The setup above is unchanged — Review 2 adds exactly two things to it:

1. `python download_assets.py` now also fetches the two face ONNX files. If you
   set up the AI service before Review 2, re-run it.
2. Set the Review 2 keys in `backend/.env` and `ai-service/.env` if you want to
   depart from the defaults above. `AI_INGEST_SECRET` must still equal
   `AI_SERVICE_INGEST_SECRET` — the recognition leg and the embeddings endpoint
   both use that same shared secret.

No new npm package and no new pip package is required. Backend tests run with
`cd backend && npm test`; AI-service tests with
`cd ai-service && python -m unittest discover -s tests -v`. Both have now been
run — the recorded results are in *Tests and builds* near the top of this
README; `docs/REVIEW2-REPORT.md` §11 records the earlier state, when neither had
been executed.

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

- **Nothing in Review 2 has been exercised end to end.** The unit suites run
  (192/192 on the backend), but no face has been enrolled, matched or turned
  into an attendance record on a running system here. Treat every behaviour
  described above as designed, statically reviewed and unit-tested at the rule
  level — not demonstrated.
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



---

## Review 3 — "Teach CCTV to UNDERSTAND & ACT"

Review 1 taught the system to **see**. Review 2 taught it to **identify**.
Review 3 teaches it to **understand a space and act on it**: how many people
are in a room, whether the data supporting that number can be trusted, and
whether that justifies switching a light or a fan off.

> **Honesty note, up front.** Everything in this section describes code that
> exists and was statically verified against the sources it calls. The
> **unit-level rules have since been executed** (see *Tests and builds*
> above), but **no occupancy, device or energy workflow has been exercised
> through the UI**. **No real device has ever been switched — device control is
> simulation-only — and no kWh figure here comes from a meter.** See
> [`docs/REVIEW3-REPORT.md`](docs/REVIEW3-REPORT.md) §D and
> [`docs/REVIEW3-VERIFICATION.md`](docs/REVIEW3-VERIFICATION.md), which record
> the state at implementation time, when nothing had been run at all.

### Objective and new modules

| Module | Where | What it does |
|---|---|---|
| Occupancy estimation | `ai-service/app/services/stream_manager.py` (`_person_track_for`, `_update_occupancy`) | Counts **distinct live person tracks** from the human detections Review 1 already produces |
| Occupancy reporting | `ai-service/app/services/event_reporter.py` (`report_occupancy`) | A third report leg, rate-limited per camera, bypassed on a change, carrying **no image** |
| Rooms / zones | `backend/src/models/Room.js`, `roomController.js`, `frontend/src/components/RoomFormModal.tsx` | Capacity, threshold, camera assignment, monitoring on/off |
| Occupancy rules | `backend/src/services/occupancyRules.js` | Status derivation, MAX aggregation, change-based persistence, usability — **dependency-free and unit-testable** |
| Occupancy service | `backend/src/services/occupancyService.js` | Ingest, aggregate, upsert live state, write history, emit, raise capacity alerts |
| Device model + adapters | `backend/src/models/Device.js`, `services/devices/*` | Registration, control modes, a documented adapter contract, and a **simulation** adapter |
| Device service | `backend/src/services/deviceService.js` | `issueCommand` — the **only** writer of device state, and only on a confirmed adapter result |
| Automation rules | `backend/src/services/automationRules.js` | `decideDeviceAction` — the seven-step decision, **dependency-free** |
| Automation engine | `backend/src/services/automationEngine.js` | Event-driven evaluation + one low-frequency tick; logs **every** decision including the skips |
| Energy rules | `backend/src/services/energyRules.js` | The kWh formula, on-duration from history, the baseline, clamped savings — **dependency-free** |
| Energy service | `backend/src/services/energyService.js` | Summary, history, by-room, by-device, trend — all derived, never random |
| Occupancy & Energy page | `frontend/src/pages/EnergyPage.tsx` | Room cards, rooms/devices/rules admin, automation activity, energy strip |
| Analytics page | `frontend/src/pages/AnalyticsPage.tsx` | Consumed-vs-baseline trend, energy by room, by device, occupancy over time |
| Component health | `backend/.../healthController.js`, `GET /api/health/components` | 11 components, each read from the component that owns the state |

The Review 3 pipeline:

```
CAMERA / VIDEO ──► YOLO HUMAN DETECTION ──► PERSON TRACKS (per camera, bbox-IoU)
                                                   │
                                      DISTINCT LIVE TRACKS = occupancy
                                                   │
                        POST /api/ai/occupancy  (x-ai-secret, no image)
                                                   │
                                      ┌────────────┴────────────┐
                                      ▼                         ▼
                            NODE BACKEND (trust boundary)   OCCUPANCY HISTORY
                            re-derives status, MAX-aggregates    (sampled)
                                      │
                               ROOM OCCUPANCY STATE
                                      │
                            AUTOMATION ENGINE (rules, delays,
                            cooldowns, overrides, FAIL-SAFE)
                                      │
                              DEVICE ADAPTER (simulation)
                                      │
                      confirmed? ──no──► command_failed + device_failure alert
                                      │yes
                             DEVICE STATE HISTORY
                                      │
                              ENERGY ANALYTICS (estimates)
                                      │
                               REACT DASHBOARD
```

Full technical detail: [`docs/OCCUPANCY_ENERGY.md`](docs/OCCUPANCY_ENERGY.md).

### How occupancy is counted — and why it is not a sum

**Occupancy is the number of distinct live person tracks on a camera worker.**
It is **not** the sum of per-frame detections and **not** a running total. One
person standing in view across a hundred processed frames is counted **once**.

Each processed frame's `human` boxes are associated with the existing tracks by
greedy bounding-box IoU (threshold `0.3`); only a box that matches nothing
opens a new track. A track expires `AI_SERVICE_OCCUPANCY_TRACK_TTL` seconds
(default 3) after it was last seen, and must have been seen
`AI_SERVICE_OCCUPANCY_MIN_TRACK_HITS` times (default 2) before it counts — so a
single-frame false positive cannot move the number.

Review 1's `people` statistic is unchanged and is **not** the occupancy figure:
it is still the count of human boxes in the current frame. Live Monitoring now
shows both, explicitly distinguished.

**Honest limits of this method** (also in *Known limitations* below):

- It is **not a multi-object tracker** — no Kalman filter, no appearance
  embedding, no ByteTrack/DeepSORT. **Two people crossing will mis-associate.**
- **There is no cross-camera re-identification.** The same person in front of
  two cameras opens two independent tracks, and nothing can know they are one
  human. So **a room with several cameras aggregates with `MAX`, never a sum** —
  summing would report two people where there is one. The maximum is a
  documented **lower bound**. *For an accurate count, give a room one camera
  that covers it.*
- **Tracks do not survive a worker restart.** They are in-memory per worker.

### Unavailable is not zero

This is the rule the rest of Review 3 depends on, and it is enforced in **one
place** (`occupancyRules.deriveOccupancyStatus`):

| Status | Label | Count reported |
|---|---|---|
| `occupied` | Occupied | the measured count |
| `unoccupied` | Unoccupied | the measured count (**a genuine 0 is allowed here**) |
| `near_capacity` | Near Capacity | the measured count |
| `capacity_exceeded` | Capacity Exceeded | the measured count |
| `camera_unavailable` | Camera Unavailable | **`null`** |
| `stale` | Occupancy Data Stale | **`null`** |

A camera that cannot be read, a YOLO model that is not loaded, a capture that
is failing, monitoring that is switched off, or a reading older than
`OCCUPANCY_STALE_AFTER` (default 30 s) all report **`null`**, never `0`. The AI
service keeps its last count rather than zeroing it, and the backend refuses to
present it as current. The UI prints an **em-dash**, suppresses the capacity
bar, and says explicitly that this is *not* a count of zero. Charts show a
**gap**, not a line dropping to the floor.

Reporting `0` would state that the room is empty — which is exactly the claim
that would switch the lights off on a room full of people.

### Occupancy history

Persistence is **change-based plus sampled**, never per frame:

- the count, status or availability changed → write;
- nothing changed but `OCCUPANCY_PERSIST_INTERVAL` (default 60 s) has elapsed →
  write a heartbeat;
- nothing changed inside the interval → **skip**.

The live `RoomOccupancyState` document is upserted on **every** accepted report
so the dashboard is current, while the `occupancies` history collection only
gets a row on the rules above. Each row stores the room, the per-camera
provenance (camera ids and counts — never an image, never an identity), the
capacity *at the time of the reading*, the status, the availability, the
`source` (`real`/`demo`) and a data-quality note.

### Device management and the adapter architecture

Each device carries: id, name, room, type (`light`/`fan`), **reported** state,
**desired** state, control mode (`automatic`/`manual`/`disabled`), adapter type,
`simulated`, connection status, last command (with its outcome), last confirmed
state change, a manual override with an explicit expiry, and a configured
`powerRatingWatts`.

**Two defaults keep this feature from doing anything you did not ask for:**
`reportedState` starts as **`unknown`** (not `off` — nothing has been
confirmed), and `controlMode` starts as **`disabled`**.

**Only the simulation adapter is implemented.** There is **no MQTT, no ESP32 and
no relay-board integration in this repository, and none is stubbed.**
`getAdapter()` **throws** a clear not-implemented error for any adapter type
other than `simulation`, rather than silently pretending to control hardware.
`services/devices/adapter.js` documents the contract a real adapter would have
to satisfy, so one can be added later without reworking the automation engine.

Simulation is disclosed four ways: `simulated: true` on every result, every
message prefixed with the literal word **`SIMULATED`**, `simulated` +
`adapterType` + `adapterImplemented` on every device payload, and
`GET /api/devices/adapters` returning a plain-language statement of which
adapters actually work. A **SIMULATED** badge renders on every device row in the
UI.

**Confirm before recording.** `deviceService.issueCommand` is the only code in
the project that writes device state, so the rule is enforced once:

- adapter returns ok → `reportedState` moves, `lastSuccessfulStateAt` is set,
  connection goes `online`, a `DeviceStateHistory` row is written with
  **`confirmed: true`**, and `device:state` is emitted;
- adapter fails, throws, or returns a malformed/inconsistent success →
  **`reportedState` is left untouched**, `lastCommand.outcome` becomes
  `failed`, connection goes `offline`, a history row is written with
  **`confirmed: false`**, an `AutomationLog` row records `command_failed`, a
  `device_failure` alert is raised (with a cooldown), and the HTTP response is
  **502** — never a 200 with a quiet flag.

The system never claims a device changed state unless the adapter confirmed it.

### Automation rules and their precedence

An administrator configures: room, devices, occupancy threshold, how long the
room must stay at/below the threshold before it counts as unoccupied,
switch-off and switch-on delays, allowed operating hours, a command cooldown,
the manual-override lifetime, and the behaviour when occupancy data is
unavailable.

`decideDeviceAction` checks these **in this order**, and the order is
deliberate:

| # | Condition | Decision |
|---|---|---|
| 1 | the rule is disabled, or the device is not in `automatic` mode | `no_change` |
| 2 | an **unexpired manual override** | `skipped_override` |
| 3 | **occupancy not usable** (unavailable, stale, or a null count) | `skipped_stale_data` — **no command** |
| 4 | outside the allowed hours (the window may wrap midnight) | `skipped_schedule` |
| 5 | inside the command cooldown | `skipped_cooldown` |
| 6 | count **above** the threshold (and the switch-on delay satisfied) | `switch_on`, or `no_change` if already on |
| 7 | count at/below the threshold for `unoccupiedForSec` **+** `switchOffDelaySec` | `switch_off`, or `no_change` if already off |

**Why 2 before 3:** an operator who has just taken manual control should be
told *"your override is in force"*, not *"the camera is stale"* — the override
would still be the reason nothing happened even if the data were perfect.

**Why 3 before anything that could switch — the fail-safe.** When the figure
cannot be trusted, **no command is issued at all** and `skipped_stale_data` is
written to the log. Absent data is not evidence of an empty room. A reading
from ten minutes ago says nothing about the room now, and a camera that cannot
be read says nothing at all. `onUnavailableOccupancy: 'leave_as_is'` is the one
alternative policy and it **also issues no command** — it exists so an operator
can record that they considered the question. **There is no configuration in
this project that switches a device on unavailable data.** The threshold clocks
are also **frozen** on an unusable reading, so a camera outage cannot
accumulate "unoccupied" time that later satisfies a switch-off delay.

**Anti-flapping** is two layers: steps 6 and 7 short-circuit to `no_change`
when the device is **already** in the state the rule wants (so a room occupied
for an hour produces one `switch_on` and then nothing), and the step-5 cooldown
bounds how often a device can be commanded even when the desired state
genuinely oscillates.

**Every evaluation is written to `AutomationLog`, including the skips** — a
rule that refused to act because the data was stale is the single most
important thing this feature has to be able to show, and it is invisible unless
it is recorded. The UI's activity list shows the skipped decisions and their
reasons, not only the successful ones.

**Manual override.** An operator command with `override: true` records the
state, the actor, the reason and an **explicit expiry**. Until it expires,
automation records `skipped_override` and changes nothing; afterwards automatic
control resumes by itself. `DELETE /api/devices/:id/override` returns to
automatic early. An override with no expiry is treated as **expired**, not as
permanent — a device stuck in manual forever because somebody forgot is the
worse outcome.

**How the engine is driven** — no new infrastructure: `occupancyService` calls
the engine directly after it upserts a room's state (a plain function call, not
a message bus), plus **one** `setInterval` (`AUTOMATION_TICK_INTERVAL`, default
30 s) for the transitions that are caused by *time passing* rather than by a
new report — an unoccupied delay maturing, an override expiring, and a reading
going stale. The last matters most: when a camera goes dark, **no report
arrives at all**, so the tick is what makes an outage visible in the log.

The whole tick is wrapped in `try/catch`. A failure raises an
`automation_failure` alert and the process keeps running; occupancy, detection,
recognition and attendance are untouched by an automation fault. The interval is
cleared on shutdown, **before** the HTTP server closes, and devices are
deliberately left exactly as they are — stopping the backend is not a request
to change the state of the lights.

### Energy calculation methodology

> **Read this before quoting any number this project produces.** There is no
> power meter anywhere in CamSense AI. **Every energy figure is an ESTIMATE.**

**Consumption.** Derived in exactly one place (`energyRules.energyKwh`):

```
kWh = watts × (seconds / 3600) / 1000
```

`watts` is the device's **operator-configured** `powerRatingWatts`, not a meter
reading. `seconds` is summed from `DeviceStateHistory` rows with
**`confirmed: true`** only — a command that **failed** never bills a room for
electricity it did not use, and a state of `unknown` contributes nothing
(unknown is not off, and guessing either way would be a fabricated figure). Two
awkward cases are handled explicitly: a state that began **before** the window
is counted from the window start, and an interval still **open** at the window
end is closed **at the window end** (never at "now", and never dropped).

**The baseline — the declared assumption.** A saving is meaningless without
one, so it is stated rather than hidden:

```
baselineKwh = watts × ENERGY_BASELINE_HOURS_PER_DAY / 1000     (pro-rated for the window,
                                                                and capped at the window)
```

`ENERGY_BASELINE_HOURS_PER_DAY` (default **12**) represents *"the hours per day
this device would have run under its configured operating schedule **without**
occupancy-based switching"*. **It is an assumption, not a measurement.** Set it
to match the schedule you are actually claiming to have improved on. Every
energy API response carries `baseline: { hoursPerDay, description, source }`
plus `estimated: true` — and `simulated: true` whenever a simulation device
contributed. The UI renders the baseline description **next to** the savings
figure.

**Savings.**

```
savedKwh     = max(0, baselineKwh − estimatedActualKwh)     ← clamped at zero
savedPercent = savedKwh / baselineKwh × 100,  or NULL when baselineKwh is 0
```

The clamp is deliberate: a device that ran *longer* than the baseline used more
than the comparison schedule, and "−0.3 kWh saved" invites a reader to subtract
it from a total and get a number that means nothing. The **null** percentage is
equally deliberate: with no baseline there is nothing to be a percentage of, so
0% and 100% are both claims the data does not support. The UI renders *"Not
enough configuration"*, never 0%.

**Worked example** (the seeded demo light):

| Quantity | Value |
|---|---|
| Configured rating | 108 W *(a number an operator typed in)* |
| Recorded on-time in a 24 h window | 4 h = 14,400 s |
| Estimated consumption | 108 × (14400/3600) / 1000 = **0.432 kWh** |
| Declared baseline | 108 × 12 / 1000 = **1.296 kWh** |
| Estimated saving | 1.296 − 0.432 = **0.864 kWh** |
| Estimated saving % | 0.864 / 1.296 = **66.7 %** |

**Insufficient data is reported as such.** A window with no confirmed
transitions, or a device with no configured wattage, returns
`insufficientData: true` plus a `requires` array naming what is missing — not a
`0` that looks like a measurement of an idle device. `GET /api/energy/trend`
reads a rollup the automation tick fills for **yesterday only**, so a fresh
system legitimately has no trend and the UI says so.

### New environment variables

**`backend/.env`** (Review 3):

| Key | Default | Meaning |
|---|---|---|
| `OCCUPANCY_STALE_AFTER` | `30` | Seconds after which a reading is **stale**; a stale figure reports a **null** count, never 0 |
| `OCCUPANCY_PERSIST_INTERVAL` | `60` | Heartbeat for an unchanged room; a change always writes immediately |
| `OCCUPANCY_ALERT_COOLDOWN` | `300` | Per-room cooldown for near-capacity / capacity-exceeded alerts |
| `OCCUPANCY_HISTORY_MAX_LIMIT` | `500` | Hard cap on `GET /api/occupancy/history` page size |
| `OCCUPANCY_NEAR_CAPACITY_RATIO` | `0.8` | Fraction of capacity at which the status becomes Near Capacity |
| `DEVICE_COMMAND_TIMEOUT` | `5` | Seconds an adapter call may take before it counts as failed |
| `DEVICE_FAILURE_ALERT_COOLDOWN` | `300` | Seconds between two `device_failure` alerts for the same device |
| `AUTOMATION_TICK_INTERVAL` | `30` | The time-driven tick; the engine is primarily event-driven |
| `AUTOMATION_COMMAND_COOLDOWN` | `60` | Minimum seconds between commands to the same device |
| `AUTOMATION_DEFAULT_UNOCCUPIED_FOR` | `300` | Default seconds at/below threshold before a room counts as unoccupied |
| `AUTOMATION_MANUAL_OVERRIDE_MINUTES` | `30` | Default override lifetime |
| `AUTOMATION_HISTORY_MAX_LIMIT` | `500` | Hard cap on `GET /api/automation/history` |
| `AUTOMATION_FAILURE_ALERT_COOLDOWN` | `300` | Seconds between two `automation_failure` alerts |
| `ENERGY_BASELINE_HOURS_PER_DAY` | `12` | **THE DECLARED BASELINE.** An assumption, not a measurement |
| `ENERGY_HISTORY_MAX_LIMIT` | `500` | Hard cap on energy page size and on in-window transition reads |

**`ai-service/.env`** (Review 3):

| Key | Default | Meaning |
|---|---|---|
| `AI_SERVICE_OCCUPANCY_ENABLED` | `true` | Set false to stop estimating/reporting occupancy; detection carries on |
| `AI_SERVICE_OCCUPANCY_REPORT_INTERVAL` | `5.0` | Minimum seconds between occupancy POSTs per camera; a **change** bypasses it |
| `AI_SERVICE_OCCUPANCY_MIN_TRACK_HITS` | `2` | Consecutive processed frames a track needs before it counts |
| `AI_SERVICE_OCCUPANCY_TRACK_TTL` | `3.0` | Seconds a person track survives without being re-seen |

`frontend/.env` gains nothing — still only `VITE_API_BASE_URL`. **No new npm
package and no new pip package** was added in Review 3.

### New API endpoints (Review 3)

| Area | Endpoints |
|---|---|
| Rooms | `GET/POST /api/rooms`, `GET/PUT/DELETE /api/rooms/:id` |
| Occupancy *(GET only)* | `GET /api/occupancy/current`, `GET /api/occupancy/summary`, `GET /api/occupancy/history` |
| Devices | `GET/POST /api/devices`, `GET/PUT/DELETE /api/devices/:id`, `POST /api/devices/:id/command`, `POST /api/devices/:id/control-mode`, `DELETE /api/devices/:id/override`, `POST /api/devices/:id/probe`, `GET /api/devices/:id/history`, `GET /api/devices/adapters` |
| Automation | `GET/POST /api/automation/rules`, `GET/PUT/DELETE /api/automation/rules/:id`, `POST /api/automation/rules/:id/enable`, `POST /api/automation/rules/:id/disable`, `POST /api/automation/rules/:id/evaluate`, `GET /api/automation/history`, `GET /api/automation/health` |
| Energy *(GET only)* | `GET /api/energy/summary`, `/history`, `/by-room`, `/by-device`, `/trend` |
| Health | `GET /api/health/components` *(JWT)* |
| AI (service-to-service) | **`POST /api/ai/occupancy`** *(shared-secret gated — the only occupancy write path)* |

Reads need a JWT. **Every mutation — device create/update/delete, every
command, every control-mode change, every override, every rule change, enable
and disable — additionally requires the `admin` role**, because these actions
control devices. The occupancy and energy routers are **GET-only**: a client can
no more submit a headcount or a kWh figure than it can submit attendance. Every
historical endpoint is paginated with a hard maximum, so no query string can
produce an unbounded read.

New Socket.IO events: `occupancy:update`, `room:status`, `device:state`,
`automation:action`, `energy:update`. A `device:state` event for a **refused**
command carries `commandFailed: true` with the **unchanged** reported state, so
the UI never redraws it as a state change. Reconnecting clients **re-fetch over
REST** rather than relying on events they missed.

### New collections and indexes

| Collection | Model | Indexes |
|---|---|---|
| `rooms` | `Room` | **`roomId` unique** · `{ cameraIds, active }` |
| `occupancies` | `Occupancy` *(placeholder replaced)* | `{ roomId, timestamp: -1 }` · `{ timestamp: -1 }` · `status` · `source` |
| `roomoccupancystates` | `RoomOccupancyState` | **`roomId` unique** · `status` |
| `devices` | `Device` | **`deviceId` unique** · `roomId` · `reportedState` · `controlMode` · `{ roomId, active }` |
| `devicestatehistories` | `DeviceStateHistory` | `{ deviceId, changedAt: -1 }` · `{ roomId, changedAt: -1 }` |
| `automationrules` | `AutomationRule` | **`ruleId` unique** · `{ roomId, enabled, active }` |
| `automationlogs` | `AutomationLog` | `{ roomId, evaluatedAt: -1 }` · `{ deviceId, evaluatedAt: -1 }` · `evaluatedAt` |
| `energyrecords` | `EnergySummary` *(placeholder replaced)* | **`{ date, deviceId }` unique** · `{ roomId, date: -1 }` |

Mongoose creates these on model registration — **no migration step is
required** and no destructive change was made. The five **unique** indexes are
built with `createIndexes()` (never `syncIndexes()`, which would also drop any
index an operator added out of band) and then **read back to verify** at
startup. A verification failure degrades **only** the affected write path:
occupancy writes refuse, device commands refuse, the automation tick returns
early — and the backend keeps booting, so Review 1 detection, alerts, cameras,
people and attendance are unaffected. The remediation is logged.

`models/Occupancy.js` and `models/EnergyRecord.js` replaced thin **unused**
foundation-phase placeholders. Both kept their mongoose model names so their
collections are not orphaned, and the legacy fields were retained as
**optional** so any pre-existing document still validates. `Alert.type` was
extended **additively** with `occupancy_warning`, `capacity_exceeded`,
`device_failure`, `automation_failure`, `ai_service_failure` and
`camera_unavailable`; every pre-existing value was kept.

### Configuring rooms and occupancy

1. **Occupancy & Energy → Rooms → Add room** (admin only).
2. Give it a **Room ID**, a name, and assign one or more cameras. A camera id
   that does not resolve to a real camera is rejected. **Assign one camera for
   an accurate count** — several cameras are supported for *coverage*, and they
   aggregate with `MAX`, not a sum.
3. Set **capacity** (0 = not configured, in which case the room only ever
   reports occupied/unoccupied — a ratio of an unknown capacity means nothing)
   and the **occupancy threshold** (the count at or above which the room counts
   as occupied).
4. **Monitoring on/off.** Switching it off reports the room as *Camera
   Unavailable* with reason `monitoring_disabled` — deliberately **not** as
   unoccupied, because the room is not being measured.
5. Start a camera in **Live Monitoring**. Occupancy begins arriving within
   `AI_SERVICE_OCCUPANCY_REPORT_INTERVAL`, and the room card shows the count,
   the status badge and the **last successful update**.
6. **History** is at `GET /api/occupancy/history` and in the Analytics
   occupancy chart.

### Configuring devices and automation

1. **Occupancy & Energy → Devices → Add device** (admin only). Set the room,
   the type (light/fan), and the **power rating in watts** — which is what every
   energy figure is computed from, so an unconfigured device (0 W) contributes
   nothing rather than a guess. The adapter dropdown is built from
   `GET /api/devices/adapters`; anything other than `simulation` is labelled
   *NOT IMPLEMENTED, commands will be refused*.
2. **Try a manual command.** The device acknowledges with a message beginning
   `SIMULATED`. A never-commanded device reads **`unknown`**, not `off`.
3. **Add an automation rule**: room, devices, threshold, unoccupied delay,
   switch-on/off delays, allowed hours, command cooldown, and the
   unavailable-data policy (**`suspend`** by default).
4. **Two explicit opt-ins before anything is ever switched automatically** —
   this is by design, not an oversight:
   - **enable the rule** (rules are created **disabled**);
   - set each device's control mode to **`automatic`** (devices are created
     **`disabled`**).
5. `POST /api/automation/rules/:id/evaluate` forces one evaluation immediately,
   so you do not have to wait for the 30-second tick.
6. Watch the **automation activity** list. It shows **every** decision,
   including `skipped_stale_data`, `skipped_override`, `skipped_schedule`,
   `skipped_cooldown` and `no_change`, each with its reason.

### Demo instructions (Review 3)

```bash
cd backend
npm run seed                    # admin account
npm run seed:cameras            # CAM-01, CAM-02
npm run seed:rooms              # ROOM-01, wired to both cameras
npm run seed:devices            # DEV-LIGHT-01 (108 W), DEV-FAN-01 (75 W), RULE-LAB-01 — ALL DISABLED
```

Every seed script is an **idempotent upsert** and deletes nothing.

**Resetting between rehearsals:**

```bash
npm run demo:reset              # REPORT ONLY — prints exactly what it would remove
npm run demo:reset -- --apply   # applies exactly that, then restart the backend
```

`demo:reset` clears **only** simulated/demo Review 3 state: device state
history and energy summaries for **simulated** devices, automation logs for
simulated devices and demo rooms, occupancy readings whose `source` is `demo`,
and the live occupancy state of demo rooms. It **resets** simulated devices to
`reportedState: 'unknown'` while **preserving their configuration**.

**It never writes to people, attendance, users or cameras** — it does not even
import those models — and it never deletes a room, a device, a rule, a
detection, an alert, a recognition event, or an occupancy reading whose source
is not `demo`. Restart the backend afterwards: the simulation adapter holds its
device states in memory per process.

`setSimulatedFailure(deviceId, true)` in
`backend/src/services/devices/simulationAdapter.js` is what makes the
`device_failure` walkthrough reproducible.

### Testing and verification

```bash
cd backend     && npm test                                   # node:test, no dependency, no MongoDB needed
cd frontend    && npm run lint                               # tsc --noEmit (there is NO ESLint config)
cd frontend    && npm run build                              # tsc -b && vite build
cd ai-service  && python -m unittest discover -s tests -v    # stdlib unittest
cd ai-service  && python -m compileall app                   # byte-compile check
```

Review 3 test files: `backend/test/review3-occupancy.test.js`,
`review3-automation.test.js`, `review3-energy.test.js`,
`review3-routes.test.js`, and `ai-service/tests/test_review3_occupancy.py`. All
five use only the standard library — **no MongoDB, no running service and no
model weights are required**, because the decision rules are deliberately
factored into dependency-free modules and the AI-service test mocks `YoloModel`.

> **These suites have now been run.** The recorded results are in *Tests and
> builds — with the results actually recorded* near the top of this README:
> backend 192/192, frontend lint clean, frontend build succeeding with an
> advisory chunk-size warning, `compileall` clean, and the AI-service suite at
> 90 pass / 1 fail on its last observed run with the fix for that one failure
> applied but **not yet re-confirmed**. [`docs/REVIEW3-REPORT.md`](docs/REVIEW3-REPORT.md)
> §D and [`docs/REVIEW3-VERIFICATION.md`](docs/REVIEW3-VERIFICATION.md) record
> the earlier state, when every one of these commands was blocked at the OS
> sandbox layer with `sandbox-exec: sandbox_apply: Operation not permitted`,
> exit code **71**. **No UI workflow is covered by any of these tests.**

### Known limitations (Review 3)

- **Nothing in Review 3 has been exercised end to end.** The unit suites run,
  but no room has been monitored, **no device has ever been switched — not even
  a simulated one — and no kWh figure has been computed by a running process**
  here. Treat everything described above as designed, statically reviewed and
  unit-tested at the rule level, not demonstrated.
- **Occupancy is an estimate, and the association method is simple.** Greedy
  bbox-IoU between consecutive frames is **not a multi-object tracker**: no
  Kalman filter, no motion model, no appearance embedding. **Two people crossing
  will mis-associate**, and the count can be briefly wrong in either direction.
- **No cross-camera re-identification.** Rooms aggregate with **`MAX`, never a
  sum**. The maximum is a documented **lower bound** on the true headcount —
  possibly an undercount when cameras see different parts of a room, but never a
  fabricated overcount.
- **Occupancy does not survive a worker restart.** Tracks are in-memory per
  camera worker; a restart resets the count to "never measured" (`null`, not 0).
- **Occupancy inherits every limitation of `yolov8n`** — occlusion, small or
  distant subjects, crowding, unusual poses.
- **`AI_SERVICE_OCCUPANCY_MIN_TRACK_HITS` trades latency for stability.** A
  genuinely new person takes at least two processed frames to appear.
- **Device control is simulation-only.** No MQTT, no ESP32, no relay board, and
  no HTTP adapter — `getAdapter()` **throws** for anything other than
  `simulation` rather than stubbing a fake. The simulated state lives in one
  in-process `Map`, so it does not survive a restart and is not shared between
  processes. **A reachable adapter does not mean hardware is connected**, and the
  health panel reports the device adapter as `simulation`, never `ok`.
- **Every energy figure is an ESTIMATE.** There is no power meter. kWh is a
  wattage **you typed in** multiplied by a recorded duration, and a device driven
  by the simulation adapter was never physically on — the duration is real
  elapsed time, but the "device" was an entry in a `Map`.
- **The baseline is an assumption, not a measurement.**
  `ENERGY_BASELINE_HOURS_PER_DAY` (default 12) is the only reason a savings
  figure can be quoted at all. Quote the baseline whenever you quote a saving.
- **No energy trend until a day has completed.** The rollup fills **yesterday**
  only, so a fresh system legitimately shows the `insufficientData` message.
- **No retention or expiry job** for occupancy readings, automation logs or
  device state history. They accumulate until something removes them.
  `demo:reset` is a demo tool, not a retention policy.
- **The automation threshold clocks are in-memory with a persisted fallback.**
  A restart resumes the room-threshold clock from `RoomOccupancyState`; a rule
  whose threshold differs from the room's starts its clock fresh, which can only
  **delay** a switch-off, never bring one forward.
- **Automation is suspended, not degraded, on unusable occupancy data.** That is
  deliberate — but it does mean a prolonged camera or AI-service outage stops
  occupancy-based switching rather than falling back to a schedule.
- **A second command for a device already being commanded is refused, not
  queued** (HTTP 409). The automation tick or the operator simply tries again.
- **The responsive layout check was a code read of Tailwind classes, not a
  resized viewport**, and `GET /api/health/components` plus the two new alert
  cooldowns have never been exercised.
- **Review 1's firearm limitation is unchanged** (see the honest note above).

### Security notes (Review 3)

- **The backend is the trust boundary, and occupancy follows the Review 2
  pattern exactly.** AI-produced data — detections, recognition results, and now
  headcounts — can only enter over the shared-secret service leg
  (`x-ai-secret`). `POST /api/ai/occupancy` is the **only** occupancy write
  path, it is **not** reachable with a browser JWT, and there is deliberately no
  client-facing occupancy, device-state-history, automation-log or energy write
  route anywhere.
- **The backend re-derives rather than trusting.** It recomputes the occupancy
  status at evaluation time against its **own** `OCCUPANCY_STALE_AFTER`, so a
  stored status of *occupied* written ten minutes ago becomes *stale* with a null
  count before any rule can act on it.
- **Device control is admin-only.** Every mutation is `requireAuth` +
  `requireRole('admin')`. UI role gating is a convenience; the control that
  matters is on the route.
- **No biometric data travels on the occupancy leg.** The occupancy report
  carries camera ids and counts — **no frame, no image, no identity, no
  embedding**. A headcount needs no snapshot, and sending one would put people's
  faces on a leg with no reason to carry them.
- **Occupancy history stores no personal data.** Camera ids, counts, a status
  and a data-quality note. The per-camera track handle is a transient bbox-IoU
  session handle and makes **no** claim about who anyone is.
- **No secret, connection string or stack trace reaches any payload.** The
  health endpoint caps an error to its first line and 200 characters; a
  credential-misconfiguration case is a sentence naming the variable **without**
  its value.
- **Both services still bind `127.0.0.1` by default**, and neither
  `.env.example` contains a real secret or tells you to bind `0.0.0.0`.
- **Review 3 alert severities are `warning`, never `critical`.** A crowded
  room, a device that did not switch and an automation fault are operational
  conditions needing attention — not security incidents. Ranking them alongside
  a weapon sighting would devalue the critical tier.

### Final demonstration checklist

Before the demo:

- [ ] MongoDB running and reachable
- [ ] `python download_assets.py` has been run (`yolov8n.pt` + `vtest.avi`; the
      two face ONNX files if you are demonstrating Review 2)
- [ ] `AI_INGEST_SECRET` **equals** `AI_SERVICE_INGEST_SECRET`
- [ ] `PORT=5050` in `backend/.env` **and**
      `VITE_API_BASE_URL=http://localhost:5050/api` in `frontend/.env`
- [ ] All three services started; `GET /api/health/components` shows what you
      expect, including an honest **down** for anything genuinely missing
- [ ] Seed chain run: `seed` → `seed:cameras` → `seed:rooms` → `seed:devices`
- [ ] Optionally `npm run demo:reset -- --apply`, then **restart the backend**
- [ ] One consenting participant enrolled, or a suitable test image ready
- [ ] RULE-LAB-01 and both devices left **disabled** — enabling them live is
      part of the demonstration

During the demo, say out loud:

- [ ] The automated suites **have** been run (backend 192/192; frontend lint and
      build clean; AI-service suite last observed 90/91 with the fix pending
      re-confirmation) — but **no workflow has been exercised through the UI**,
      so nothing on screen is a verified result
- [ ] `yolov8n` (COCO) **has no firearm class** — the demo weapon button is
      clearly labelled DEMO for exactly that reason
- [ ] The `0.363` recognition threshold is **uncalibrated**, and a cosine
      similarity **is not a probability**
- [ ] Occupancy is a count of **distinct tracks**, not a sum of frames, and
      multi-camera rooms use **MAX, never a sum**
- [ ] An unavailable or stale room shows a **dash, not 0** — and automation
      **refuses to act** on it
- [ ] The devices are **SIMULATED**; there is no IoT hardware in this project
- [ ] Every energy figure is an **ESTIMATE** against a **declared baseline** —
      quote the baseline whenever you quote the saving

The full 5–8 minute script, with what to show and what to say at each step, is
in [`docs/REVIEW3-REPORT.md`](docs/REVIEW3-REPORT.md) §F.

---

## Configuration reference

Each service ships a `.env.example`; copy it to `.env`. **No secrets are
committed** — never hardcode passwords, JWT secrets, or the ingest secret.

**`backend/.env`** — `PORT` (**set it to 5050**; the committed default is
5000), `HOST` (`127.0.0.1`), `CLIENT_ORIGIN`, `MONGODB_URI`,
`JWT_SECRET`, `JWT_EXPIRES_IN`, `ASSET_TOKEN_EXPIRES_IN` (`1d` — the narrowed
token used in `/uploads` image URLs), `AI_SERVICE_URL`, `AI_INGEST_SECRET` (no
default; must match the AI service), and throttling knobs:
`DETECTION_EVENT_COOLDOWN`, `WEAPON_ALERT_COOLDOWN`, `PERSON_ALERT_COOLDOWN`.
*Review 2 adds:* `RECOGNITION_MATCH_THRESHOLD`, `RECOGNITION_EMBEDDING_DIM`,
`UNKNOWN_PERSISTENCE_COUNT`, `UNKNOWN_PERSISTENCE_WINDOW`,
`UNKNOWN_ALERT_COOLDOWN`, `KNOWN_EVENT_COOLDOWN`, `ENROLLED_COUNT_TTL`,
`ATTENDANCE_UPDATE_COOLDOWN`, `FACE_UPLOAD_MAX_BYTES`.
*Review 3 adds:* `OCCUPANCY_STALE_AFTER`, `OCCUPANCY_PERSIST_INTERVAL`,
`OCCUPANCY_ALERT_COOLDOWN`, `OCCUPANCY_HISTORY_MAX_LIMIT`,
`OCCUPANCY_NEAR_CAPACITY_RATIO`, `DEVICE_COMMAND_TIMEOUT`,
`DEVICE_FAILURE_ALERT_COOLDOWN`, `AUTOMATION_TICK_INTERVAL`,
`AUTOMATION_COMMAND_COOLDOWN`, `AUTOMATION_DEFAULT_UNOCCUPIED_FOR`,
`AUTOMATION_MANUAL_OVERRIDE_MINUTES`, `AUTOMATION_HISTORY_MAX_LIMIT`,
`AUTOMATION_FAILURE_ALERT_COOLDOWN`, `ENERGY_BASELINE_HOURS_PER_DAY`,
`ENERGY_HISTORY_MAX_LIMIT`.

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
*Review 3 adds:* `AI_SERVICE_OCCUPANCY_ENABLED`,
`AI_SERVICE_OCCUPANCY_REPORT_INTERVAL`, `AI_SERVICE_OCCUPANCY_MIN_TRACK_HITS`,
`AI_SERVICE_OCCUPANCY_TRACK_TTL`.

**`frontend/.env`** — `VITE_API_BASE_URL` only (browser-exposed; no secrets).
Review 2 and Review 3 both add nothing here, by design.

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

## API overview (Review 3)

| Area | Endpoints |
|------|-----------|
| Rooms | `GET/POST /api/rooms`, `GET/PUT/DELETE /api/rooms/:id` |
| Occupancy | `GET /api/occupancy/current`, `GET /api/occupancy/summary`, `GET /api/occupancy/history` *(read-only by design)* |
| Devices | `GET/POST /api/devices`, `GET/PUT/DELETE /api/devices/:id`, `POST /api/devices/:id/command`, `POST /api/devices/:id/control-mode`, `DELETE /api/devices/:id/override`, `POST /api/devices/:id/probe`, `GET /api/devices/:id/history`, `GET /api/devices/adapters` |
| Automation | `GET/POST /api/automation/rules`, `GET/PUT/DELETE /api/automation/rules/:id`, `POST /api/automation/rules/:id/enable`, `/disable`, `/evaluate`, `GET /api/automation/history`, `GET /api/automation/health` |
| Energy | `GET /api/energy/summary`, `/history`, `/by-room`, `/by-device`, `/trend` *(read-only by design)* |
| Health | `GET /api/health/components` *(JWT; per-component status read from the component that owns the state)* |
| AI | `POST /api/ai/occupancy` *(service-to-service, shared secret — the only occupancy write path)* |

**Every** room, device and automation **mutation** requires the `admin` role in
addition to a JWT, because these routes control devices. The occupancy and
energy routers are **GET-only**: occupancy figures and energy figures are
produced by the trusted workflow and derived on request respectively, so a
client can no more submit one than it can submit attendance. Every historical
endpoint is paginated with a hard maximum, so no query string can produce an
unbounded read.

Review 3 Socket.IO events: `occupancy:update`, `room:status`, `device:state`,
`automation:action`, `energy:update`. `/api/analytics` and
`/api/notifications` remain unimplemented commented placeholders — the
Analytics page is built on the occupancy and energy endpoints.

---

## Security and data handling — what a new operator must know

Full detail lives in [Biometric data handling](#biometric-data-handling) and
[Security notes (Review 3)](#security-notes-review-3); this is the short list.

- **Both services bind `127.0.0.1` by default. Keep it.** The backend serves
  detection snapshots and enrolled people's registration portraits; the AI
  service returns face embeddings. Widening `HOST` or `AI_SERVICE_HOST`
  publishes those to the local network. Use an SSH port-forward instead.
- **Face embeddings never appear in a normal API response.**
  `Person.faceEmbedding` is `select: false` *and* stripped by a
  `toJSON`/`toObject` transform, and client payloads are built from a field
  whitelist. The only two endpoints that emit a vector —
  `GET /api/ai/face-embeddings` on the backend and `POST /api/faces/register`
  on the AI service — are both shared-secret, service-to-service routes that a
  browser never calls.
- **`/uploads` is authenticated.** Snapshots and registration portraits are
  served through an authenticated static mount, using a **narrowed asset
  token** (`ASSET_TOKEN_EXPIRES_IN`, default `1d`) because an `<img>` tag cannot
  send an `Authorization` header. A full session token is rejected there.
- **Those files are face images, and there is no retention job.** Registration
  photographs and event snapshots accumulate on local disk under the backend's
  `uploads/` tree until something removes them. `npm run demo:reset` is a demo
  tool, not a retention policy.
- **Face embeddings are not anonymous and must not be called irreversible.**
  They are derived from a person's face and identify that person by design.
  Treat them like any other identifying personal record.
- **Demonstrate with consenting participants or suitable test images only**, and
  change `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` from their defaults before
  anyone else can reach the UI.
- **No secret belongs in a committed file.** No `.env.example` in this
  repository contains a real secret, and `JWT_SECRET` / `AI_INGEST_SECRET` must
  be values you generate yourself.

---

## Known limitations — the short version

Each item is expanded in the per-review sections above; this is the list to read
before quoting anything this project reports.

| Area | The limitation |
|---|---|
| Verification | The automated suites run (see *Tests and builds*), but **no workflow has been exercised through the UI**. The AI-service suite's last observed run was 90/91 with the fix not yet re-confirmed. |
| Weapon detection | `yolov8n` (COCO) detects knife/scissors but **has no firearm class**. The demo-weapon button injects a clearly labelled DEMO event. |
| Recognition accuracy | The `0.363` threshold is OpenCV's published starting point, **uncalibrated** here. A cosine similarity is **not a probability**. No liveness or anti-spoofing check exists. |
| Occupancy | Greedy bbox-IoU association, not a real multi-object tracker — two people crossing will mis-associate. No cross-camera re-identification, so multi-camera rooms aggregate with **MAX, never a sum**. Tracks do not survive a restart. |
| Device control | **Simulation only.** `getAdapter()` throws for any adapter other than `simulation`; there is no MQTT, ESP32 or relay integration and none is stubbed. |
| Energy | **Every figure is an estimate** — an operator-typed wattage × a recorded duration, compared against the declared `ENERGY_BASELINE_HOURS_PER_DAY` (default 12). There is no power meter and **no measured saving is claimed**. |
| Retention | No expiry job for snapshots, occupancy readings, automation logs or device-state history. |

Reports: [`docs/REVIEW2-REPORT.md`](docs/REVIEW2-REPORT.md) §11,
[`docs/REVIEW3-REPORT.md`](docs/REVIEW3-REPORT.md) §D,
[`docs/REVIEW3-VERIFICATION.md`](docs/REVIEW3-VERIFICATION.md). Design detail:
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md),
[`docs/FACE_RECOGNITION.md`](docs/FACE_RECOGNITION.md),
[`docs/OCCUPANCY_ENERGY.md`](docs/OCCUPANCY_ENERGY.md).

---

## Troubleshooting

**Start here — these are the failures actually hit while setting this up:**

| Symptom | Cause and fix |
|---|---|
| `[ERROR] Seed failed connect ECONNREFUSED 127.0.0.1:27017` — on `npm run seed` or any backend command | **MongoDB is not running.** Start `mongod` first and leave it running, then re-run the command. This is the most common first-run failure. |
| `ModuleNotFoundError: No module named 'pydantic_settings'` | The **virtualenv is not activated**, so a system/`mise` Python is being used. Run `source .venv/bin/activate` in `ai-service/` and confirm the prompt shows `(.venv)`. |
| The AI-service tests report skipped tests with *"cv2 and numpy are not installed in this environment"* | Same cause. **17 occupancy tests silently skip** on an unactivated venv, so the run looks green while checking far less. Activate the venv and re-run. |
| Dashboard loads but never updates, the player is black, and thumbnails are broken — all at once | The **port split**: with `VITE_API_BASE_URL` unset, REST goes to 5000 while Socket.IO, the MJPEG stream and `/uploads` go to 5050. Set `PORT=5050` in `backend/.env` **and** `VITE_API_BASE_URL=http://localhost:5050/api` in `frontend/.env`, then restart both. See *The three settings that actually break setup*. |
| `npm run dev` in `backend/` fails in nodemon | Run `npm install` — the `nodemon` pin was corrected from `^1.14.10` back to `^3.1.4` and a stale `node_modules` may still hold the old one. |
| Anything AI-related returns an authentication error, or a 503 naming a variable | `AI_INGEST_SECRET` (backend) ≠ `AI_SERVICE_INGEST_SECRET` (ai-service), or one is unset. Both default to **empty** so an unset value fails closed with the variable named. Make them identical and restart both. |
| Live stream stays black | The assets were never downloaded. `cd ai-service && source .venv/bin/activate && python download_assets.py`, then restart the service. |
| A log line says an index was **not verified**, and some writes are refused | By design: only the affected writes stop (attendance writes, device commands, or the automation tick) while detection, alerts and camera management keep working. `GET /api/health/components` shows which. For attendance, `npm run dedupe:attendance` lists the duplicates and `-- --apply` removes them; then restart. |
| Port 5000 already in use (macOS) | The AirPlay Receiver owns 5000. Use 5050, as above. |

**Everything else:**

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
| Port 5000 conflict (macOS) | Expected; use 5050 for the backend. See *The three settings that actually break setup* — the committed defaults are inconsistent, so set `PORT` and `VITE_API_BASE_URL` explicitly. |
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
| A room shows **Camera Unavailable** or **Occupancy Data Stale** with a dash instead of a number | Working as designed. The dash means *no current measurement*, which is deliberately **not** a count of zero. Causes: the camera is not being monitored, the YOLO weights are missing, the capture is failing, monitoring is switched off for that room, or no report has arrived within `OCCUPANCY_STALE_AFTER` (default 30 s). Start the camera in Live Monitoring and check `GET /api/health/components`. |
| Occupancy never appears at all | The camera must be **monitored** (Live Monitoring → Start Stream), the camera must be **assigned to a room** (`npm run seed:rooms` wires CAM-01 and CAM-02 to ROOM-01), `AI_SERVICE_OCCUPANCY_ENABLED` must be true, and `yolov8n.pt` must be present. A camera that belongs to no room is accepted and ignored. |
| Occupancy looks lower than the number of people in the room | Expected in two cases. A room with several cameras aggregates with **MAX, never a sum**, because there is no cross-camera re-identification — the maximum is a documented lower bound. And a person the detector misses (occluded, distant, unusual pose) is not counted. For an accurate count, give a room one camera that covers it. |
| Occupancy briefly jumps or drops when two people cross | Expected. Association is greedy bbox-IoU between consecutive frames, not a real multi-object tracker, so crossing paths can mis-associate. |
| Occupancy resets to no-data after restarting the AI service | Expected. Person tracks are in-memory per camera worker and do not survive a restart, so the count honestly goes back to *never measured* rather than to 0. |
| Automation never switches anything | Two explicit opt-ins are required, by design: the **rule must be enabled** (rules are created disabled) **and** each device's control mode must be **`automatic`** (devices are created `disabled`). Then check the automation activity list — the decision and its reason are always recorded. `POST /api/automation/rules/:id/evaluate` forces one evaluation immediately instead of waiting for the tick. |
| The automation log says `skipped_stale_data` | **Working as designed, and this is the fail-safe.** The occupancy figure was unavailable, stale, or null, so no command was issued: unavailable data is not evidence of an empty room. Fix the data source (start the camera, restore the AI service) and automation resumes by itself. |
| The automation log says `skipped_override` | An unexpired manual override is in force, so automation will not undo an operator action. Wait for the expiry (`AUTOMATION_MANUAL_OVERRIDE_MINUTES`, default 30) or call `DELETE /api/devices/:id/override` to return to automatic. |
| The automation log says `skipped_cooldown` or `no_change` | The anti-flapping guards. `no_change` means the device is **already** in the state the rule wants; `skipped_cooldown` means it was commanded inside `AUTOMATION_COMMAND_COOLDOWN`. Neither is an error. |
| A device command returns **502** and the device state did not change | The adapter did not confirm the command, so the state was deliberately **left unchanged** — the system never claims a device switched unless the adapter confirmed it. Check the `device_failure` alert and the device history row with `confirmed: false`. If you injected a failure with `setSimulatedFailure`, clear it. |
| A device command returns **409** | Another command for that same device is already in flight. Nothing failed and nothing was attempted; try again in a moment. |
| A device reads **`unknown`** rather than on or off | Correct for a device that has never been commanded. `unknown` is the honest initial value — it is not `off`. |
| Adding a device for MQTT / ESP32 / a relay board | **Not supported.** Only the `simulation` adapter is implemented, and `getAdapter()` refuses any other type with a clear error rather than pretending to control hardware. `GET /api/devices/adapters` states which adapters work. `services/devices/adapter.js` documents the contract a real adapter would have to satisfy. |
| Energy shows 0, or "not enough data" | Energy is computed from `DeviceStateHistory` rows with `confirmed: true` plus each device's configured `powerRatingWatts`. A device with 0 W configured, or a window with no confirmed transitions, returns `insufficientData: true` with a `requires` message naming what is missing — deliberately, rather than a 0 that would look like a measurement of an idle device. Set a wattage on the device and command it at least once. |
| The savings percentage reads "Not enough configuration" | The baseline is 0, which happens when no contributing device has a configured wattage. With no baseline there is nothing to be a percentage of, so a null is reported rather than a fabricated 0% or 100%. |
| The energy trend chart is empty on a fresh system | Expected. `GET /api/energy/trend` reads a rollup the automation tick fills for **yesterday only**, at most once per local day, so no completed day has been rolled up yet. The summary, by-room and by-device views are computed on demand and work immediately. |
| Log says "the device/automation indexes are unverified" and device commands are refused | The unique indexes on `devices.deviceId`, `automationrules.ruleId` or `energyrecords.{date,deviceId}` could not be built or read back — usually duplicate keys in an existing collection, sometimes a database user without index privileges. Device commands and automation refuse while unverified, because those indexes are what stop two "current states" existing for one device. Everything else — detection, alerts, cameras, people, attendance, occupancy reads — keeps working. The remediation is in the startup log. |
| `npm run demo:reset` removed nothing | It is **report-only** without a flag, by design. Re-run it as `npm run demo:reset -- --apply`. |
| Simulated devices still show their old state after `demo:reset -- --apply` | Restart the backend. The simulation adapter holds device states in memory **per process**, so the running server still has its own copy until it restarts. |
