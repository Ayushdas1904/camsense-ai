# CamSense AI — Smart CCTV Intelligence Platform

CamSense AI adds an intelligence layer on top of ordinary CCTV cameras:

> **CAMERA → SEE → UNDERSTAND → GENERATE EVENT → TAKE ACTION**

Instead of recording video for humans to watch, the platform understands what
is happening in a feed — detecting people and weapons, recognizing registered
individuals, automating attendance, monitoring occupancy, optimizing energy,
and raising security alerts.

**Current status: Review 1 — "Teach CCTV to SEE" is implemented.** A working
AI surveillance pipeline: cameras → video → YOLO detection → events → alerts →
live dashboard.

---

## Development roadmap

| Phase | Theme | Status |
|-------|-------|--------|
| **Foundation** | Architecture & scaffolding | ✅ Done |
| **Review 1** | *Teach CCTV to SEE* — cameras, streaming, human & weapon detection, events, alerts, live dashboard | ✅ Done |
| **Review 2** | *Teach CCTV to KNOW* — face recognition, attendance | 🔜 Planned |
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

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design.

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
> runs the backend on **5050**. The `.env.example` files already reflect this.

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
mongod --dbpath ~/.camsense/mongo-data --port 27017
```
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
> `AI_SERVICE_INGEST_SECRET` in `ai-service/.env` — that shared secret
> authenticates the AI service when it reports detections to the backend.

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
Dropping in a firearm-trained YOLO model later needs only a new
`AI_SERVICE_MODEL_PATH` — no code changes.

---

## Configuration reference

Each service ships a `.env.example`; copy it to `.env`. **No secrets are
committed** — never hardcode passwords, JWT secrets, or the ingest secret.

**`backend/.env`** — `PORT` (5050), `MONGODB_URI`, `JWT_SECRET`,
`AI_SERVICE_URL`, `AI_INGEST_SECRET`, and throttling knobs:
`DETECTION_EVENT_COOLDOWN`, `WEAPON_ALERT_COOLDOWN`, `PERSON_ALERT_COOLDOWN`.

**`ai-service/.env`** — `AI_SERVICE_PORT` (8000), `AI_SERVICE_DETECTION_MODE`,
`AI_SERVICE_MODEL_PATH`, `AI_SERVICE_PERSON_CONFIDENCE`,
`AI_SERVICE_WEAPON_CONFIDENCE`, `AI_SERVICE_TARGET_FPS`, `AI_SERVICE_BACKEND_URL`,
`AI_SERVICE_INGEST_SECRET` (must match the backend).

**`frontend/.env`** — `VITE_API_BASE_URL` only (browser-exposed; no secrets).

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

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Backend exits on start | MongoDB isn't running / `MONGODB_URI` is wrong. |
| Dashboard shows "AI Degraded" | The AI service isn't running, or `AI_SERVICE_URL` is wrong. |
| Alerts never appear when monitoring | `AI_INGEST_SECRET` (backend) ≠ `AI_SERVICE_INGEST_SECRET` (ai-service). |
| Live stream stays black | Run `python download_assets.py` — the model/video weren't downloaded. |
| First detection is slow | Normal — the model warms up once at AI-service startup. |
| Port 5000 conflict (macOS) | Expected; the backend uses 5050. Disable AirPlay Receiver if you want 5000. |
