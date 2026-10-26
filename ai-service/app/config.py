"""Centralized settings for the AI service.

Reads configuration from environment variables (and a local .env in dev) so
nothing sensitive or environment-specific is hardcoded. Detection thresholds,
frame rate, and model paths all live here — never scattered through the code.
"""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Loopback by DEFAULT. This service holds the face models and emits face
    # embeddings, and the only legitimate caller is the Node backend running
    # beside it, so it must not listen on every interface out of the box.
    # Override with AI_SERVICE_HOST only when the deployment genuinely needs a
    # wider bind (e.g. inside a container whose ports are published to
    # 127.0.0.1), and keep the x-ai-secret gate in place either way.
    host: str = "127.0.0.1"
    port: int = 8000

    # "demo" processes the bundled sample video; "real" opens a camera stream URL.
    detection_mode: str = "demo"
    allowed_origins: str = "http://127.0.0.1:5050"

    # ── Model & detection ──────────────────────────────────────
    model_path: str = "../models/yolov8n.pt"
    person_confidence: float = 0.50
    weapon_confidence: float = 0.65
    # Sample video used in DEMO mode (real pedestrians → real detections).
    sample_video: str = "samples/vtest.avi"

    # ── Processing performance ─────────────────────────────────
    target_fps: int = 8          # frames per second actually run through YOLO
    frame_width: int = 640       # frames resized to this width before inference
    jpeg_quality: int = 70       # MJPEG stream quality

    # ── Face detection & recognition (Review 2) ────────────────
    # Both are ONNX models run through OpenCV's dnn/objdetect modules, so they
    # add NO new pip dependency (see app/recognition/face_model.py for the full
    # model-selection rationale). Fetch them with `python download_assets.py`.
    face_detection_model_path: str = "../models/face_detection_yunet_2023mar.onnx"
    face_recognition_model_path: str = "../models/face_recognition_sface_2021dec.onnx"
    # YuNet detection score below which a candidate face box is discarded.
    face_detection_confidence: float = 0.80
    # Cosine-similarity threshold above which a candidate is reported KNOWN.
    # 0.363 is the value OpenCV publishes for SFace cosine matching. It is a
    # documented STARTING POINT, NOT a universal or production-calibrated
    # value: it REQUIRES validation against your own enrolled population and
    # camera conditions, and is deliberately adjustable via
    # AI_SERVICE_FACE_MATCH_THRESHOLD. A similarity score is not a probability.
    face_match_threshold: float = 0.363
    # Minimum face box side in pixels. Smaller faces are reported LOW_QUALITY
    # rather than matched — too few pixels for a trustworthy embedding.
    face_min_size: int = 60
    # Recognition (face detection + embedding + matching) runs on every Nth
    # *processed* frame. YOLO human/weapon detection still runs on every
    # processed frame, so identity work never slows the Review 1 path.
    face_recognition_every_n_frames: int = 3
    # A registration photo must contain exactly this many faces to be accepted.
    face_registration_max_faces: int = 1
    # Seconds before the cached set of enrolled identities is re-fetched.
    embedding_cache_ttl: float = 60.0
    # Extra grace, in seconds, before a cache that is PAST its TTL and failed
    # to refresh is treated as untrustworthy. Past TTL+grace, matching fails
    # CLOSED (RECOGNITION_UNAVAILABLE) instead of scoring against data that may
    # still contain a person who has since been disabled or deleted.
    embedding_cache_stale_grace: float = 30.0
    # HTTP timeout for fetching the enrolled identities. Kept well below the
    # frame budget; the fetch also runs on a background thread, never on the
    # camera worker that runs YOLO.
    embedding_fetch_timeout: float = 3.0
    # Base URL the enrolled embeddings are fetched from. Empty → use backend_url.
    embedding_source_url: str = ""

    # ── Occupancy estimation (Review 3) ────────────────────────
    # Occupancy reuses the EXISTING YOLO human detections — no second model and
    # no new dependency. Set to False to stop estimating and reporting it; YOLO
    # human/weapon detection is unaffected either way.
    occupancy_enabled: bool = True
    # Minimum seconds between occupancy POSTs per camera. A headcount is cheap
    # and slow-moving, so it is reported far less often than detections — but a
    # CHANGE in the count bypasses this interval so a real transition is not
    # delayed by it (see EventReporter.report_occupancy).
    occupancy_report_interval: float = 5.0
    # A person track must have been seen in at least this many CONSECUTIVE
    # processed frames before it counts towards occupancy. 1 would let a
    # single-frame false positive move the headcount; 2 is the cheapest rule
    # that makes a blip non-reportable while staying responsive.
    occupancy_min_track_hits: int = 2
    # Seconds a person track survives without being re-seen. Long enough to
    # ride out a missed frame or a brief occlusion, short enough that someone
    # who has left is not counted indefinitely. Mirrors the face track TTL.
    occupancy_track_ttl: float = 3.0

    # ── Reporting events back to the Node backend ──────────────
    backend_url: str = "http://127.0.0.1:5050"
    # Shared service secret. DEFAULT EMPTY, deliberately: it must be set to the
    # same value as the backend's AI_INGEST_SECRET. A non-empty default here
    # could not match the backend's own default, so a run with no .env used to
    # 401 every backend→AI call — which takes Review 1 camera monitoring down
    # with it, with only a credential-mismatch message to go on. Empty instead
    # means require_service_secret fails closed with a 503 whose message names
    # exactly the variable to set, and the backend relays that message.
    ingest_secret: str = ""
    # Minimum seconds between event POSTs per camera (backend applies the real
    # alert cooldown; this just avoids hammering the backend every frame).
    report_interval: float = 1.0
    # Separate rate limit for the recognition leg so detection and recognition
    # reporting cannot starve each other.
    recognition_report_interval: float = 1.0
    # HTTP timeout for reporting to the backend. The POST itself is dispatched
    # on a background thread, so a stalled backend cannot block detection.
    report_timeout: float = 2.0

    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="AI_SERVICE_",
        extra="ignore",
        protected_namespaces=(),
    )

    @property
    def origins_list(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

    @property
    def embedding_source(self) -> str:
        """Base URL the enrolled face embeddings are fetched from.

        Defaults to the backend, which is the only service that holds them.
        """
        return (self.embedding_source_url or self.backend_url).rstrip("/")


@lru_cache
def get_settings() -> Settings:
    return Settings()
