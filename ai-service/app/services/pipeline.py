"""Detection pipeline — runs the enabled detectors on a frame and draws overlays.

Single place that knows which detectors run and how detections are drawn onto
the stream. Overlay boxes use the model's REAL coordinates (never random), so
what the operator sees on the video matches the stored detection events.
"""
import cv2

from app.detection.human_detection import HumanDetector
from app.detection.weapon_detection import WeaponDetector
from app.detection.yolo_model import YoloModel
from app.models.schemas import Detection, DetectorStatus

# BGR colors (OpenCV). Semantic: humans = informational blue, weapons = critical red.
COLORS = {
    "human": (246, 130, 59),   # blue-ish
    "weapon": (68, 68, 239),   # red
    "demo": (11, 158, 245),    # amber for demo-labelled boxes
}


class DetectionPipeline:
    def __init__(self) -> None:
        self._detectors = [HumanDetector(), WeaponDetector()]

    def detector_status(self) -> list[DetectorStatus]:
        statuses = [
            DetectorStatus(key=d.type, label=d.label, status=d.status())
            for d in self._detectors
        ]
        statuses.append(
            DetectorStatus(key="video", label="Video Processing", status="active")
        )
        return statuses

    def run(self, frame) -> list[Detection]:
        detections: list[Detection] = []
        for detector in self._detectors:
            detections.extend(detector.detect(frame))
        return detections

    @staticmethod
    def annotate(frame, detections: list[Detection]):
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
        return frame


pipeline = DetectionPipeline()


def warmup() -> None:
    """Run one dummy inference so the first real frame isn't slow."""
    model = YoloModel.instance()
    if model.available:
        import numpy as np

        model.predict(np.zeros((640, 640, 3), dtype="uint8"), conf=0.5)
