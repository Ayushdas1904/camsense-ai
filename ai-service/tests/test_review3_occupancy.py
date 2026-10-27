"""Unit tests for the Review 3 occupancy counting (AI service).

Stdlib ``unittest`` only — no new dependency. Run from the ai-service/ dir::

    python -m unittest discover -s tests -v

WHAT THIS FILE EXISTS TO PROVE. Occupancy is the one Review 3 number that the
automation engine is allowed to switch a device on, so the two properties that
matter are the two asserted hardest here:

* A PERSON VISIBLE ACROSS CONSECUTIVE FRAMES IS COUNTED ONCE. The headcount is
  the number of distinct live person TRACKS, not the sum of per-frame human
  boxes. Feeding the same box through a hundred frames must yield 1, not 100.
* UNAVAILABLE IS NOT ZERO. When the YOLO model reports unavailable there is no
  detection to count, so ``occupancy_available`` goes False and
  ``occupancy_count`` keeps its LAST value. It is never coerced to 0, because
  "we could not look" is a different statement from "the room is empty", and
  collapsing the two is precisely what would switch the lights off on a room
  full of people.

Plus the supporting rules: two distinct people are two tracks, a track that
stops being re-seen expires after ``occupancy_track_ttl``, and a track below
``occupancy_min_track_hits`` does not yet count (so a one-frame false positive
cannot move the number).

NO MODEL WEIGHTS ARE LOADED AND NO NETWORK IS TOUCHED. ``YoloModel`` is mocked
in the ``stream_manager`` namespace, and the whole module is skipped when the
native dependencies it imports at module scope (``cv2``, ``numpy``) are absent
rather than failing with an ImportError that says nothing useful.

WHAT THESE TESTS DO NOT PROVE: headcount ACCURACY. Greedy bbox-IoU association
is not a real multi-object tracker — it will mis-associate when two people
cross, and the boxes here are synthetic rectangles rather than output from a
model looking at a real room. See docs/OCCUPANCY_ENERGY.md. Nothing in this
repository has been executed (see docs/REVIEW3-REPORT.md section D).
"""
import importlib.util
import time
import unittest
from unittest import mock

_HAS_NATIVE_DEPS = bool(
    importlib.util.find_spec("cv2") and importlib.util.find_spec("numpy")
)
_IMPORT_ERROR = None

if _HAS_NATIVE_DEPS:  # pragma: no cover - import guard, not logic
    try:
        from app.models.schemas import Detection
        from app.services import stream_manager
        from app.services.stream_manager import _CameraWorker
    except Exception as exc:  # noqa: BLE001 - skip rather than fail on a missing native dep
        _HAS_NATIVE_DEPS = False
        _IMPORT_ERROR = exc

_SKIP_REASON = (
    f"stream_manager could not be imported in this environment: {_IMPORT_ERROR}"
    if _IMPORT_ERROR is not None
    else "stream_manager imports cv2 and numpy, which are not installed in this environment"
)


class _OccupancySettings:
    """The only settings ``_update_occupancy`` reads, with driveable values.

    A plain object rather than a mock so an unexpected attribute read raises
    instead of silently returning a Mock that tests as truthy.
    """

    def __init__(self, enabled=True, min_track_hits=1, track_ttl=3.0):
        self.occupancy_enabled = enabled
        self.occupancy_min_track_hits = min_track_hits
        self.occupancy_track_ttl = track_ttl


class _FakeYolo:
    """Stand-in for the ``YoloModel`` singleton, with a driveable `available`."""

    def __init__(self, available=True):
        self._available = available

    @property
    def available(self):
        return self._available

    def instance(self):  # matches the `YoloModel.instance()` call site
        return self


def human(x, y, w=40, h=100):
    """One human detection box, the shape YOLO already produces in Review 1."""
    return Detection(
        type="human", label="person", confidence=0.9, bbox=[x, y, w, h], source="real"
    )


def weapon(x, y, w=20, h=20):
    return Detection(
        type="weapon", label="knife", confidence=0.9, bbox=[x, y, w, h], source="demo"
    )


def face(x, y, w=30, h=30):
    return Detection(
        type="face", label="face", confidence=0.9, bbox=[x, y, w, h], source="real"
    )


@unittest.skipUnless(_HAS_NATIVE_DEPS, _SKIP_REASON)
class OccupancyCountingTest(unittest.TestCase):
    """The counting rule, driven through the real ``_update_occupancy``."""

    def setUp(self) -> None:
        self.yolo = _FakeYolo(available=True)
        patch = mock.patch.object(stream_manager, "YoloModel", self.yolo)
        patch.start()
        self.addCleanup(patch.stop)
        # mode='demo' and source=None resolve to the bundled sample video path.
        # Nothing opens it: these tests call _update_occupancy directly and
        # never start the worker thread.
        self.worker = _CameraWorker(camera_id="CAM-TEST", source=None, mode="demo")

    def feed(self, detections, settings=None, frames=1):
        settings = settings or _OccupancySettings()
        for _ in range(frames):
            self.worker._update_occupancy(list(detections), settings)
        return self.worker.occupancy_count

    # ── The rule the feature rests on ────────────────────────────

    def test_one_person_across_many_consecutive_frames_is_counted_once(self) -> None:
        """The regression that would make the whole feature meaningless.

        If occupancy were the sum of per-frame detections (or a running
        total), a single person standing still for 100 processed frames would
        report 100 occupants. It must report 1.
        """
        count = self.feed([human(100, 100)], frames=100)

        self.assertEqual(count, 1)
        self.assertEqual(len(self.worker._person_tracks), 1)
        self.assertTrue(self.worker.occupancy_available)

    def test_a_person_drifting_between_frames_stays_the_same_track(self) -> None:
        """Real boxes move. A small shift must re-associate, not open a track."""
        settings = _OccupancySettings(min_track_hits=1)
        for offset in range(0, 10):
            # 2px per frame: the boxes overlap heavily, so IoU is well above
            # the 0.3 association threshold.
            self.worker._update_occupancy([human(100 + offset * 2, 100)], settings)

        self.assertEqual(self.worker.occupancy_count, 1)
        self.assertEqual(len(self.worker._person_tracks), 1)

    def test_two_distinct_people_are_two_occupants(self) -> None:
        # Far apart, so IoU is 0 and neither box can claim the other's track.
        count = self.feed([human(0, 0), human(500, 300)], frames=5)
        self.assertEqual(count, 2)

    def test_each_box_claims_at_most_one_track_per_frame(self) -> None:
        """Two boxes in one frame must not both be matched to one track."""
        settings = _OccupancySettings(min_track_hits=1)
        self.worker._update_occupancy([human(0, 0)], settings)
        self.assertEqual(self.worker.occupancy_count, 1)

        # The second box overlaps the first one exactly; the per-pass claim
        # means one of them opens a new track rather than both collapsing.
        self.worker._update_occupancy([human(0, 0), human(0, 0)], settings)
        self.assertEqual(self.worker.occupancy_count, 2)

    def test_only_human_detections_feed_the_headcount(self) -> None:
        """A weapon is not a person, and a face box is a different measurement."""
        count = self.feed([weapon(10, 10), face(50, 50)], frames=3)
        self.assertEqual(count, 0)
        self.assertEqual(len(self.worker._person_tracks), 0)

        # And a measured zero IS reported as available — the honest empty room.
        self.assertTrue(self.worker.occupancy_available)

    def test_a_malformed_box_is_skipped_rather_than_counted(self) -> None:
        count = self.feed(
            [Detection(type="human", label="person", confidence=0.5, bbox=[1, 2])],
            frames=2,
        )
        self.assertEqual(count, 0)

    # ── Minimum persistence ──────────────────────────────────────

    def test_a_track_below_the_minimum_hit_count_does_not_yet_count(self) -> None:
        """A single-frame false positive must not move the headcount."""
        settings = _OccupancySettings(min_track_hits=2)

        self.worker._update_occupancy([human(100, 100)], settings)
        self.assertEqual(self.worker.occupancy_count, 0, "one sighting is not an occupant yet")
        # The track exists; it simply has not earned its place in the count.
        self.assertEqual(len(self.worker._person_tracks), 1)

        self.worker._update_occupancy([human(100, 100)], settings)
        self.assertEqual(self.worker.occupancy_count, 1)

    def test_a_one_frame_blip_never_reaches_the_count(self) -> None:
        settings = _OccupancySettings(min_track_hits=3)
        self.worker._update_occupancy([human(100, 100)], settings)
        # A spurious box somewhere else for exactly one frame.
        self.worker._update_occupancy([human(100, 100), human(600, 400)], settings)
        self.worker._update_occupancy([human(100, 100)], settings)

        # The persistent person counts; the blip never did.
        self.assertEqual(self.worker.occupancy_count, 1)

    # ── Expiry ───────────────────────────────────────────────────

    def test_a_track_that_stops_being_seen_expires_and_stops_counting(self) -> None:
        """Somebody who has left must not be counted indefinitely."""
        settings = _OccupancySettings(min_track_hits=1, track_ttl=0.05)

        self.worker._update_occupancy([human(100, 100)], settings)
        self.assertEqual(self.worker.occupancy_count, 1)

        # Longer than the TTL with no further sighting.
        time.sleep(0.08)
        self.worker._update_occupancy([], settings)

        self.assertEqual(self.worker.occupancy_count, 0)
        self.assertEqual(self.worker._person_tracks, [])
        # Still a real measurement: the room was looked at and is empty.
        self.assertTrue(self.worker.occupancy_available)

    def test_the_track_list_is_bounded_by_the_ttl_rather_than_growing(self) -> None:
        """No unbounded in-memory growth: expiry runs on every update."""
        settings = _OccupancySettings(min_track_hits=1, track_ttl=0.05)

        for i in range(20):
            # A box in a different place each time, so each opens a new track.
            self.worker._update_occupancy([human(i * 200, i * 150)], settings)
            time.sleep(0.01)

        time.sleep(0.08)
        self.worker._update_occupancy([], settings)
        self.assertEqual(self.worker._person_tracks, [])

    # ── THE HONESTY RULE: unavailable is not zero ────────────────

    def test_an_unavailable_model_reports_unavailable_and_does_not_zero_the_count(self) -> None:
        """The rule the whole fail-safe chain depends on.

        With no YOLO model there is no detection, so there is no headcount.
        Reporting 0 would state that the room is empty — a claim the system
        cannot make from a model it never loaded.
        """
        settings = _OccupancySettings(min_track_hits=1)

        # A real measurement first, so there is a last-known value to protect.
        self.worker._update_occupancy([human(100, 100), human(500, 300)], settings)
        self.assertEqual(self.worker.occupancy_count, 2)
        self.assertTrue(self.worker.occupancy_available)

        # The model becomes unavailable.
        self.yolo._available = False
        self.worker._update_occupancy([], settings)

        self.assertFalse(self.worker.occupancy_available)
        # NOT coerced to 0 — this is the assertion that matters.
        self.assertNotEqual(self.worker.occupancy_count, 0)
        self.assertEqual(self.worker.occupancy_count, 2)

    def test_a_never_measured_worker_reports_None_not_zero(self) -> None:
        """A worker that has never counted anything has no count, not a count of 0."""
        fresh = _CameraWorker(camera_id="CAM-NEVER", source=None, mode="demo")
        self.assertIsNone(fresh.occupancy_count)
        self.assertFalse(fresh.occupancy_available)

        # And an unavailable model leaves it None rather than inventing a 0.
        self.yolo._available = False
        fresh._update_occupancy([human(1, 1)], _OccupancySettings())
        self.assertIsNone(fresh.occupancy_count)
        self.assertFalse(fresh.occupancy_available)

    def test_availability_recovers_once_the_model_is_back(self) -> None:
        settings = _OccupancySettings(min_track_hits=1)
        self.yolo._available = False
        self.worker._update_occupancy([human(100, 100)], settings)
        self.assertFalse(self.worker.occupancy_available)

        self.yolo._available = True
        self.worker._update_occupancy([human(100, 100)], settings)
        self.assertTrue(self.worker.occupancy_available)
        self.assertEqual(self.worker.occupancy_count, 1)

    def test_disabling_occupancy_leaves_the_state_untouched(self) -> None:
        """AI_SERVICE_OCCUPANCY_ENABLED=false must not fabricate a zero either."""
        self.worker._update_occupancy([human(100, 100)], _OccupancySettings(min_track_hits=1))
        self.assertEqual(self.worker.occupancy_count, 1)

        self.worker._update_occupancy([], _OccupancySettings(enabled=False))
        self.assertEqual(self.worker.occupancy_count, 1)

    # ── Occupancy is not the per-frame box count ─────────────────

    def test_the_review_1_people_stat_and_occupancy_are_separate_numbers(self) -> None:
        """`people` is this frame's human boxes; occupancy is distinct tracks.

        They coincide for a still scene, which is exactly why they are easy to
        confuse — so this asserts they are produced by different code paths and
        that occupancy does not accumulate across frames the way a sum would.
        """
        settings = _OccupancySettings(min_track_hits=1)
        for _ in range(50):
            detections = [human(100, 100)]
            self.worker._update_occupancy(detections, settings)
            self.worker._update_stats(time.time(), detections, recognitions=None)

        self.assertEqual(self.worker.people, 1, "per-frame human box count")
        self.assertEqual(self.worker.occupancy_count, 1, "distinct live person tracks")


@unittest.skipUnless(_HAS_NATIVE_DEPS, _SKIP_REASON)
class PersonTrackIdentityTest(unittest.TestCase):
    """Track handles are per-camera session handles, not identities."""

    def setUp(self) -> None:
        patch = mock.patch.object(stream_manager, "YoloModel", _FakeYolo(True))
        patch.start()
        self.addCleanup(patch.stop)

    def test_a_track_id_is_scoped_to_its_camera(self) -> None:
        """No cross-camera re-identification exists, and the ids admit it."""
        one = _CameraWorker(camera_id="CAM-01", source=None, mode="demo")
        two = _CameraWorker(camera_id="CAM-02", source=None, mode="demo")

        first = one._person_track_for([10, 10, 40, 100])
        second = two._person_track_for([10, 10, 40, 100])

        self.assertTrue(first["id"].startswith("CAM-01-person-"))
        self.assertTrue(second["id"].startswith("CAM-02-person-"))
        # The SAME person in front of two cameras legitimately gets two tracks.
        # That is why rooms aggregate with MAX and never with a sum — see
        # backend/src/services/occupancyRules.js::aggregateRoomCount.
        self.assertNotEqual(first["id"], second["id"])

    def test_a_track_does_not_survive_a_worker_restart(self) -> None:
        """Tracks are in-memory only; a restarted worker starts from nothing."""
        worker = _CameraWorker(camera_id="CAM-01", source=None, mode="demo")
        worker._person_track_for([10, 10, 40, 100])
        self.assertEqual(len(worker._person_tracks), 1)

        restarted = _CameraWorker(camera_id="CAM-01", source=None, mode="demo")
        self.assertEqual(restarted._person_tracks, [])
        self.assertIsNone(restarted.occupancy_count)


class OccupancySettingsTest(unittest.TestCase):
    """The class defaults, asserted without importing cv2."""

    def test_the_occupancy_settings_exist_with_safe_defaults(self) -> None:
        from app.config import Settings

        fields = Settings.model_fields
        for key in (
            "occupancy_enabled",
            "occupancy_report_interval",
            "occupancy_min_track_hits",
            "occupancy_track_ttl",
        ):
            self.assertIn(key, fields, f"{key} must be a declared setting")

        # min_track_hits above 1: a one-frame false positive must not be able
        # to move a headcount that automation acts on.
        self.assertGreaterEqual(fields["occupancy_min_track_hits"].default, 2)
        # A finite TTL, so the track list cannot grow without bound.
        self.assertGreater(fields["occupancy_track_ttl"].default, 0)
        self.assertLessEqual(fields["occupancy_track_ttl"].default, 60)

    def test_the_report_interval_does_not_post_per_frame(self) -> None:
        from app.config import Settings

        self.assertGreaterEqual(Settings.model_fields["occupancy_report_interval"].default, 1.0)


if __name__ == "__main__":
    unittest.main()
