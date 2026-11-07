"""Separate evaluation purpose; unchanged numerical classes and historical package validation."""
import copy
import unittest
from unittest.mock import patch

import numpy as np

from test_issued_policy import fixture, face
import test_verify
from test_verify import FakeVerifier, FakeVideo
from issued_policy import policy_sha256, validate_issued_policy
from draft_similarity_filter import requested_draft_filter, POLICY_ID, POLICY_SHA256, DraftSimilarityFilter
from foreground_similarity_filter import ForegroundDraftSimilarityFilter
from verify import validate_input, assess


def current_fixture(legacy=False):
    value, metadata, manifest, gallery = fixture(version=1 if legacy else 2)
    issued = value.pop("issuedPolicy")
    body = issued["body"]
    body.update(purpose="current-reference-assessment-v1", originalPolicy={"kind": "legacy" if legacy else "issued",
        "id": POLICY_ID if legacy else issued["id"], "sha256": POLICY_SHA256 if legacy else issued["sha256"]})
    if legacy:
        body["generationModel"] = value["generationModel"] = "h3-ref2va-int8-v2"
    digest = policy_sha256(body)
    value.update(purpose="current-reference-assessment-v1", evaluationReferenceHashes=value.pop("generationReferenceHashes"),
        evaluationPolicy={"version": 1, "id": "h3-current-policy-"+digest, "sha256": digest, "body": body})
    return value, metadata, manifest, gallery


class CurrentReferenceTests(unittest.TestCase):
    def test_original_generation_package_contract_is_unchanged(self):
        case = test_verify.IdentityGateTests(); case.setUp()
        try:
            original = copy.deepcopy(case.value)
            original["identityReferenceHashes"] = ["b"*64]
            with self.assertRaisesRegex(ValueError, "outside the generation package"):
                validate_input(original)
            current = copy.deepcopy(case.value)
            current["purpose"] = "current-reference-assessment-v1"
            current["evaluationReferenceHashes"] = current.pop("generationReferenceHashes")
            current["origin"] = {key: "a"*64 for key in ["originalJobSha256", "originalTargetSha256", "originalProofSha256", "selectedProofSha256", "contextSha256"]}
            current["origin"]["generationReferenceHashes"] = ["b"*64]
            self.assertEqual(validate_input(current)["origin"]["generationReferenceHashes"], ["b"*64])
            mixed = copy.deepcopy(current); mixed["generationReferenceHashes"] = ["b"*64]
            with self.assertRaisesRegex(ValueError, "historical origin"): validate_input(mixed)
            with patch("verify.Verifier", FakeVerifier), patch("verify.cv2.VideoCapture", FakeVideo), patch("verify.requested_draft_filter", return_value=None):
                report = assess(current, "unused")
            self.assertNotIn("referenceHashes", report)
            self.assertNotIn("generationReferenceHashes", report)
            self.assertEqual(report["evaluationReferenceHashes"], current["evaluationReferenceHashes"])
            self.assertEqual(report["origin"]["generationReferenceHashes"], ["b"*64])
            self.assertEqual(report["status"], "unverifiable")
        finally: case.tearDown()

    def test_current_issued_family_reuses_actual_foreground_numeric_class(self):
        value, metadata, manifest, gallery = current_fixture()
        evaluator = requested_draft_filter(value, metadata, manifest, gallery)
        self.assertIsInstance(evaluator, ForegroundDraftSimilarityFilter)
        self.assertEqual(evaluator.policy["scope"]["minimumDetectionScore"], .9)
        for i in range(3): evaluator.observe(i, 24, f"{i:064x}", (768, 1344, 3), [face()], np.array([1, 0]))
        self.assertEqual(evaluator.finish()["status"], "eligible")

    def test_legacy_purpose_preserves_point94_single_face_and_temporal_rules(self):
        value, metadata, manifest, gallery = current_fixture(legacy=True)
        for variant in ["valid", "detection", "second-face", "track", "score", "missing-frame"]:
            evaluator = requested_draft_filter(value, metadata, manifest, gallery)
            self.assertIsInstance(evaluator, DraftSimilarityFilter)
            self.assertNotIsInstance(evaluator, ForegroundDraftSimilarityFilter)
            self.assertEqual(evaluator.policy["scope"]["minimumDetectionScore"], .94)
            for i in range(2 if variant == "missing-frame" else 3):
                lead = face()
                if i == 1 and variant == "detection": lead["quality"]["detectionScore"] = .93
                if i == 1 and variant == "track": lead["trackId"] = "other"
                if i == 1 and variant == "score": lead["feature"] = np.array([.79, np.sqrt(1-.79**2)])
                faces = [lead, face(x=20, width=100, height=180, track="small", feature=[0, 1])] if i == 1 and variant == "second-face" else [lead]
                evaluator.observe(i, 24, f"{i:064x}", (768, 1344, 3), faces, np.array([1, 0]))
            result = evaluator.finish()
            self.assertEqual(result["status"] == "eligible", variant == "valid", variant)
            self.assertEqual(result["threshold"], .8)

    def test_numerical_factory_parity_with_original_issued_family(self):
        original, metadata, manifest, gallery = fixture(version=2)
        current, current_metadata, current_manifest, current_gallery = current_fixture()
        for variant in ["valid", "background", "geometry", "similarity", "track"]:
            old = requested_draft_filter(original, metadata, manifest, gallery)
            new = requested_draft_filter(current, current_metadata, current_manifest, current_gallery)
            for i in range(3):
                lead = face()
                if i == 1 and variant == "geometry": lead["quality"]["detectionScore"] = .899
                if i == 1 and variant == "similarity": lead["feature"] = np.array([.799, np.sqrt(1-.799**2)])
                if i == 1 and variant == "track": lead["trackId"] = "other"
                faces = [lead, face(x=20, width=180, height=220, track="background", feature=[0, 1])] if i == 1 and variant == "background" else [lead]
                for evaluator in [old, new]: evaluator.observe(i, 24, f"{i:064x}", (768, 1344, 3), copy.deepcopy(faces), np.array([1, 0]))
            left, right = old.finish(), new.finish()
            for field in ["status", "threshold", "examinedFrameCount", "eligibleFrameCount", "ambiguousFrameCount", "outOfScopeFrameCount", "samples"]:
                self.assertEqual(left[field], right[field], (variant, field))

    def test_mutated_current_policy_or_package_is_rejected(self):
        value, metadata, manifest, gallery = current_fixture()
        for mutate in [lambda v: v.update(ownerId="other"), lambda v: v["evaluationPolicy"]["body"].update(familySha256="0"*64),
            lambda v: v.update(evaluationReferenceHashes=["f"*64]), lambda v: v["references"][0].update(canonicalName="other"),
            lambda v: v["evaluationPolicy"].update(id="h3-policy-"+v["evaluationPolicy"]["sha256"])]:
            changed = copy.deepcopy(value); mutate(changed)
            with self.assertRaises(ValueError): validate_issued_policy(changed, metadata, manifest, gallery)
        legacy, metadata, manifest, gallery = current_fixture(legacy=True)
        legacy["evaluationPolicy"]["body"]["originalPolicy"]["sha256"] = "a"*64
        digest = policy_sha256(legacy["evaluationPolicy"]["body"])
        legacy["evaluationPolicy"].update(id="h3-current-policy-"+digest, sha256=digest)
        with self.assertRaisesRegex(ValueError, "historical single-face"):
            requested_draft_filter(legacy, metadata, manifest, gallery)


if __name__ == "__main__": unittest.main()
