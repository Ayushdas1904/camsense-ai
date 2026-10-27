"""AI service HTTP routes.

Thin layer over the stream manager and pipeline. The Node backend is the only
expected caller (start/stop/status/stats + proxying the MJPEG stream), and the
only caller of the Review 2 face endpoints — a browser never talks to this
service and never receives a service credential.

AUTHENTICATION. Every route in this module except ``/health`` requires the
shared service secret (``x-ai-secret``, verified by
``app.api.security.require_service_secret``). The face endpoints need it
because ``/faces/register`` emits a face embedding and ``/faces/cache/refresh``
is state-changing; the Review 1 stream endpoints are gated too, because an
inherited missing guard is still a missing guard. ``/health`` stays open as a
liveness probe: it reveals only the detection mode and whether the YOLO model
loaded, and no caller can change state through it.
"""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.api.security import require_service_secret
from app.config import get_settings
from app.detection.yolo_model import YoloModel
from app.models.schemas import (
    FaceRegistrationRequest,
    FaceRegistrationResponse,
    HealthResponse,
    RecognitionStatusResponse,
    StreamControlResponse,
    StreamStartRequest,
    StreamStats,
    SystemStatus,
)
from app.recognition import face_service
from app.recognition.face_model import FaceDetectorModel, FaceEmbedderModel
from app.services.event_reporter import reporter
from app.services.pipeline import pipeline
from app.services.stream_manager import stream_manager

router = APIRouter()

#: Every route that needs the shared service secret is registered on this
#: router; it is merged into ``router`` at the bottom of the module. Keeping it
#: separate means a new route is secured by construction — you have to opt OUT
#: (by using ``router`` directly) rather than remember to opt in.
secured = APIRouter(dependencies=[Depends(require_service_secret)])


@router.get("/health", response_model=HealthResponse, tags=["system"])
def health() -> HealthResponse:
    """Liveness probe — deliberately the ONLY unauthenticated route."""
    return HealthResponse(
        mode=get_settings().detection_mode,
        model_loaded=YoloModel.instance().available,
    )


@secured.get("/status", response_model=SystemStatus, tags=["system"])
def status() -> SystemStatus:
    """AI system status — real per-detector readiness for the operator panel."""
    return SystemStatus(
        mode=get_settings().detection_mode,
        model_loaded=YoloModel.instance().available,
        detectors=pipeline.detector_status(),
    )


@secured.post("/stream/start", response_model=StreamControlResponse, tags=["stream"])
def start_stream(req: StreamStartRequest) -> StreamControlResponse:
    worker = stream_manager.start(req.camera_id, req.source, req.mode)
    return StreamControlResponse(camera_id=req.camera_id, running=worker.running, mode=worker.mode)


@secured.post("/stream/{camera_id}/stop", response_model=StreamControlResponse, tags=["stream"])
def stop_stream(camera_id: str) -> StreamControlResponse:
    stream_manager.stop(camera_id)
    return StreamControlResponse(camera_id=camera_id, running=False, mode=get_settings().detection_mode)


@secured.post("/stream/{camera_id}/demo-weapon", tags=["stream"])
def trigger_demo_weapon(camera_id: str) -> dict:
    """Inject a clearly-labelled DEMO weapon detection (source='demo').

    Lets the critical-alert pipeline be demonstrated when no bladed object is in
    the sample video. Never presented as a real detection — the event carries
    source='demo' end to end.
    """
    worker = stream_manager.get(camera_id)
    if worker is None or not worker.running:
        raise HTTPException(status_code=409, detail="Camera is not being monitored")
    worker.trigger_demo_weapon()
    return {"triggered": True, "source": "demo"}


@secured.get("/stream/{camera_id}/stats", response_model=StreamStats, tags=["stream"])
def stream_stats(camera_id: str) -> StreamStats:
    worker = stream_manager.get(camera_id)
    if worker is None:
        return StreamStats(camera_id=camera_id, running=False,
                           mode=get_settings().detection_mode,
                           model_loaded=YoloModel.instance().available,
                           recognition_available=face_service.recognition_available(),
                           # Nothing is being processed, so there is no
                           # headcount. Reported as unavailable with a null
                           # count — NEVER as an empty room.
                           occupancy=None,
                           occupancy_available=False,
                           occupancy_age_seconds=None)
    return StreamStats(
        camera_id=camera_id,
        running=worker.running,
        mode=worker.mode,
        fps=worker.fps,
        inference_ms=worker.inference_ms,
        people=worker.people,
        weapons=worker.weapons,
        model_loaded=YoloModel.instance().available,
        faces=worker.faces,
        known_faces=worker.known_faces,
        unknown_faces=worker.unknown_faces,
        recognition_available=face_service.recognition_available(),
        recognition_errors=worker.recognition_errors,
        # Reports the reporter had to discard for this camera. Counted here
        # rather than only logged, so a silently-dropped sighting is visible.
        recognition_reports_dropped=reporter.dropped_reports("recognition", camera_id),
        detection_reports_dropped=reporter.dropped_reports("detection", camera_id),
        # ── Review 3 · occupancy ──
        # Distinct live person tracks, not a sum of per-frame detections. The
        # availability flag and the age are reported alongside it so a consumer
        # can tell a measured 0 from a figure it must not trust.
        occupancy=worker.occupancy_count,
        occupancy_available=worker.occupancy_available,
        occupancy_age_seconds=worker.occupancy_age_seconds,
        occupancy_reports_dropped=reporter.dropped_reports("occupancy", camera_id),
    )


@secured.get("/stream/{camera_id}", tags=["stream"])
def stream(camera_id: str):
    worker = stream_manager.get(camera_id)
    if worker is None or not worker.running:
        raise HTTPException(status_code=404, detail="Camera is not being monitored")
    return StreamingResponse(
        stream_manager.mjpeg(camera_id),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


# ── Review 2 · face recognition ───────────────────────────────────


@secured.post("/faces/register", response_model=FaceRegistrationResponse, tags=["faces"])
def register_face(req: FaceRegistrationRequest) -> FaceRegistrationResponse:
    """Enroll one registration photograph and return its face embedding.

    Called by the Node backend only (service-to-service), and gated by the
    shared ``x-ai-secret`` service secret: the response carries biometric data,
    which the backend stores in a protected field and must never relay to the
    browser.

    Status codes:
      200 — a structured result, including the EXPECTED validation outcomes
            INVALID_IMAGE / NO_FACE / MULTIPLE_FACES / LOW_QUALITY. These are
            not server errors: the backend relays the message verbatim so the
            administrator sees why the photo was rejected.
      401 — the service secret was missing or wrong.
      503 — the recognition models are not loaded, so no enrollment is possible.
    """
    detector = FaceDetectorModel.instance()
    embedder = FaceEmbedderModel.instance()
    if not detector.available or not embedder.available:
        raise HTTPException(
            status_code=503,
            detail=(
                "Face recognition is unavailable: the ONNX model files are missing "
                "or failed to load. Run `python download_assets.py` in ai-service/ "
                "and restart the service."
            ),
        )

    image = face_service.decode_image(req.image)
    return face_service.register_face(image)


@secured.post("/faces/cache/refresh", tags=["faces"])
def refresh_face_cache() -> dict:
    """Drop and re-fetch the enrolled identities from the backend.

    The backend calls this whenever a person is registered, edited, has
    recognition disabled, or is deleted, so a removed identity stops being
    matchable immediately instead of lingering until the TTL expires.

    State-changing and therefore secret-gated: an unauthenticated caller could
    otherwise force repeated fetches against the backend's embeddings endpoint.
    This call refreshes SYNCHRONOUSLY (it is a request/response, not a camera
    frame) so the backend learns whether the refresh actually succeeded.
    """
    return face_service.refresh_identity_cache(force=True)


@secured.get("/faces/status", response_model=RecognitionStatusResponse, tags=["faces"])
def face_status() -> RecognitionStatusResponse:
    """Honest readiness of the recognition subsystem (never optimistic)."""
    return face_service.recognition_status()


# Merge the secured routes in. Keep this at the bottom: anything registered
# after it would not be included.
router.include_router(secured)

