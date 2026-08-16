"""Centralized settings for the AI service.

Reads configuration from environment variables (and a local .env in dev) so
nothing sensitive or environment-specific is hardcoded. Detection thresholds,
frame rate, and model paths all live here — never scattered through the code.
"""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    host: str = "0.0.0.0"
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

    # ── Reporting events back to the Node backend ──────────────
    backend_url: str = "http://127.0.0.1:5050"
    ingest_secret: str = "change_me_shared_secret"
    # Minimum seconds between event POSTs per camera (backend applies the real
    # alert cooldown; this just avoids hammering the backend every frame).
    report_interval: float = 1.0

    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="AI_SERVICE_",
        extra="ignore",
        protected_namespaces=(),
    )

    @property
    def origins_list(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
