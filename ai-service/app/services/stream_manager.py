"""Per-camera video processing workers.

Each monitored camera runs one background thread that:
  1. opens the source with OpenCV (sample video in demo mode; RTSP/IP URL in real mode)
  2. reads frames, skipping to hit a target inference FPS (performance)
  3. runs the detection pipeline (model loaded once, reused)
  4. keeps the latest annotated JPEG + live stats in memory (for the MJPEG stream)
  5. reports significant detections to the backend

Review 2 additionally runs face detection and face recognition on every Nth
processed frame (``settings.face_recognition_every_n_frames``). Object
detection still runs on EVERY processed frame exactly as in Review 1 — identity
work is additive and deliberately lower-cadence: on a non-recognition frame the
pipeline is handed an empty face list, so neither YuNet nor the embedder runs.
The recognition pass does no blocking network I/O on this thread: the identity
cache refresh and the report POST are both dispatched to background threads.
Any recognition failure is counted and logged while detection, the MJPEG stream
and detection reporting carry on.

Consequence worth knowing: grey face boxes and the ``faces`` stat update at the
recognition cadence, not every frame. Identity overlays from the most recent
pass are redrawn for a short TTL so labels do not flicker.

The MJPEG endpoint just reads each worker's latest frame — decoupled from event
generation, so a dropped video viewer never stops detection/alerting.

Review 3 adds OCCUPANCY on top of the SAME human detections Review 1 already
produces — no second model, no extra pass, no new dependency. The worker keeps
transient person tracks (``_person_track_for``) and the headcount is the number
of distinct live tracks, so a person visible across consecutive frames is
counted once. When the model is missing or the capture is failing the count is
marked UNAVAILABLE and left at its last value rather than being zeroed, because
"we cannot see" is not "the room is empty".
"""
from __future__ import annotations

import os
import threading
import time

import cv2

from app.config import get_settings
from app.detection.yolo_model import YoloModel
from app.models.schemas import Detection, FaceRecognitionResult
from app.recognition import face_service
from app.services.event_reporter import reporter
from app.services.pipeline import pipeline

# Minimum IoU for two face boxes in consecutive recognition passes to be
# treated as the same short-lived track.
_TRACK_IOU = 0.3

# Minimum IoU for two PERSON boxes in consecutive processed frames to be
# treated as the same person. Same value and same greedy-IoU association as
# the face tracker above — a person box moves less between frames than a face
# box does between recognition passes, so 0.3 is if anything generous here.
_PERSON_TRACK_IOU = 0.3


class _CameraWorker:
    #: Seconds a transient face track survives without being re-seen.
    _TRACK_TTL = 3.0
    #: Seconds an identity overlay keeps being drawn after its recognition pass.
    _OVERLAY_TTL = 1.0

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
        # Review 2 stats.
        self.faces = 0
        self.known_faces = 0
        self.unknown_faces = 0
        self.recognition_errors = 0

        # Recognition cadence + transient face tracks (see _track_for).
        self._frame_counter = 0
        self._recognition_pass = 0
        self._tracks: list[dict] = []
        self._track_seq = 0
        self._latest_recognitions: list[FaceRecognitionResult] = []
        self._recognitions_until = 0.0

        # ── Review 3 · occupancy ────────────────────────────────
        # Transient PERSON tracks, the same idea as the face tracks above but
        # driven by the `human` detections YOLO already produces on every
        # processed frame. See _person_track_for and _update_occupancy.
        self._person_tracks: list[dict] = []
        self._person_track_seq = 0
        self._person_pass = 0
        #: Last measured headcount: the number of DISTINCT live person tracks,
        #: NOT a sum of per-frame detections and NOT a running total. None
        #: until occupancy has been measured at least once.
        self.occupancy_count: int | None = None
        #: When that measurement was taken. Monotonic for age arithmetic that
        #: a clock adjustment cannot corrupt; wall clock for display.
        self.occupancy_updated_at: float | None = None
        self.occupancy_updated_wall: float | None = None
        #: Whether the headcount can be TRUSTED right now. False when the YOLO
        #: model is unavailable or the capture is failing. When False,
        #: occupancy_count keeps its LAST value — it is never zeroed, because
        #: "we could not look" is not "the room is empty".
        self.occupancy_available: bool = False

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

    @property
    def occupancy_age_seconds(self) -> float | None:
        """Seconds since the headcount was last measured, or None if never.

        Monotonic-based, so a system clock adjustment cannot make a stale
        reading look fresh. The consumer uses this to decide staleness; the
        backend applies its own independent staleness window on top.
        """
        if self.occupancy_updated_at is None:
            return None
        return max(0.0, time.monotonic() - self.occupancy_updated_at)

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
                # The capture is failing, so no honest headcount can be made.
                # occupancy_count is deliberately LEFT ALONE rather than zeroed:
                # a camera we cannot read is not an empty room, and reporting 0
                # here would make a full room look evacuated. The consumer sees
                # available=False plus an ageing timestamp instead.
                self.occupancy_available = False
                if settings.occupancy_enabled:
                    try:
                        reporter.report_occupancy(
                            self.camera_id, self.occupancy_count, False, self.mode
                        )
                    except Exception as exc:  # noqa: BLE001 - never stop the retry loop
                        print(f"[stream:{self.camera_id}] occupancy report failed: {exc}")
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

            # ── Review 2: decide whether identity work runs on this frame ──
            # Object detection runs every processed frame (Review 1 behaviour).
            # Face detection AND recognition run on every Nth processed frame:
            # on other frames the pipeline is handed an EMPTY face list, so the
            # face detector does not run its own YuNet pass and identity work
            # cannot slow the human/weapon path. The face records computed here
            # are shared with the pipeline, so YuNet runs once per recognition
            # frame, not twice.
            self._frame_counter += 1
            every = max(1, int(settings.face_recognition_every_n_frames))
            recognition_due = self._frame_counter % every == 0
            faces: list[dict] = []
            if recognition_due:
                try:
                    faces = face_service.detect_faces(frame)
                except Exception as exc:  # noqa: BLE001 - never stop detection
                    self.recognition_errors += 1
                    print(f"[stream:{self.camera_id}] face detection failed: {exc}")
                    faces = []

            t0 = time.time()
            detections = pipeline.run(frame, faces=faces)
            self.inference_ms = round((time.time() - t0) * 1000, 1)

            detections = self._maybe_add_demo_weapon(detections, frame)

            recognitions: list[FaceRecognitionResult] = []
            if recognition_due:
                recognitions = self._recognize(frame, faces)

            pipeline.annotate(frame, detections, self._overlay_recognitions())
            self._update_stats(now, detections, recognitions, recognition_due)
            # Occupancy is ADDITIVE to Review 1, so it is guarded the same way
            # face detection and recognition are: a fault here marks the
            # headcount unavailable and is logged, while YOLO detection, the
            # MJPEG stream and detection reporting carry on. An unguarded
            # exception in this block would kill the whole camera thread and
            # take Review 1 monitoring down with it.
            try:
                self._update_occupancy(detections, settings)
            except Exception as exc:  # noqa: BLE001 - occupancy must never stop detection
                # Unavailable, NOT zero — see _update_occupancy's docstring.
                self.occupancy_available = False
                print(f"[stream:{self.camera_id}] occupancy update failed: {exc}")
            self._encode(frame)

            reporter.report(self.camera_id, detections, frame, self.mode)
            if recognitions:
                reporter.report_recognition(self.camera_id, recognitions, frame, self.mode)
            if settings.occupancy_enabled:
                # No frame and no image is passed: a headcount needs no
                # snapshot, and sending one would put people's faces on a leg
                # that has no reason to carry them.
                try:
                    reporter.report_occupancy(
                        self.camera_id,
                        self.occupancy_count,
                        self.occupancy_available,
                        self.mode,
                    )
                except Exception as exc:  # noqa: BLE001 - reporting must never stop detection
                    print(f"[stream:{self.camera_id}] occupancy report failed: {exc}")

        cap.release()

    def _recognize(self, frame, faces) -> list[FaceRecognitionResult]:
        """Run identity matching for this frame. Never raises.

        A recognition failure is counted and logged; YOLO detection, the MJPEG
        stream and detection reporting are unaffected.
        """
        self._recognition_pass += 1
        try:
            results = face_service.recognize_frame(
                frame,
                self.camera_id,
                faces=faces,
                tracker=self._track_for,
            )
        except Exception as exc:  # noqa: BLE001 - recognition must never crash the worker
            self.recognition_errors += 1
            print(f"[stream:{self.camera_id}] recognition failed: {exc}")
            return []
        self._latest_recognitions = results
        self._recognitions_until = time.time() + self._OVERLAY_TTL
        return results

    def _overlay_recognitions(self) -> list[FaceRecognitionResult]:
        """The identity overlays worth drawing right now.

        Recognition runs every Nth frame, so between passes the labels from the
        most recent pass are reused for a short TTL to avoid flicker. The boxes
        are always the real coordinates the AI service returned — they may lag
        the live frame by up to the recognition interval, and stale labels are
        dropped entirely rather than being drawn indefinitely.
        """
        if time.time() > self._recognitions_until:
            return []
        return self._latest_recognitions

    def _track_for(self, bbox) -> str:
        """Transient per-camera handle for repeated sightings of one face.

        Associates this pass's face boxes with the previous pass by greedy
        bbox-IoU so repeated observations can be de-duplicated and alert
        cooldowns applied. It is a SHORT-LIVED SESSION HANDLE ONLY and makes NO
        claim about the person's real identity — an unmatched face keeps its
        track id while staying anonymous.
        """
        now = time.time()
        self._tracks = [t for t in self._tracks if now - t["ts"] <= self._TRACK_TTL]
        best, best_iou = None, 0.0
        for track in self._tracks:
            if track.get("pass") == self._recognition_pass:
                continue  # already claimed by another face in this same pass
            iou = face_service.bbox_iou(bbox, track["bbox"])
            if iou > best_iou:
                best, best_iou = track, iou
        if best is not None and best_iou >= _TRACK_IOU:
            best["bbox"] = list(bbox)
            best["ts"] = now
            best["pass"] = self._recognition_pass
            return str(best["id"])

        self._track_seq += 1
        track_id = f"{self.camera_id}-face-{self._track_seq}"
        self._tracks.append(
            {"id": track_id, "bbox": list(bbox), "ts": now, "pass": self._recognition_pass}
        )
        return track_id

    # ── Review 3 · occupancy estimation ────────────────────────

    def _person_track_for(self, bbox) -> dict:
        """Associate one person box with a live track, or open a new one.

        Exactly the approach ``_track_for`` uses for faces — greedy bbox-IoU
        against the previous pass, one claim per track per pass, TTL expiry —
        applied to the ``human`` detections YOLO already produces on every
        processed frame. No extra model and no new dependency.

        Like the face tracker, this is a SHORT-LIVED SESSION HANDLE and makes
        NO claim about who the person is. It also does not survive across
        cameras: there is no cross-camera re-identification in this project, so
        the same person walking from one camera to another legitimately opens a
        new track on the second camera.
        """
        now = time.time()
        best, best_iou = None, 0.0
        for track in self._person_tracks:
            if track.get("pass") == self._person_pass:
                continue  # already claimed by another box in this same frame
            iou = face_service.bbox_iou(bbox, track["bbox"])
            if iou > best_iou:
                best, best_iou = track, iou

        if best is not None and best_iou >= _PERSON_TRACK_IOU:
            best["bbox"] = list(bbox)
            best["ts"] = now
            best["pass"] = self._person_pass
            best["hits"] = int(best.get("hits", 0)) + 1
            return best

        self._person_track_seq += 1
        track = {
            "id": f"{self.camera_id}-person-{self._person_track_seq}",
            "bbox": list(bbox),
            "ts": now,
            "pass": self._person_pass,
            "hits": 1,
        }
        self._person_tracks.append(track)
        return track

    def _update_occupancy(self, detections: list[Detection], settings) -> None:
        """Recompute the headcount from this frame's human detections.

        THE COUNTING RULE, which the whole feature rests on: occupancy is the
        number of DISTINCT LIVE PERSON TRACKS. It is NOT the sum of per-frame
        detections and NOT a running total, so one person standing in view
        across a hundred consecutive frames is counted ONCE, not a hundred
        times. Each frame's boxes are associated with the existing tracks by
        IoU first; only a box that matches nothing opens a new track.

        A track must also have been seen ``occupancy_min_track_hits`` times
        before it counts, so a single-frame false positive cannot move the
        number.

        Honesty rule: when the YOLO model is not loaded there is no detection
        to count, so ``occupancy_available`` goes False and the last count is
        LEFT IN PLACE rather than being reset to 0. Zero means "nobody is
        there"; unavailable means "we cannot tell", and conflating them would
        report an empty room whenever the model is missing.
        """
        if not settings.occupancy_enabled:
            return

        if not YoloModel.instance().available:
            # No real human detection is happening — so there is no headcount.
            # Do NOT touch occupancy_count (see the docstring).
            self.occupancy_available = False
            return

        ttl = float(settings.occupancy_track_ttl)
        min_hits = max(1, int(settings.occupancy_min_track_hits))
        now = time.time()

        self._person_pass += 1
        # Expire tracks that have not been re-seen inside the TTL before
        # matching, so a person who has left stops being counted.
        self._person_tracks = [t for t in self._person_tracks if now - t["ts"] <= ttl]

        for det in detections:
            # Only REAL human detections feed the headcount. A demo-injected
            # weapon (source='demo') is not a person, and a face box is a
            # different measurement entirely.
            if det.type != "human":
                continue
            if not det.bbox or len(det.bbox) < 4:
                continue
            self._person_track_for(det.bbox)

        self.occupancy_count = sum(
            1 for t in self._person_tracks if int(t.get("hits", 0)) >= min_hits
        )
        self.occupancy_updated_at = time.monotonic()
        self.occupancy_updated_wall = now
        self.occupancy_available = True

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

    def _update_stats(self, now: float, detections: list[Detection],
                      recognitions: list[FaceRecognitionResult] | None = None,
                      recognition_due: bool = True) -> None:
        # `people` is the number of human boxes IN THIS FRAME — the Review 1
        # statistic, unchanged. It is NOT the occupancy figure: occupancy is
        # the number of distinct live person TRACKS (see _update_occupancy), so
        # one person standing in view keeps `people` at 1 per frame and
        # contributes exactly 1 to occupancy rather than one per frame.
        self.people = sum(1 for d in detections if d.type == "human")
        self.weapons = sum(1 for d in detections if d.type == "weapon")
        # Face and identity counters only change on frames where face
        # detection / recognition actually ran, so they reflect the latest real
        # measurement rather than decaying to zero between recognition passes.
        if recognition_due:
            self.faces = sum(1 for d in detections if d.type == "face")
        if recognitions is not None and recognitions:
            self.known_faces = sum(1 for r in recognitions if r.status == "KNOWN")
            self.unknown_faces = sum(1 for r in recognitions if r.status == "UNKNOWN")
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
