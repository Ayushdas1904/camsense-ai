"""Unit tests for the Review 2 post-review fixes (AI service).

Stdlib ``unittest`` only — no new dependency. Run from the ai-service/ dir::

    python -m unittest discover -s tests -v

Covers the paths the reviews flagged as untested, newly added, or wrongly
tested:

* ``EmbeddingCache`` staleness driven by the REAL refresh cycle — a clock seam
  (``_now``) lets a test let refreshes fail once per TTL and watch the cache
  age into staleness, instead of assigning ``_fetched_at`` by hand and
  asserting a state the production loop could not reach;
* the fail-closed ``IDENTITY_CACHE_STALE`` match result, and the invalidation
  case (a cache the backend told us is out of date is not trusted until the
  replacement lands);
* ``ensure_fresh(blocking=False)`` — the camera workers' non-blocking refresh,
  including that UNFORCED refreshes deduplicate, that a FORCED refresh is not
  swallowed by one in flight, and that a fetch which predates an invalidation
  is discarded rather than installed;
* ``refresh_blocking`` reporting whether a fetch actually succeeded;
* the reporter's per-camera in-flight cap, drop accounting, and shutdown drain;
* ``register_face`` validation outcomes, with the models stubbed so no ONNX
  weight file and no OpenCV build are required;
* the ``x-ai-secret`` service-secret dependency, including that it fails
  CLOSED when no secret is configured, and that no secret is configured by
  default.

Nothing here loads a model or touches the network. ``cv2`` is imported only by
the reporter test, which skips itself when OpenCV is absent;
``register_face`` only reaches it through ``detect_faces`` /
``generate_embedding``, which are stubbed.

What these tests do NOT prove: recognition accuracy. That needs the ONNX
weights and consented test images, and must be done separately.
"""
import importlib.util
import threading
import time
import unittest
from unittest import mock

import numpy as np

from app.config import get_settings
from app.recognition import face_service
from app.recognition.embedding_cache import EmbeddingCache, embedding_cache
from app.recognition.face_service import (
    RecognitionStatus,
    RegistrationStatus,
    match_embedding,
)

DIM = 2


def enrolled(person_id, name, embedding):
    return {
        "personId": person_id,
        "name": name,
        "embedding": embedding,
        "embeddingModel": "sface_2021dec",
        "embeddingDim": len(embedding),
    }


class _SlowCache(EmbeddingCache):
    """Cache whose fetch blocks until released, to observe non-blocking refresh."""

    def __init__(self, payload, delay=0.05):
        super().__init__()
        self.payload = payload
        self.delay = delay
        self.fetches = 0
        self.started = threading.Event()
        self.release = threading.Event()

    def _fetch_candidates(self):
        self.fetches += 1
        # Captured BEFORE the delay, so a payload change during the sleep does
        # not retroactively update what this (now superseded) fetch returns.
        payload = self.payload
        self.started.set()
        if self.delay:
            time.sleep(self.delay)
        return payload


class _ScriptedCache(EmbeddingCache):
    """Cache with a driveable clock and a fetch that can be made to fail.

    The clock is injected through ``EmbeddingCache._now`` — the same seam the
    production code reads — so a test can run the REAL refresh loop (TTL lapses
    → refresh attempted → refresh fails → repeat) and observe staleness as the
    code actually produces it, instead of assigning an internal timestamp by
    hand and asserting a state the loop could never reach.
    """

    def __init__(self, payload, clock=1000.0):
        super().__init__()
        self.payload = payload
        self.clock = float(clock)
        self.fail = False
        self.fetches = 0
        self.failures = 0

    def _now(self):
        return self.clock

    def _fetch_candidates(self):
        self.fetches += 1
        if self.fail:
            self.failures += 1
            raise RuntimeError("backend unreachable")
        return self.payload


class StalenessTest(unittest.TestCase):
    def test_a_fresh_cache_is_not_stale(self) -> None:
        cache = EmbeddingCache()
        cache.replace([enrolled("PRN-1", "Person One", [1.0, 0.0])], expected_dim=DIM)
        self.assertFalse(cache.is_stale())
        self.assertFalse(cache.is_stale(grace=30.0))

    def test_a_never_loaded_cache_is_stale(self) -> None:
        self.assertTrue(EmbeddingCache().is_stale())
        self.assertTrue(EmbeddingCache().is_stale(grace=600.0))

    def test_repeatedly_failing_refreshes_do_age_the_cache_into_staleness(self) -> None:
        """The regression this exists for.

        Staleness is measured from the last SUCCESSFUL load, not the last
        attempt. When it was measured from the attempt, every failed refresh
        reset the clock, so a cache whose refreshes kept failing never aged
        past TTL + grace — the gate was unreachable in exactly the scenario it
        was written for. This drives the real loop: load, then let a refresh
        fail once per TTL.
        """
        settings = get_settings()
        ttl = float(settings.embedding_cache_ttl)
        grace = float(settings.embedding_cache_stale_grace)

        cache = _ScriptedCache([enrolled("PRN-1", "Person One", [1.0, 0.0])])
        self.assertTrue(cache.ensure_fresh(expected_dim=DIM, force=True, blocking=True))
        self.assertFalse(cache.is_stale(grace=grace))

        # One TTL later the refresh is attempted and fails.
        cache.fail = True
        cache.clock += ttl
        cache.ensure_fresh(expected_dim=DIM, blocking=True)
        self.assertEqual(cache.failures, 1)
        # Past the TTL (so the overlay withdraws) but still inside the grace
        # window, so matching continues for one failed cycle.
        self.assertTrue(cache.is_stale())
        self.assertFalse(cache.is_stale(grace=grace))

        # A second failing cycle takes it past TTL + grace. Previously this
        # point was never reached, because the failed attempt reset the clock.
        cache.clock += ttl
        cache.ensure_fresh(expected_dim=DIM, blocking=True)
        self.assertEqual(cache.failures, 2)
        self.assertTrue(cache.is_stale(grace=grace))
        # The data is still there — it is withdrawn from use, not erased.
        self.assertTrue(cache.loaded)
        self.assertEqual(cache.size, 1)
        self.assertIn("backend unreachable", cache.last_error or "")

        # And a refresh that finally succeeds clears it.
        cache.fail = False
        cache.clock += ttl
        self.assertTrue(cache.ensure_fresh(expected_dim=DIM, blocking=True))
        self.assertFalse(cache.is_stale(grace=grace))

    def test_a_failed_refresh_still_backs_off(self) -> None:
        """The attempt clock must keep doing its own job: one fetch per TTL."""
        cache = _ScriptedCache([enrolled("PRN-1", "Person One", [1.0, 0.0])])
        cache.ensure_fresh(expected_dim=DIM, force=True, blocking=True)
        cache.fail = True
        cache.clock += float(get_settings().embedding_cache_ttl)
        cache.ensure_fresh(expected_dim=DIM, blocking=True)
        fetches = cache.fetches
        # Several more frames inside the same TTL window must not re-fetch.
        for _ in range(5):
            cache.clock += 1.0
            cache.ensure_fresh(expected_dim=DIM, blocking=True)
        self.assertEqual(cache.fetches, fetches)

    def test_an_invalidated_cache_is_stale_until_a_replacement_is_installed(self) -> None:
        """A cache the backend told us is out of date is not trusted meanwhile.

        ``invalidate()`` is called when a person is registered, edited,
        disabled or deleted. Until the replacement actually lands, this
        generation may still name somebody who must no longer be matched.
        """
        cache = _ScriptedCache([enrolled("PRN-1", "Person One", [1.0, 0.0])])
        cache.ensure_fresh(expected_dim=DIM, force=True, blocking=True)
        self.assertFalse(cache.is_stale(grace=30.0))

        cache.invalidate()
        self.assertTrue(cache.superseded)
        self.assertTrue(cache.is_stale())
        self.assertTrue(cache.is_stale(grace=600.0))

        cache.ensure_fresh(expected_dim=DIM, force=True, blocking=True)
        self.assertFalse(cache.superseded)
        self.assertFalse(cache.is_stale(grace=30.0))


class StaleCacheFailsClosedTest(unittest.TestCase):
    """A stale identity set must not produce KNOWN, and must not produce UNKNOWN."""

    def setUp(self) -> None:
        self.settings = get_settings()
        # match_embedding(candidates=None) reads the process-wide cache, so the
        # clock seam is patched on that instance and the staleness is produced
        # by a real failing refresh rather than by assigning a timestamp.
        self.clock = 5000.0
        self._now_patch = mock.patch.object(
            embedding_cache, "_now", side_effect=lambda: self.clock
        )
        self._now_patch.start()
        self.addCleanup(self._now_patch.stop)

        embedding_cache.replace(
            [enrolled("PRN-1", "Person One", [1.0, 0.0])],
            expected_dim=DIM,
            expected_model="sface_2021dec",
        )

    def tearDown(self) -> None:
        embedding_cache._matrix = None
        embedding_cache._people = []
        embedding_cache._loaded = False
        embedding_cache._fetched_at = 0.0
        embedding_cache._loaded_at = 0.0
        embedding_cache._last_error = None
        embedding_cache._superseded = False

    def _match(self):
        return match_embedding(
            [1.0, 0.0],
            threshold=0.5,
            expected_dim=DIM,
            embedder_available=True,
        )

    def _let_a_refresh_fail(self) -> None:
        """Advance one TTL and let the refresh the code itself issues fail."""
        self.clock += float(self.settings.embedding_cache_ttl)
        with mock.patch.object(
            embedding_cache, "_fetch_candidates", side_effect=RuntimeError("backend unreachable")
        ):
            embedding_cache.ensure_fresh(expected_dim=DIM, blocking=True)

    def test_a_fresh_cache_still_matches(self) -> None:
        result = self._match()
        self.assertEqual(result["status"], RecognitionStatus.KNOWN)
        self.assertEqual(result["person_id"], "PRN-1")

    def test_a_stale_cache_is_unavailable_not_unknown(self) -> None:
        # Two failing refresh cycles take it past TTL + grace, the way the
        # production loop does when the backend is unreachable.
        self._let_a_refresh_fail()
        self.assertEqual(self._match()["status"], RecognitionStatus.KNOWN)
        self._let_a_refresh_fail()

        result = self._match()
        self.assertEqual(result["status"], RecognitionStatus.RECOGNITION_UNAVAILABLE)
        self.assertEqual(result["reason"], "IDENTITY_CACHE_STALE")
        # Critically NOT unknown: an unknown would be an alertable claim we
        # cannot justify from data we no longer trust.
        self.assertNotEqual(result["status"], RecognitionStatus.UNKNOWN)
        self.assertIsNone(result["person_id"])

    def test_identity_labels_are_withdrawn_once_the_cache_is_past_its_ttl(self) -> None:
        self._let_a_refresh_fail()
        # The models are absent in this environment, so the combined predicate
        # is False either way; assert on the cache term directly.
        self.assertTrue(embedding_cache.is_stale())
        self.assertFalse(face_service.identity_labels_trustworthy())


class NonBlockingRefreshTest(unittest.TestCase):
    def test_non_blocking_refresh_returns_before_the_fetch_finishes(self) -> None:
        cache = _SlowCache([enrolled("PRN-1", "Person One", [1.0, 0.0])], delay=0.2)

        started = time.time()
        returned = cache.ensure_fresh(expected_dim=DIM, force=True, blocking=False)
        elapsed = time.time() - started

        # Returned immediately with the current (empty) state…
        self.assertLess(elapsed, 0.15)
        self.assertFalse(returned)
        # …and the fetch completes on the background thread.
        self.assertTrue(cache.started.wait(timeout=2))
        deadline = time.time() + 2
        while not cache.loaded and time.time() < deadline:
            time.sleep(0.01)
        self.assertTrue(cache.loaded)
        self.assertEqual(cache.size, 1)

    def test_unforced_refreshes_are_deduplicated(self) -> None:
        """N camera threads hitting the same lapsed TTL must not each fetch."""
        cache = _SlowCache([enrolled("PRN-1", "Person One", [1.0, 0.0])], delay=0.2)

        cache.ensure_fresh(expected_dim=DIM, blocking=False)
        self.assertTrue(cache.started.wait(timeout=2))
        cache.ensure_fresh(expected_dim=DIM, blocking=False)
        cache.ensure_fresh(expected_dim=DIM, blocking=False)

        deadline = time.time() + 2
        while not cache.loaded and time.time() < deadline:
            time.sleep(0.01)
        self.assertEqual(cache.fetches, 1)

    def test_a_forced_refresh_is_not_swallowed_by_an_in_flight_one(self) -> None:
        """The defect this replaces a test for.

        ``ensure_fresh`` used to return early whenever a refresh was in flight,
        ignoring ``force`` — so the invalidation the backend triggers when a
        person is deleted or has recognition disabled could be a no-op, and the
        in-flight fetch (which may have read the PRE-change list) then installed
        itself and reported success. A forced refresh must run.
        """
        cache = _SlowCache([enrolled("PRN-1", "Person One", [1.0, 0.0])], delay=0.2)

        cache.ensure_fresh(expected_dim=DIM, blocking=False)   # background, in flight
        self.assertTrue(cache.started.wait(timeout=2))
        cache.ensure_fresh(expected_dim=DIM, force=True, blocking=True)  # the person changed

        self.assertEqual(cache.fetches, 2)

    def test_an_in_flight_fetch_that_predates_an_invalidation_is_discarded(self) -> None:
        """A refresh must not install a generation it read before the change.

        The background fetch below starts with the two-person list, then the
        list changes and a forced refresh installs the new one. When the old
        fetch finally returns, its result is older than a known change, so it
        is discarded rather than overwriting the newer generation.
        """
        stale_payload = [
            enrolled("PRN-1", "Person One", [1.0, 0.0]),
            enrolled("PRN-2", "Person Two", [0.0, 1.0]),
        ]
        cache = _SlowCache(stale_payload, delay=0.3)

        cache.ensure_fresh(expected_dim=DIM, blocking=False)
        self.assertTrue(cache.started.wait(timeout=2))

        # PRN-2 was deleted: the backend forces a refresh, and the new fetch
        # returns only PRN-1.
        cache.payload = [enrolled("PRN-1", "Person One", [1.0, 0.0])]
        cache.ensure_fresh(expected_dim=DIM, force=True, blocking=True)
        self.assertEqual(cache.size, 1)

        # Wait out the original (now superseded) fetch.
        time.sleep(0.45)
        self.assertEqual(cache.size, 1, "a superseded fetch must not reinstate a deleted identity")
        self.assertEqual([p["person_id"] for p in cache.snapshot()[1]], ["PRN-1"])

    def test_blocking_refresh_still_loads_inline(self) -> None:
        cache = _SlowCache([enrolled("PRN-1", "Person One", [1.0, 0.0])], delay=0.01)
        self.assertTrue(cache.ensure_fresh(expected_dim=DIM, force=True, blocking=True))
        self.assertEqual(cache.size, 1)

    def test_refresh_blocking_reports_whether_a_fetch_actually_succeeded(self) -> None:
        """The route must not report success when nothing was installed.

        It used to return ``state()`` alone, which showed ``loaded: true`` and
        the previous candidate count even when no fetch had run — and the
        backend logged "AI identity cache refreshed" from it.
        """
        cache = _ScriptedCache([enrolled("PRN-1", "Person One", [1.0, 0.0])])

        ok = cache.refresh_blocking(expected_dim=DIM)
        self.assertTrue(ok["refreshed"])
        self.assertEqual(ok["candidates"], 1)

        cache.fail = True
        failed = cache.refresh_blocking(expected_dim=DIM)
        self.assertFalse(failed["refreshed"])
        # The old data is still there (not erased) but is reported superseded,
        # so matching fails closed rather than using it.
        self.assertTrue(failed["loaded"])
        self.assertTrue(failed["superseded"])
        self.assertTrue(cache.is_stale(grace=600.0))


class _FakeModel:
    """Stand-in for FaceDetectorModel / FaceEmbedderModel singletons."""

    def __init__(self, available=True, model_name="sface_2021dec", embedding_dim=128):
        self.available = available
        self.model_name = model_name
        self.embedding_dim = embedding_dim
        self.last_error = None

    def instance(self):  # matches the classmethod call site
        return self


def face(width=80, height=80, score=0.95):
    return {"bbox": [10, 10, width, height], "score": score}


class RegisterFaceTest(unittest.TestCase):
    """Registration validation outcomes, with the models stubbed out."""

    def setUp(self) -> None:
        self.image = np.zeros((200, 200, 3), dtype=np.uint8)
        self.detector = _FakeModel(model_name="yunet_2023mar")
        self.embedder = _FakeModel()

    def _register(self, faces, embedding=None, image="default"):
        with mock.patch.object(face_service, "FaceDetectorModel", self.detector), mock.patch.object(
            face_service, "FaceEmbedderModel", self.embedder
        ), mock.patch.object(face_service, "detect_faces", return_value=faces), mock.patch.object(
            face_service, "generate_embedding", return_value=embedding
        ):
            return face_service.register_face(self.image if image == "default" else image)

    def test_models_unavailable_is_reported_not_guessed(self) -> None:
        self.detector.available = False
        result = self._register([face()])
        self.assertEqual(result.status, RegistrationStatus.RECOGNITION_UNAVAILABLE)
        self.assertIsNone(result.embedding)

    def test_an_unreadable_image_is_invalid_image(self) -> None:
        result = self._register([face()], image=None)
        self.assertEqual(result.status, RegistrationStatus.INVALID_IMAGE)
        self.assertIsNone(result.embedding)

    def test_no_face_returns_the_operator_message_verbatim(self) -> None:
        result = self._register([])
        self.assertEqual(result.status, RegistrationStatus.NO_FACE)
        self.assertEqual(result.faces_detected, 0)
        self.assertEqual(
            result.message, "No usable face was detected. Please upload another image."
        )
        self.assertIsNone(result.embedding)

    def test_multiple_faces_is_rejected_rather_than_picking_one(self) -> None:
        result = self._register([face(), face(width=70, height=70)])
        self.assertEqual(result.status, RegistrationStatus.MULTIPLE_FACES)
        self.assertEqual(result.faces_detected, 2)
        self.assertIsNone(result.embedding)

    def test_a_face_below_the_minimum_size_is_low_quality(self) -> None:
        small = get_settings().face_min_size - 1
        result = self._register([face(width=small, height=small)])
        self.assertEqual(result.status, RegistrationStatus.LOW_QUALITY)
        self.assertIsNone(result.embedding)

    def test_a_missing_embedding_never_marks_the_person_ready(self) -> None:
        result = self._register([face()], embedding=None)
        self.assertEqual(result.status, RegistrationStatus.RECOGNITION_UNAVAILABLE)
        self.assertIsNone(result.embedding)

    def test_a_valid_photograph_returns_one_embedding_with_its_metadata(self) -> None:
        vector = [0.01] * 128
        result = self._register([face()], embedding=vector)
        self.assertEqual(result.status, RegistrationStatus.OK)
        self.assertEqual(result.embedding, vector)
        self.assertEqual(result.embedding_dim, 128)
        self.assertEqual(result.embedding_model, "sface_2021dec")
        self.assertIn("Face detected successfully.", result.message)


@unittest.skipUnless(
    importlib.util.find_spec("fastapi"), "fastapi is not installed in this environment"
)
class ServiceSecretDependencyTest(unittest.TestCase):
    """The face and stream endpoints verify a credential, not just detect one."""

    def _call(self, header, configured):
        from fastapi import HTTPException

        from app.api import security

        settings = mock.Mock()
        settings.ingest_secret = configured
        with mock.patch.object(security, "get_settings", return_value=settings):
            try:
                security.require_service_secret(header)
            except HTTPException as exc:
                return exc.status_code
        return 200

    def test_the_correct_secret_is_accepted(self) -> None:
        self.assertEqual(self._call("s3cret", "s3cret"), 200)

    def test_a_missing_header_is_rejected(self) -> None:
        self.assertEqual(self._call(None, "s3cret"), 401)

    def test_a_wrong_secret_is_rejected(self) -> None:
        self.assertEqual(self._call("not-it", "s3cret"), 401)

    def test_an_arbitrary_header_value_is_not_enough(self) -> None:
        """A gate that merely DETECTS a header would pass this; ours must not."""
        for value in ("", "true", "1", "Bearer anything"):
            self.assertEqual(self._call(value, "s3cret"), 401)

    def test_an_unconfigured_secret_fails_closed(self) -> None:
        # No secret configured must mean "reject everything", never "allow all".
        self.assertEqual(self._call("anything", ""), 503)
        self.assertEqual(self._call(None, "   "), 503)


@unittest.skipUnless(
    importlib.util.find_spec("cv2") and importlib.util.find_spec("requests"),
    "event_reporter needs cv2 and requests, which are not installed in this environment",
)
class ReporterDropAccountingTest(unittest.TestCase):
    """A dropped report must be counted, visible, and treated as a failure."""

    def _reporter(self):
        from app.services.event_reporter import EventReporter

        return EventReporter()

    def test_the_in_flight_cap_is_per_camera_and_drops_are_counted(self) -> None:
        from app.services.event_reporter import MAX_IN_FLIGHT_REPORTS

        reporter = self._reporter()
        gate = threading.Event()
        self.addCleanup(gate.set)

        def blocked(*_args):
            gate.wait(3)

        for _ in range(MAX_IN_FLIGHT_REPORTS):
            self.assertTrue(reporter._dispatch("recognition", "CAM-01", blocked, None))

        # The cap is reached for THIS camera: the report is dropped…
        self.assertFalse(reporter._dispatch("recognition", "CAM-01", blocked, None))
        # …counted…
        self.assertEqual(reporter.dropped_reports("recognition", "CAM-01"), 1)
        self.assertEqual(reporter.dropped_reports("recognition"), 1)
        # …and recorded as a FAILURE of the leg, because the backend never
        # learns about that sighting. A status surface must not read `active`.
        self.assertIs(reporter.recognition_leg_ok, False)
        self.assertIsNotNone(reporter.seconds_since_drop("recognition"))

        # Another camera is unaffected — the cap used to be global, so one busy
        # camera could discard every other camera's reports.
        self.assertTrue(reporter._dispatch("recognition", "CAM-02", blocked, None))
        self.assertEqual(reporter.dropped_reports("recognition", "CAM-02"), 0)

        gate.set()
        reporter.shutdown(timeout=3)
        self.assertEqual(reporter.in_flight("recognition", "CAM-01"), 0)
        self.assertEqual(reporter.in_flight("recognition", "CAM-02"), 0)

    def test_shutdown_waits_for_an_in_flight_post(self) -> None:
        reporter = self._reporter()
        done = threading.Event()

        def slow(*_args):
            time.sleep(0.1)
            done.set()

        self.assertTrue(reporter._dispatch("recognition", "CAM-01", slow, None))
        self.assertEqual(reporter.shutdown(timeout=3), 0)
        self.assertTrue(done.is_set())


class ReportingSettingsTest(unittest.TestCase):
    def test_timeouts_are_well_below_a_frame_budget(self) -> None:
        settings = get_settings()
        self.assertLessEqual(settings.report_timeout, 3.0)
        self.assertLessEqual(settings.embedding_fetch_timeout, 4.0)

    def test_the_default_bind_is_loopback(self) -> None:
        # Asserted on the CLASS DEFAULT, not the resolved value: a deployment
        # may legitimately override AI_SERVICE_HOST (a container whose ports are
        # published to 127.0.0.1, for instance). What must never drift is the
        # out-of-the-box default.
        from app.config import Settings

        self.assertEqual(Settings.model_fields["host"].default, "127.0.0.1")

    def test_the_shared_secret_has_no_default_value(self) -> None:
        """An unconfigured secret must fail closed, not fail confusingly.

        A non-empty default here could never match the backend's own default,
        so a no-.env run 401'd every backend→AI call — which takes Review 1
        camera monitoring down with it. Empty means require_service_secret
        returns the 503 that names the variable to set.
        """
        from app.config import Settings

        self.assertEqual(Settings.model_fields["ingest_secret"].default, "")


if __name__ == "__main__":
    unittest.main()
