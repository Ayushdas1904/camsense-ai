"""AI service HTTP routes.

Kept thin: routes validate/shape requests and delegate to the pipeline. The
`/detect` endpoint returns DEMO detections in the foundation; the response
shape is the real contract, so Review 1's models drop in without API changes.
"""
from fastapi import APIRouter

from app.config import get_settings
from app.models.schemas import DetectionRequest, DetectionResponse, HealthResponse
from app.services.pipeline import pipeline

router = APIRouter()


@router.get("/health", response_model=HealthResponse, tags=["system"])
def health() -> HealthResponse:
    """Health check — reports mode and per-module readiness."""
    settings = get_settings()
    return HealthResponse(mode=settings.detection_mode, modules=pipeline.module_status)


@router.post("/detect", response_model=DetectionResponse, tags=["ai"])
def detect(request: DetectionRequest) -> DetectionResponse:
    """Run the detection pipeline for a camera/frame.

    Foundation: returns clearly-labelled DEMO detections (mode == "demo").
    Never presented as real-world AI output — the `mode` field makes this
    explicit to every consumer.
    """
    return pipeline.run(camera_id=request.camera_id)
