"""Per-camera video processing workers.

Each monitored camera runs one background thread that:
  1. opens the source with OpenCV (sample video in demo mode; RTSP/IP URL in real mode)
  2. reads frames, skipping to hit a target inference FPS (performance)
  3. runs the detection pipeline (model loaded once, reused)
  4. keeps the latest annotated JPEG + live stats in memory (for the MJPEG stream)
  5. reports significant detections to the backend

The MJPEG endpoint just reads each worker's latest frame — decoupled from event
generation, so a dropped video viewer never stops detection/alerting.
"""
from __future__ import annotations

import os
import threading
import time

import cv2

from app.config import get_settings
from app.detection.yolo_model import YoloModel
from app.models.schemas import Detection
from app.services.event_reporter import reporter
from app.services.pipeline import pipeline


class _CameraWorker:
    def __init__(self, camera_id: str, source: str | None, mode: str) -> None:
        self.camera_id = camera_id
        self.mode = mode
        self._source = self._resolve_source(source, mode)
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._lock = threading.Lock()

        self._latest_jpeg: bytes | None = None
        self._demo_weapon_until: float = 0.0

        # Live stats.
        self.fps = 0.0
        self.inference_ms = 0.0
        self.people = 0
        self.weapons = 0

    @staticmethod
    def _resolve_source(source: str | None, mode: str):
        settings = get_settings()
        if mode == "real" and source:
            return source
        # Demo mode → bundled sample video (resolved relative to ai-service root).
        path = settings.sample_video
        if not os.path.isabs(path):
            root = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
            path = os.path.normpath(os.path.join(root, path))
        return path

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name=f"cam-{self.camera_id}", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=3)

    def trigger_demo_weapon(self, seconds: float = 4.0) -> None:
        """Inject a clearly-labelled DEMO weapon detection for the next N seconds."""
        self._demo_weapon_until = time.time() + seconds

    @property
    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def latest_jpeg(self) -> bytes | None:
        with self._lock:
            return self._latest_jpeg

    def _run(self) -> None:
        settings = get_settings()
        cap = cv2.VideoCapture(self._source)
        target_dt = 1.0 / max(1, settings.target_fps)
        last_time = 0.0

        while not self._stop.is_set():
            ok, frame = cap.read()
            if not ok:
                # Demo video ended → loop it; real stream error → brief backoff.
                if self.mode == "demo":
                    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    continue
                time.sleep(0.5)
                cap.open(self._source)
                continue

            now = time.time()
            if now - last_time < target_dt:
                continue  # frame skipping to hit target FPS
            last_time = now

            # Resize for faster inference while keeping aspect ratio.
            h, w = frame.shape[:2]
            scale = settings.frame_width / float(w)
            frame = cv2.resize(frame, (settings.frame_width, int(h * scale)))

            t0 = time.time()
            detections = pipeline.run(frame)
            self.inference_ms = round((time.time() - t0) * 1000, 1)

            detections = self._maybe_add_demo_weapon(detections, frame)

            pipeline.annotate(frame, detections)
            self._update_stats(now, detections)
            self._encode(frame)

            reporter.report(self.camera_id, detections, frame, self.mode)

        cap.release()

    def _maybe_add_demo_weapon(self, detections: list[Detection], frame) -> list[Detection]:
        if time.time() >= self._demo_weapon_until:
            return detections
        h, w = frame.shape[:2]
        detections.append(
            Detection(
                type="weapon",
                label="knife",
                confidence=0.9,
                bbox=[int(w * 0.4), int(h * 0.4), int(w * 0.15), int(h * 0.15)],
                source="demo",
            )
        )
        return detections

    def _update_stats(self, now: float, detections: list[Detection]) -> None:
        self.people = sum(1 for d in detections if d.type == "human")
        self.weapons = sum(1 for d in detections if d.type == "weapon")
        # Smooth FPS from the achieved processing cadence.
        if not hasattr(self, "_frame_times"):
            self._frame_times: list[float] = []
        self._frame_times.append(now)
        self._frame_times = self._frame_times[-15:]
        if len(self._frame_times) > 1:
            span = self._frame_times[-1] - self._frame_times[0]
            self.fps = round((len(self._frame_times) - 1) / span, 1) if span > 0 else 0.0

    def _encode(self, frame) -> None:
        settings = get_settings()
        ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, settings.jpeg_quality])
        if ok:
            with self._lock:
                self._latest_jpeg = buf.tobytes()


class StreamManager:
    def __init__(self) -> None:
        self._workers: dict[str, _CameraWorker] = {}
        self._lock = threading.Lock()

    def start(self, camera_id: str, source: str | None, mode: str) -> _CameraWorker:
        with self._lock:
            worker = self._workers.get(camera_id)
            if worker and worker.running:
                return worker
            worker = _CameraWorker(camera_id, source, mode)
            self._workers[camera_id] = worker
        worker.start()
        return worker

    def stop(self, camera_id: str) -> bool:
        with self._lock:
            worker = self._workers.pop(camera_id, None)
        if worker:
            worker.stop()
            return True
        return False

    def get(self, camera_id: str) -> _CameraWorker | None:
        return self._workers.get(camera_id)

    def mjpeg(self, camera_id: str):
        """Multipart MJPEG generator for a camera's annotated stream."""
        boundary = b"--frame"
        while True:
            worker = self._workers.get(camera_id)
            if worker is None or not worker.running:
                break
            jpeg = worker.latest_jpeg()
            if jpeg is not None:
                yield boundary + b"\r\nContent-Type: image/jpeg\r\n\r\n" + jpeg + b"\r\n"
            time.sleep(1 / 15)


stream_manager = StreamManager()
