"""Reports significant detections from the AI service to the Node backend.

This realizes the AI → BACKEND leg of the pipeline. The backend owns the real
alert cooldown/throttling and persistence; the reporter only rate-limits POSTs
so the backend isn't hit every frame. Authenticated with a shared secret, not a
user JWT (this is service-to-service traffic).
"""
import base64
import threading
import time

import cv2
import requests

from app.config import get_settings
from app.models.schemas import Detection


class EventReporter:
    def __init__(self) -> None:
        self._last_sent: dict[str, float] = {}
        self._lock = threading.Lock()

    def report(self, camera_id: str, detections: list[Detection], frame, mode: str) -> None:
        if not detections:
            return

        settings = get_settings()
        now = time.time()
        with self._lock:
            last = self._last_sent.get(camera_id, 0)
            if now - last < settings.report_interval:
                return
            self._last_sent[camera_id] = now

        # Attach a snapshot only when a weapon is present (evidence for the
        # critical alert). Person-only frames don't need a snapshot.
        snapshot = None
        if any(d.type == "weapon" for d in detections):
            snapshot = self._encode_snapshot(frame, detections)

        payload = {
            "cameraId": camera_id,
            "mode": mode,
            "detections": [d.model_dump() for d in detections],
            "snapshot": snapshot,
        }
        try:
            requests.post(
                f"{settings.backend_url}/api/ai/ingest",
                json=payload,
                headers={"x-ai-secret": settings.ingest_secret},
                timeout=4,
            )
        except requests.RequestException as exc:
            # Backend down must never crash video processing.
            print(f"[reporter] ingest failed: {exc}")

    @staticmethod
    def _encode_snapshot(frame, detections: list[Detection]) -> str | None:
        annotated = frame.copy()
        from app.services.pipeline import DetectionPipeline

        DetectionPipeline.annotate(annotated, detections)
        ok, buf = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 80])
        if not ok:
            return None
        return "data:image/jpeg;base64," + base64.b64encode(buf).decode("ascii")


reporter = EventReporter()
