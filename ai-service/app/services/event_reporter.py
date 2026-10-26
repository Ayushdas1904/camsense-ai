"""Reports significant detections from the AI service to the Node backend.

This realizes the AI → BACKEND leg of the pipeline. The backend owns the real
alert cooldown/throttling and persistence; the reporter only rate-limits POSTs
so the backend isn't hit every frame. Authenticated with a shared secret, not a
user JWT (this is service-to-service traffic).

Review 2 adds a second, independently rate-limited leg for recognition
results. The two legs use separate limiters and separate timestamps so neither
can starve the other. Review 3 adds a THIRD leg for occupancy, on the same
pattern: its own limiter, its own interval, its own in-flight accounting — and
no image payload at all, because a headcount needs no snapshot.

THREADING: the HTTP POSTs are dispatched on short-lived background threads.
The caller is a camera worker that also runs YOLO on every frame, so a backend
that accepts connections but stalls must not be able to block human/weapon
detection while a POST times out. Rate limiting and payload construction stay
on the worker; only the network call moves off it, and the number of POSTs in
flight is capped per leg AND per camera so a stalled backend cannot cause
unbounded thread growth and one busy camera cannot starve the others. A report
the cap discards is COUNTED, surfaced in ``StreamStats``, and marks the
recognition leg degraded — a dropped report means the backend never learns
about that sighting, so the status panel must not keep reporting ``active``.
``shutdown()`` waits briefly for in-flight POSTs so a pending unknown-identity
report and its snapshot are not abandoned at exit.

PRIVACY: the recognition payload NEVER contains a face embedding. The backend
already holds the enrolled embeddings; the decision travels as a person id plus
the similarity that produced it.
"""
import base64
import threading
import time

import cv2
import requests

from app.config import get_settings
from app.models.schemas import Detection, FaceRecognitionResult

# Bound the payload: evidence snapshots are only attached to the first few
# non-KNOWN results in a batch.
MAX_SNAPSHOTS_PER_REPORT = 3

# Maximum POSTs in flight PER LEG AND PER CAMERA before further reports are
# dropped. Per camera, not global: a single global cap of 4 was reached by a
# merely slow backend plus a handful of cameras, so one busy camera could cause
# reports to be discarded for all the others.
MAX_IN_FLIGHT_REPORTS = 4

# How long shutdown waits for in-flight POSTs to finish. An unknown-identity
# report carries its evidence snapshot, so abandoning it at interpreter exit
# loses the event entirely, not just a frame.
SHUTDOWN_JOIN_TIMEOUT = 2.0


class EventReporter:
    def __init__(self) -> None:
        self._last_sent: dict[str, float] = {}
        self._last_recognition_sent: dict[str, float] = {}
        # Review 3 occupancy leg: its own limiter, plus the last count actually
        # DELIVERED per camera so a change can bypass the interval.
        self._last_occupancy_sent: dict[str, float] = {}
        self._last_occupancy_value: dict[str, tuple[int | None, bool]] = {}
        self._lock = threading.Lock()
        # None = never attempted, True = last POST succeeded, False = last POST
        # failed OR a report was dropped without being delivered at all.
        self.recognition_leg_ok: bool | None = None
        # POSTs in flight, keyed (leg, camera_id). Bounded so a stalled backend
        # cannot make the camera workers spawn threads without limit.
        self._in_flight: dict[tuple[str, str], int] = {}
        # Reports DISCARDED because the cap was reached, keyed the same way.
        # Surfaced in StreamStats so a drop is visible to the operator instead
        # of only appearing in this service's stdout.
        self._dropped: dict[tuple[str, str], int] = {}
        # When each leg last had to discard a report, so the status surface can
        # report the leg degraded for a while afterwards rather than going green
        # again the moment one later POST happens to succeed.
        self._last_drop_at: dict[str, float] = {}
        # In-flight dispatch threads, so shutdown can wait briefly for them.
        self._threads: set[threading.Thread] = set()

    # ── failure accounting ─────────────────────────────────────

    def dropped_reports(self, leg: str, camera_id: str | None = None) -> int:
        """Reports discarded by the in-flight cap, for one camera or all."""
        with self._lock:
            if camera_id is not None:
                return self._dropped.get((leg, camera_id), 0)
            return sum(count for (key_leg, _), count in self._dropped.items() if key_leg == leg)

    def in_flight(self, leg: str, camera_id: str) -> int:
        with self._lock:
            return self._in_flight.get((leg, camera_id), 0)

    def seconds_since_drop(self, leg: str) -> float | None:
        """Seconds since this leg last discarded a report, or None if never."""
        with self._lock:
            at = self._last_drop_at.get(leg)
        return None if at is None else max(0.0, time.time() - at)

    def shutdown(self, timeout: float = SHUTDOWN_JOIN_TIMEOUT) -> int:
        """Wait briefly for in-flight POSTs, so a pending report is not lost.

        The dispatch threads are daemons (a hung backend must never stop the
        process exiting), which on its own meant an unknown-identity report and
        its snapshot were abandoned at interpreter exit. Returns the number of
        threads still running when the deadline passed.
        """
        with self._lock:
            threads = [t for t in self._threads if t.is_alive()]
        deadline = time.time() + max(0.0, float(timeout))
        for thread in threads:
            remaining = deadline - time.time()
            if remaining <= 0:
                break
            thread.join(timeout=remaining)
        still_running = sum(1 for t in threads if t.is_alive())
        if still_running:
            print(f"[reporter] shutdown: {still_running} POST(s) still in flight, abandoning")
        return still_running

    # ── off-thread dispatch ────────────────────────────────────

    def _dispatch(self, leg: str, camera_id: str, fn, *args) -> bool:
        """Run ``fn`` on a short-lived background thread.

        The camera worker that calls ``report``/``report_recognition`` is the
        SAME thread that runs YOLO human and weapon detection. A synchronous
        POST to a backend that accepts connections but stalls would therefore
        hold up detection for that camera for the whole timeout. The rate
        limiting and payload construction stay on the worker (cheap and
        deterministic); only the network call moves off it.

        Returns False when this leg already has ``MAX_IN_FLIGHT_REPORTS`` POSTs
        outstanding FOR THIS CAMERA — the report is DROPPED rather than queued,
        because a stale recognition report is worth less than a responsive
        camera. A drop is counted, exposed in ``StreamStats``, and (for the
        recognition leg) marks the leg as degraded, so the status panel cannot
        report ``active`` while reports are being discarded.
        """
        key = (leg, camera_id)
        with self._lock:
            if self._in_flight.get(key, 0) >= MAX_IN_FLIGHT_REPORTS:
                self._dropped[key] = self._dropped.get(key, 0) + 1
                self._last_drop_at[leg] = time.time()
                dropped = self._dropped[key]
                if leg == "recognition":
                    # The backend never learns about this sighting at all, so
                    # the leg is NOT working, whatever the last POST did.
                    self.recognition_leg_ok = False
                print(
                    f"[reporter] {leg} report for {camera_id} dropped: "
                    f"{self._in_flight.get(key, 0)} POSTs in flight "
                    f"({dropped} dropped for this camera so far)"
                )
                return False
            self._in_flight[key] = self._in_flight.get(key, 0) + 1

        def runner() -> None:
            try:
                fn(*args)
            finally:
                with self._lock:
                    self._in_flight[key] = max(0, self._in_flight.get(key, 1) - 1)
                    self._threads.discard(threading.current_thread())

        thread = threading.Thread(target=runner, name=f"reporter-{leg}", daemon=True)
        with self._lock:
            # Drop finished threads so this set cannot grow without bound.
            self._threads = {t for t in self._threads if t.is_alive()}
            self._threads.add(thread)
        thread.start()
        return True

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
        if not self._dispatch("detection", camera_id, self._post_ingest, payload):
            # Nothing was sent, so do not hold the limiter closed for another
            # interval — let the next frame try again.
            with self._lock:
                self._last_sent.pop(camera_id, None)

    @staticmethod
    def _post_ingest(payload: dict) -> None:
        settings = get_settings()
        try:
            requests.post(
                f"{settings.backend_url}/api/ai/ingest",
                json=payload,
                headers={"x-ai-secret": settings.ingest_secret},
                timeout=float(settings.report_timeout),
            )
        except requests.RequestException as exc:
            # Backend down must never crash video processing.
            print(f"[reporter] ingest failed: {exc}")

    def report_recognition(
        self,
        camera_id: str,
        results: list[FaceRecognitionResult],
        frame,
        mode: str,
    ) -> None:
        """POST recognition results to the backend (separate rate limiter).

        The backend validates every result before it may create an attendance
        record or an unknown-identity alert — this service only reports what
        the models produced.
        """
        if not results:
            return
        if not any(res.bbox for res in results):
            # Nothing to report but the service-level "unavailable" marker,
            # which the backend reads from GET /api/faces/status instead. Not
            # worth a POST per second per camera.
            return

        settings = get_settings()
        now = time.time()
        with self._lock:
            last = self._last_recognition_sent.get(camera_id, 0)
            if now - last < settings.recognition_report_interval:
                return
            self._last_recognition_sent[camera_id] = now

        snapshots_left = MAX_SNAPSHOTS_PER_REPORT
        items: list[dict] = []
        for res in results:
            # mode="json" so the timestamp serializes (datetime isn't JSON-safe).
            item = res.model_dump(mode="json")
            # Evidence snapshot only for results that are NOT a confirmed
            # identity AND actually point at a face region — those are the ones
            # a human may need to review.
            if res.status != "KNOWN" and res.bbox and snapshots_left > 0:
                snapshot = self._encode_face_snapshot(frame, res.bbox)
                if snapshot:
                    item["snapshot"] = snapshot
                    snapshots_left -= 1
            items.append(item)

        payload = {"cameraId": camera_id, "mode": mode, "results": items}
        if not self._dispatch("recognition", camera_id, self._post_recognition, payload):
            # The sighting was never delivered. Clear the limiter so the next
            # recognition pass can try again instead of waiting out the
            # interval for a report that no longer exists.
            with self._lock:
                self._last_recognition_sent.pop(camera_id, None)

    def _post_recognition(self, payload: dict) -> None:
        settings = get_settings()
        try:
            requests.post(
                f"{settings.backend_url}/api/ai/recognition",
                json=payload,
                headers={"x-ai-secret": settings.ingest_secret},
                timeout=float(settings.report_timeout),
            )
            self.recognition_leg_ok = True
        except requests.RequestException as exc:
            # Backend down must never crash video processing.
            self.recognition_leg_ok = False
            print(f"[reporter] recognition report failed: {exc}")

    # ── Review 3 · occupancy leg ───────────────────────────────

    def report_occupancy(
        self,
        camera_id: str,
        count: int | None,
        available: bool,
        frame_mode: str,
    ) -> None:
        """POST the current headcount to the backend (third, separate leg).

        Its own limiter and its own interval, so occupancy cannot starve — or
        be starved by — detection or recognition reporting.

        TWO DELIBERATE PROPERTIES:

        1. SEND ON CHANGE. The interval is a floor for UNCHANGED reports only.
           If the count (or the availability flag) differs from what was last
           delivered for this camera, the interval is bypassed, so a real
           transition — a room emptying, a camera going dark — reaches the
           backend immediately instead of up to one interval later.

        2. NO IMAGE, EVER. A headcount needs no evidence snapshot, so none is
           attached. Occupancy is the one leg that carries no pixels at all,
           which also means it cannot leak a face onto a payload that has no
           reason to hold one.

        ``available=False`` is REPORTED, not suppressed: the backend has to
        learn that the figure can no longer be trusted, otherwise it would keep
        treating the last count as current. ``count`` is passed through
        unchanged in that case (it is the last known value, possibly None) —
        this service never substitutes 0 for "unknown", and the backend's own
        rules decide what to show.
        """
        settings = get_settings()
        if not settings.occupancy_enabled:
            return

        now = time.time()
        current = (count, bool(available))
        with self._lock:
            previous = self._last_occupancy_value.get(camera_id)
            changed = previous is None or previous != current
            last = self._last_occupancy_sent.get(camera_id, 0)
            if not changed and now - last < settings.occupancy_report_interval:
                return
            self._last_occupancy_sent[camera_id] = now
            self._last_occupancy_value[camera_id] = current

        payload = {
            "cameraId": camera_id,
            "mode": frame_mode,
            # None when the count has never been measured. Sent as null rather
            # than 0 so the backend cannot mistake it for an empty room.
            "count": count,
            "available": bool(available),
        }
        if not self._dispatch("occupancy", camera_id, self._post_occupancy, payload):
            # Nothing was delivered, so do not record this as the last reported
            # state — otherwise the next genuine change could be compared
            # against a value the backend never received and be suppressed.
            with self._lock:
                self._last_occupancy_sent.pop(camera_id, None)
                if previous is None:
                    self._last_occupancy_value.pop(camera_id, None)
                else:
                    self._last_occupancy_value[camera_id] = previous

    def _post_occupancy(self, payload: dict) -> None:
        settings = get_settings()
        try:
            requests.post(
                f"{settings.backend_url}/api/ai/occupancy",
                json=payload,
                headers={"x-ai-secret": settings.ingest_secret},
                timeout=float(settings.report_timeout),
            )
        except requests.RequestException as exc:
            # Backend down must never crash video processing.
            print(f"[reporter] occupancy report failed: {exc}")

    @staticmethod
    def _encode_snapshot(frame, detections: list[Detection]) -> str | None:
        annotated = frame.copy()
        from app.services.pipeline import DetectionPipeline

        DetectionPipeline.annotate(annotated, detections)
        ok, buf = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 80])
        if not ok:
            return None
        return "data:image/jpeg;base64," + base64.b64encode(buf).decode("ascii")

    @staticmethod
    def _encode_face_snapshot(frame, bbox, margin: float = 0.35) -> str | None:
        """Crop to the face region (with margin) and encode it as a data URL.

        Cropping keeps the evidence proportionate and the payload small: the
        reviewer needs the face, not the whole scene. Falls back to ``None``
        rather than raising.
        """
        if frame is None:
            return None
        try:
            height, width = frame.shape[:2]
        except Exception:  # noqa: BLE001 - not an image
            return None

        if bbox and len(bbox) >= 4 and int(bbox[2]) > 0 and int(bbox[3]) > 0:
            x, y, w, h = (int(v) for v in bbox[:4])
            pad_x, pad_y = int(w * margin), int(h * margin)
            x1 = max(0, x - pad_x)
            y1 = max(0, y - pad_y)
            x2 = min(width, x + w + pad_x)
            y2 = min(height, y + h + pad_y)
            crop = frame[y1:y2, x1:x2] if x2 > x1 and y2 > y1 else frame
        else:
            crop = frame

        if getattr(crop, "size", 0) == 0:
            return None
        ok, buf = cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, 80])
        if not ok:
            return None
        return "data:image/jpeg;base64," + base64.b64encode(buf).decode("ascii")


reporter = EventReporter()
