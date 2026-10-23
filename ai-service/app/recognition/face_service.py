"""Face recognition service — the single interface the rest of the app uses.

Public surface (nothing else should talk to the face models directly):

    decode_image(data)                  base64/data-URL → BGR frame
    detect_faces(frame)                 where are the faces?
    generate_embedding(frame, face)     the ONE embedding code path
    cosine_similarity(a, b)             pure math
    match_embedding(embedding, ...)     threshold-gated identity decision
    register_face(image_bgr)            enroll one photograph
    recognize_frame(frame, camera_id)   per-face results for a live frame
    recognition_status()                honest readiness report
    refresh_identity_cache()            drop + re-fetch enrolled identities
    identity_labels_trustworthy()       may a name be drawn on the video now?

Design rules enforced here:

* Face DETECTION and face RECOGNITION are separate steps with separate
  outputs. A detector finding a face says nothing about who it is.
* There is exactly ONE embedding function. A registration photograph and a
  live camera frame both reach SFace through ``align_and_embed``, so their
  vectors live in the same space and are comparable.
* The closest candidate is NOT a match. If the best cosine similarity is below
  ``settings.face_match_threshold`` the answer is UNKNOWN, with no person id
  attached, no matter how close it was.
* When a model is missing or the identity cache has never loaded, the answer
  is RECOGNITION_UNAVAILABLE — never UNKNOWN. An unavailable pipeline must not
  be able to raise unknown-person alerts. The same applies when the cache is
  STALE — last SUCCESSFULLY loaded more than TTL + grace ago because refreshes
  keep failing, or explicitly superseded by an invalidation we have not been
  able to replace yet: matching fails closed, because that generation may still
  contain a person whose recognition has since been disabled or who has been
  deleted.
* Matching is vectorized: one dot product against the stacked candidate
  matrix. An enrolled person's embedding is never regenerated at match time.
* ``cv2`` is imported lazily inside functions, so this module (and the pure
  decision logic in it) stays importable without the CV stack installed.
"""
from __future__ import annotations

import base64
import binascii

import numpy as np

from app.config import get_settings
from app.models.schemas import (
    FaceRecognitionResult,
    FaceRegistrationResponse,
    RecognitionStatusResponse,
)
from app.recognition.embedding_cache import embedding_cache
from app.recognition.face_model import FaceDetectorModel, FaceEmbedderModel


class RecognitionStatus:
    """The single status vocabulary used end to end (AI → backend → UI)."""

    KNOWN = "KNOWN"
    UNKNOWN = "UNKNOWN"
    LOW_QUALITY = "LOW_QUALITY"
    NO_FACE = "NO_FACE"
    RECOGNITION_UNAVAILABLE = "RECOGNITION_UNAVAILABLE"


class RegistrationStatus:
    """Outcomes of enrolling a photograph."""

    OK = "OK"
    NO_FACE = RecognitionStatus.NO_FACE
    MULTIPLE_FACES = "MULTIPLE_FACES"
    LOW_QUALITY = RecognitionStatus.LOW_QUALITY
    INVALID_IMAGE = "INVALID_IMAGE"
    RECOGNITION_UNAVAILABLE = RecognitionStatus.RECOGNITION_UNAVAILABLE


# Operator-facing messages (the backend relays these verbatim).
REGISTRATION_MESSAGES = {
    RegistrationStatus.OK: "Face registration completed successfully.",
    RegistrationStatus.NO_FACE: "No usable face was detected. Please upload another image.",
    RegistrationStatus.MULTIPLE_FACES: (
        "Registration photograph contains multiple faces. Please upload an image "
        "containing one clearly visible face."
    ),
    RegistrationStatus.INVALID_IMAGE: (
        "The uploaded file could not be decoded as an image. Please upload a valid "
        "JPEG or PNG photograph."
    ),
    RegistrationStatus.RECOGNITION_UNAVAILABLE: (
        "Face recognition is unavailable on the AI service — the model files are "
        "missing or could not be loaded. Run `python download_assets.py` in "
        "ai-service/ and restart the service."
    ),
}


# ── pure math ─────────────────────────────────────────────────────


def cosine_similarity(a, b) -> float:
    """Cosine similarity of two equal-length vectors, clamped to [-1, 1].

    Returns 0.0 when either vector is all zeros (undefined direction) or the
    lengths differ — callers that care about a length mismatch must check it
    themselves, because silently scoring mismatched vectors is exactly what
    ``match_embedding`` refuses to do.
    """
    va = np.asarray(a, dtype=np.float64).reshape(-1)
    vb = np.asarray(b, dtype=np.float64).reshape(-1)
    if va.size == 0 or vb.size == 0 or va.size != vb.size:
        return 0.0
    na = float(np.linalg.norm(va))
    nb = float(np.linalg.norm(vb))
    if na == 0.0 or nb == 0.0:
        return 0.0
    return float(np.clip(float(np.dot(va, vb)) / (na * nb), -1.0, 1.0))


def bbox_iou(a, b) -> float:
    """Intersection-over-union of two [x, y, w, h] boxes."""
    if not a or not b or len(a) < 4 or len(b) < 4:
        return 0.0
    ax, ay, aw, ah = (float(v) for v in a[:4])
    bx, by, bw, bh = (float(v) for v in b[:4])
    if aw <= 0 or ah <= 0 or bw <= 0 or bh <= 0:
        return 0.0
    ix1, iy1 = max(ax, bx), max(ay, by)
    ix2, iy2 = min(ax + aw, bx + bw), min(ay + ah, by + bh)
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    union = aw * ah + bw * bh - inter
    return float(inter / union) if union > 0 else 0.0


# ── detection ─────────────────────────────────────────────────────


def detect_faces(frame) -> list[dict]:
    """Detect faces on a BGR frame. Presence and location only — no identity.

    Returns a list of records::

        {"bbox": [x, y, w, h], "score": float,
         "landmarks": [[x, y] * 5], "raw": <YuNet row>}

    ``raw`` is kept so alignment can consume the original float landmarks.
    Returns ``[]`` when the detector is unavailable or nothing was found.
    Never raises.
    """
    rows = FaceDetectorModel.instance().detect(frame)
    if rows is None:
        return []

    settings = get_settings()
    min_score = float(settings.face_detection_confidence)
    faces: list[dict] = []
    for row in rows:
        values = np.asarray(row, dtype=np.float32).reshape(-1)
        if values.size < 15:
            continue
        score = float(values[14])
        if score < min_score:
            continue
        x, y, w, h = (int(round(float(v))) for v in values[0:4])
        if w <= 0 or h <= 0:
            continue
        landmarks = [
            [int(round(float(values[4 + i * 2]))), int(round(float(values[5 + i * 2])))]
            for i in range(5)
        ]
        faces.append(
            {
                "bbox": [max(0, x), max(0, y), w, h],
                "score": round(min(1.0, max(0.0, score)), 3),
                "landmarks": landmarks,
                "raw": values,
            }
        )
    return faces


def _face_row(face: dict):
    """The YuNet row alignment needs, rebuilt from bbox+landmarks if absent."""
    raw = face.get("raw")
    if raw is not None:
        return np.asarray(raw, dtype=np.float32).reshape(1, -1)
    bbox = face.get("bbox") or [0, 0, 0, 0]
    landmarks = face.get("landmarks") or [[0, 0]] * 5
    flat: list[float] = [float(v) for v in bbox[:4]]
    for point in landmarks[:5]:
        flat.extend([float(point[0]), float(point[1])])
    while len(flat) < 14:
        flat.append(0.0)
    flat.append(float(face.get("score", 1.0)))
    return np.asarray([flat], dtype=np.float32)


def is_low_quality(face: dict, min_size: int | None = None) -> bool:
    """A face too small to embed reliably. LOW_QUALITY is not a threat signal."""
    if min_size is None:
        min_size = int(get_settings().face_min_size)
    bbox = face.get("bbox") or [0, 0, 0, 0]
    return min(int(bbox[2]), int(bbox[3])) < int(min_size)


# ── embedding (the ONE code path) ─────────────────────────────────


def generate_embedding(frame, face: dict) -> list[float] | None:
    """Align the face with its landmarks, embed it, and L2-normalize.

    This is the ONLY embedding producer in the service. Registration photos and
    live frames both come through here, which is what makes their vectors
    comparable. Returns a plain list of floats (JSON-ready) or ``None``.
    """
    feature = FaceEmbedderModel.instance().align_and_embed(frame, _face_row(face))
    if feature is None:
        return None
    vector = np.asarray(feature, dtype=np.float32).reshape(-1)
    if vector.size == 0:
        return None
    norm = float(np.linalg.norm(vector))
    if norm == 0.0:
        return None
    return [float(v) for v in (vector / norm)]


# ── matching ──────────────────────────────────────────────────────


def _unavailable_match(threshold: float, reason: str, dimension_mismatch: bool = False) -> dict:
    return {
        "status": RecognitionStatus.RECOGNITION_UNAVAILABLE,
        "person_id": None,
        "person_name": None,
        "similarity": None,
        "runner_up_similarity": None,
        "candidates_considered": 0,
        "candidates_skipped": 0,
        "threshold": threshold,
        "dimension_mismatch": dimension_mismatch,
        "reason": reason,
    }


def _stack_candidates(candidates, expected_dim: int) -> tuple[np.ndarray | None, list[dict], int]:
    """Stack explicit candidate dicts into a normalized matrix + metadata.

    Candidates whose embedding length differs from ``expected_dim`` are DROPPED
    and counted — never padded, truncated, or scored.
    """
    vectors: list[list[float]] = []
    meta: list[dict] = []
    skipped = 0
    for raw in candidates or []:
        embedding = raw.get("embedding") if isinstance(raw, dict) else None
        if not isinstance(embedding, (list, tuple)) or len(embedding) != expected_dim:
            skipped += 1
            continue
        try:
            vectors.append([float(v) for v in embedding])
        except (TypeError, ValueError):
            skipped += 1
            continue
        meta.append(
            {
                "person_id": str(raw.get("person_id") or raw.get("personId") or ""),
                "name": raw.get("name") or raw.get("personName"),
                "embedding_model": raw.get("embedding_model") or raw.get("embeddingModel"),
                "embedding_dim": len(embedding),
            }
        )
    if not vectors:
        return None, meta, skipped
    matrix = np.asarray(vectors, dtype=np.float32)
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return matrix / norms, meta, skipped


def match_embedding(
    embedding,
    candidates=None,
    threshold: float | None = None,
    expected_dim: int | None = None,
    embedder_available: bool | None = None,
) -> dict:
    """Decide whether an embedding belongs to an enrolled identity.

    ``candidates`` is a list of ``{"person_id", "name", "embedding"}`` dicts,
    or ``None`` to match against the shared enrolled-identity cache.

    THRESHOLD GATE: the best candidate is returned as KNOWN only when its
    cosine similarity is ``>= threshold``. Below the threshold the result is
    UNKNOWN with NO person id, even though it was the closest candidate. The
    best similarity is still reported so an operator can see how close it was.

    Returns a dict with: status, person_id, person_name, similarity,
    runner_up_similarity, candidates_considered, candidates_skipped,
    threshold, dimension_mismatch, reason.
    """
    settings = get_settings()
    if threshold is None:
        threshold = float(settings.face_match_threshold)
    threshold = float(threshold)

    if embedder_available is None or expected_dim is None:
        model = FaceEmbedderModel.instance()
        if embedder_available is None:
            embedder_available = bool(model.available)
        if expected_dim is None:
            expected_dim = int(model.embedding_dim)
    expected_dim = int(expected_dim)

    if not embedder_available:
        return _unavailable_match(threshold, "EMBEDDER_UNAVAILABLE")

    probe = np.asarray(embedding if embedding is not None else [], dtype=np.float32).reshape(-1)
    if probe.size != expected_dim:
        # Refuse to score a vector from a different embedding space.
        return _unavailable_match(threshold, "EMBEDDING_DIM_MISMATCH", dimension_mismatch=True)
    probe_norm = float(np.linalg.norm(probe))
    if probe_norm == 0.0:
        return _unavailable_match(threshold, "EMBEDDING_INVALID")
    probe = probe / probe_norm

    if candidates is None:
        if not embedding_cache.loaded:
            # Never UNKNOWN here: we could not look, so we cannot say nobody matched.
            return _unavailable_match(threshold, "IDENTITY_CACHE_UNAVAILABLE")
        if embedding_cache.is_stale(grace=float(settings.embedding_cache_stale_grace)):
            # Loaded, but too old (or explicitly superseded) to trust: either a
            # refresh has been failing long enough since the last SUCCESSFUL
            # load, or the backend told us the enrolled set changed and we have
            # not managed to re-fetch it. Either way this set may still contain
            # someone whose recognition was disabled or who was deleted. Fail
            # CLOSED — report the pipeline as unavailable rather than matching
            # against it (and rather than calling it UNKNOWN, which would be an
            # alertable claim we cannot justify).
            return _unavailable_match(threshold, "IDENTITY_CACHE_STALE")
        matrix, meta = embedding_cache.snapshot()
        skipped = embedding_cache.skipped
    else:
        matrix, meta, skipped = _stack_candidates(candidates, expected_dim)

    considered = 0 if matrix is None else int(matrix.shape[0])
    if matrix is None or considered == 0 or len(meta) < considered:
        return {
            "status": RecognitionStatus.UNKNOWN,
            "person_id": None,
            "person_name": None,
            "similarity": None,
            "runner_up_similarity": None,
            "candidates_considered": considered,
            "candidates_skipped": skipped,
            "threshold": threshold,
            "dimension_mismatch": False,
            "reason": "NO_ENROLLED_IDENTITIES",
        }

    # One vectorized pass over every enrolled identity (both sides already
    # L2-normalized, so the dot product IS the cosine similarity).
    similarities = np.clip(matrix @ probe, -1.0, 1.0)
    best_index = int(np.argmax(similarities))
    best = float(similarities[best_index])
    runner_up = None
    if considered > 1:
        ordered = np.sort(similarities)[::-1]
        runner_up = round(float(ordered[1]), 4)

    best_person = meta[best_index]
    matched = best >= threshold
    return {
        "status": RecognitionStatus.KNOWN if matched else RecognitionStatus.UNKNOWN,
        "person_id": best_person.get("person_id") if matched else None,
        "person_name": best_person.get("name") if matched else None,
        "similarity": round(best, 4),
        "runner_up_similarity": runner_up,
        "candidates_considered": considered,
        "candidates_skipped": skipped,
        "threshold": threshold,
        "dimension_mismatch": False,
        "reason": None if matched else "BELOW_THRESHOLD",
    }


# ── registration ──────────────────────────────────────────────────


def decode_image(data: str):
    """Decode a data URL or raw base64 string into a BGR frame, or ``None``."""
    if not isinstance(data, str) or not data.strip():
        return None
    payload = data.strip()
    if payload.startswith("data:"):
        _, _, payload = payload.partition(",")
    payload = "".join(payload.split())
    try:
        raw = base64.b64decode(payload, validate=False)
    except (binascii.Error, ValueError):
        return None
    if not raw:
        return None
    try:
        import cv2  # imported lazily so this module stays test-importable

        buffer = np.frombuffer(raw, dtype=np.uint8)
        image = cv2.imdecode(buffer, cv2.IMREAD_COLOR)
    except Exception as exc:  # noqa: BLE001 - undecodable input is expected
        print(f"[face] image decode failed: {exc}")
        return None
    if image is None or getattr(image, "size", 0) == 0:
        return None
    return image


def register_face(image_bgr) -> FaceRegistrationResponse:
    """Enroll one photograph: validate → detect → align → embed.

    Returns a structured result. These are EXPECTED validation outcomes, not
    errors: NO_FACE, MULTIPLE_FACES, LOW_QUALITY, INVALID_IMAGE. Only status
    OK carries an embedding, so a person is never marked recognition-ready
    without one.
    """
    settings = get_settings()
    detector = FaceDetectorModel.instance()
    embedder = FaceEmbedderModel.instance()

    if not detector.available or not embedder.available:
        return FaceRegistrationResponse(
            status=RegistrationStatus.RECOGNITION_UNAVAILABLE,
            message=REGISTRATION_MESSAGES[RegistrationStatus.RECOGNITION_UNAVAILABLE],
        )

    if image_bgr is None or getattr(image_bgr, "size", 0) == 0:
        return FaceRegistrationResponse(
            status=RegistrationStatus.INVALID_IMAGE,
            message=REGISTRATION_MESSAGES[RegistrationStatus.INVALID_IMAGE],
        )

    faces = detect_faces(image_bgr)
    if not faces:
        return FaceRegistrationResponse(
            status=RegistrationStatus.NO_FACE,
            message=REGISTRATION_MESSAGES[RegistrationStatus.NO_FACE],
            faces_detected=0,
        )

    max_faces = max(1, int(settings.face_registration_max_faces))
    if len(faces) > max_faces:
        # Never silently embed an arbitrary one of several faces.
        return FaceRegistrationResponse(
            status=RegistrationStatus.MULTIPLE_FACES,
            message=REGISTRATION_MESSAGES[RegistrationStatus.MULTIPLE_FACES],
            faces_detected=len(faces),
        )

    face = max(faces, key=lambda f: f["bbox"][2] * f["bbox"][3])
    min_size = int(settings.face_min_size)
    if is_low_quality(face, min_size):
        return FaceRegistrationResponse(
            status=RegistrationStatus.LOW_QUALITY,
            message=(
                f"A face was detected but it is too small to register reliably "
                f"(shortest side must be at least {min_size}px). Please upload a "
                f"closer, clearer photograph."
            ),
            faces_detected=len(faces),
            bbox=list(face["bbox"]),
            detection_score=face["score"],
        )

    embedding = generate_embedding(image_bgr, face)
    if embedding is None:
        return FaceRegistrationResponse(
            status=RegistrationStatus.RECOGNITION_UNAVAILABLE,
            message=(
                "A face was detected but no valid embedding could be generated, so "
                "this person was not marked recognition-ready. Please try another "
                "photograph."
            ),
            faces_detected=len(faces),
            bbox=list(face["bbox"]),
            detection_score=face["score"],
        )

    return FaceRegistrationResponse(
        status=RegistrationStatus.OK,
        message="Face detected successfully. " + REGISTRATION_MESSAGES[RegistrationStatus.OK],
        faces_detected=len(faces),
        embedding=embedding,
        embedding_dim=len(embedding),
        embedding_model=embedder.model_name,
        bbox=list(face["bbox"]),
        detection_score=face["score"],
    )


# ── live recognition ──────────────────────────────────────────────


def recognize_frame(
    frame,
    camera_id: str,
    faces: list[dict] | None = None,
    tracker=None,
) -> list[FaceRecognitionResult]:
    """Recognize every face in a live frame.

    ``faces`` may be pre-computed by the caller (the stream worker passes the
    records the pipeline's face detector already produced) so YuNet runs once
    per frame, not twice. ``tracker`` is an optional ``callable(bbox) -> str``
    supplying a transient per-camera track id for de-duplication.

    Returns one result per face. An empty list means no face was detected.
    Never raises.
    """
    settings = get_settings()
    threshold = float(settings.face_match_threshold)
    detector = FaceDetectorModel.instance()
    embedder = FaceEmbedderModel.instance()

    def _track(bbox):
        if tracker is None:
            return None
        try:
            return tracker(bbox)
        except Exception:  # noqa: BLE001 - tracking is a convenience, not a guarantee
            return None

    if not detector.available or not embedder.available:
        # One service-level result, so the caller can report honestly instead
        # of inventing an unknown person.
        return [
            FaceRecognitionResult(
                camera_id=camera_id,
                status=RecognitionStatus.RECOGNITION_UNAVAILABLE,
                quality="MODEL_UNAVAILABLE",
                threshold=threshold,
                model_name=embedder.model_name,
            )
        ]

    if faces is None:
        faces = detect_faces(frame)
    if not faces:
        return []

    # Refresh the enrolled identities at most once per TTL. NON-BLOCKING: the
    # fetch happens on a background thread so a stalled backend cannot hold up
    # this worker, which is also the thread running YOLO human/weapon
    # detection. Matching uses whatever generation is currently cached, and
    # match_embedding fails closed if that generation has gone stale.
    embedding_cache.ensure_fresh(
        expected_dim=int(embedder.embedding_dim),
        expected_model=embedder.model_name,
        blocking=False,
    )

    results: list[FaceRecognitionResult] = []
    min_size = int(settings.face_min_size)
    for face in faces:
        bbox = [int(v) for v in face["bbox"]]
        track_id = _track(bbox)

        if is_low_quality(face, min_size):
            # Too few pixels to trust. Explicitly NOT an unknown-person event.
            results.append(
                FaceRecognitionResult(
                    camera_id=camera_id,
                    status=RecognitionStatus.LOW_QUALITY,
                    bbox=bbox,
                    detection_score=face["score"],
                    quality="FACE_TOO_SMALL",
                    track_id=track_id,
                    threshold=threshold,
                    model_name=embedder.model_name,
                )
            )
            continue

        embedding = generate_embedding(frame, face)
        if embedding is None:
            results.append(
                FaceRecognitionResult(
                    camera_id=camera_id,
                    status=RecognitionStatus.RECOGNITION_UNAVAILABLE,
                    bbox=bbox,
                    detection_score=face["score"],
                    quality="EMBEDDING_FAILED",
                    track_id=track_id,
                    threshold=threshold,
                    model_name=embedder.model_name,
                )
            )
            continue

        match = match_embedding(
            embedding,
            threshold=threshold,
            expected_dim=int(embedder.embedding_dim),
            embedder_available=True,
        )
        results.append(
            FaceRecognitionResult(
                camera_id=camera_id,
                status=match["status"],
                person_id=match["person_id"],
                person_name=match["person_name"],
                similarity=match["similarity"],
                bbox=bbox,
                detection_score=face["score"],
                quality=match["reason"],
                track_id=track_id,
                threshold=threshold,
                model_name=embedder.model_name,
            )
        )
    return results


# ── status / cache control ────────────────────────────────────────


def refresh_identity_cache(force: bool = True) -> dict:
    """Invalidate and re-fetch the enrolled identities. Never raises.

    Called by the backend whenever a person is registered, edited, disabled or
    deleted, so a removed or disabled identity stops being matchable
    immediately. Deliberately SYNCHRONOUS: this runs on an HTTP request
    thread, not on a camera worker, and the backend needs to know whether the
    refresh actually succeeded.

    The returned dict carries ``refreshed``: True only when a fetch actually
    ran AND installed a new generation. A forced refresh is never swallowed by
    an in-flight background refresh any more — it supersedes it — but the fetch
    can still fail (backend unreachable), and the caller must be able to tell
    that from success rather than reading a stale candidate count as proof.
    """
    embedder = FaceEmbedderModel.instance()
    if not force:
        # Honour the TTL; report whether anything was installed.
        installed = embedding_cache.ensure_fresh(
            expected_dim=int(embedder.embedding_dim),
            expected_model=embedder.model_name,
            force=False,
            blocking=True,
        )
        state = embedding_cache.state()
        state["refreshed"] = bool(installed)
        return state

    return embedding_cache.refresh_blocking(
        expected_dim=int(embedder.embedding_dim),
        expected_model=embedder.model_name,
    )


def identity_labels_trustworthy() -> bool:
    """Whether an identity label may be DRAWN on a video frame right now.

    Separate from ``recognition_available()`` because the overlay reuses the
    last recognition pass for a short TTL: a name must not keep being drawn
    from a cache generation that has gone stale, since the person may have had
    recognition disabled or been deleted in the meantime. No grace here — the
    overlay is cosmetic, so it withdraws the moment the data is past its TTL
    (measured from the last successful load) or has been superseded by an
    invalidation.
    """
    return bool(
        FaceDetectorModel.instance().available
        and FaceEmbedderModel.instance().available
        and not embedding_cache.is_stale()
    )


def recognition_available() -> bool:
    """True only when a real identity decision can actually be made."""
    settings = get_settings()
    return bool(
        FaceDetectorModel.instance().available
        and FaceEmbedderModel.instance().available
        and embedding_cache.loaded
        and not embedding_cache.is_stale(grace=float(settings.embedding_cache_stale_grace))
    )


def recognition_status() -> RecognitionStatusResponse:
    """Readiness report — reports what is really loaded, never optimistically."""
    settings = get_settings()
    detector = FaceDetectorModel.instance()
    embedder = FaceEmbedderModel.instance()
    state = embedding_cache.state()
    stale = embedding_cache.is_stale(grace=float(settings.embedding_cache_stale_grace))
    last_error = state["last_error"] or embedder.last_error or detector.last_error
    if stale and state["loaded"] and not last_error:
        last_error = (
            "The enrolled-identity cache is past its TTL (or awaiting a replacement after an "
            "invalidation); matching is failing closed."
        )
    return RecognitionStatusResponse(
        detector_available=detector.available,
        embedder_available=embedder.available,
        detector_model=detector.model_name,
        embedder_model=embedder.model_name,
        embedding_dim=int(embedder.embedding_dim),
        match_threshold=float(settings.face_match_threshold),
        min_face_size=int(settings.face_min_size),
        recognition_every_n_frames=int(settings.face_recognition_every_n_frames),
        cache_loaded=bool(state["loaded"]),
        cache_size=int(state["candidates"]),
        cache_skipped=int(state["skipped"]),
        cache_age_seconds=state["age_seconds"],
        cache_stale=bool(stale),
        last_error=last_error,
    )
