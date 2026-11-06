"""Project-local two-person numeric draft screen. Never certifies identity."""
import json
import math
from pathlib import Path

import numpy as np
from draft_similarity_filter import JOINT_POLICY_ID, JOINT_POLICY_SHA256, canonical_sha256, geometry_reasons, box_overlap


def load_joint_policy():
    policy = json.loads(Path(__file__).with_name("policies").joinpath(JOINT_POLICY_ID + ".json").read_text())
    if canonical_sha256(policy) != JOINT_POLICY_SHA256:
        raise ValueError("Joint draft policy changed")
    return policy


def similarity(left, right):
    left, right = np.asarray(left, dtype=np.float32).reshape(-1), np.asarray(right, dtype=np.float32).reshape(-1)
    if left.shape != right.shape or not np.isfinite(left).all() or not np.isfinite(right).all(): return float("nan")
    if np.linalg.norm(left) <= 0 or np.linalg.norm(right) <= 0: return float("nan")
    return float(np.clip((left/np.linalg.norm(left)) @ (right/np.linalg.norm(right)), -1, 1))


class JointDraftSimilarityFilter:
    def __init__(self, value, metadata, manifest, gallery):
        self.value, self.policy = value, load_joint_policy()
        self.evidence = {"version": 1, "policyId": JOINT_POLICY_ID, "policySha256": JOINT_POLICY_SHA256,
            "status": "unverifiable", "threshold": self.policy["threshold"], "examinedFrameCount": 0,
            "eligibleFrameCount": 0, "outOfScopeFrameCount": 0, "ambiguousFrameCount": 0, "samples": [],
            "warnings": ["Provisional two-person numeric-model draft filter; not an identity certificate or final creative approval."]}
        self.identities = self.policy["identities"]
        self.hashes = [identity["rawSha256"] for identity in self.identities]
        binding = next((entry for entry in self.policy["galleryBindings"] if entry["identityReferenceHashes"] == value["identityReferenceHashes"]), None)
        refs = {ref["hash"]: ref for ref in value["references"]}
        model = self.policy["model"]
        self.bound = (value.get("projectId") == self.policy["projectId"]
            and value.get("draftSimilarityPolicySha256") == JOINT_POLICY_SHA256
            and value.get("generationModel") == self.policy["generationModel"] and binding is not None
            and gallery["sha256"] == binding["gallerySha256"]
            and metadata["version"] == model["version"] and metadata["preprocessVersion"] == binding["preprocessVersion"]
            and {entry["sha256"] for entry in manifest["models"]} == {model["recognitionSha256"], model["detectionSha256"]}
            and all(raw in refs and refs[raw]["role"] == "identity" and refs[raw]["canonicalName"] == identity["canonicalName"]
                for raw, identity in zip(self.hashes, self.identities)))
        self.previous, self.previous_index, self.tracks = None, None, None
        self.unresolved = False
        self.warning_counts = {"native_blur": 0, "native_luminance_low": 0, "native_luminance_high": 0}
        if not self.bound: self.evidence["warnings"].append("Project, joint policy, raw authorities, galleries or model binding does not match.")

    def observe(self, index, fps, frame_hash, image_shape, faces, templates):
        if not self.bound: return
        self.evidence["examinedFrameCount"] += 1
        sample = {"timeSeconds": index/fps, "frameSha256": frame_hash, "scores": [], "candidateScores": []}
        self.evidence["samples"].append(sample)
        if index != self.value["verifiedStartFrame"]+self.evidence["examinedFrameCount"]-1:
            self.unresolved = True
        if len(faces) != 2 or any(raw not in templates for raw in self.hashes):
            self.evidence["outOfScopeFrameCount"] += 1
            self.unresolved = True
            return
        matrix = [[similarity(face["feature"], templates[raw]) for face in faces] for raw in self.hashes]
        if not all(math.isfinite(score) for row in matrix for score in row):
            self.unresolved = True
            return
        sample["candidateScores"] = [{"referenceHash": raw, "trackId": face["trackId"], "score": matrix[ri][fi]}
            for ri, raw in enumerate(self.hashes) for fi, face in enumerate(faces)]
        # Enumerate both bijections; never assign identities greedily or by screen position.
        order = [0, 1] if matrix[0][0]+matrix[1][1] >= matrix[0][1]+matrix[1][0] else [1, 0]
        assigned = [faces[fi] for fi in order]
        margin = self.policy["scope"]["minimumAssignmentCosineMargin"]
        ambiguous = any(matrix[ri][fi]-matrix[ri][1-fi] < margin
            or matrix[ri][fi]-matrix[1-ri][fi] < margin for ri, fi in enumerate(order))
        tracks = [face["trackId"] for face in assigned]
        ambiguous |= len(set(tracks)) != 2 or (self.tracks is not None and tracks != self.tracks)
        if self.previous is not None:
            ambiguous |= index != self.previous_index+1
            for ri, face in enumerate(assigned):
                own = box_overlap(face["box"], self.previous[ri]["box"])
                cross = box_overlap(face["box"], self.previous[1-ri]["box"])
                ambiguous |= own < self.policy["scope"]["minimumConsecutiveFaceBoxIoU"] or own <= cross
        reasons = [geometry_reasons(face, image_shape, self.policy["scope"]) for face in assigned]
        self.evidence["outOfScopeFrameCount"] += int(any(reasons))
        self.evidence["ambiguousFrameCount"] += int(ambiguous)
        self.unresolved |= ambiguous
        self.tracks = self.tracks or tracks
        self.previous, self.previous_index = assigned, index
        sample["scores"] = [{"referenceHash": raw, "trackId": face["trackId"], "score": matrix[ri][order[ri]]}
            for ri, (raw, face) in enumerate(zip(self.hashes, assigned))]
        self.evidence["eligibleFrameCount"] += int(not any(reasons) and not ambiguous
            and all(score["score"] >= self.policy["threshold"] for score in sample["scores"]))
        warning = self.policy["acquisitionWarningsOnly"]
        for face in assigned:
            quality = face["quality"]
            self.warning_counts["native_blur"] += int(quality["blurVariance"] < warning["nativeBoxBlurVarianceBelow"])
            self.warning_counts["native_luminance_low"] += int(quality["meanLuminance"] < warning["nativeBoxLuminanceBelow"])
            self.warning_counts["native_luminance_high"] += int(quality["meanLuminance"] > warning["nativeBoxLuminanceAbove"])

    def finish(self):
        expected = self.value["verifiedEndFrameExclusive"]-self.value["verifiedStartFrame"]
        if not self.bound: return self.evidence
        if self.unresolved or self.evidence["examinedFrameCount"] != expected or expected < self.policy["scope"]["minimumIntendedFrameCount"]:
            self.evidence["warnings"].append("Both unique continuous face tracks must be resolved in every intended frame.")
        else:
            self.evidence["status"] = "eligible" if self.evidence["eligibleFrameCount"] == expected else "ineligible"
        for name, count in self.warning_counts.items():
            if count: self.evidence["warnings"].append(f"Acquisition diagnostic warning only: {name} on {count}/{2*self.evidence['examinedFrameCount']} face observations.")
        return self.evidence
