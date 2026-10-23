"""AI-service test harness smoke test.

Uses only Python's standard-library ``unittest`` so the suite adds no new
dependency to requirements.txt. Run with::

    python -m unittest discover -s tests -v

from the ai-service/ directory. (``tests`` is a package, so unittest resolves
the top-level directory to ai-service/ and ``app.config`` is importable.)

This module imports ``app.config`` ONLY. It deliberately avoids importing the
service entrypoint, the detector modules, or anything that pulls in the
heavyweight computer-vision stack or model weights, so the suite stays runnable
on a machine where only the lightweight settings dependency is installed.
"""
import unittest

from app.config import get_settings


class SettingsSmokeTest(unittest.TestCase):
    """The settings object is the shared contract every other module reads."""

    def setUp(self) -> None:
        self.settings = get_settings()

    def test_review1_detection_fields_exist(self) -> None:
        for field in ("person_confidence", "weapon_confidence", "target_fps", "frame_width"):
            self.assertTrue(
                hasattr(self.settings, field),
                msg=f"Settings is missing the Review 1 field '{field}'",
            )

    def test_confidence_thresholds_are_fractions(self) -> None:
        for field in ("person_confidence", "weapon_confidence"):
            value = getattr(self.settings, field)
            self.assertIsInstance(value, float)
            self.assertGreater(value, 0.0)
            self.assertLessEqual(value, 1.0)

    def test_frame_processing_knobs_are_positive_ints(self) -> None:
        for field in ("target_fps", "frame_width"):
            value = getattr(self.settings, field)
            self.assertIsInstance(value, int)
            self.assertGreater(value, 0)

    def test_get_settings_is_cached_single_instance(self) -> None:
        """Settings are read once; callers must share the same object."""
        self.assertIs(get_settings(), get_settings())


if __name__ == "__main__":
    unittest.main()
