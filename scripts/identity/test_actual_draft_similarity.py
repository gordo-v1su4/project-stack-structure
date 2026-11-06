import hashlib
import json
import os
from pathlib import Path
import unittest

from draft_similarity_filter import POLICY_ID, POLICY_SHA256, load_policy
from verify import assess

FIXTURE = Path(".tmp/identity-audit/sface-pilot-input.json")
VIDEO = Path(".tmp/film-audit/controlled-diego-v2.mp4")


@unittest.skipUnless(os.environ.get("IDENTITY_TEST_MODEL_DIR") and FIXTURE.is_file() and VIDEO.is_file(), "Pinned models and approved local diagnostic media required")
class ActualDraftSimilarityTest(unittest.TestCase):
    def test_rejected_original_pilot_cannot_be_admitted_by_the_new_numeric_policy(self):
        value = json.loads(FIXTURE.read_text())
        value.update(projectId=load_policy()["projectId"], draftSimilarityPolicyId=POLICY_ID, draftSimilarityPolicySha256=POLICY_SHA256)
        report = assess(value, os.environ["IDENTITY_TEST_MODEL_DIR"])
        self.assertEqual(report["status"], "unverifiable")
        self.assertNotEqual(report["draftSimilarityFilter"]["status"], "eligible")

    def test_observed_v2_all37_frames_is_provisional_candidate_while_identity_stays_unverifiable(self):
        value = json.loads(FIXTURE.read_text())
        value.update(projectId=load_policy()["projectId"], draftSimilarityPolicyId=POLICY_ID, draftSimilarityPolicySha256=POLICY_SHA256,
            assetId="h3-c8d7f22e6afd91d337bf85ddcfee8e5dfc2f825f9e9da6cdf41739046284a710",
            jobId="h3-c8d7f22e6afd91d337bf85ddcfee8e5dfc2f825f9e9da6cdf41739046284a710", generationModel="h3-ref2va-int8-v2",
            videoPath=str(VIDEO), mediaSha256=hashlib.sha256(VIDEO.read_bytes()).hexdigest(), verifiedEndFrameExclusive=37)
        self.assertEqual(value["mediaSha256"], "9f0e7f539218830b5f56be7949c062df6477863a02e0852f48f6c17ece5d6d4a")
        report = assess(value, os.environ["IDENTITY_TEST_MODEL_DIR"])
        self.assertEqual(report["status"], "unverifiable")
        self.assertGreater(report["unverifiableFrameCount"], 0)
        evidence = report["draftSimilarityFilter"]
        self.assertEqual(evidence["status"], "eligible")
        self.assertEqual(evidence["examinedFrameCount"], 37)
        self.assertEqual(evidence["eligibleFrameCount"], 37)
        self.assertEqual(evidence["outOfScopeFrameCount"], 0)
        self.assertEqual(evidence["ambiguousFrameCount"], 0)
        self.assertEqual(len(evidence["samples"]), 37)
        self.assertGreaterEqual(min(sample["scores"][0]["score"] for sample in evidence["samples"]), .86)
        self.assertEqual(len(set(sample["scores"][0]["trackId"] for sample in evidence["samples"])), 1)


if __name__ == "__main__": unittest.main()
