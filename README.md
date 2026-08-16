# CamSense AI — Smart CCTV Intelligence Platform

CamSense AI adds an intelligence layer on top of ordinary CCTV cameras:

> **CAMERA → SEE → UNDERSTAND → GENERATE EVENT → TAKE ACTION**

Instead of recording video for humans to watch, the platform understands what
is happening in a feed — detecting people and weapons, recognizing registered
individuals, automating attendance, monitoring occupancy, optimizing energy,
and raising security alerts.

This repository currently contains the **foundation** — a scalable architecture
that the three academic review phases build on without a rewrite.

---

## Development roadmap

| Phase | Theme | Focus |
|-------|-------|-------|
| **Foundation** *(this phase)* | Architecture & scaffolding | Project structure, auth, dashboard shell, service separation, health checks |
| **Review 1** | *Teach CCTV to SEE* | Camera management, video streaming, human & weapon detection, AI events, basic alerts |
| **Review 2** | *Teach CCTV to KNOW* | Person registration, face detection/recognition, attendance automation |
| **Review 3** | *Teach CCTV to UNDERSTAND & ACT* | Occupancy, energy optimization, real-time events, advanced analytics |

---

## Architecture

Two decoupled data paths keep AI models away from the UI:

```
FRONTEND  ──►  APPLICATION BACKEND  ──►  DATABASE
(React)        (Node + Express)          (MongoDB)

VIDEO/CAMERA ──► AI SERVICE ──► APPLICATION BACKEND ──► FRONTEND
                 (Python/FastAPI)  (Node)                (React)
```

The React frontend talks **only** to the Node backend. The Node backend is the
only thing that talks to the Python AI service. Swapping a mock detector for a
real YOLO/face model is an AI-service-internal change — the frontend never sees it.

```
camsense-ai/
├── frontend/     React + Vite + TS + Tailwind (UI)
├── backend/      Node + Express + Mongoose (API, auth, data)
├── ai-service/   Python + FastAPI (computer vision / detection)
├── models/       Trained model weights (added in later reviews)
├── docs/         Architecture notes
└── README.md
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design.

---

## Technology stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite, TypeScript, Tailwind CSS, React Router, Redux Toolkit, Axios, Lucide, Recharts |
| Backend | Node.js, Express, Mongoose, JWT (jsonwebtoken), bcryptjs, Zod, Socket.IO, Helmet |
| AI service | Python 3.12, FastAPI, Uvicorn, Pydantic *(OpenCV / YOLO / face-recognition added in later reviews)* |
| Database | MongoDB |
| Real-time | Socket.IO |

---

## Prerequisites

- **Node.js** ≥ 18 and npm
- **Python** ≥ 3.10
- **MongoDB** ≥ 6 — either:
  - a local install (`mongod` on `mongodb://127.0.0.1:27017`), or
  - a free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster (put its URI in `backend/.env`)

---

## Setup & run

Open **three terminals** — one per service.

### 1. Backend (`http://localhost:5000`)

```bash
cd backend
cp .env.example .env          # then edit values (esp. MONGODB_URI, JWT_SECRET)
npm install
npm run seed                  # creates the initial admin account (needs MongoDB running)
npm run dev                   # starts on http://localhost:5000
```

Health check: <http://localhost:5000/api/health>

### 2. AI service (`http://localhost:8000`)

```bash
cd ai-service
python3 -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload  # starts on http://localhost:8000
```

Health check: <http://localhost:8000/api/health> · Interactive docs: `/docs`

### 3. Frontend (`http://localhost:5173`)

```bash
cd frontend
cp .env.example .env
npm install
npm run dev                    # starts on http://localhost:5173
```

Open <http://localhost:5173> and sign in with the seeded admin credentials
(default `admin@camsense.ai` / the `SEED_ADMIN_PASSWORD` from `backend/.env`).

---

## Environment variables

Each service ships a `.env.example`. Copy it to `.env` and fill in real values.
**No secrets are committed.** Never hardcode passwords, JWT secrets, API keys, or
database credentials.

- `backend/.env` — `MONGODB_URI`, `JWT_SECRET`, `CLIENT_ORIGIN`, seed admin, `AI_SERVICE_URL`
- `ai-service/.env` — host/port, `AI_SERVICE_DETECTION_MODE`, allowed origins
- `frontend/.env` — `VITE_API_BASE_URL` only (browser-exposed; never put secrets here)

---

## DEMO mode vs REAL mode

The system runs without physical CCTV hardware. `AI_SERVICE_DETECTION_MODE`
selects the source:

- **DEMO** — process sample videos (foundation ships mock detectors)
- **REAL** — process RTSP/IP camera streams

Every detection response carries a `mode` field. Simulated detections are always
labeled `demo` and are **never** presented as real-world AI output. Switching
modes does not require frontend changes.

---

## Verified in this phase

- ✅ Backend HTTP layer: routing, Zod validation, JWT auth guard, central error handler, health endpoint
- ✅ AI service: `/api/health` and `POST /api/detect` return structured, `demo`-labeled data
- ✅ Frontend: type-checks and production-builds cleanly; full routing + auth + layout
- ⚠️ Backend live start and login require a running MongoDB (see Prerequisites)
