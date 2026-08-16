"""Human detection module.

Foundation ships a MOCK detector that returns clearly-labelled DEMO data.
Review 1 replaces the body of `detect()` with a YOLOv8/YOLOv11 person detector
while keeping this exact class interface, so nothing downstream changes.
"""
import random

from app.detection.base import Detector
from app.models.schemas import BoundingBox, Detection


class HumanDetector(Detector):
    type = "human"

    def detect(self, frame=None) -> list[Detection]:
        # DEMO: synthesize 0–2 person boxes. Not a real inference result.
        count = random.randint(0, 2)
        detections: list[Detection] = []
        for _ in range(count):
            x, y = random.randint(0, 400), random.randint(0, 200)
            detections.append(
                Detection(
                    type=self.type,
                    label="person",
                    confidence=round(random.uniform(0.75, 0.98), 2),
                    bbox=BoundingBox(x=x, y=y, width=random.randint(80, 160),
                                     height=random.randint(200, 360)),
                )
            )
        return detections
