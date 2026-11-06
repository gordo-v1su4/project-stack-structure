"""Fixed numeric families with server-issued raw-reference bindings; never certifies identity."""
import hashlib
import json
import math
from pathlib import Path

FAMILIES = {
    "sface-yunet-foreground-frontal-v1": "15c8acceeb809a13c4d322b03fd4967c3013ab78610774df1f3b3b28f3ad391b",
    "sface-yunet-joint-frontal-v1": "b6f5526099fc483a1fa0573f79636b40304e00e37c0074b1014cba15d6424b95",
    "sface-yunet-foreground-frontal-v2": "45bd64dac164694b7715c7afd65debdea3a9b5db24725016f30fd05cea6ec6f4",
    "sface-yunet-joint-frontal-v2": "6abae4d91e76d21864c88d2e3fcbb03b4a7052f5a2bd7b47bbc7a56bb50c2a44",
}


def canonical_value(value):
    if isinstance(value, float):
        if not math.isfinite(value): raise ValueError("Non-finite policy number")
        return int(value) if value.is_integer() else value
    if isinstance(value, list): return [canonical_value(item) for item in value]
    if isinstance(value, dict): return {key: canonical_value(item) for key, item in value.items()}
    return value


def canonical_json(value):
    return json.dumps(canonical_value(value), sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def policy_sha256(value):
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def load_family(family_id):
    if family_id not in FAMILIES: raise ValueError("Unknown identity policy family")
    family = json.loads(Path(__file__).with_name("families").joinpath(family_id + ".json").read_text())
    if policy_sha256(family) != FAMILIES[family_id]: raise ValueError("Fixed identity policy family changed")
    return {**family, "sha256": FAMILIES[family_id]}


def validate_issued_policy(value, metadata, manifest, gallery):
    """Recheck trusted worker input against actual rehashed files and gallery geometry."""
    issued = value.get("issuedPolicy")
    if not isinstance(issued, dict): raise ValueError("Missing issued policy")
    body = issued.get("body", {})
    digest = policy_sha256(body)
    if (issued.get("version") != 1 or body.get("version") != 1 or issued.get("sha256") != digest
        or issued.get("id") != "h3-policy-" + digest): raise ValueError("Issued policy digest differs")
    family = load_family(body.get("familyId"))
    if (issued.get("familyId") != family["id"] or issued.get("familySha256") != family["sha256"]
        or body.get("familySha256") != family["sha256"]): raise ValueError("Issued policy family differs")
    if (body.get("ownerId") != value.get("ownerId") or not body.get("ownerId")
        or body.get("projectId") != value.get("projectId") or not body.get("projectId")
        or body.get("generationModel") != value.get("generationModel") or body.get("generationModel") != "h3-ref2va-int8-v3"):
        raise ValueError("Issued policy owner, project or model differs")
    references = body.get("references", [])
    identities = [ref for ref in references if ref.get("role") == "identity"]
    if (len(identities) != family["scope"]["requiredIdentityCount"]
        or [ref.get("rawSha256") for ref in references] != value["generationReferenceHashes"]
        or [ref.get("rawSha256") for ref in identities] != value["identityReferenceHashes"]
        or body.get("identityReferenceHashes") != value["identityReferenceHashes"]): raise ValueError("Issued raw references differ")
    actual = value["references"]
    if len(references) != len(actual): raise ValueError("Issued reference count differs")
    for ref, local in zip(references, actual):
        if ref.get("rawSha256") != local["hash"] or ref.get("canonicalName") != local["canonicalName"] or ref.get("role") != local.get("role"):
            raise ValueError("Issued declared reference differs")
    galleries = body.get("galleries", [])
    if len(galleries) != len(identities): raise ValueError("Issued galleries differ")
    by_hash = {ref["hash"]: ref for ref in actual}
    for entry, identity in zip(galleries, identities):
        regions, validation = entry.get("faceRegions", []), entry.get("referenceValidation", {})
        limits = family["referencePreparation"]
        if (entry.get("referenceAssetId") != identity.get("assetId") or entry.get("rawSha256") != identity.get("rawSha256")
            or entry.get("canonicalName") != identity.get("canonicalName")
            or regions != by_hash[identity["rawSha256"]].get("faceRegions")
            or not limits["minimumGalleryRegionCount"] <= len(regions) <= limits["maximumGalleryRegionCount"]
            or validation.get("method") != limits["method"] or validation.get("selectedRegionCount") != len(regions)
            or validation.get("frontalAnchorCount") != len(regions)
            or not isinstance(validation.get("detectedFaceCount"), int)
            or not len(regions) <= validation["detectedFaceCount"] <= limits["maximumDetectedFaceCount"]
            or not isinstance(validation.get("evidenceSha256"), str) or len(validation["evidenceSha256"]) != 64
            or (len(regions) > 1 and (not isinstance(validation.get("minimumPairwiseCosine"), (int, float))
                or not math.isfinite(validation["minimumPairwiseCosine"])
                or not limits["minimumPairwiseCosine"] <= validation["minimumPairwiseCosine"] <= 1))):
            raise ValueError("Issued gallery definition differs")
    model = family["model"]
    expected_preprocess = model["preprocessBaseVersion"] + "-gallery-v2-" + gallery["sha256"]
    if (body.get("galleryProfileSha256") != gallery["sha256"] or body.get("preprocessVersion") != expected_preprocess
        or metadata.get("version") != model["verifierVersion"] or metadata.get("preprocessVersion") != expected_preprocess
        or metadata.get("method") != model["method"] or metadata.get("model") != model["model"]
        or metadata.get("modelSha256") != model["recognitionSha256"]
        or {entry["sha256"] for entry in manifest["models"]} != {model["recognitionSha256"], model["detectionSha256"]}):
        raise ValueError("Issued model or actual gallery hash differs")
    return issued, family, identities


def issued_draft_filter(value, metadata, manifest, gallery):
    from foreground_similarity_filter import ForegroundDraftSimilarityFilter
    from joint_similarity_filter import JointDraftSimilarityFilter
    issued, family, identities = validate_issued_policy(value, metadata, manifest, gallery)
    joint = family["scope"]["kind"] == "joint-frontal"
    # Reuse the exact existing numerical evaluators; only the immutable bindings differ.
    instance = (JointDraftSimilarityFilter if joint else ForegroundDraftSimilarityFilter).__new__(
        JointDraftSimilarityFilter if joint else ForegroundDraftSimilarityFilter)
    instance.value = value
    instance.policy = {"threshold": family["threshold"], "scope": {**family["frontalGeometry"], **(family["scope"] if joint else {})},
        "acquisitionWarningsOnly": family["acquisitionWarningsOnly"]}
    instance.evidence = {"version": 1, "policyId": issued["id"], "policySha256": issued["sha256"], "status": "unverifiable",
        "threshold": family["threshold"], "examinedFrameCount": 0, "eligibleFrameCount": 0, "outOfScopeFrameCount": 0,
        "ambiguousFrameCount": 0, "samples": [], "warnings": [
            "Provisional server-issued numeric-model draft filter; not an identity certificate or final creative approval.",
            "Fixed editorial scope is not held-out identity accuracy calibration. Background identities are unassessed."]}
    instance.bound, instance.unresolved = True, False
    instance.warning_counts = {"native_blur": 0, "native_luminance_low": 0, "native_luminance_high": 0}
    if joint:
        instance.identities = identities
        instance.hashes = [identity["rawSha256"] for identity in identities]
        instance.policy["identities"] = identities
        instance.previous, instance.previous_index, instance.tracks = None, None, None
    else:
        instance.policy["identity"] = identities[0]
        instance.policy["foregroundDominance"] = family["scope"]
        instance.previous_box, instance.previous_index, instance.track_id = None, None, None
    return instance
