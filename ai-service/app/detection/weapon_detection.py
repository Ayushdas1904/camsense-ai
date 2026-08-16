"""Weapon detection module.

Foundation ships a MOCK detector returning clearly-labelled DEMO data.
Review 1 replaces `detect()` with a trained YOLO weapon model, same interface.
"""
import random

from app.detection.base import Detector
from app.models.schemas import BoundingBox, Detection


class WeaponDetector(Detector):
    type = "weapon"

    # Weapons should be rare in demo output so alerts stay meaningful.
    _classes = ["knife", "pistol"]

    def detect(self, frame=None) -> list[Detection]:
        # DEMO: ~10% chance of a single weapon detection. Not real inference.
        if random.random() > 0.1:
            return []
        return [
            Detection(
                type=self.type,
                label=random.choice(self._classes),
                confidence=round(random.uniform(0.6, 0.9), 2),
                bbox=BoundingBox(
                    x=random.randint(0, 400),
                    y=random.randint(0, 300),
                    width=random.randint(40, 100),
                    height=random.randint(40, 100),
                ),
            )
        ]
