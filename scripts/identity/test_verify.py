import copy
import hashlib
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import cv2
import numpy as np
from verify import Verifier, assess, identity_gallery_profile, unit, validate_input


class FakeVideo:
    def __init__(self, _): self.index = 0
    def isOpened(self): return True
    def get(self, field): return 3 if field == cv2.CAP_PROP_FRAME_COUNT else 24
    def read(self):
        if self.index >= 3: return False, None
        self.index += 1
        return True, np.full((8, 8, 3), self.index, dtype=np.uint8)
    def release(self): pass


class FakeVerifier:
    manifest = {"models": [{"sha256": "a" * 64}]}
    versions = {}
    missing_last = False
    duplicate_faces = False
    def __init__(self, _): pass
    def gallery(self, _): return np.array([1, 0], dtype=np.float32), {"viewCount": 1}
    def faces(self, image):
        if self.missing_last and image[0, 0, 0] == 3: return []
        face = {"box": [0, 0, 8, 8], "feature": np.array([1, 0], dtype=np.float32), "quality": {}, "qualityReasons": []}
        return [face, copy.deepcopy(face)] if self.duplicate_faces else [face]


class IdentityGateTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        root = Path(self.temporary.name)
        video, reference = root / "video.mp4", root / "reference.png"
        video.write_bytes(b"bound-video"); reference.write_bytes(b"bound-reference")
        self.ref_hash = hashlib.sha256(reference.read_bytes()).hexdigest()
        self.value = {"version": 1, "assetId": "asset", "jobId": "h3-job", "generationModel": "h3-ref2va-int8-v1",
            "videoPath": str(video), "mediaSha256": hashlib.sha256(video.read_bytes()).hexdigest(),
            "frameCount": 3, "fps": 24, "durationSeconds": 3/24, "verifiedStartFrame": 0, "verifiedEndFrameExclusive": 3,
            "generationReferenceHashes": [self.ref_hash], "identityReferenceHashes": [self.ref_hash],
            "references": [{"path": str(reference), "hash": self.ref_hash, "canonicalName": "Diego", "role": "identity"}]}
        FakeVerifier.missing_last = False; FakeVerifier.duplicate_faces = False

    def tearDown(self): self.temporary.cleanup()

    def fake_assess(self, value=None, count=None):
        with patch("verify.Verifier", FakeVerifier), patch("verify.cv2.VideoCapture", FakeVideo):
            return assess(copy.deepcopy(value or self.value), "unused", count)

    def test_perfect_scores_and_provisional_cutoff_cannot_fabricate_a_calibrated_pass(self):
        self.value["provisionalThreshold"] = .99
        report = self.fake_assess()
        self.assertEqual(report["status"], "unverifiable")
        self.assertEqual(report["coverage"], "complete")
        self.assertEqual(report["examinedFrameCount"], 3)
        self.assertTrue(all(sample["scores"][0]["score"] == 1 for sample in report["samples"]))
        self.assertIn("uncalibrated", report["verifier"]["calibrationId"])

    def test_missing_or_ambiguous_faces_abstain_instead_of_hiding_frames(self):
        FakeVerifier.missing_last = True
        report = self.fake_assess()
        self.assertEqual(report["status"], "unverifiable")
        self.assertEqual(report["unverifiableFrameCount"], 1)
        self.assertEqual(report["coverage"], "incomplete")
        FakeVerifier.missing_last = False; FakeVerifier.duplicate_faces = True
        report = self.fake_assess()
        self.assertEqual(report["ambiguousFrameCount"], 3)
        self.assertEqual(report["coverage"], "ambiguous")

    def test_sampled_diagnostics_cannot_claim_complete_trim_coverage(self):
        report = self.fake_assess(count=2)
        self.assertEqual(report["examinedFrameCount"], 2)
        self.assertEqual(report["coverage"], "incomplete")

    def test_identity_conditioning_cannot_be_disguised_as_not_required(self):
        self.value["identityReferenceHashes"] = []
        with self.assertRaisesRegex(ValueError, "ordered identity-conditioning"):
            validate_input(self.value)
        self.value["references"][0]["role"] = "environment"
        report = self.fake_assess()
        self.assertEqual(report["status"], "not_required")
        self.assertEqual(report["samples"], [])

    def test_mutated_video_or_reference_bytes_fail_before_model_inference(self):
        Path(self.value["videoPath"]).write_bytes(b"other-video")
        with self.assertRaisesRegex(ValueError, "Video bytes changed"):
            self.fake_assess()
        self.value["mediaSha256"] = hashlib.sha256(b"other-video").hexdigest()
        Path(self.value["references"][0]["path"]).write_bytes(b"other-reference")
        with self.assertRaisesRegex(ValueError, "Reference bytes changed"):
            self.fake_assess()

    def test_invalid_trim_and_out_of_image_face_regions_are_rejected(self):
        self.value["verifiedEndFrameExclusive"] = 4
        with self.assertRaisesRegex(ValueError, "half-open"):
            validate_input(self.value)
        self.value["verifiedEndFrameExclusive"] = 3
        self.value["references"][0]["faceRegions"] = [{"name": "outside", "rect": [.8, 0, .5, 1]}]
        with self.assertRaisesRegex(ValueError, "outside its image"):
            validate_input(self.value)

    def test_gallery_profile_binds_actual_regions_names_raw_bytes_and_order_without_local_paths(self):
        baseline = identity_gallery_profile(self.value)
        changed_path = copy.deepcopy(self.value)
        changed_path["references"][0]["path"] = "/another/runtime/reference.png"
        self.assertEqual(baseline, identity_gallery_profile(changed_path))
        explicit_whole = copy.deepcopy(self.value)
        explicit_whole["references"][0]["faceRegions"] = [{"name": "whole-sheet", "rect": [0., 0., 1., 1.]}]
        self.assertEqual(baseline, identity_gallery_profile(explicit_whole))
        self.value["references"][0]["faceRegions"] = [{"name": "front", "rect": [0, 0, .285, .55]}]
        cropped = identity_gallery_profile(self.value)
        self.assertNotEqual(baseline["sha256"], cropped["sha256"])
        report = self.fake_assess()
        self.assertTrue(report["verifier"]["preprocessVersion"].endswith(cropped["sha256"]))
        self.assertEqual(report["diagnostics"]["galleryProfile"], cropped)
        self.assertEqual(report["status"], "unverifiable")
        self.assertIn("uncalibrated", report["verifier"]["calibrationId"])
        for field, replacement in [("hash", "a" * 64), ("canonicalName", "Someone Else")]:
            altered = copy.deepcopy(self.value)
            altered["references"][0][field] = replacement
            if field == "hash": altered["identityReferenceHashes"] = [replacement]
            self.assertNotEqual(cropped["sha256"], identity_gallery_profile(altered)["sha256"])
        self.value["references"][0]["faceRegions"][0]["rect"][2] = .3
        self.assertNotEqual(cropped["sha256"], identity_gallery_profile(self.value)["sha256"])
        second = {**self.value["references"][0], "hash": "b" * 64, "canonicalName": "Another Identity"}
        self.value["references"].append(second)
        self.value["identityReferenceHashes"].append(second["hash"])
        ordered = identity_gallery_profile(self.value)["sha256"]
        self.value["identityReferenceHashes"].reverse()
        self.assertNotEqual(ordered, identity_gallery_profile(self.value)["sha256"])


@unittest.skipUnless(os.environ.get("IDENTITY_TEST_MODEL_DIR"), "Official model files required for the numerical preprocessing check")
class NumericalPreprocessTest(unittest.TestCase):
    def test_ort_rgb_features_match_the_official_opencv_feature_implementation(self):
        verifier = Verifier(os.environ["IDENTITY_TEST_MODEL_DIR"])
        image = np.random.default_rng(1).integers(0, 256, (160, 160, 3), dtype=np.uint8)
        face = np.array([10, 10, 112, 112, 48.2946, 61.6963, 83.5318, 61.5014, 66.0252, 81.7366, 51.5493, 102.3655, 80.7299, 102.2041, 1], dtype=np.float32)
        actual = verifier.feature(image, face)
        expected = unit(verifier.aligner.feature(verifier.aligner.alignCrop(image, face)))
        self.assertGreater(float(actual @ expected), .99999)
        self.assertLess(float(np.max(np.abs(actual-expected))), .0001)


if __name__ == "__main__": unittest.main()
