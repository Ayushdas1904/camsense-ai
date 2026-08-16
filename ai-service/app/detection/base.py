"""Detector interface.

Every detection module (human, weapon, face, ...) implements this interface.
The rest of the service depends only on `Detector`, never on a concrete model,
so real YOLO/face models can replace the mock implementations without touching
callers. This is the seam that makes DEMO → REAL a config change, not a rewrite.
"""
from abc import ABC, abstractmethod

from app.models.schemas import Detection


class Detector(ABC):
    #: Module family reported on each detection ("human", "weapon", "face").
    type: str = "other"

    @abstractmethod
    def detect(self, frame) -> list[Detection]:
        """Run detection on a single frame and return structured detections.

        `frame` is an image/array in real mode. In the foundation's mock
        detectors it is unused, but the signature matches the real contract.
        """
        raise NotImplementedError

    @property
    def name(self) -> str:
        return self.__class__.__name__
