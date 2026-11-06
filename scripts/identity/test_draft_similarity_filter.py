import copy
import math
import unittest

import numpy as np
from draft_similarity_filter import DraftSimilarityFilter, POLICY_ID, POLICY_SHA256, canonical_sha256, load_policy, requested_draft_filter


class DraftFilterTests(unittest.TestCase):
    def setUp(self):
        self.policy = load_policy()
        raw = self.policy["identity"]["rawSha256"]
        self.value = {"projectId": self.policy["projectId"], "draftSimilarityPolicyId": POLICY_ID,
            "draftSimilarityPolicySha256": POLICY_SHA256, "verifiedStartFrame": 0, "verifiedEndFrameExclusive": 3,
            "identityReferenceHashes": [raw], "references": [{"hash": raw, "canonicalName": "Diego", "role": "identity"}]}
        self.metadata = {"version": self.policy["model"]["version"], "preprocessVersion": self.policy["model"]["preprocessVersion"]}
        self.manifest = {"models": [{"sha256": self.policy["model"]["recognitionSha256"]}, {"sha256": self.policy["model"]["detectionSha256"]}]}
        self.gallery = {"sha256": self.policy["identity"]["gallerySha256"]}
        self.face = {"box": [20, 20, 180, 220], "trackId": "face-0", "quality": {"widthPixels": 180, "heightPixels": 220,
            "detectionScore": .97, "blurVariance": 35, "meanLuminance": 55},
            "landmarks": [70, 80, 150, 80, 110, 130, 85, 170, 135, 170], "feature": np.array([.9, math.sqrt(1-.9*.9)], dtype=np.float32)}

    def create(self, value=None, gallery=None):
        return requested_draft_filter(value or self.value, self.metadata, self.manifest, gallery or self.gallery)

    def observe(self, evaluator, index, faces=None):
        evaluator.observe(index, 24, f"{index:064x}", (500, 500, 3), faces if faces is not None else [copy.deepcopy(self.face)], np.array([1, 0], dtype=np.float32))

    def test_policy_is_immutable_and_requires_explicit_id_project_sha_and_exact_gallery(self):
        self.assertEqual(canonical_sha256(load_policy()), POLICY_SHA256)
        self.assertIsNone(self.create({**self.value, "draftSimilarityPolicyId": None}))
        self.assertIsNone(self.create({**self.value, "draftSimilarityPolicyId": "other-policy"}))
        for field in ["projectId", "draftSimilarityPolicySha256", "identityReferenceHashes"]:
            value = {**self.value, field: [] if field == "identityReferenceHashes" else "other"}
            evaluator = self.create(value)
            for index in range(3): self.observe(evaluator, index)
            self.assertEqual(evaluator.finish()["status"], "unverifiable")
        self.assertEqual(self.create(gallery={"sha256": "a"*64}).finish()["status"], "unverifiable")

    def test_all_frames_above_exact_threshold_can_be_provisional_even_with_acquisition_warnings(self):
        evaluator = self.create()
        for index in range(3): self.observe(evaluator, index)
        evidence = evaluator.finish()
        self.assertEqual(evidence["status"], "eligible")
        self.assertEqual(evidence["eligibleFrameCount"], 3)
        self.assertEqual(evidence["outOfScopeFrameCount"], 0)
        self.assertEqual(evidence["ambiguousFrameCount"], 0)
        self.assertEqual(len(evidence["samples"]), 3)
        self.assertTrue(any("native_blur" in warning for warning in evidence["warnings"]))
        self.assertTrue(any("native_luminance_low" in warning for warning in evidence["warnings"]))

    def test_one_low_score_or_geometry_failure_prevents_eligibility_without_threshold_relaxation(self):
        for change in [{"feature": np.array([.79, math.sqrt(1-.79*.79)], dtype=np.float32)},
            {"landmarks": [70, 80, 150, 80, 135, 130, 85, 170, 135, 170]}]:
            evaluator = self.create()
            for index in range(3): self.observe(evaluator, index, [{**self.face, **change}] if index == 1 else None)
            evidence = evaluator.finish()
            self.assertEqual(evidence["status"], "ineligible")
            self.assertEqual(evidence["eligibleFrameCount"], 2)
            self.assertEqual(evidence["threshold"], .8)

    def test_missing_multiple_sampled_and_discontinuous_tracks_remain_unverifiable(self):
        for special in [[], [self.face, self.face], [{**self.face, "trackId": "face-1"}], [{**self.face, "box": [300, 20, 180, 220]}]]:
            evaluator = self.create()
            for index in range(3): self.observe(evaluator, index, special if index == 1 else None)
            self.assertEqual(evaluator.finish()["status"], "unverifiable")
        evaluator = self.create()
        self.observe(evaluator, 0)
        self.observe(evaluator, 2)
        self.assertEqual(evaluator.finish()["status"], "unverifiable")


if __name__ == "__main__": unittest.main()
