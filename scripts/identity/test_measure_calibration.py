import unittest
from measure_calibration import decision


class CalibrationDecisionTests(unittest.TestCase):
    def test_preregistered_floor_and_margins_cannot_be_lowered_to_fit_controls(self):
        result = decision([.79, .9], [.754058, .2])
        self.assertEqual(result["candidateThreshold"], .78)
        self.assertEqual(result["status"], "provisionally_separated")
        self.assertFalse(result["automaticPassEnabled"])
        overlapping = decision([.77, .9], [.754058, .2])
        self.assertEqual(overlapping["candidateThreshold"], .78)
        self.assertEqual(overlapping["status"], "controls_overlap_or_abstain")
        self.assertEqual(decision([.9], [.81])["candidateThreshold"], .83)

    def test_unresolved_controls_and_missing_classes_cannot_certify_separation(self):
        self.assertEqual(decision([.9], [.2], 1)["status"], "controls_overlap_or_abstain")
        self.assertEqual(decision([.9], [.2], 0, 1)["status"], "controls_overlap_or_abstain")
        self.assertEqual(decision([], [.2])["status"], "insufficient_controls")


if __name__ == "__main__": unittest.main()
