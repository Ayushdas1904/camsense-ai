"""AI service HTTP routes.

Thin layer over the stream manager and pipeline. The Node backend is the only
expected caller (start/stop/status/stats + proxying the MJPEG stream).
"""
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.config import get_settings
from app.detection.yolo_model import YoloModel
from app.models.schemas import (
    HealthResponse,
    StreamControlResponse,
    StreamStartRequest,
    StreamStats,
    SystemStatus,
)
from app.services.pipeline import pipeline
from app.services.stream_manager import stream_manager

router = APIRouter()


@router.get("/health", response_model=HealthResponse, tags=["system"])
def health() -> HealthResponse:
    return HealthResponse(
        mode=get_settings().detection_mode,
        model_loaded=YoloModel.instance().available,
    )


@router.get("/status", response_model=SystemStatus, tags=["system"])
def status() -> SystemStatus:
    """AI system status — real per-detector readiness for the operator panel."""
    return SystemStatus(
        mode=get_settings().detection_mode,
        model_loaded=YoloModel.instance().available,
        detectors=pipeline.detector_status(),
    )


@router.post("/stream/start", response_model=StreamControlResponse, tags=["stream"])
def start_stream(req: StreamStartRequest) -> StreamControlResponse:
    worker = stream_manager.start(req.camera_id, req.source, req.mode)
    return StreamControlResponse(camera_id=req.camera_id, running=worker.running, mode=worker.mode)


@router.post("/stream/{camera_id}/stop", response_model=StreamControlResponse, tags=["stream"])
def stop_stream(camera_id: str) -> StreamControlResponse:
    stream_manager.stop(camera_id)
    return StreamControlResponse(camera_id=camera_id, running=False, mode=get_settings().detection_mode)


@router.post("/stream/{camera_id}/demo-weapon", tags=["stream"])
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


@router.get("/stream/{camera_id}/stats", response_model=StreamStats, tags=["stream"])
def stream_stats(camera_id: str) -> StreamStats:
    worker = stream_manager.get(camera_id)
    if worker is None:
        return StreamStats(camera_id=camera_id, running=False,
                           mode=get_settings().detection_mode,
                           model_loaded=YoloModel.instance().available)
    return StreamStats(
        camera_id=camera_id,
        running=worker.running,
        mode=worker.mode,
        fps=worker.fps,
        inference_ms=worker.inference_ms,
        people=worker.people,
        weapons=worker.weapons,
        model_loaded=YoloModel.instance().available,
    )


@router.get("/stream/{camera_id}", tags=["stream"])
def stream(camera_id: str):
    worker = stream_manager.get(camera_id)
    if worker is None or not worker.running:
        raise HTTPException(status_code=404, detail="Camera is not being monitored")
    return StreamingResponse(
        stream_manager.mjpeg(camera_id),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )
