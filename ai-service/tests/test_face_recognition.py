"""Unit tests for the Review 2 face-recognition decision logic.

Stdlib ``unittest`` only — no new dependency. Run from the ai-service/ dir::

    python -m unittest discover -s tests -v

These tests deliberately exercise the PURE logic: cosine similarity, the
threshold gate, embedding-dimension rejection, cache replacement semantics, and
status mapping. ``app.recognition.face_service`` and
``app.recognition.embedding_cache`` import ``cv2`` lazily (inside functions),
so this module is importable and runnable WITHOUT OpenCV, torch, or any ONNX
model file present. Nothing here loads a model or touches the network.

What these tests do NOT prove: recognition accuracy. Verifying that a real
photograph of a real person matches their enrolment requires the ONNX weights
and consented test images, and must be done separately.
"""
import math
import unittest

from app.config import get_settings
from app.recognition.embedding_cache import EmbeddingCache
from app.recognition.face_service import (
    RecognitionStatus,
    RegistrationStatus,
    bbox_iou,
    cosine_similarity,
    match_embedding,
)

#: Dimension used by the synthetic vectors below. Deliberately small and
#: hand-computable; the live model's 128-d is passed in explicitly where needed.
DIM = 2


def candidate(person_id, name, embedding):
    return {"person_id": person_id, "name": name, "embedding": embedding}


class CosineSimilarityTest(unittest.TestCase):
    def test_identical_vectors_are_one(self) -> None:
        self.assertAlmostEqual(cosine_similarity([1.0, 2.0, 3.0], [1.0, 2.0, 3.0]), 1.0, places=6)

    def test_orthogonal_vectors_are_zero(self) -> None:
        self.assertAlmostEqual(cosine_similarity([1.0, 0.0], [0.0, 1.0]), 0.0, places=6)

    def test_opposite_vectors_are_minus_one(self) -> None:
        self.assertAlmostEqual(cosine_similarity([1.0, 0.0], [-1.0, 0.0]), -1.0, places=6)

    def test_hand_computed_value(self) -> None:
        # (3*4 + 4*3) / (5 * 5) = 24 / 25 = 0.96
        self.assertAlmostEqual(cosine_similarity([3.0, 4.0], [4.0, 3.0]), 0.96, places=6)

    def test_scale_invariance(self) -> None:
        self.assertAlmostEqual(cosine_similarity([1.0, 1.0], [7.0, 7.0]), 1.0, places=6)

    def test_zero_vector_is_not_nan(self) -> None:
        value = cosine_similarity([0.0, 0.0], [1.0, 1.0])
        self.assertFalse(math.isnan(value))
        self.assertEqual(value, 0.0)

    def test_length_mismatch_returns_zero_not_a_crash(self) -> None:
        self.assertEqual(cosine_similarity([1.0, 0.0], [1.0, 0.0, 0.0]), 0.0)


class ThresholdGateTest(unittest.TestCase):
    """The closest candidate is NOT a match unless it clears the threshold."""

    def setUp(self) -> None:
        # Unit vector at 45 degrees; cosine against [1, 0] is cos(45) ≈ 0.7071.
        self.probe = [1.0, 1.0]
        self.candidates = [candidate("PRN-1", "Example Person", [1.0, 0.0])]

    def _match(self, threshold):
        return match_embedding(
            self.probe,
            candidates=self.candidates,
            threshold=threshold,
            expected_dim=DIM,
            embedder_available=True,
        )

    def test_just_above_threshold_is_known(self) -> None:
        result = self._match(0.70)
        self.assertEqual(result["status"], RecognitionStatus.KNOWN)
        self.assertEqual(result["person_id"], "PRN-1")
        self.assertEqual(result["person_name"], "Example Person")
        self.assertGreaterEqual(result["similarity"], 0.70)

    def test_just_below_threshold_is_unknown_despite_being_closest(self) -> None:
        result = self._match(0.71)
        self.assertEqual(result["status"], RecognitionStatus.UNKNOWN)
        # The closest candidate must NOT leak out as an identity.
        self.assertIsNone(result["person_id"])
        self.assertIsNone(result["person_name"])
        # …but the score is still reported so an operator can see how close it was.
        self.assertAlmostEqual(result["similarity"], 0.7071, places=3)
        self.assertEqual(result["reason"], "BELOW_THRESHOLD")

    def test_exactly_at_threshold_is_known(self) -> None:
        result = match_embedding(
            [1.0, 0.0],
            candidates=[candidate("PRN-1", "Example Person", [1.0, 0.0])],
            threshold=1.0,
            expected_dim=DIM,
            embedder_available=True,
        )
        self.assertEqual(result["status"], RecognitionStatus.KNOWN)

    def test_best_candidate_wins_and_runner_up_is_reported(self) -> None:
        result = match_embedding(
            [1.0, 0.0],
            candidates=[
                candidate("PRN-FAR", "Far Person", [0.0, 1.0]),
                candidate("PRN-NEAR", "Near Person", [1.0, 0.05]),
            ],
            threshold=0.5,
            expected_dim=DIM,
            embedder_available=True,
        )
        self.assertEqual(result["status"], RecognitionStatus.KNOWN)
        self.assertEqual(result["person_id"], "PRN-NEAR")
        self.assertEqual(result["candidates_considered"], 2)
        self.assertIsNotNone(result["runner_up_similarity"])
        self.assertLess(result["runner_up_similarity"], result["similarity"])

    def test_similarity_is_not_treated_as_a_probability(self) -> None:
        """A cosine similarity may be negative — it is not a 0..1 confidence."""
        result = match_embedding(
            [1.0, 0.0],
            candidates=[candidate("PRN-1", "Opposite", [-1.0, 0.0])],
            threshold=0.363,
            expected_dim=DIM,
            embedder_available=True,
        )
        self.assertEqual(result["status"], RecognitionStatus.UNKNOWN)
        self.assertLess(result["similarity"], 0.0)


class DimensionMismatchTest(unittest.TestCase):
    def test_candidate_with_wrong_dimension_is_skipped_not_scored(self) -> None:
        result = match_embedding(
            [1.0, 0.0],
            candidates=[
                candidate("PRN-BAD", "Wrong Space", [1.0, 0.0, 0.0]),
                candidate("PRN-OK", "Right Space", [1.0, 0.0]),
            ],
            threshold=0.5,
            expected_dim=DIM,
            embedder_available=True,
        )
        self.assertEqual(result["candidates_considered"], 1)
        self.assertEqual(result["candidates_skipped"], 1)
        self.assertEqual(result["person_id"], "PRN-OK")

    def test_only_mismatched_candidates_cannot_produce_a_match(self) -> None:
        result = match_embedding(
            [1.0, 0.0],
            candidates=[candidate("PRN-BAD", "Wrong Space", [1.0, 0.0, 0.0])],
            threshold=0.1,
            expected_dim=DIM,
            embedder_available=True,
        )
        self.assertNotEqual(result["status"], RecognitionStatus.KNOWN)
        self.assertIsNone(result["person_id"])
        self.assertEqual(result["candidates_skipped"], 1)

    def test_probe_with_wrong_dimension_is_refused(self) -> None:
        result = match_embedding(
            [1.0, 0.0, 0.0],
            candidates=[candidate("PRN-OK", "Right Space", [1.0, 0.0])],
            threshold=0.1,
            expected_dim=DIM,
            embedder_available=True,
        )
        self.assertEqual(result["status"], RecognitionStatus.RECOGNITION_UNAVAILABLE)
        self.assertTrue(result["dimension_mismatch"])
        self.assertEqual(result["reason"], "EMBEDDING_DIM_MISMATCH")
        self.assertIsNone(result["person_id"])


class UnavailableStatusTest(unittest.TestCase):
    """An unavailable pipeline must never produce unknown-person results."""

    def test_unavailable_embedder_maps_to_recognition_unavailable(self) -> None:
        result = match_embedding(
            [1.0, 0.0],
            candidates=[candidate("PRN-1", "Example Person", [1.0, 0.0])],
            threshold=0.1,
            expected_dim=DIM,
            embedder_available=False,
        )
        self.assertEqual(result["status"], RecognitionStatus.RECOGNITION_UNAVAILABLE)
        self.assertNotEqual(result["status"], RecognitionStatus.UNKNOWN)
        self.assertEqual(result["reason"], "EMBEDDER_UNAVAILABLE")
        self.assertIsNone(result["person_id"])
        self.assertIsNone(result["similarity"])

    def test_zero_probe_is_unavailable_not_unknown(self) -> None:
        result = match_embedding(
            [0.0, 0.0],
            candidates=[candidate("PRN-1", "Example Person", [1.0, 0.0])],
            threshold=0.1,
            expected_dim=DIM,
            embedder_available=True,
        )
        self.assertEqual(result["status"], RecognitionStatus.RECOGNITION_UNAVAILABLE)
        self.assertEqual(result["reason"], "EMBEDDING_INVALID")

    def test_empty_roster_is_unknown_because_the_pipeline_did_work(self) -> None:
        result = match_embedding(
            [1.0, 0.0],
            candidates=[],
            threshold=0.1,
            expected_dim=DIM,
            embedder_available=True,
        )
        self.assertEqual(result["status"], RecognitionStatus.UNKNOWN)
        self.assertEqual(result["reason"], "NO_ENROLLED_IDENTITIES")
        self.assertEqual(result["candidates_considered"], 0)


class _StubCache(EmbeddingCache):
    """EmbeddingCache whose backend fetch is replaced by a scripted payload."""

    def __init__(self, payloads):
        super().__init__()
        self.payloads = list(payloads)
        self.fetches = 0

    def _fetch_candidates(self):
        self.fetches += 1
        if not self.payloads:
            raise RuntimeError("backend unreachable")
        return self.payloads.pop(0)


def enrolled(person_id, name, embedding):
    return {
        "personId": person_id,
        "name": name,
        "embedding": embedding,
        "embeddingModel": "sface_2021dec",
        "embeddingDim": len(embedding),
    }


class EmbeddingCacheTest(unittest.TestCase):
    def test_cache_starts_unloaded(self) -> None:
        cache = EmbeddingCache()
        self.assertFalse(cache.loaded)
        self.assertEqual(cache.size, 0)
        self.assertIsNone(cache.snapshot()[0])

    def test_refresh_replaces_and_does_not_merge(self) -> None:
        """A person removed from a refresh payload must stop being matchable."""
        cache = EmbeddingCache()
        cache.replace(
            [
                enrolled("PRN-1", "Person One", [1.0, 0.0]),
                enrolled("PRN-2", "Person Two", [0.0, 1.0]),
            ],
            expected_dim=DIM,
            expected_model="sface_2021dec",
        )
        self.assertEqual(cache.size, 2)
        ids = {p["person_id"] for p in cache.snapshot()[1]}
        self.assertEqual(ids, {"PRN-1", "PRN-2"})

        # PRN-2 was deleted / had recognition disabled → absent from the payload.
        cache.replace(
            [enrolled("PRN-1", "Person One", [1.0, 0.0])],
            expected_dim=DIM,
            expected_model="sface_2021dec",
        )
        self.assertEqual(cache.size, 1)
        remaining = {p["person_id"] for p in cache.snapshot()[1]}
        self.assertEqual(remaining, {"PRN-1"})
        self.assertNotIn("PRN-2", remaining)

        # And the removed identity can no longer be matched, even by an exact
        # copy of its own embedding.
        matrix, meta = cache.snapshot()
        result = match_embedding(
            [0.0, 1.0],
            candidates=[
                {"person_id": m["person_id"], "name": m["name"], "embedding": list(row)}
                for m, row in zip(meta, matrix)
            ],
            threshold=0.5,
            expected_dim=DIM,
            embedder_available=True,
        )
        self.assertEqual(result["status"], RecognitionStatus.UNKNOWN)
        self.assertIsNone(result["person_id"])

    def test_candidates_are_l2_normalized_on_load(self) -> None:
        cache = EmbeddingCache()
        cache.replace([enrolled("PRN-1", "Person One", [3.0, 4.0])], expected_dim=DIM)
        matrix, _ = cache.snapshot()
        self.assertAlmostEqual(float(sum(v * v for v in matrix[0])), 1.0, places=5)

    def test_mismatched_dimension_candidates_are_dropped_and_counted(self) -> None:
        cache = EmbeddingCache()
        cache.replace(
            [
                enrolled("PRN-1", "Person One", [1.0, 0.0]),
                enrolled("PRN-BAD", "Wrong Space", [1.0, 0.0, 0.0]),
            ],
            expected_dim=DIM,
            expected_model="sface_2021dec",
        )
        self.assertEqual(cache.size, 1)
        self.assertEqual(cache.skipped, 1)

    def test_candidates_from_another_model_are_dropped(self) -> None:
        cache = EmbeddingCache()
        cache.replace(
            [
                enrolled("PRN-1", "Person One", [1.0, 0.0]),
                {
                    "personId": "PRN-OTHER",
                    "name": "Other Model",
                    "embedding": [1.0, 0.0],
                    "embeddingModel": "some_other_model",
                    "embeddingDim": 2,
                },
            ],
            expected_dim=DIM,
            expected_model="sface_2021dec",
        )
        self.assertEqual(cache.size, 1)
        self.assertEqual(cache.skipped, 1)

    def test_incomplete_records_are_dropped(self) -> None:
        cache = EmbeddingCache()
        cache.replace(
            [
                {"name": "No Id", "embedding": [1.0, 0.0]},
                {"personId": "PRN-NOEMB", "name": "No Embedding"},
                enrolled("PRN-1", "Person One", [1.0, 0.0]),
            ],
            expected_dim=DIM,
        )
        self.assertEqual(cache.size, 1)
        self.assertEqual(cache.skipped, 2)

    def test_failed_refresh_keeps_previous_identities_and_records_the_error(self) -> None:
        cache = _StubCache([[enrolled("PRN-1", "Person One", [1.0, 0.0])]])
        self.assertTrue(cache.ensure_fresh(expected_dim=DIM, force=True))
        self.assertEqual(cache.size, 1)

        # Second refresh raises (backend down) → previous data survives.
        self.assertTrue(cache.ensure_fresh(expected_dim=DIM, force=True))
        self.assertEqual(cache.size, 1)
        self.assertTrue(cache.loaded)
        self.assertIn("backend unreachable", cache.last_error or "")

    def test_unloaded_cache_after_failed_first_fetch_stays_unloaded(self) -> None:
        cache = _StubCache([])
        self.assertFalse(cache.ensure_fresh(expected_dim=DIM, force=True))
        self.assertFalse(cache.loaded)
        self.assertEqual(cache.size, 0)
        self.assertIsNotNone(cache.last_error)

    def test_envelope_shapes_are_all_accepted(self) -> None:
        items = [enrolled("PRN-1", "Person One", [1.0, 0.0])]
        for payload in (
            items,
            {"items": items},
            {"data": items},
            {"success": True, "data": {"items": items}},
        ):
            self.assertEqual(EmbeddingCache._extract_items(payload), items)
        self.assertEqual(EmbeddingCache._extract_items(None), [])
        self.assertEqual(EmbeddingCache._extract_items({"success": True}), [])


class BboxIouTest(unittest.TestCase):
    def test_identical_boxes(self) -> None:
        self.assertAlmostEqual(bbox_iou([0, 0, 10, 10], [0, 0, 10, 10]), 1.0, places=6)

    def test_disjoint_boxes(self) -> None:
        self.assertEqual(bbox_iou([0, 0, 10, 10], [100, 100, 10, 10]), 0.0)

    def test_half_overlap(self) -> None:
        # Intersection 50, union 150 → 1/3.
        self.assertAlmostEqual(bbox_iou([0, 0, 10, 10], [5, 0, 10, 10]), 1.0 / 3.0, places=6)

    def test_degenerate_boxes_are_zero(self) -> None:
        self.assertEqual(bbox_iou([0, 0, 0, 0], [0, 0, 10, 10]), 0.0)
        self.assertEqual(bbox_iou([], [0, 0, 10, 10]), 0.0)


class StatusVocabularyTest(unittest.TestCase):
    def test_status_values_are_the_documented_set(self) -> None:
        self.assertEqual(
            {
                RecognitionStatus.KNOWN,
                RecognitionStatus.UNKNOWN,
                RecognitionStatus.LOW_QUALITY,
                RecognitionStatus.NO_FACE,
                RecognitionStatus.RECOGNITION_UNAVAILABLE,
            },
            {"KNOWN", "UNKNOWN", "LOW_QUALITY", "NO_FACE", "RECOGNITION_UNAVAILABLE"},
        )

    def test_registration_statuses_reuse_the_same_vocabulary(self) -> None:
        self.assertEqual(RegistrationStatus.NO_FACE, RecognitionStatus.NO_FACE)
        self.assertEqual(RegistrationStatus.LOW_QUALITY, RecognitionStatus.LOW_QUALITY)
        self.assertEqual(
            RegistrationStatus.RECOGNITION_UNAVAILABLE,
            RecognitionStatus.RECOGNITION_UNAVAILABLE,
        )
        self.assertEqual(RegistrationStatus.OK, "OK")
        self.assertEqual(RegistrationStatus.MULTIPLE_FACES, "MULTIPLE_FACES")


class RecognitionSettingsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.settings = get_settings()

    def test_review2_fields_exist(self) -> None:
        for field in (
            "face_detection_model_path",
            "face_recognition_model_path",
            "face_detection_confidence",
            "face_match_threshold",
            "face_min_size",
            "face_recognition_every_n_frames",
            "face_registration_max_faces",
            "embedding_cache_ttl",
            "embedding_source_url",
            "recognition_report_interval",
        ):
            self.assertTrue(hasattr(self.settings, field), msg=f"missing setting '{field}'")

    def test_threshold_is_an_adjustable_fraction(self) -> None:
        value = self.settings.face_match_threshold
        self.assertIsInstance(value, float)
        self.assertGreater(value, 0.0)
        self.assertLess(value, 1.0)

    def test_recognition_cadence_is_at_least_every_frame(self) -> None:
        self.assertGreaterEqual(self.settings.face_recognition_every_n_frames, 1)

    def test_embedding_source_falls_back_to_the_backend(self) -> None:
        if not self.settings.embedding_source_url:
            self.assertEqual(
                self.settings.embedding_source, self.settings.backend_url.rstrip("/")
            )


if __name__ == "__main__":
    unittest.main()
