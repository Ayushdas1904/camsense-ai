"""Centralized settings for the AI service.

Reads configuration from environment variables (and a local .env in dev) so
nothing sensitive or environment-specific is hardcoded.
"""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    host: str = "0.0.0.0"
    port: int = 8000
    # "demo" processes sample videos; "real" processes live camera streams.
    detection_mode: str = "demo"
    allowed_origins: str = "http://127.0.0.1:5000"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="AI_SERVICE_",
        extra="ignore",
    )

    @property
    def origins_list(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
