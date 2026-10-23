"""Detection pipeline — runs the enabled detectors on a frame and draws overlays.

Single place that knows which detectors run and how detections are drawn onto
the stream. Overlay boxes use the model's REAL coordinates (never random), so
what the operator sees on the video matches the stored detection events.

Review 2 adds face DETECTION to the detector list (presence + location) and an
optional identity overlay layer. Identity is drawn only for recognition
results that cleared the configured similarity threshold — a face that did not
clear it never gets a name drawn on it.
"""
import cv2

from app.config import get_settings
from app.detection.human_detection import HumanDetector
from app.detection.weapon_detection import WeaponDetector
from app.detection.yolo_model import YoloModel
from app.models.schemas import Detection, DetectorStatus, FaceRecognitionResult
from app.recognition import face_service
from app.recognition.embedding_cache import embedding_cache
from app.recognition.face_detection import FaceDetector
from app.recognition.face_model import FaceDetectorModel, FaceEmbedderModel
from app.recognition.face_service import RecognitionStatus

# BGR colors (OpenCV). Semantic: humans = informational blue, weapons = critical red.
COLORS = {
    "human": (246, 130, 59),   # blue-ish
    "weapon": (68, 68, 239),   # red
    "demo": (11, 158, 245),    # amber for demo-labelled boxes
    "face": (180, 180, 180),   # neutral grey — a detected face is not an event
}

# Identity overlay colors. Deliberately NOT red: an unmatched face is a face the
# system could not confidently match, not evidence of wrongdoing.
IDENTITY_COLORS = {
    RecognitionStatus.KNOWN: (120, 200, 120),              # calm green
    RecognitionStatus.UNKNOWN: (219, 168, 56),             # muted amber
    RecognitionStatus.LOW_QUALITY: (170, 170, 170),         # grey
    RecognitionStatus.RECOGNITION_UNAVAILABLE: (170, 170, 170),
}

#: Seconds a dropped recognition report keeps the attendance leg in `error`.
_DROP_DEGRADED_WINDOW = 60.0


class DetectionPipeline:
    def __init__(self) -> None:
        # Review 1 detectors first, unchanged; face detection is additive.
        self._detectors = [HumanDetector(), WeaponDetector(), FaceDetector()]

    def detector_status(self) -> list[DetectorStatus]:
        statuses = [
            DetectorStatus(key=d.type, label=d.label, status=d.status())
            for d in self._detectors
        ]
        statuses.append(
            DetectorStatus(key="video", label="Video Processing", status="active")
        )
        statuses.append(
            DetectorStatus(
                key="face_recognition",
                label="Face Recognition",
                status=_face_recognition_status(),
            )
        )
        statuses.append(
            DetectorStatus(
                key="attendance",
                label="Attendance Service",
                status=_attendance_leg_status(),
            )
        )
        return statuses

    def run(self, frame, faces: list[dict] | None = None) -> list[Detection]:
        """Run every detector on one frame.

        ``faces`` is an optional set of already-computed face records; passing
        them lets the face detector skip a redundant inference pass when the
        caller has just run face detection for recognition. Review 1 callers
        that pass only a frame behave exactly as before.
        """
        detections: list[Detection] = []
        for detector in self._detectors:
            if faces is not None and getattr(detector, "type", None) == "face":
                detections.extend(detector.detect(frame, faces=faces))
            else:
                detections.extend(detector.detect(frame))
        return detections

    @staticmethod
    def annotate(frame, detections: list[Detection],
                 recognitions: "list[FaceRecognitionResult] | None" = None):
        """Draw bounding boxes + labels onto a copy-safe frame (in place)."""
        for det in detections:
            x, y, w, h = det.bbox
            color = COLORS["demo"] if det.source == "demo" else COLORS.get(det.type, (200, 200, 200))
            cv2.rectangle(frame, (x, y), (x + w, y + h), color, 2)

            tag = f"{det.label.upper()} {int(det.confidence * 100)}%"
            if det.source == "demo":
                tag = f"DEMO {tag}"
            (tw, th), _ = cv2.getTextSize(tag, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
            cv2.rectangle(frame, (x, y - th - 8), (x + tw + 8, y), color, -1)
            cv2.putText(frame, tag, (x + 4, y - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.5,
                        (255, 255, 255), 1, cv2.LINE_AA)

        if recognitions:
            DetectionPipeline.annotate_identities(frame, recognitions)
        return frame

    @staticmethod
    def annotate_identities(frame, recognitions: "list[FaceRecognitionResult]"):
        """Draw identity labels under faces, using the AI service's own coordinates.

        A name is drawn ONLY for a KNOWN result (one that cleared the
        similarity threshold). UNKNOWN draws 'UNKNOWN IDENTITY' with no name
        and no identity claim; LOW_QUALITY and RECOGNITION_UNAVAILABLE report
        the service state instead of inventing a result.

        FAIL CLOSED ON A STALE CACHE. Identity labels are drawn inside this
        service from its own cached identity set, before anything reaches the
        backend's re-verification — so the backend's rejection of a disabled or
        deleted person cannot un-draw a name. If the cache is past its TTL
        (a refresh notification was missed or has been failing), no name is
        drawn at all: the box says IDENTITY UNVERIFIED instead.
        """
        trustworthy = face_service.identity_labels_trustworthy()
        for res in recognitions:
            if not res.bbox or len(res.bbox) < 4:
                continue
            x, y, w, h = (int(v) for v in res.bbox[:4])
            color = IDENTITY_COLORS.get(res.status, (170, 170, 170))

            if res.status == RecognitionStatus.KNOWN and res.person_name and trustworthy:
                similarity = f" {res.similarity:.2f}" if res.similarity is not None else ""
                tag = f"{res.person_name}{similarity}"
            elif res.status == RecognitionStatus.KNOWN:
                # Matched against an identity set we can no longer vouch for.
                color = IDENTITY_COLORS[RecognitionStatus.RECOGNITION_UNAVAILABLE]
                tag = "IDENTITY UNVERIFIED"
            elif res.status == RecognitionStatus.UNKNOWN:
                tag = "UNKNOWN IDENTITY"
            elif res.status == RecognitionStatus.LOW_QUALITY:
                tag = "FACE TOO SMALL"
            else:
                tag = "RECOGNITION UNAVAILABLE"

            cv2.rectangle(frame, (x, y), (x + w, y + h), color, 2)
            (tw, th), _ = cv2.getTextSize(tag, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
            top = y + h
            cv2.rectangle(frame, (x, top), (x + tw + 8, top + th + 8), color, -1)
            cv2.putText(frame, tag, (x + 4, top + th + 3), cv2.FONT_HERSHEY_SIMPLEX,
                        0.45, (20, 20, 20), 1, cv2.LINE_AA)
        return frame


def _face_recognition_status() -> str:
    """Honest readiness of the identity-matching leg.

    active      → models loaded AND a fresh enrolled-identity set is available
    error       → models loaded but identities could not be fetched, or the
                  cached set is past its TTL (matching is failing closed)
    inactive    → models loaded, identities not fetched yet, no error
    unavailable → the embedding model itself is missing or failed to load
    """
    if not FaceEmbedderModel.instance().available or not FaceDetectorModel.instance().available:
        return "unavailable"
    if embedding_cache.loaded:
        settings = get_settings()
        if embedding_cache.is_stale(grace=float(settings.embedding_cache_stale_grace)):
            return "error"
        return "active"
    return "error" if embedding_cache.last_error else "inactive"


def _attendance_leg_status() -> str:
    """Readiness of the AI → backend recognition-reporting leg.

    Attendance itself is owned and enforced by the Node backend; all this
    service can honestly report is whether it is able to produce recognition
    results and deliver them.

    A report the reporter had to DISCARD (its in-flight cap was reached) counts
    as a failure of this leg, not a neutral event: the backend never learns
    about that sighting. Drops keep the leg in ``error`` for
    ``_DROP_DEGRADED_WINDOW`` seconds afterwards, so a single later successful
    POST cannot paint the panel green while reports are still being dropped.
    """
    if _face_recognition_status() == "unavailable":
        return "unavailable"
    from app.services.event_reporter import reporter  # local import avoids a cycle

    since_drop = reporter.seconds_since_drop("recognition")
    if since_drop is not None and since_drop <= _DROP_DEGRADED_WINDOW:
        return "error"
    if reporter.recognition_leg_ok is False:
        return "error"
    if reporter.recognition_leg_ok is None:
        return "inactive"
    return "active"


pipeline = DetectionPipeline()


def warmup() -> None:
    """Run one dummy inference so the first real frame isn't slow."""
    model = YoloModel.instance()
    if model.available:
        import numpy as np

        model.predict(np.zeros((640, 640, 3), dtype="uint8"), conf=0.5)
