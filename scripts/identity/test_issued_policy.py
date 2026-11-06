import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

from issued_policy import FAMILIES, canonical_json, load_family, policy_sha256, validate_issued_policy
from draft_similarity_filter import requested_draft_filter
from prepare_policy import prepare, face_regions
from verify import identity_gallery_profile


def face(x=300, y=20, width=240, height=344, track="lead", feature=None):
    return {"box": [x, y, width, height], "trackId": track,
        "feature": np.array([.85, np.sqrt(1-.85**2)]) if feature is None else np.array(feature),
        "quality": {"widthPixels": width, "heightPixels": height, "detectionScore": .97, "blurVariance": 35, "meanLuminance": 55},
        "landmarks": [x+.28*width, y+.25*height, x+.72*width, y+.25*height, x+.5*width, y+.5*height,
            x+.35*width, y+.7*height, x+.65*width, y+.7*height]}


def fixture(joint=False, version=1):
    family = load_family(f"sface-yunet-{'joint' if joint else 'foreground'}-frontal-v{version}")
    refs = [{"assetId": "ref-"+str(i), "canonicalName": name, "rawSha256": str(i+1)*64, "role": "identity",
        "bucket": "media", "objectKey": "media-uploads/owner/"+str(i), "version": "v1", "etag": '"immutable"'}
        for i, name in enumerate(["Renée", "Second Lead"] if joint else ["Renée"])]
    local = [{"hash": ref["rawSha256"], "canonicalName": ref["canonicalName"], "role": "identity",
        "faceRegions": [{"name": "frontal-1", "rect": [0.0, 0.0, .5, .5]}]} for ref in refs]
    hashes = [ref["rawSha256"] for ref in refs]
    gallery = identity_gallery_profile({"references": local, "identityReferenceHashes": hashes})
    preprocess = family["model"]["preprocessBaseVersion"]+"-gallery-v2-"+gallery["sha256"]
    galleries = [{"referenceAssetId": ref["assetId"], "canonicalName": ref["canonicalName"], "rawSha256": ref["rawSha256"],
        "faceRegions": local[i]["faceRegions"], "referenceValidation": {"method": family["referencePreparation"]["method"],
            "detectedFaceCount": 1, "frontalAnchorCount": 1, "selectedRegionCount": 1, "evidenceSha256": "e"*64}} for i, ref in enumerate(refs)]
    body = {"version": 1, "ownerId": "owner", "projectId": "new-project", "generationModel": "h3-ref2va-int8-v3",
        "familyId": family["id"], "familySha256": family["sha256"], "references": refs,
        "identityReferenceHashes": hashes, "galleries": galleries, "galleryProfileSha256": gallery["sha256"], "preprocessVersion": preprocess}
    digest = policy_sha256(body)
    issued = {"version": 1, "id": "h3-policy-"+digest, "sha256": digest, "familyId": family["id"], "familySha256": family["sha256"], "body": body}
    value = {"issuedPolicy": issued, "ownerId": "owner", "projectId": "new-project", "generationModel": "h3-ref2va-int8-v3",
        "generationReferenceHashes": hashes, "identityReferenceHashes": hashes, "references": local,
        "verifiedStartFrame": 0, "verifiedEndFrameExclusive": 3}
    metadata = {"version": family["model"]["verifierVersion"], "preprocessVersion": preprocess,
        "method": family["model"]["method"], "model": family["model"]["model"], "modelSha256": family["model"]["recognitionSha256"]}
    manifest = {"models": [{"sha256": family["model"][key]} for key in ["recognitionSha256", "detectionSha256"]]}
    return value, metadata, manifest, gallery


class IssuedPolicyTests(unittest.TestCase):
    def test_family_hashes_and_utf8_integral_float_canonicalization(self):
        for name, digest in FAMILIES.items():
            family = load_family(name)
            self.assertEqual(policy_sha256({key: value for key, value in family.items() if key != "sha256"}), digest)
        self.assertEqual(canonical_json({"é": [0.0, 1.0], "a": "Renée"}), '{"a":"Renée","é":[0,1]}')
        self.assertEqual(policy_sha256({"x": -0.0}), policy_sha256({"x": 0}))
        with self.assertRaises(ValueError): policy_sha256({"x": float("nan")})

    def test_unknown_project_and_named_reference_work_without_hardcoded_identity(self):
        value, metadata, manifest, gallery = fixture()
        evaluator = requested_draft_filter(value, metadata, manifest, gallery)
        for i in range(3): evaluator.observe(i, 24, f"{i:064x}", (768, 1344, 3), [face()], np.array([1, 0]))
        evidence = evaluator.finish()
        self.assertEqual(evidence["status"], "eligible")
        self.assertEqual(evidence["eligibleFrameCount"], 3)
        self.assertEqual(evidence["policyId"], value["issuedPolicy"]["id"])

    def test_issued_binding_rejects_owner_project_raw_name_model_gallery_and_digest_changes(self):
        original, metadata, manifest, gallery = fixture()
        for mutate in [lambda v: v.update(ownerId="other"), lambda v: v.update(projectId="other"),
            lambda v: v.update(generationModel="h3-ref2va-int8-v2"),
            lambda v: v["references"][0].update(canonicalName="Other"),
            lambda v: v["references"][0].update(hash="f"*64),
            lambda v: v["references"][0]["faceRegions"][0].update(rect=[.1, 0, .5, .5]),
            lambda v: v["issuedPolicy"].update(sha256="a"*64),
            lambda v: v["issuedPolicy"]["body"].update(familySha256="b"*64)]:
            value = copy.deepcopy(original); mutate(value)
            with self.assertRaises(ValueError): validate_issued_policy(value, metadata, manifest, gallery)
        with self.assertRaises(ValueError): validate_issued_policy(original, {**metadata, "modelSha256": "0"*64}, manifest, gallery)
        with self.assertRaises(ValueError): validate_issued_policy(original, metadata, {"models": []}, gallery)
        with self.assertRaises(ValueError): validate_issued_policy(original, metadata, manifest, {"sha256": "0"*64})

    def test_missing_frames_background_bounds_and_low_similarity_fail_closed(self):
        value, metadata, manifest, gallery = fixture()
        for special in [[], [face(feature=[.79, np.sqrt(1-.79**2)])], [face(), face(x=20, width=180, height=220, track="background", feature=[0, 1])]]:
            evaluator = requested_draft_filter(value, metadata, manifest, gallery)
            for i in range(3): evaluator.observe(i, 24, f"{i:064x}", (768, 1344, 3), [face()] if i != 1 else special, np.array([1, 0]))
            self.assertNotEqual(evaluator.finish()["status"], "eligible")

    def test_joint_family_keeps_two_unique_continuous_bijection_tracks(self):
        value, metadata, manifest, gallery = fixture(joint=True)
        evaluator = requested_draft_filter(value, metadata, manifest, gallery)
        templates = {value["identityReferenceHashes"][0]: np.array([1, 0]), value["identityReferenceHashes"][1]: np.array([0, 1])}
        for i in range(3): evaluator.observe(i, 24, f"{i:064x}", (768, 1344, 3),
            [face(x=200, track="one", feature=[1, 0]), face(x=700, track="two", feature=[0, 1])], templates)
        self.assertEqual(evaluator.finish()["status"], "eligible")
        self.assertEqual(len(evaluator.evidence["samples"][0]["candidateScores"]), 4)

    def test_absent_opt_in_preserves_no_policy_behavior(self):
        value, metadata, manifest, gallery = fixture(); value.pop("issuedPolicy")
        self.assertIsNone(requested_draft_filter(value, metadata, manifest, gallery))


class PreflightTests(unittest.TestCase):
    def setUp(self): self.family = load_family("sface-yunet-foreground-frontal-v1")

    def test_no_anchor_excess_faces_and_incoherent_views_stop_before_generation(self):
        class Fake:
            def __init__(self, values): self.values = iter(values)
            def faces(self, image): return next(self.values)
        image = np.zeros((768, 1344, 3), dtype=np.uint8)
        self.assertEqual(face_regions(Fake([[]]), image, self.family)[1], "no-frontal-anchor")
        self.assertEqual(face_regions(Fake([[face()]*33]), image, self.family)[1], "ambiguous-gallery")
        seed1, seed2 = face(x=100), face(x=700)
        roi1, roi2 = face(x=72, y=86, feature=[1, 0]), face(x=72, y=86, feature=[0, 1])
        # Crop height is516px, so this whole344px face fits and retains native geometry.
        self.assertEqual(face_regions(Fake([[seed1, seed2], [roi1], [roi2]]), image, self.family)[1], "incoherent-gallery")

    def test_exact_raw_hash_and_family_required_before_detector_runs(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/"image.png"; cv2.imwrite(str(path), np.zeros((768, 1344, 3), dtype=np.uint8))
            ref = {"assetId": "new", "canonicalName": "New Lead", "rawSha256": hashlib.sha256(path.read_bytes()).hexdigest(), "role": "identity", "localPath": str(path)}
            value = {"version": 1, "bindingSha256": "c"*64, "family": self.family, "references": [ref]}
            class Empty:
                def faces(self, image): return []
            self.assertEqual(prepare(value, "unused", Empty())["reason"], "no-frontal-anchor")
            changed = copy.deepcopy(value); changed["references"][0]["rawSha256"] = "b"*64
            self.assertEqual(prepare(changed, "unused", object())["reason"], "invalid-reference")
            changed = copy.deepcopy(value); changed["family"]["threshold"] = .79
            self.assertEqual(prepare(changed, "unused", object())["reason"], "invalid-reference")

    def test_actual_raw_sheet_preflight_and_issued_cli_fixture_keep_parent_unverifiable(self):
        source = Path(".tmp/identity-audit/issued-preflight-valentina-input.json")
        models = Path(".tmp/identity-audit/models")
        if not source.is_file() or not models.is_dir(): self.skipTest("Local approved raw reference and pinned models unavailable")
        value = json.loads(source.read_text())
        if not all(Path(ref["localPath"]).is_file() for ref in value["references"]): self.skipTest("Local raw files unavailable")
        first, second = prepare(value, str(models)), prepare(value, str(models))
        self.assertEqual(first, second)
        self.assertEqual(first["status"], "ready")
        self.assertEqual(len(first["galleries"][0]["faceRegions"]), 1)
        verification = Path(".tmp/identity-audit/issued-valentina-verification-input.json")
        if verification.is_file():
            from verify import assess
            report = assess(json.loads(verification.read_text()), str(models))
            self.assertEqual(report["status"], "unverifiable")
            self.assertEqual(report["draftSimilarityFilter"]["examinedFrameCount"], 59)
            self.assertEqual(report["issuedPolicy"]["body"]["galleryProfileSha256"], first["galleryProfileSha256"])


if __name__ == "__main__": unittest.main()
