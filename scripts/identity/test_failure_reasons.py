import copy
import math
import types
import unittest

import numpy as np

from failure_reasons import REASON_NAMES, record_failure_reasons, append_failure_reason_warnings
from draft_similarity_filter import requested_draft_filter
import test_draft_similarity_filter as single
import test_foreground_similarity_filter as foreground
import test_joint_similarity_filter as joint
from test_issued_policy import fixture as issued_fixture, face as issued_face


class FailureReasonTests(unittest.TestCase):
    def test_bounded_sorted_per_frame_counts_deduplicate_and_ignore_unknown_codes(self):
        evaluator = types.SimpleNamespace(evidence={"examinedFrameCount": 2, "warnings": []})
        record_failure_reasons(evaluator, ["roll_outside_scope", "minimumFaceWidthPixels", "minimumFaceHeightPixels", "unknown"])
        record_failure_reasons(evaluator, ["roll_outside_scope", "minimumDetectionScore"])
        append_failure_reason_warnings(evaluator)
        expected = ["Draft filter reason: face_too_small on 1/2 frames.",
            "Draft filter reason: low_detection_confidence on 1/2 frames.",
            "Draft filter reason: roll_outside_scope on 2/2 frames."]
        self.assertEqual(evaluator.evidence["warnings"], expected)
        append_failure_reason_warnings(evaluator)
        self.assertEqual(evaluator.evidence["warnings"], expected)
        self.assertLessEqual(len(set(REASON_NAMES.values())) + 6, 32)

    def test_single_face_reports_actual_geometry_and_low_score_without_changing_counts(self):
        fixture = single.DraftFilterTests(); fixture.setUp()
        evaluator = fixture.create()
        bad = {**fixture.face, "quality": {**fixture.face["quality"], "widthPixels": 100, "heightPixels": 140, "detectionScore": .93},
            "feature": np.array([.79, math.sqrt(1-.79**2)], dtype=np.float32)}
        for index in range(3): fixture.observe(evaluator, index, [bad] if index == 1 else None)
        evidence = evaluator.finish()
        self.assertEqual((evidence["status"], evidence["eligibleFrameCount"], evidence["outOfScopeFrameCount"]), ("ineligible", 2, 1))
        for reason in ["face_too_small", "low_detection_confidence", "below_similarity_threshold"]:
            self.assertIn(f"Draft filter reason: {reason} on 1/3 frames.", evidence["warnings"])
        self.assertEqual(len(evidence["samples"]), 3)

    def test_missing_and_multiple_faces_report_early_return_paths(self):
        fixture = single.DraftFilterTests(); fixture.setUp()
        evaluator = fixture.create()
        fixture.observe(evaluator, 0, [])
        fixture.observe(evaluator, 1, [fixture.face, fixture.face])
        fixture.observe(evaluator, 2)
        evidence = evaluator.finish()
        self.assertEqual(evidence["status"], "unverifiable")
        self.assertIn("Draft filter reason: missing_face on 1/3 frames.", evidence["warnings"])
        self.assertIn("Draft filter reason: ambiguous_face_count on 1/3 frames.", evidence["warnings"])
        self.assertIn("Draft filter reason: track_discontinuous on 1/3 frames.", evidence["warnings"])

    def test_foreground_background_failure_is_not_misreported_as_lead_confidence(self):
        fixture = foreground.ForegroundFilterTests(); fixture.setUp()
        too_large = fixture.face(20, 200, 145, 180, "background", .1, .88)
        evidence = fixture.run_frames([fixture.lead, too_large])
        self.assertEqual((evidence["status"], evidence["eligibleFrameCount"]), ("ineligible", 2))
        self.assertIn("Draft filter reason: background_outside_dominance_scope on 1/3 frames.", evidence["warnings"])
        self.assertFalse(any("low_detection_confidence" in warning for warning in evidence["warnings"]))
        ambiguous = fixture.run_frames([fixture.lead, fixture.face(20, 200, 100, 180, "background", .8, .88)])
        self.assertEqual(ambiguous["status"], "unverifiable")
        self.assertIn("Draft filter reason: assignment_margin on 1/3 frames.", ambiguous["warnings"])

    def test_joint_duplicate_reasons_count_frames_not_face_observations(self):
        fixture = joint.JointFilterTests(); fixture.setUp()
        both_low = copy.deepcopy(fixture.faces)
        for face in both_low: face["quality"]["detectionScore"] = .93
        evidence = fixture.run_frames(both_low)
        self.assertEqual((evidence["status"], evidence["eligibleFrameCount"], evidence["outOfScopeFrameCount"]), ("ineligible", 2, 1))
        self.assertIn("Draft filter reason: low_detection_confidence on 1/3 frames.", evidence["warnings"])
        self.assertEqual(len(evidence["samples"][1]["scores"]), 2)
        missing = fixture.run_frames(fixture.faces[:1])
        self.assertEqual(missing["status"], "unverifiable")
        self.assertIn("Draft filter reason: missing_required_face on 1/3 frames.", missing["warnings"])

    def test_server_issued_evaluator_also_reports_reasons_without_new_initialization(self):
        value, metadata, manifest, gallery = issued_fixture()
        evaluator = requested_draft_filter(value, metadata, manifest, gallery)
        for index in range(3):
            face = issued_face()
            if index == 1:
                face["quality"]["detectionScore"] = .93
                face["feature"] = np.array([.79, math.sqrt(1-.79**2)])
            evaluator.observe(index, 24, f"{index:064x}", (768, 1344, 3), [face], np.array([1, 0]))
        evidence = evaluator.finish()
        self.assertEqual((evidence["status"], evidence["eligibleFrameCount"]), ("ineligible", 2))
        self.assertIn("Draft filter reason: low_detection_confidence on 1/3 frames.", evidence["warnings"])
        self.assertIn("Draft filter reason: below_similarity_threshold on 1/3 frames.", evidence["warnings"])


if __name__ == "__main__": unittest.main()
