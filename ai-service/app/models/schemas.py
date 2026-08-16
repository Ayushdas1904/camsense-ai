"""Pydantic schemas — the AI service's public data contract.

These shapes are the stable interface between the AI service and the Node
backend. Real models return these same shapes, so backend and frontend never
change when detectors are swapped or improved.
"""
from datetime import datetime, timezone

from pydantic import BaseModel, ConfigDict, Field


class _Base(BaseModel):
    # Several fields start with "model_" (model_loaded); opt out of pydantic's
    # protected-namespace warning for the whole contract.
    model_config = ConfigDict(protected_namespaces=())


class Detection(BaseModel):
    type: str = Field(..., description="Module family: human | weapon")
    label: str = Field(..., description="Specific class, e.g. 'person', 'knife'")
    confidence: float = Field(..., ge=0.0, le=1.0)
    # [x, y, width, height] in pixels of the (resized) processed frame.
    bbox: list[int]
    source: str = Field(default="real", description="real | demo")


class DetectorStatus(BaseModel):
    key: str
    label: str
    # active = running a real model; unavailable = model/class not loaded;
    # demo = clearly-labelled simulated output.
    status: str


class SystemStatus(_Base):
    service: str = "camsense-ai-service"
    status: str = "ok"
    mode: str
    model_loaded: bool
    detectors: list[DetectorStatus]
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class StreamStartRequest(BaseModel):
    camera_id: str
    # For real mode, the RTSP/IP URL. Ignored in demo mode (sample video used).
    source: str | None = None
    mode: str = "demo"


class StreamControlResponse(BaseModel):
    camera_id: str
    running: bool
    mode: str


class StreamStats(_Base):
    camera_id: str
    running: bool
    mode: str
    fps: float = 0.0
    inference_ms: float = 0.0
    people: int = 0
    weapons: int = 0
    model_loaded: bool = False


class HealthResponse(_Base):
    service: str = "camsense-ai-service"
    status: str = "ok"
    mode: str
    model_loaded: bool
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
