"""Face detection + face embedding model loaders (loaded exactly once).

MODEL SELECTION RATIONALE (Review 2)
====================================
Detection:  OpenCV YuNet          via ``cv2.FaceDetectorYN``
            model: face_detection_yunet_2023mar.onnx   (~230-345 KB)
Embedding:  OpenCV SFace          via ``cv2.FaceRecognizerSF``
            model: face_recognition_sface_2021dec.onnx (~37 MB)
            output: 128-d vector, compared with cosine similarity

Why this pair was chosen for this project:

1. ZERO new pip dependencies. ``opencv-python-headless==4.10.0.84`` is already
   pinned for Review 1, and its ``objdetect``/``dnn`` modules ship both
   classes. Nothing has to be installed, compiled, or downloaded from PyPI —
   only two ONNX weight files (``python download_assets.py``).
2. CPU-fast. YuNet is a few hundred KB and runs in ~1 ms at 640 px; SFace is a
   single small ONNX forward pass per face. No GPU required.
3. Compatible with the existing tight pins, in particular ``numpy<2`` and the
   torch CPU build that ultralytics brings in. No second numerical stack.
4. GENUINE ALIGNMENT. YuNet returns 5 facial landmarks (both eyes, nose, both
   mouth corners) and ``cv2.FaceRecognizerSF.alignCrop`` consumes exactly that
   row, which gives the real face-alignment step the Review 2 workflow asks
   for, rather than embedding a raw unaligned crop.
5. One recognition library, not several — the instruction to avoid overlapping
   recognition stacks is satisfied.

Why the alternatives were rejected *in this environment*:

* ``face-recognition`` / ``dlib`` — the requirements.txt placeholder originally
  proposed this. It is a dlib wrapper and needs a native dlib build (no
  prebuilt wheel for this platform/Python combination). No compiler toolchain
  or network install is available here, so the placeholder was removed.
* ``insightface`` — stronger models, but requires a native/Cython build step
  and downloads its model zoo at first use; same blocker.
* ``deepface`` — pulls TensorFlow, which conflicts with the existing torch CPU
  stack and with the ``numpy<2`` pin, and doubles install size for no gain.

HONESTY NOTE: SFace is a solid, widely used open model, but no accuracy claim
is made here. The cosine threshold in ``Settings.face_match_threshold`` is
OpenCV's published starting point and REQUIRES validation on real enrolled
data before any production use.

GRACEFUL DEGRADATION: every load is wrapped so that a missing ONNX file, an
OpenCV build without ``FaceDetectorYN``/``FaceRecognizerSF``, or a corrupt
model sets ``available = False`` and prints a diagnostic instead of raising.
The service must still start and Review 1's YOLO human/weapon detection must
still run when the face weights have not been downloaded.
"""
from __future__ import annotations

import os
import threading

from app.config import get_settings


def resolve_model_path(path: str) -> str:
    """Resolve a configured model path against the ai-service root.

    Mirrors ``YoloModel._load`` so relative paths behave identically no matter
    what the current working directory is.
    """
    if os.path.isabs(path):
        return path
    # .../ai-service/app/recognition/face_model.py → .../ai-service
    root = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
    return os.path.normpath(os.path.join(root, path))


class FaceDetectorModel:
    """Load-once wrapper around ``cv2.FaceDetectorYN`` (YuNet).

    Thread safety: the stream workers are threads sharing this one instance,
    and YuNet requires ``setInputSize(w, h)`` before detecting on a frame of a
    different size — a per-instance lock guards both the size switch and the
    detect call so two camera threads with different frame sizes cannot
    interleave and corrupt each other's input size.
    """

    _instance: "FaceDetectorModel | None" = None
    _lock = threading.Lock()

    #: Identifies the detector in status payloads.
    model_name = "yunet_2023mar"

    def __init__(self) -> None:
        self.detector = None
        self.available = False
        self.model_path = ""
        self.last_error: str | None = None
        self._input_size: tuple[int, int] = (0, 0)
        self._use_lock = threading.Lock()
        self._load()

    def _load(self) -> None:
        settings = get_settings()
        path = resolve_model_path(settings.face_detection_model_path)
        self.model_path = path
        try:
            import cv2  # imported lazily so an import error degrades gracefully

            if not os.path.exists(path):
                raise FileNotFoundError(f"model file not found: {path}")
            # Positional args: (model, config, input_size, score_threshold,
            # nms_threshold, top_k) — kept positional for binding stability.
            self.detector = cv2.FaceDetectorYN.create(
                path,
                "",
                (320, 320),
                float(settings.face_detection_confidence),
                0.3,
                5000,
            )
            self._input_size = (320, 320)
            self.available = True
            self.last_error = None
        except Exception as exc:  # noqa: BLE001 - any failure → graceful fallback
            self.detector = None
            self.available = False
            self.last_error = str(exc)
            print(
                f"[face] detector unavailable: {exc} "
                f"(expected model at {path} — run `python download_assets.py`)"
            )

    @classmethod
    def instance(cls) -> "FaceDetectorModel":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = FaceDetectorModel()
        return cls._instance

    def detect(self, frame):
        """Detect faces on a BGR frame.

        Returns YuNet's raw Nx15 float array (``[x, y, w, h, 10 landmark
        coords, score]`` per row), or ``None`` when unavailable / on failure.
        Never raises.
        """
        if not self.available or self.detector is None or frame is None:
            return None
        try:
            height, width = frame.shape[:2]
        except Exception:  # noqa: BLE001 - not an image
            return None
        try:
            with self._use_lock:
                if self._input_size != (width, height):
                    self.detector.setInputSize((width, height))
                    self._input_size = (width, height)
                _retval, faces = self.detector.detect(frame)
            return faces
        except Exception as exc:  # noqa: BLE001 - never kill the worker
            print(f"[face] detection failed: {exc}")
            return None


class FaceEmbedderModel:
    """Load-once wrapper around ``cv2.FaceRecognizerSF`` (SFace, 128-d).

    ``align_and_embed`` is the ONE place an embedding is produced, so a
    registration photograph and a live camera frame go through an identical
    align-then-embed path (a hard requirement: embeddings generated two
    different ways are not comparable).
    """

    _instance: "FaceEmbedderModel | None" = None
    _lock = threading.Lock()

    #: Identifies the embedding space. Stored with every enrolled embedding so
    #: vectors from a different model can be rejected instead of mis-scored.
    model_name = "sface_2021dec"
    #: SFace produces a 128-d feature vector.
    embedding_dim = 128

    def __init__(self) -> None:
        self.recognizer = None
        self.available = False
        self.model_path = ""
        self.last_error: str | None = None
        # Instance copies so callers can read them even when unavailable.
        self.model_name = FaceEmbedderModel.model_name
        self.embedding_dim = FaceEmbedderModel.embedding_dim
        self._use_lock = threading.Lock()
        self._load()

    def _load(self) -> None:
        settings = get_settings()
        path = resolve_model_path(settings.face_recognition_model_path)
        self.model_path = path
        try:
            import cv2  # imported lazily so an import error degrades gracefully

            if not os.path.exists(path):
                raise FileNotFoundError(f"model file not found: {path}")
            self.recognizer = cv2.FaceRecognizerSF.create(path, "")
            self.available = True
            self.last_error = None
        except Exception as exc:  # noqa: BLE001 - any failure → graceful fallback
            self.recognizer = None
            self.available = False
            self.last_error = str(exc)
            print(
                f"[face] embedder unavailable: {exc} "
                f"(expected model at {path} — run `python download_assets.py`)"
            )

    @classmethod
    def instance(cls) -> "FaceEmbedderModel":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = FaceEmbedderModel()
        return cls._instance

    def align_and_embed(self, frame, face_row):
        """Align the face using its landmarks, then return the raw feature.

        ``face_row`` is one row of YuNet's detection output. Returns the raw
        (1, 128) numpy feature, or ``None`` when unavailable / on failure.
        Never raises.
        """
        if not self.available or self.recognizer is None or frame is None:
            return None
        try:
            with self._use_lock:
                aligned = self.recognizer.alignCrop(frame, face_row)
                if aligned is None or getattr(aligned, "size", 0) == 0:
                    return None
                return self.recognizer.feature(aligned)
        except Exception as exc:  # noqa: BLE001 - never kill the worker
            # Deliberately logs only the failure reason, never vector values.
            print(f"[face] embedding failed: {exc}")
            return None
