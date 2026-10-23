"""CamSense AI · AI service entry point (FastAPI).

Run: uvicorn app.main:app --reload  (or `python -m app.main`)

Performs all computer-vision work. The Node backend calls it; the React
frontend never talks to it directly. Every model (YOLO for objects, YuNet for
face detection, SFace for face embeddings) is loaded ONCE at startup and reused
for every frame and every request.

Startup is deliberately fault-tolerant: a missing face model is reported and
the service still starts with Review 1's YOLO human/weapon detection fully
functional. Face recognition then reports itself unavailable rather than
degrading into guesses.
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.config import get_settings
from app.detection.yolo_model import YoloModel
from app.recognition import face_service
from app.recognition.face_model import FaceDetectorModel, FaceEmbedderModel
from app.services.pipeline import warmup


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Load + warm the model once on startup so the first frame isn't slow.
    model = YoloModel.instance()
    print(f"[startup] YOLO model loaded: {model.available}")
    if model.available:
        warmup()
        print("[startup] model warmed up")

    # Review 2: load the face models once. Neither constructor can raise — a
    # missing ONNX file sets available=False and prints a diagnostic.
    detector = FaceDetectorModel.instance()
    embedder = FaceEmbedderModel.instance()
    print(f"[startup] face detector ({detector.model_name}) loaded: {detector.available}")
    print(
        f"[startup] face embedder ({embedder.model_name}, {embedder.embedding_dim}-d) "
        f"loaded: {embedder.available}"
    )

    if detector.available and embedder.available:
        # One best-effort prefetch of the enrolled identities. The backend may
        # not be up yet; failing here is non-fatal and simply leaves the cache
        # unloaded, which makes recognition report RECOGNITION_UNAVAILABLE
        # instead of producing unknown-person results it cannot justify.
        try:
            state = face_service.refresh_identity_cache(force=True)
            print(
                f"[startup] identity cache refreshed={state.get('refreshed')} "
                f"loaded={state['loaded']} candidates={state['candidates']} "
                f"skipped={state['skipped']}"
            )
            if state["last_error"]:
                print(f"[startup] identity cache warning: {state['last_error']}")
        except Exception as exc:  # noqa: BLE001 - prefetch must never block startup
            print(f"[startup] identity cache prefetch failed (non-fatal): {exc}")
    else:
        print(
            "[startup] face recognition UNAVAILABLE — object detection is unaffected. "
            "Run `python download_assets.py` in ai-service/ to fetch the face models."
        )
    try:
        yield
    finally:
        # Give in-flight report POSTs a moment to land. They run on daemon
        # threads (a hung backend must never stop this process exiting), which
        # on its own meant a pending unknown-identity report — and the evidence
        # snapshot attached to it — was abandoned at interpreter exit.
        from app.services.event_reporter import reporter

        still_running = reporter.shutdown()
        print(f"[shutdown] reporter drained (in-flight POSTs abandoned: {still_running})")


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="CamSense AI · AI Service",
        version="1.1.0",
        description=(
            "Computer-vision service for CamSense AI: object detection "
            "(Review 1) plus face detection and face recognition (Review 2)."
        ),
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(router, prefix="/api")

    @app.get("/", tags=["system"])
    def root() -> dict:
        return {"service": "camsense-ai-service", "version": "1.0.0"}

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    settings = get_settings()
    uvicorn.run("app.main:app", host=settings.host, port=settings.port, reload=True)
