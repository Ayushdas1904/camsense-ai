"""Face detection as a pipeline Detector.

Implements the same ``app.detection.base.Detector`` interface as the human and
weapon detectors, so face boxes flow through the existing pipeline, stats and
overlay path using REAL coordinates — no separate drawing route, no invented
boxes.

SCOPE: presence and location only. This detector answers "is a face here, and
where?" and deliberately attaches NO identity. Identity comes from
``face_service.recognize_frame`` and is only ever labelled on the video when
the match cleared the configured threshold.
"""
from app.detection.base import Detector
from app.models.schemas import Detection
from app.recognition import face_service
from app.recognition.face_model import FaceDetectorModel


class FaceDetector(Detector):
    type = "face"
    label = "Face Detection"

    def detect(self, frame, faces: list[dict] | None = None) -> list[Detection]:
        """Return a Detection per detected face.

        ``faces`` lets a caller that already ran face detection on this frame
        (the stream worker, on recognition frames) reuse those records instead
        of paying for a second YuNet pass.
        """
        if faces is None:
            faces = face_service.detect_faces(frame)
        detections: list[Detection] = []
        for face in faces or []:
            bbox = face.get("bbox")
            if not bbox or len(bbox) < 4:
                continue
            # YuNet scores are ~[0, 1]; clamp so the contract's bounds hold.
            score = min(1.0, max(0.0, float(face.get("score", 0.0))))
            detections.append(
                Detection(
                    type=self.type,
                    label="face",
                    confidence=round(score, 2),
                    bbox=[int(v) for v in bbox[:4]],
                    source="real",
                )
            )
        return detections

    def status(self) -> str:
        return "active" if FaceDetectorModel.instance().available else "unavailable"
