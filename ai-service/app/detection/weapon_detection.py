"""Weapon detection.

Honesty note (per spec §8/§12): the bundled YOLOv8n model is trained on COCO,
which contains a real `knife` class (and `scissors`) but NO firearm class. So:

  - knife / scissors  → REAL detection via the COCO model
  - gun / firearm      → NOT available with this model (reported as unavailable)

A dedicated firearm-trained YOLO model can be dropped in later via
`WEAPON_MODEL_PATH` without changing this interface. For demonstrating the
critical-alert pipeline when no bladed object is in view, a clearly-labelled
DEMO weapon event can be injected through the stream API (source="demo").
"""
from app.config import get_settings
from app.detection.base import Detector
from app.detection.yolo_model import YoloModel
from app.models.schemas import Detection

# COCO classes that are genuinely weapon-like and detectable by yolov8n.
COCO_WEAPON_CLASSES = {"knife", "scissors"}


class WeaponDetector(Detector):
    type = "weapon"
    label = "Weapon Detection"

    def detect(self, frame) -> list[Detection]:
        model = YoloModel.instance()
        if not model.available:
            return []

        conf = get_settings().weapon_confidence
        result = model.predict(frame, conf=conf)
        if result is None or result.boxes is None:
            return []

        detections: list[Detection] = []
        for box in result.boxes:
            cls_id = int(box.cls[0])
            name = model.names.get(cls_id, str(cls_id))
            if name not in COCO_WEAPON_CLASSES:
                continue
            x1, y1, x2, y2 = (int(v) for v in box.xyxy[0].tolist())
            detections.append(
                Detection(
                    type=self.type,
                    label=name,
                    confidence=round(float(box.conf[0]), 2),
                    bbox=[x1, y1, x2 - x1, y2 - y1],
                    source="real",
                )
            )
        return detections

    def status(self) -> str:
        # Real (limited to bladed weapons) when the model is loaded; firearm
        # detection would need a dedicated model.
        return "active" if YoloModel.instance().available else "unavailable"
