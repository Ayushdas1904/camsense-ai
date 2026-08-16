"""Detector interface.

Every detection module (human, weapon, ...) implements this. The pipeline
depends only on `Detector`, never on a concrete model, so models can be
swapped or upgraded without touching callers.
"""
from abc import ABC, abstractmethod

from app.models.schemas import Detection


class Detector(ABC):
    #: Module family reported on each detection ("human", "weapon").
    type: str = "other"
    #: Human-readable label for the status panel.
    label: str = "Detector"

    @abstractmethod
    def detect(self, frame) -> list[Detection]:
        """Run detection on a single BGR frame and return structured detections."""
        raise NotImplementedError

    def status(self) -> str:
        """Report readiness: 'active' | 'unavailable' | 'demo'."""
        return "active"
