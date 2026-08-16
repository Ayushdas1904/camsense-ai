"""Face detection & recognition — Review 2.

Interface defined now; not implemented in the foundation. Documents the shape
Review 2 will fill in (detect faces, compute embeddings, match against known
people) so the API surface is planned rather than improvised later.
"""
from app.models.schemas import Detection


class FaceRecognitionService:
    type = "face"

    def detect_faces(self, frame=None) -> list[Detection]:
        """Return face bounding boxes. Implemented in Review 2."""
        raise NotImplementedError("Face detection is implemented in Review 2")

    def compute_embedding(self, face_image) -> list[float]:
        """Return a face embedding vector. Implemented in Review 2."""
        raise NotImplementedError("Face embeddings are implemented in Review 2")

    def recognize(self, embedding, known_people) -> dict:
        """Match an embedding against registered people. Implemented in Review 2."""
        raise NotImplementedError("Face recognition is implemented in Review 2")
