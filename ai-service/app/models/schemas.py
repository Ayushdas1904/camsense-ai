"""Pydantic schemas defining the AI service's public data contract.

These shapes are the stable interface between the AI service and the Node
backend. Real models added in later reviews must return these same shapes, so
the backend and frontend never change when a mock detector is swapped for a
real one.
"""
from datetime import datetime, timezone

from pydantic import BaseModel, Field


class BoundingBox(BaseModel):
    """Axis-aligned box in pixels: [x, y, width, height]."""

    x: int
    y: int
    width: int
    height: int


class Detection(BaseModel):
    type: str = Field(..., description="Module family: human | weapon | face | other")
    label: str = Field(..., description="Specific class, e.g. 'person', 'knife'")
    confidence: float = Field(..., ge=0.0, le=1.0)
    bbox: BoundingBox


class DetectionRequest(BaseModel):
    camera_id: str = Field(default="CAM-DEMO")
    # In real mode this references a frame/stream the AI service pulls itself.
    # In demo mode it selects which sample scenario the mock returns.
    source: str = Field(default="demo")


class DetectionResponse(BaseModel):
    camera_id: str
    mode: str = Field(..., description="demo | real")
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    detections: list[Detection] = Field(default_factory=list)


class HealthResponse(BaseModel):
    service: str = "camsense-ai-service"
    status: str = "ok"
    mode: str
    modules: dict[str, str]
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
