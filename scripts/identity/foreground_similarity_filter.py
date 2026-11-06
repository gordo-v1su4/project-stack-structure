"""Explicit post-observation editorial dominance scope; no identity certification."""
import json
import math
from pathlib import Path

from draft_similarity_filter import (FOREGROUND_POLICY_ID, FOREGROUND_POLICY_SHA256,
    DraftSimilarityFilter, canonical_sha256, geometry_reasons, box_overlap)
from joint_similarity_filter import similarity
from failure_reasons import record_failure_reasons


def load_foreground_policy():
    policy = json.loads(Path(__file__).with_name("policies").joinpath(FOREGROUND_POLICY_ID + ".json").read_text())
    if canonical_sha256(policy) != FOREGROUND_POLICY_SHA256:
        raise ValueError("Foreground draft policy changed")
    return policy


def intersects(left, right):
    return (min(left[0]+left[2],right[0]+right[2]) > max(left[0],right[0])
        and min(left[1]+left[3],right[1]+right[3]) > max(left[1],right[1]))


class ForegroundDraftSimilarityFilter(DraftSimilarityFilter):
    def __init__(self, value, metadata, manifest, gallery):
        self.value, self.policy = value, load_foreground_policy()
        self.evidence = {"version":1,"policyId":FOREGROUND_POLICY_ID,"policySha256":FOREGROUND_POLICY_SHA256,
            "status":"unverifiable","threshold":self.policy["threshold"],"examinedFrameCount":0,
            "eligibleFrameCount":0,"outOfScopeFrameCount":0,"ambiguousFrameCount":0,"samples":[],
            "warnings":["Provisional foreground-dominance draft filter; not an identity certificate or final creative approval.",
                "Editorial scope chosen after observing this pickup; not held-out calibration. Background identities are unassessed."]}
        identity, model = self.policy["identity"], self.policy["model"]
        refs = {ref["hash"]:ref for ref in value["references"]}
        reference = refs.get(identity["rawSha256"])
        self.bound = (value.get("projectId") == self.policy["projectId"]
            and value.get("draftSimilarityPolicySha256") == FOREGROUND_POLICY_SHA256
            and value.get("generationModel") == self.policy["generationModel"]
            and value["identityReferenceHashes"] == [identity["rawSha256"]]
            and reference is not None and reference["canonicalName"] == identity["canonicalName"] and reference["role"] == "identity"
            and gallery["sha256"] == identity["gallerySha256"] and metadata["version"] == model["version"]
            and metadata["preprocessVersion"] == model["preprocessVersion"]
            and {entry["sha256"] for entry in manifest["models"]} == {model["recognitionSha256"],model["detectionSha256"]})
        self.previous_box, self.previous_index, self.track_id = None, None, None
        self.unresolved = False
        self.warning_counts = {"native_blur":0,"native_luminance_low":0,"native_luminance_high":0}
        if not self.bound: self.evidence["warnings"].append("Project, policy, raw authority, gallery or model binding does not match.")

    def observe(self, index, fps, frame_hash, image_shape, faces, template):
        if not self.bound: return
        self.evidence["examinedFrameCount"] += 1
        sample = {"timeSeconds":index/fps,"frameSha256":frame_hash,"scores":[],"candidateScores":[]}
        self.evidence["samples"].append(sample)
        dominance, scope = self.policy["foregroundDominance"], self.policy["scope"]
        if not faces or len(faces) > dominance["maximumDetectedFaceCount"]:
            self.evidence["outOfScopeFrameCount"] += 1
            self.unresolved = True
            record_failure_reasons(self, ["missing_face" if not faces else "excessive_face_count"])
            return
        if any(len(face["box"]) != 4 or not all(math.isfinite(v) for v in face["box"])
            or face["box"][2] <= 0 or face["box"][3] <= 0 for face in faces):
            self.unresolved = True
            record_failure_reasons(self, ["invalid_face_box"])
            return
        # Select only by physical box area before calculating any similarity.
        ordered = sorted(faces,key=lambda face:face["box"][2]*face["box"][3],reverse=True)
        lead, others = ordered[0], ordered[1:]
        area = lead["box"][2]*lead["box"][3]
        ambiguous = (bool(others) and others[0]["box"][2]*others[0]["box"][3] >= area)
        failure_reasons = ["lead_not_unique_largest"] if ambiguous else []
        ambiguous |= len({face["trackId"] for face in faces}) != len(faces)
        if len({face["trackId"] for face in faces}) != len(faces): failure_reasons.append("duplicate_track_id")
        reasons = geometry_reasons(lead,image_shape,scope)
        for other in others:
            box = other["box"]
            if (box[2] > lead["box"][2]*dominance["maximumBackgroundWidthRatio"]
                or box[3] > lead["box"][3]*dominance["maximumBackgroundHeightRatio"]
                or box[2]*box[3] > area*dominance["maximumBackgroundAreaRatio"]
                or intersects(box,lead["box"]) or not geometry_reasons(other,image_shape,scope)):
                reasons.append("background_outside_dominance_scope")
        scores = [similarity(face["feature"],template) for face in faces]
        if not all(math.isfinite(score) for score in scores):
            self.unresolved = True
            record_failure_reasons(self, failure_reasons + reasons + ["non_finite_similarity"])
            return
        raw = self.policy["identity"]["rawSha256"]
        sample["candidateScores"] = [{"referenceHash":raw,"trackId":face["trackId"],"score":score} for face,score in zip(faces,scores)]
        detections = [{"trackId":face["trackId"],"box":[float(v) for v in face["box"]],
            "landmarks":[float(v) for v in face["landmarks"]],"quality":{key:float(face["quality"][key]) for key in
                ["widthPixels","heightPixels","detectionScore","blurVariance","meanLuminance"]},"score":score}
            for face,score in zip(faces,scores)]
        sample["foreground"] = {"imageWidth":image_shape[1],"imageHeight":image_shape[0],"leadTrackId":lead["trackId"],"detections":detections}
        lead_score = next(score for face,score in zip(faces,scores) if face is lead)
        ambiguous |= any(lead_score-score < dominance["minimumLeadCosineMargin"] for face,score in zip(faces,scores) if face is not lead)
        if any(lead_score-score < dominance["minimumLeadCosineMargin"] for face,score in zip(faces,scores) if face is not lead): failure_reasons.append("assignment_margin")
        ambiguous |= self.track_id is not None and self.track_id != lead["trackId"]
        if self.track_id is not None and self.track_id != lead["trackId"]: failure_reasons.append("track_changed")
        ambiguous |= index != self.value["verifiedStartFrame"]+self.evidence["examinedFrameCount"]-1
        if index != self.value["verifiedStartFrame"]+self.evidence["examinedFrameCount"]-1: failure_reasons.append("frame_sequence_gap")
        if self.previous_index is not None:
            ambiguous |= index != self.previous_index+1 or box_overlap(lead["box"],self.previous_box) < scope["minimumConsecutiveFaceBoxIoU"]
            if index != self.previous_index+1 or box_overlap(lead["box"],self.previous_box) < scope["minimumConsecutiveFaceBoxIoU"]: failure_reasons.append("track_discontinuous")
        self.track_id = self.track_id or lead["trackId"]
        self.previous_box, self.previous_index = lead["box"], index
        self.unresolved |= ambiguous
        self.evidence["ambiguousFrameCount"] += int(ambiguous)
        self.evidence["outOfScopeFrameCount"] += int(bool(reasons))
        sample["scores"] = [{"referenceHash":raw,"trackId":lead["trackId"],"score":lead_score}]
        self.evidence["eligibleFrameCount"] += int(not reasons and not ambiguous and lead_score >= self.policy["threshold"])
        record_failure_reasons(self, failure_reasons + reasons + (["below_similarity_threshold"] if lead_score < self.policy["threshold"] else []))
        quality, warning = lead["quality"],self.policy["acquisitionWarningsOnly"]
        self.warning_counts["native_blur"] += int(quality["blurVariance"] < warning["nativeBoxBlurVarianceBelow"])
        self.warning_counts["native_luminance_low"] += int(quality["meanLuminance"] < warning["nativeBoxLuminanceBelow"])
        self.warning_counts["native_luminance_high"] += int(quality["meanLuminance"] > warning["nativeBoxLuminanceAbove"])
