import copy
import unittest
from unittest.mock import patch
import numpy as np
from draft_similarity_filter import JOINT_POLICY_ID, JOINT_POLICY_SHA256, requested_draft_filter, canonical_sha256
from joint_similarity_filter import load_joint_policy
from verify import assess, identity_gallery_profile


class JointFilterTests(unittest.TestCase):
    def setUp(self):
        self.policy = load_joint_policy()
        self.hashes = [identity["rawSha256"] for identity in self.policy["identities"]]
        self.refs = [{"hash": raw, "canonicalName": identity["canonicalName"], "role": "identity", "faceRegions": regions}
            for raw, identity, regions in zip(self.hashes, self.policy["identities"], [
                [{"name":"front","rect":[0,0,.285,.55]}, {"name":"three-quarter","rect":[.285,0,.25,.55]}, {"name":"upper-body","rect":[0,.55,.5,.365]}],
                [{"name":"front","rect":[.267,0,.241,.508]}, {"name":"three-quarter","rect":[.509,0,.24,.508]}, {"name":"full-body","rect":[0,0,.266,.938]}]])]
        self.value = {"projectId": self.policy["projectId"], "draftSimilarityPolicyId": JOINT_POLICY_ID,
            "draftSimilarityPolicySha256": JOINT_POLICY_SHA256, "generationModel": "h3-ref2va-int8-v3",
            "identityReferenceHashes": self.hashes, "references": self.refs, "verifiedStartFrame":0,"verifiedEndFrameExclusive":3}
        self.templates = dict(zip(self.hashes, [np.array([1,0,0]),np.array([0,1,0])]))
        self.faces = [self.face(20, "face-0", [.9,.1,np.sqrt(.18)]), self.face(300, "face-1", [.1,.9,np.sqrt(.18)])]

    def face(self, x, track, feature):
        return {"box":[x,20,180,220],"trackId":track,"feature":np.array(feature),
            "quality":{"widthPixels":180,"heightPixels":220,"detectionScore":.97,"blurVariance":35,"meanLuminance":55},
            "landmarks":[x+50,80,x+130,80,x+90,130,x+65,170,x+115,170]}

    def create(self, value=None, gallery=None, metadata=None, manifest=None):
        value = value or self.value
        binding = next((b for b in self.policy["galleryBindings"] if b["identityReferenceHashes"] == value["identityReferenceHashes"]), self.policy["galleryBindings"][0])
        return requested_draft_filter(value, metadata or {"version":self.policy["model"]["version"],"preprocessVersion":binding["preprocessVersion"]},
            manifest or {"models":[{"sha256":self.policy["model"][key]} for key in ["recognitionSha256","detectionSha256"]]},
            gallery or identity_gallery_profile(value))

    def run_frames(self, special=None, templates=None):
        evaluator=self.create()
        for index in range(3):
            faces=copy.deepcopy(self.faces if index != 1 or special is None else special)
            evaluator.observe(index,24,f"{index:064x}",(500,700,3),faces,templates or self.templates)
        return evaluator.finish()

    def test_exact_gallery_order_and_policy_pins_match_runtime_both_orders(self):
        self.assertEqual(canonical_sha256(self.policy),JOINT_POLICY_SHA256)
        for binding in self.policy["galleryBindings"]:
            value={**self.value,"identityReferenceHashes":binding["identityReferenceHashes"]}
            self.assertEqual(identity_gallery_profile(value)["sha256"],binding["gallerySha256"])
            evaluator=self.create(value)
            for index in range(3): evaluator.observe(index,24,f"{index:064x}",(500,700,3),self.faces,self.templates)
            self.assertEqual(evaluator.finish()["status"],"eligible")
        for change in [{"projectId":"other"},{"generationModel":"h3-ref2va-int8-v2"},{"draftSimilarityPolicySha256":"a"*64},
            {"identityReferenceHashes":[self.hashes[0]]}, {"identityReferenceHashes":[self.hashes[0]]*2},
            {"references":[{**self.refs[0],"canonicalName":"Other"},self.refs[1]]}]:
            self.assertEqual(self.create({**self.value,**change}).finish()["status"],"unverifiable")
        self.assertEqual(self.create(gallery={"sha256":"a"*64}).finish()["status"],"unverifiable")
        self.assertEqual(self.create(metadata={"version":"changed","preprocessVersion":"changed"}).finish()["status"],"unverifiable")
        self.assertEqual(self.create(manifest={"models":[]}).finish()["status"],"unverifiable")

    def test_two_full_tracks_and_all_four_candidate_scores_are_required_without_changing_identity_status(self):
        result=self.run_frames()
        self.assertEqual(result["status"],"eligible")
        self.assertEqual(result["eligibleFrameCount"],3)
        self.assertEqual(len(result["samples"][0]["scores"]),2)
        self.assertEqual(len(result["samples"][0]["candidateScores"]),4)
        self.assertEqual(self.policy["preserveIdentityVerificationStatus"],"unverifiable")
        self.assertTrue(any("face observations" in warning for warning in result["warnings"]))
        self.assertEqual(self.run_frames(list(reversed(self.faces)))["status"],"eligible")

    def test_missing_person_duplicate_identity_ambiguous_assignment_and_extra_face_never_pass(self):
        duplicate=[self.faces[0],{**self.faces[1],"feature":self.faces[0]["feature"]}]
        ambiguous=[{**face,"feature":np.array([.7,.7,np.sqrt(.02)])} for face in self.faces]
        for faces in [[],self.faces[:1],duplicate,ambiguous,self.faces+[self.faces[0]]]:
            self.assertNotEqual(self.run_frames(faces)["status"],"eligible")
        self.assertNotEqual(self.run_frames(templates={self.hashes[0]:self.templates[self.hashes[0]]})["status"],"eligible")

    def test_low_score_small_face_nonfrontal_face_and_missing_frame_fail(self):
        for change in [{"feature":np.array([.1,.79,np.sqrt(1-.01-.79**2)])},
            {"quality":{**self.faces[1]["quality"],"widthPixels":90}},
            {"landmarks":[350,80,430,80,425,130,365,170,415,170]}]:
            self.assertEqual(self.run_frames([self.faces[0],{**self.faces[1],**change}])["status"],"ineligible")
        evaluator=self.create()
        for index in [0,2]: evaluator.observe(index,24,f"{index:064x}",(500,700,3),self.faces,self.templates)
        self.assertEqual(evaluator.finish()["status"],"unverifiable")

    def test_track_reassignment_crossing_and_discontinuity_never_pass(self):
        for faces in [[{**self.faces[0],"trackId":"face-1"},{**self.faces[1],"trackId":"face-0"}],
            [{**self.faces[0],"trackId":"face-1"},self.faces[1]],
            [{**self.faces[0],"box":self.faces[1]["box"]},{**self.faces[1],"box":self.faces[0]["box"]}],
            [{**self.faces[0],"box":[20,300,180,190]},self.faces[1]]]:
            self.assertEqual(self.run_frames(faces)["status"],"unverifiable")

    def test_assess_routes_both_distinct_templates_and_preserves_parent_unverifiable(self):
        import cv2
        owner = self
        class FakeVerifier:
            versions = {}
            manifest = {"models":[{"sha256":owner.policy["model"][key]} for key in ["recognitionSha256","detectionSha256"]]}
            def __init__(self, _): pass
            def gallery(self, reference): return owner.templates[reference["hash"]], {"viewCount":3}
            def faces(self, image):
                faces = copy.deepcopy(owner.faces)
                for face in faces:
                    face.pop("trackId")
                    face["qualityReasons"] = []
                return faces
        class FakeVideo:
            def __init__(self, _): self.index = 0
            def isOpened(self): return True
            def get(self, field): return 3 if field == cv2.CAP_PROP_FRAME_COUNT else 24
            def read(self):
                self.index += 1
                return (True,np.full((500,700,3),self.index,dtype=np.uint8)) if self.index <= 3 else (False,None)
            def release(self): pass
        for ordered in [self.hashes,list(reversed(self.hashes))]:
            refs = [{**next(ref for ref in self.refs if ref["hash"] == raw),"path":raw} for raw in ordered]
            value = {**self.value,"version":1,"assetId":"asset","jobId":"h3-job","videoPath":"video",
                "mediaSha256":"c"*64,"frameCount":3,"fps":24,"durationSeconds":.125,
                "generationReferenceHashes":ordered,"identityReferenceHashes":ordered,"references":refs}
            with patch("verify.Verifier",FakeVerifier), patch("verify.cv2.VideoCapture",FakeVideo), patch("verify.sha256_file",lambda path: "c"*64 if path == "video" else path):
                report = assess(value,"unused")
            self.assertEqual(report["status"],"unverifiable")
            self.assertEqual(report["draftSimilarityFilter"]["status"],"eligible")
            self.assertEqual(len(report["draftSimilarityFilter"]["samples"]),3)
            self.assertEqual({score["referenceHash"] for score in report["draftSimilarityFilter"]["samples"][0]["scores"]},set(self.hashes))


if __name__ == "__main__": unittest.main()
