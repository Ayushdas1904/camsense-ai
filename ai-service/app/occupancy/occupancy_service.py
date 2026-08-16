"""Occupancy estimation — Review 3.

Interface defined now; not implemented in the foundation. Occupancy is derived
from human detections rather than a separate model.
"""
from app.models.schemas import Detection


class OccupancyService:
    def calculate_occupancy(self, detections: list[Detection]) -> int:
        """Count people currently in view. Implemented in Review 3."""
        raise NotImplementedError("Occupancy monitoring is implemented in Review 3")
