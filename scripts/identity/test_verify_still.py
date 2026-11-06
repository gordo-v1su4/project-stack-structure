import copy
import tempfile
import unittest
from pathlib import Path
import cv2
import numpy as np
from test_issued_policy import fixture, face
from issued_policy import load_family, policy_sha256, validate_issued_policy
from verify_still import decode_png, screen_spatial, assess_still
import json


def still_fixture(joint=False):
    value, metadata, manifest, gallery = fixture(joint, version=2)
    binding = {"artifactId": "h3-frame-" + "a" * 64, "descriptorSha256": "a" * 64,
        "pngSha256": "b" * 64, "preparationVersion": "first-frame-native-v1"}
    value["generationModel"] = "h3-i2va-fl2va-int8-v1"
    value["firstFrame"] = binding
    body = value["issuedPolicy"]["body"]
    body["generationModel"] = value["generationModel"]
    body["firstFrame"] = binding
    digest = policy_sha256(body)
    value["issuedPolicy"].update(id="h3-policy-" + digest, sha256=digest)
    family = load_family(body["familyId"])
    return value, metadata, manifest, gallery, family


class StillTests(unittest.TestCase):
    def test_one_png_is_not_video_or_three_temporal_samples(self):
        value, metadata, manifest, gallery, family = still_fixture()
        raw = value["identityReferenceHashes"][0]
        report = screen_spatial(value, metadata, manifest, gallery, [face()], {raw: np.array([1, 0])}, family, (768, 1344, 3))
        self.assertEqual(report["status"], "eligible")
        self.assertEqual(len(report["assignments"]), 1)
        self.assertNotIn("frameCount", report)
        self.assertNotIn("examinedFrameCount", report)

    def test_foreground_keeps_same_similarity_confidence_pose_and_background_rules(self):
        value, metadata, manifest, gallery, family = still_fixture()
        raw = value["identityReferenceHashes"][0]
        for special in [[], [face(feature=[.79, np.sqrt(1-.79**2)])], [face()], [face()], [face(), face(x=20, width=180, height=220, track="bg", feature=[0, 1])]]:
            if len(special) == 1 and special[0]["feature"][0] > .8:
                special[0]["quality"]["detectionScore"] = .899
            result = screen_spatial(value, metadata, manifest, gallery, special, {raw: np.array([1, 0])}, family, (768, 1344, 3))
            self.assertNotEqual(result["status"], "eligible")
        turned = face(); turned["landmarks"][4] += 80
        self.assertNotEqual(screen_spatial(value, metadata, manifest, gallery, [turned], {raw: np.array([1, 0])}, family, (768, 1344, 3))["status"], "eligible")

    def test_joint_requires_two_real_faces_and_unique_row_column_margin(self):
        value, metadata, manifest, gallery, family = still_fixture(True)
        one, two = value["identityReferenceHashes"]
        templates = {one: np.array([1, 0]), two: np.array([0, 1])}
        good = [face(x=200, feature=[1, 0]), face(x=700, track="second", feature=[0, 1])]
        self.assertEqual(screen_spatial(value, metadata, manifest, gallery, good, templates, family, (768, 1344, 3))["status"], "eligible")
        self.assertNotEqual(screen_spatial(value, metadata, manifest, gallery, good[:1], templates, family, (768, 1344, 3))["status"], "eligible")
        ambiguous = [face(x=200, feature=[1, 1]), face(x=700, feature=[1, 1])]
        self.assertEqual(screen_spatial(value, metadata, manifest, gallery, ambiguous, templates, family, (768, 1344, 3))["status"], "unverifiable")

    def test_first_frame_policy_cannot_relabel_reference_only_or_change_pixels(self):
        value, metadata, manifest, gallery, _ = still_fixture()
        validate_issued_policy(value, metadata, manifest, gallery)
        for mutate in [lambda v: v["firstFrame"].update(pngSha256="f"*64), lambda v: v.update(generationModel="h3-ref2va-int8-v3")]:
            changed = copy.deepcopy(value); mutate(changed)
            with self.assertRaises(ValueError): validate_issued_policy(changed, metadata, manifest, gallery)

    def test_decode_native_pixels_does_not_resize_or_accept_alpha(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "native.png"
            native = np.zeros((768, 1344, 3), np.uint8)
            cv2.imwrite(str(path), native)
            decoded, binding = decode_png(path)
            self.assertTrue(np.array_equal(decoded, native))
            self.assertEqual((binding["width"], binding["height"]), (1344, 768))
            cv2.imwrite(str(path), np.zeros((948, 1659, 3), np.uint8))
            with self.assertRaises(ValueError): decode_png(path)
            cv2.imwrite(str(path), np.zeros((768, 1344, 4), np.uint8))
            with self.assertRaises(ValueError): decode_png(path)

    def test_actual_native_canary_one_image_matches_original_video_sample(self):
        source = Path(".tmp/identity-audit/i2va-production-still-fixture/input.json")
        canonical = Path(".tmp/zero-footage-identity-canary-v3/live-h3-observation/h3-183013d4924535cc6b5c03557962e7d36f8c8b7f24935b1d34b0dac63a4cf1e2.job.json")
        models = Path(".tmp/identity-audit/models")
        if not source.is_file() or not canonical.is_file() or not models.is_dir(): self.skipTest("Optional native canary fixture unavailable")
        value = json.loads(source.read_text())
        if not Path(value["imagePath"]).is_file() or not all(Path(ref["path"]).is_file() for ref in value["references"]): self.skipTest("Optional native pixels unavailable")
        result = assess_still(value, str(models))
        original = json.loads(canonical.read_text())["result"]["asset"]["identityVerification"]["draftSimilarityFilter"]
        sample = next(sample for sample in original["samples"] if abs(sample["timeSeconds"] * 24 - 32) < 1e-6)
        self.assertEqual(result["kind"], "single-image")
        self.assertEqual(result["status"], "eligible")
        self.assertAlmostEqual(result["spatialEvidence"]["assignments"][0]["score"], sample["scores"][0]["score"], places=7)


if __name__ == "__main__": unittest.main()
