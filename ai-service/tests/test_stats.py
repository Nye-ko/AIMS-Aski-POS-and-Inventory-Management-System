"""Run from ai-service/:  python -m unittest discover -s tests -v"""
import math
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from forecast_stats import INTERVAL_Z, range_for_total, sample_variance, window_mean  # noqa: E402


class WindowMean(unittest.TestCase):
    def test_uses_only_the_last_days(self):
        self.assertEqual(window_mean([100, 100, 2, 4], 2), (3.0, 2))

    def test_shorter_series_uses_everything(self):
        self.assertEqual(window_mean([1, 2, 3], 28), (2.0, 3))

    def test_skips_unobserved_days_instead_of_counting_them_as_zero(self):
        self.assertEqual(window_mean([4, None, 4, None], 4), (4.0, 2))

    def test_nothing_observed(self):
        self.assertIsNone(window_mean([None, None], 5))
        self.assertIsNone(window_mean([], 5))


class SampleVariance(unittest.TestCase):
    def test_known_value(self):
        self.assertAlmostEqual(sample_variance([2, 4, 4, 4, 5, 5, 7, 9]), 32 / 7)

    def test_needs_two_observations(self):
        self.assertIsNone(sample_variance([5]))
        self.assertIsNone(sample_variance([5, None]))

    def test_ignores_unobserved_days(self):
        self.assertEqual(sample_variance([1, None, 3]), sample_variance([1, 3]))


class RangeForTotal(unittest.TestCase):
    def test_matches_the_formula(self):
        low, high = range_for_total(10.0, 28, 25.0, 7)
        sd = math.sqrt(7 * 25 + 49 * 25 / 28)
        self.assertAlmostEqual(low, 70 - INTERVAL_Z * sd)
        self.assertAlmostEqual(high, 70 + INTERVAL_Z * sd)

    def test_low_never_goes_below_zero(self):
        self.assertEqual(range_for_total(0.2, 5, 4.0, 7)[0], 0.0)

    def test_poisson_floor_only_applies_to_counts(self):
        self.assertEqual(range_for_total(6.0, 28, 0.0, 7, count_data=False), (42.0, 42.0))
        low, high = range_for_total(6.0, 28, 0.0, 7, count_data=True)
        self.assertLess(low, 42.0)
        self.assertGreater(high, 42.0)

    def test_no_variance_estimate_falls_back_to_poisson_for_counts(self):
        self.assertEqual(range_for_total(3.0, 1, None, 7, count_data=True),
                         range_for_total(3.0, 1, 3.0, 7, count_data=True))


if __name__ == "__main__":
    unittest.main()
