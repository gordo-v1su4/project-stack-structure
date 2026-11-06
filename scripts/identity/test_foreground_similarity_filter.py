import copy
import unittest
import numpy as np
from draft_similarity_filter import FOREGROUND_POLICY_ID, FOREGROUND_POLICY_SHA256, requested_draft_filter, canonical_sha256, geometry_reasons
from foreground_similarity_filter import load_foreground_policy


class ForegroundFilterTests(unittest.TestCase):
    def setUp(self):
        self.policy=load_foreground_policy()
        self.raw=self.policy["identity"]["rawSha256"]
        self.value={"projectId":self.policy["projectId"],"draftSimilarityPolicyId":FOREGROUND_POLICY_ID,
            "draftSimilarityPolicySha256":FOREGROUND_POLICY_SHA256,"generationModel":"h3-ref2va-int8-v3",
            "identityReferenceHashes":[self.raw],"references":[{"hash":self.raw,"canonicalName":"Valentina","role":"identity"}],
            "verifiedStartFrame":0,"verifiedEndFrameExclusive":3}
        self.metadata={"version":self.policy["model"]["version"],"preprocessVersion":self.policy["model"]["preprocessVersion"]}
        self.manifest={"models":[{"sha256":self.policy["model"][key]} for key in ["recognitionSha256","detectionSha256"]]}
        self.gallery={"sha256":self.policy["identity"]["gallerySha256"]}
        self.lead=self.face(300,20,240,344,"lead",.85,.97)
        self.background=self.face(20,200,100,180,"background",.1,.88)

    def face(self,x,y,width,height,track,score,confidence):
        return {"box":[x,y,width,height],"trackId":track,"feature":np.array([score,np.sqrt(1-score**2)]),
            "quality":{"widthPixels":width,"heightPixels":height,"detectionScore":confidence,"blurVariance":35,"meanLuminance":55},
            "landmarks":[x+.28*width,y+.25*height,x+.72*width,y+.25*height,x+.5*width,y+.5*height,
                x+.35*width,y+.7*height,x+.65*width,y+.7*height]}

    def create(self,value=None,metadata=None,manifest=None,gallery=None):
        return requested_draft_filter(value or self.value,metadata or self.metadata,manifest or self.manifest,gallery or self.gallery)

    def run_frames(self,special=None):
        evaluator=self.create()
        for index in range(3):
            faces=copy.deepcopy([self.lead,self.background] if index != 1 or special is None else special)
            evaluator.observe(index,24,f"{index:064x}",(768,1344,3),faces,np.array([1,0]))
        return evaluator.finish()

    def test_immutable_exact_binding_and_post_observation_disclosure(self):
        self.assertEqual(canonical_sha256(self.policy),FOREGROUND_POLICY_SHA256)
        self.assertEqual(self.policy["threshold"],.8)
        self.assertEqual(self.policy["preserveIdentityVerificationStatus"],"unverifiable")
        self.assertIn("after observing",self.policy["scopeDecisionBasis"])
        for change in [{"projectId":"other"},{"generationModel":"h3-ref2va-int8-v2"},{"draftSimilarityPolicySha256":"a"*64},
            {"identityReferenceHashes":["a"*64]},{"identityReferenceHashes":[self.raw,"a"*64]},
            {"references":[{"hash":self.raw,"canonicalName":"Other","role":"identity"}]}]:
            self.assertEqual(self.create({**self.value,**change}).finish()["status"],"unverifiable")
        self.assertEqual(self.create(gallery={"sha256":"a"*64}).finish()["status"],"unverifiable")
        self.assertEqual(self.create(metadata={**self.metadata,"preprocessVersion":"other"}).finish()["status"],"unverifiable")
        self.assertEqual(self.create(manifest={"models":[]}).finish()["status"],"unverifiable")

    def test_complete_foreground_and_background_evidence_with_unchanged_lead_scope(self):
        evidence=self.run_frames()
        self.assertEqual(evidence["status"],"eligible")
        self.assertEqual(evidence["eligibleFrameCount"],3)
        sample=evidence["samples"][0]
        self.assertEqual(sample["scores"][0]["trackId"],"lead")
        self.assertEqual(len(sample["candidateScores"]),2)
        self.assertEqual(sample["foreground"]["detections"][1]["box"],self.background["box"])
        self.assertEqual(len(sample["foreground"]["detections"][1]["landmarks"]),10)
        self.assertEqual(self.run_frames(list(reversed([self.lead,self.background])))["status"],"eligible")
        self.assertEqual(self.run_frames([self.lead])["status"],"eligible")

    def test_background_width_height_area_and_intersection_boundaries_fail_closed(self):
        for background in [self.face(20,200,145,180,"background",.1,.88),
            self.face(20,200,100,207,"background",.1,.88),
            self.face(20,200,144,200,"background",.1,.88),
            self.face(290,200,100,180,"background",.1,.88)]:
            self.assertEqual(self.run_frames([self.lead,background])["status"],"ineligible")
        # Inclusive width/height caps still obey the independent area cap.
        self.assertEqual(self.run_frames([self.lead,self.face(20,200,144,190,"background",.1,.88)])["status"],"eligible")

    def test_second_qualified_face_is_forbidden_even_within_relative_size_limits(self):
        qualified=self.face(20,200,140,190,"background",.1,.97)
        self.assertEqual(geometry_reasons(qualified,(768,1344,3),self.policy["scope"]),[])
        self.assertEqual(self.run_frames([self.lead,qualified])["status"],"ineligible")
        low_conf_large=self.face(20,200,180,220,"background",.1,.4)
        self.assertEqual(self.run_frames([self.lead,low_conf_large])["status"],"ineligible")

    def test_duplicate_or_high_similarity_background_never_passes_and_size_selects_before_score(self):
        for score in [.71,.9]:
            background=self.face(20,200,100,180,"background",score,.88)
            evidence=self.run_frames([self.lead,background])
            self.assertEqual(evidence["status"],"unverifiable")
            self.assertEqual(evidence["samples"][1]["scores"][0]["trackId"],"lead")

    def test_lead_geometry_low_score_missing_face_and_track_switch_never_pass(self):
        for special in [[{**self.lead,"feature":np.array([.79,np.sqrt(1-.79**2)])},self.background],
            [self.face(300,20,120,150,"lead",.85,.97),self.background],
            [{**self.lead,"quality":{**self.lead["quality"],"detectionScore":.93}},self.background],
            [self.face(-10,20,240,344,"lead",.85,.97),self.background]]:
            self.assertNotEqual(self.run_frames(special)["status"],"eligible")
        for special in [[],[self.background],[{**self.lead,"trackId":"other"},self.background],
            [self.face(900,20,240,344,"lead",.85,.97),self.background]]:
            self.assertNotEqual(self.run_frames(special)["status"],"eligible")
        evaluator=self.create()
        for index in [0,2]: evaluator.observe(index,24,f"{index:064x}",(768,1344,3),[self.lead,self.background],np.array([1,0]))
        self.assertEqual(evaluator.finish()["status"],"unverifiable")


if __name__ == "__main__": unittest.main()
