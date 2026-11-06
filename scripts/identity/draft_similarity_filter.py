"""Opt-in, project-scoped numeric draft evidence; never an identity certificate."""
import hashlib
import json
import math
from pathlib import Path

import numpy as np

POLICY_ID = "love-me-tonight-diego-frontal-draft-v1"
POLICY_SHA256 = "f23f8186a59c3c893c043b0bba19a335d874dec9d140de54cfd98f6c824fe7d7"
POLICIES = {
    POLICY_ID: (POLICY_SHA256, "h3-ref2va-int8-v2"),
    "love-me-tonight-diego-frontal-draft-v2": ("f0250eadd801010db9885de4a6359c3c526fe6783e7dcd4a8128cbabbb3d9498", "h3-ref2va-int8-v3"),
    "love-me-tonight-valentina-frontal-draft-v1": ("589ee087db6829a53910659514b50bb1227c705ae6f7302fe2c977ccdb49d637", "h3-ref2va-int8-v3"),
}
JOINT_POLICY_ID = "love-me-tonight-diego-valentina-frontal-pair-draft-v1"
JOINT_POLICY_SHA256 = "34e9171b83d5d5fa07d4f61ed72e38efd28a13aa357f9c0413da2beca5d33e00"
FOREGROUND_POLICY_ID = "love-me-tonight-valentina-dominant-foreground-draft-v1"
FOREGROUND_POLICY_SHA256 = "185d2a89d61cbad481ae3ea45acb87d2a5c8d8e0a46f14ddcddad74068878b47"


def canonical_sha256(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()).hexdigest()


def load_policy(policy_id=POLICY_ID):
    if policy_id == FOREGROUND_POLICY_ID:
        from foreground_similarity_filter import load_foreground_policy
        return load_foreground_policy()
    if policy_id == JOINT_POLICY_ID:
        from joint_similarity_filter import load_joint_policy
        return load_joint_policy()
    if policy_id not in POLICIES: raise ValueError("Unknown draft similarity policy")
    expected_sha, generation_model = POLICIES[policy_id]
    policy = json.loads(Path(__file__).with_name("policies").joinpath(policy_id + ".json").read_text())
    if canonical_sha256(policy) != expected_sha: raise ValueError("Draft similarity policy bytes do not match the immutable policy")
    if policy["id"] != policy_id or policy.get("generationModel", "h3-ref2va-int8-v2") != generation_model:
        raise ValueError("Draft similarity policy has a different generation profile")
    return policy


def geometry_reasons(face, image_shape, scope):
    reasons = []
    quality = face["quality"]
    for field, bound in [("widthPixels", "minimumFaceWidthPixels"), ("heightPixels", "minimumFaceHeightPixels"), ("detectionScore", "minimumDetectionScore")]:
        value = quality.get(field)
        if value is None or not math.isfinite(value) or value < scope[bound]: reasons.append(bound)
    box = np.asarray(face["box"], dtype=np.float64)
    if box.size != 4 or not np.isfinite(box).all(): return reasons + ["invalid_face_box"]
    x, y, width, height = box
    image_height, image_width = image_shape[:2]
    if x < 0 or y < 0 or x+width > image_width or y+height > image_height: reasons.append("face_box_clipped")
    points = np.asarray(face.get("landmarks", []), dtype=np.float64)
    if points.size != 10 or not np.isfinite(points).all(): return reasons + ["landmarks_unavailable"]
    points = points.reshape(5, 2)
    eyes = sorted(points[:2], key=lambda point: point[0])
    eye_vector = eyes[1] - eyes[0]
    distance = float(np.linalg.norm(eye_vector))
    if distance < scope["minimumEyeDistancePixels"]: reasons.append("eye_distance_too_small")
    if distance <= 0: return reasons + ["invalid_eye_geometry"]
    across = eye_vector / distance
    down = np.array([-across[1], across[0]])
    midpoint = (eyes[0] + eyes[1]) / 2
    nose, mouth = points[2] - midpoint, (points[3] + points[4]) / 2 - midpoint
    roll = abs(math.degrees(math.atan2(across[1], across[0])))
    if roll > scope["maximumAbsoluteRollDegrees"]: reasons.append("roll_outside_scope")
    if abs(float(nose @ across / distance)) > scope["maximumAbsoluteNoseEyeMidpointOffsetOverEyeDistance"]: reasons.append("nose_yaw_proxy_outside_scope")
    if abs(float(mouth @ across / distance)) > scope["maximumAbsoluteMouthEyeMidpointOffsetOverEyeDistance"]: reasons.append("mouth_yaw_proxy_outside_scope")
    nose_depth, mouth_depth = float(nose @ down / distance), float(mouth @ down / distance)
    if not scope["minimumNoseDepthOverEyeDistance"] <= nose_depth <= scope["maximumNoseDepthOverEyeDistance"]: reasons.append("nose_depth_geometry_invalid")
    if not nose_depth < mouth_depth <= scope["maximumMouthDepthOverEyeDistance"]: reasons.append("mouth_depth_geometry_invalid")
    return reasons


def box_overlap(left, right):
    x, y = max(left[0], right[0]), max(left[1], right[1])
    width = max(0, min(left[0]+left[2], right[0]+right[2])-x)
    height = max(0, min(left[1]+left[3], right[1]+right[3])-y)
    area = width*height
    return float(area / max(1, left[2]*left[3]+right[2]*right[3]-area))


class DraftSimilarityFilter:
    def __init__(self, value, verifier_metadata, manifest, gallery_profile):
        self.value, self.policy = value, load_policy(value["draftSimilarityPolicyId"])
        policy_id = self.policy["id"]
        policy_sha, generation_model = POLICIES[policy_id]
        self.evidence = {"version": 1, "policyId": policy_id, "policySha256": policy_sha, "status": "unverifiable",
            "threshold": self.policy["threshold"], "examinedFrameCount": 0, "eligibleFrameCount": 0,
            "outOfScopeFrameCount": 0, "ambiguousFrameCount": 0, "samples": [],
            "warnings": ["Provisional numeric-model draft filter; not an identity certificate or final creative approval."]}
        identity, model = self.policy["identity"], self.policy["model"]
        reference = next((ref for ref in value["references"] if ref["hash"] == identity["rawSha256"]), None)
        hashes = {entry["sha256"] for entry in manifest["models"]}
        self.bound = (value.get("draftSimilarityPolicyId") == policy_id and value.get("projectId") == self.policy["projectId"] and value.get("draftSimilarityPolicySha256") == policy_sha
            and value.get("generationModel") == generation_model
            and value["identityReferenceHashes"] == [identity["rawSha256"]]
            and reference is not None and reference["canonicalName"] == identity["canonicalName"] and reference["role"] == identity["role"]
            and gallery_profile["sha256"] == identity["gallerySha256"]
            and verifier_metadata["version"] == model["version"] and verifier_metadata["preprocessVersion"] == model["preprocessVersion"]
            and hashes == {model["recognitionSha256"], model["detectionSha256"]})
        self.previous_box, self.previous_index, self.track_id = None, None, None
        self.unresolved = False
        self.warning_counts = {"native_blur": 0, "native_luminance_low": 0, "native_luminance_high": 0}
        if not self.bound: self.evidence["warnings"].append("Project, policy, raw authority, gallery or model binding does not match this policy.")

    def observe(self, index, fps, frame_hash, image_shape, faces, template):
        if not self.bound: return
        self.evidence["examinedFrameCount"] += 1
        sample = {"timeSeconds": index/fps, "frameSha256": frame_hash, "scores": []}
        self.evidence["samples"].append(sample)
        if len(faces) != 1:
            self.evidence["outOfScopeFrameCount"] += 1
            self.evidence["ambiguousFrameCount"] += int(len(faces) > 1)
            self.unresolved = True
            self.previous_box, self.previous_index = None, index
            return
        face = faces[0]
        scope = self.policy["scope"]
        reasons = geometry_reasons(face, image_shape, scope)
        track_changed = self.track_id is not None and self.track_id != face["trackId"]
        discontinuous = self.previous_index is not None and (index != self.previous_index+1 or self.previous_box is None
            or box_overlap(face["box"], self.previous_box) < scope["minimumConsecutiveFaceBoxIoU"])
        ambiguous = track_changed or discontinuous
        if ambiguous:
            self.evidence["ambiguousFrameCount"] += 1
            self.unresolved = True
        self.track_id = self.track_id or face["trackId"]
        self.previous_box, self.previous_index = face["box"], index
        self.evidence["outOfScopeFrameCount"] += int(bool(reasons))
        left, right = np.asarray(face["feature"], dtype=np.float32).reshape(-1), np.asarray(template, dtype=np.float32).reshape(-1)
        score = float(np.clip((left/np.linalg.norm(left)) @ (right/np.linalg.norm(right)), -1, 1))
        if not math.isfinite(score):
            self.unresolved = True
            return
        sample["scores"].append({"referenceHash": self.policy["identity"]["rawSha256"], "trackId": face["trackId"], "score": score})
        self.evidence["eligibleFrameCount"] += int(not reasons and not ambiguous and score >= self.policy["threshold"])
        warning = self.policy["acquisitionWarningsOnly"]
        quality = face["quality"]
        self.warning_counts["native_blur"] += int(quality["blurVariance"] < warning["nativeBoxBlurVarianceBelow"])
        self.warning_counts["native_luminance_low"] += int(quality["meanLuminance"] < warning["nativeBoxLuminanceBelow"])
        self.warning_counts["native_luminance_high"] += int(quality["meanLuminance"] > warning["nativeBoxLuminanceAbove"])

    def finish(self):
        expected = self.value["verifiedEndFrameExclusive"] - self.value["verifiedStartFrame"]
        if not self.bound: return self.evidence
        complete = self.evidence["examinedFrameCount"] == expected and expected >= self.policy["scope"]["minimumIntendedFrameCount"]
        if not complete or self.unresolved:
            self.evidence["status"] = "unverifiable"
            self.evidence["warnings"].append("Every intended frame and one continuous unique face track must be resolved.")
        else:
            self.evidence["status"] = "eligible" if self.evidence["eligibleFrameCount"] == expected else "ineligible"
        for name, count in self.warning_counts.items():
            if count: self.evidence["warnings"].append(f"Acquisition diagnostic warning only: {name} on {count}/{self.evidence['examinedFrameCount']} frames.")
        return self.evidence


def requested_draft_filter(value, verifier_metadata, manifest, gallery_profile):
    if value.get("issuedPolicy") is not None:
        from issued_policy import issued_draft_filter
        return issued_draft_filter(value, verifier_metadata, manifest, gallery_profile)
    if value.get("draftSimilarityPolicyId") == FOREGROUND_POLICY_ID:
        from foreground_similarity_filter import ForegroundDraftSimilarityFilter
        return ForegroundDraftSimilarityFilter(value, verifier_metadata, manifest, gallery_profile)
    if value.get("draftSimilarityPolicyId") == JOINT_POLICY_ID:
        from joint_similarity_filter import JointDraftSimilarityFilter
        return JointDraftSimilarityFilter(value, verifier_metadata, manifest, gallery_profile)
    if value.get("draftSimilarityPolicyId") not in POLICIES: return None
    return DraftSimilarityFilter(value, verifier_metadata, manifest, gallery_profile)
