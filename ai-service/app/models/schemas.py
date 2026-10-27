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
    type: str = Field(..., description="Module family: human | weapon | face")
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
    # ── Review 2 ──
    faces: int = 0
    known_faces: int = 0
    unknown_faces: int = 0
    recognition_available: bool = False
    recognition_errors: int = 0
    #: Recognition reports DISCARDED for this camera because the reporter's
    #: in-flight cap was reached. Non-zero means the backend never learned
    #: about those sightings, so it must be visible rather than only logged.
    recognition_reports_dropped: int = 0
    #: Detection reports discarded the same way (Review 1 leg).
    detection_reports_dropped: int = 0
    # ── Review 3 · occupancy ──
    #: Distinct live PERSON TRACKS currently counted for this camera — not a
    #: sum of per-frame detections. `None` when occupancy has never been
    #: measured on this worker. Deliberately nullable: a count of 0 means "we
    #: looked and nobody is there", which is a different statement from "we
    #: could not look", and the two must not collapse into the same number.
    occupancy: int | None = None
    #: False when the YOLO model is unavailable or the capture is failing. When
    #: this is False, `occupancy` is the LAST KNOWN value and must be presented
    #: as stale/unavailable — never as an empty room.
    occupancy_available: bool = False
    #: Seconds since the occupancy figure was last measured, or None if never.
    occupancy_age_seconds: float | None = None
    #: Occupancy reports discarded by the reporter's in-flight cap.
    occupancy_reports_dropped: int = 0


class HealthResponse(_Base):
    service: str = "camsense-ai-service"
    status: str = "ok"
    mode: str
    model_loaded: bool
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# ── Review 2 · face detection & recognition contract ──────────────


class FaceBox(BaseModel):
    """Where a face is — presence and location only, no identity."""

    # [x, y, width, height] in pixels of the (resized) processed frame.
    bbox: list[int]
    score: float = Field(..., ge=0.0, le=1.0, description="Face DETECTION score")
    # 5 landmarks (right eye, left eye, nose, right mouth corner, left mouth
    # corner) as [x, y] pairs — used for alignment before embedding.
    landmarks: list[list[int]] | None = None


class FaceRecognitionResult(_Base):
    """One face's recognition outcome.

    `similarity` is a cosine similarity between embeddings — a different
    measurement from a detector's `confidence`, and NOT a probability. The two
    must never be presented interchangeably.

    `person_id`/`person_name` are populated ONLY when `status == "KNOWN"`, i.e.
    when the best similarity actually cleared `threshold`. Being the closest
    candidate is not a match.
    """

    camera_id: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    # KNOWN | UNKNOWN | LOW_QUALITY | NO_FACE | RECOGNITION_UNAVAILABLE
    status: str
    person_id: str | None = None
    person_name: str | None = None
    similarity: float | None = Field(default=None, description="Cosine similarity, not a probability")
    # [x, y, width, height]; empty when there is no face to point at.
    bbox: list[int] = Field(default_factory=list)
    detection_score: float | None = Field(default=None, description="Face DETECTION score")
    # Short machine-readable note, e.g. FACE_TOO_SMALL, EMBEDDER_UNAVAILABLE.
    quality: str | None = None
    # Transient per-camera session handle for de-duplicating repeat sightings.
    # It makes NO claim about the person's real identity.
    track_id: str | None = None
    threshold: float | None = None
    model_name: str | None = None


class FaceRegistrationRequest(BaseModel):
    """A registration photograph, as a data URL or raw base64 string."""

    image: str = Field(..., min_length=16)


class FaceRegistrationResponse(_Base):
    """Result of enrolling one photograph.

    SERVICE-TO-SERVICE ONLY. `embedding` is biometric data: the Node backend
    stores it in a protected field and must never relay it to the browser.
    """

    # OK | NO_FACE | MULTIPLE_FACES | LOW_QUALITY | INVALID_IMAGE
    # | RECOGNITION_UNAVAILABLE
    status: str
    message: str
    faces_detected: int = 0
    embedding: list[float] | None = None
    embedding_dim: int | None = None
    embedding_model: str | None = None
    bbox: list[int] | None = None
    detection_score: float | None = None


class RecognitionStatusResponse(_Base):
    """Honest readiness report for the recognition subsystem."""

    detector_available: bool
    embedder_available: bool
    detector_model: str
    embedder_model: str
    embedding_dim: int
    match_threshold: float
    threshold_note: str = (
        "Starting point only — requires validation on real enrolled data. "
        "A cosine similarity is not a calibrated probability."
    )
    min_face_size: int
    recognition_every_n_frames: int
    cache_loaded: bool
    cache_size: int = 0
    cache_skipped: int = 0
    cache_age_seconds: float | None = None
    #: True when the cached identity set is past its TTL + grace because
    #: refreshes keep failing. Matching fails closed while this is true, so the
    #: operator panel must be able to see it.
    cache_stale: bool = False
    last_error: str | None = None
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

