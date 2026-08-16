"""Detection pipeline — orchestrates the enabled detector modules.

This is the single place that knows which detectors run. It composes their
results into one DetectionResponse. Adding a module later (face, etc.) means
registering it here — callers of the pipeline don't change.
"""
from app.config import get_settings
from app.detection.human_detection import HumanDetector
from app.detection.weapon_detection import WeaponDetector
from app.models.schemas import Detection, DetectionResponse


class DetectionPipeline:
    def __init__(self) -> None:
        # Registry of active detector modules. Order is not significant.
        self._detectors = [HumanDetector(), WeaponDetector()]

    @property
    def module_status(self) -> dict[str, str]:
        """Reports each module's readiness for the health endpoint."""
        status = {d.type: "mock" for d in self._detectors}
        status.update({"face": "planned", "occupancy": "planned"})
        return status

    def run(self, camera_id: str, frame=None) -> DetectionResponse:
        settings = get_settings()
        detections: list[Detection] = []
        for detector in self._detectors:
            detections.extend(detector.detect(frame))

        return DetectionResponse(
            camera_id=camera_id,
            mode=settings.detection_mode,
            detections=detections,
        )


# Single shared instance — detectors (and later, loaded models) are reused
# across requests rather than reconstructed per call.
pipeline = DetectionPipeline()
