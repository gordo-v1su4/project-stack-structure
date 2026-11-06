"""Bounded offline reference preflight before GPU submission; no identity certificate."""
import argparse
import hashlib
import json
import math
from pathlib import Path

from issued_policy import load_family, policy_sha256


def face_regions(verifier, image, family):
    """Detect the sheet, then re-detect bounded native pixel crops, without changing thresholds."""
    from verify import cv2, cosine
    from draft_similarity_filter import geometry_reasons, box_overlap
    height, width = image.shape[:2]
    seeds = verifier.faces(image)
    rules = family["referencePreparation"]
    if len(seeds) > rules["maximumDetectedFaceCount"]: return None, "ambiguous-gallery", {}
    candidates, evidence = [], []
    for seed in sorted(seeds, key=lambda face: (face["box"][0], face["box"][1])):
        x, y, w, h = seed["box"]
        left, top = max(0, math.floor(x-.3*w)), max(0, math.floor(y-.25*h))
        right, bottom = min(width, math.ceil(x+1.3*w)), min(height, math.ceil(y+1.25*h))
        if right <= left or bottom <= top: continue
        crop = image[top:bottom, left:right]
        detected = verifier.faces(crop)
        qualifying = [face for face in detected if not geometry_reasons(face, crop.shape, family["frontalGeometry"])]
        evidence.append({"pixelCrop": [left, top, right-left, bottom-top], "detected": len(detected),
            "frontal": len(qualifying), "faces": [{"box": face["box"], "quality": face["quality"],
                "reasons": geometry_reasons(face, crop.shape, family["frontalGeometry"])} for face in detected]})
        if len(qualifying) > 1: return None, "ambiguous-gallery", {"candidates": evidence}
        # The eventual gallery decoder must also see exactly one face in this ROI.
        if len(detected) != 1 or not qualifying: continue
        face = qualifying[0]
        box = [face["box"][0]+left, face["box"][1]+top, *face["box"][2:]]
        if any(box_overlap(box, old["box"]) > .5 for old in candidates): continue
        candidates.append({"box": box, "feature": face["feature"], "crop": [left, top, right-left, bottom-top]})
    if not candidates: return None, "no-frontal-anchor", {"candidates": evidence}
    if len(candidates) > rules["maximumGalleryRegionCount"]: return None, "ambiguous-gallery", {"candidates": evidence}
    pairs = [cosine(left["feature"], right["feature"]) for index, left in enumerate(candidates) for right in candidates[index+1:]]
    if pairs and min(pairs) < rules["minimumPairwiseCosine"]:
        return None, "incoherent-gallery", {"candidates": evidence, "pairwiseCosines": pairs}
    regions = [{"name": f"frontal-{index+1}", "rect": [left/width, top/height, w/width, h/height]}
        for index, candidate in enumerate(candidates) for left, top, w, h in [candidate["crop"]]]
    return regions, None, {"detectedFaceCount": len(seeds), "frontalAnchorCount": len(candidates),
        "selectedRegionCount": len(regions), "minimumPairwiseCosine": min(pairs) if pairs else None,
        "candidates": evidence, "pairwiseCosines": pairs}


def prepare(value, model_dir, verifier=None):
    from verify import Verifier, cv2, identity_gallery_profile
    from download_models import sha256_file
    family = load_family(value.get("family", {}).get("id"))
    result = {"version": 1, "bindingSha256": value.get("bindingSha256"), "familyId": family["id"],
        "familySha256": family["sha256"], "status": "unverifiable", "model": family["model"], "galleries": []}
    if (value.get("version") != 1 or not isinstance(result["bindingSha256"], str)
        or len(result["bindingSha256"]) != 64 or any(c not in "0123456789abcdef" for c in result["bindingSha256"])
        or value.get("family") != family): return {**result, "reason": "invalid-reference"}
    refs = value.get("references")
    if not isinstance(refs, list) or not 1 <= len(refs) <= 9: return {**result, "reason": "invalid-reference"}
    identities = [ref for ref in refs if ref.get("role") == "identity"]
    if len(identities) != family["scope"]["requiredIdentityCount"]: return {**result, "reason": "invalid-reference"}
    names, hashes, ids = set(), set(), set()
    try:
        for ref in refs:
            name, raw, asset_id = ref.get("canonicalName"), ref.get("rawSha256"), ref.get("assetId")
            if (not isinstance(name, str) or not name.strip() or name in names or not isinstance(asset_id, str) or not asset_id
                or asset_id in ids or not isinstance(raw, str) or len(raw) != 64 or any(c not in "0123456789abcdef" for c in raw)
                or raw in hashes or sha256_file(ref["localPath"]) != raw): return {**result, "reason": "invalid-reference"}
            names.add(name); hashes.add(raw); ids.add(asset_id)
    except (OSError, ValueError, KeyError): return {**result, "reason": "invalid-reference"}
    try:
        verifier = verifier or Verifier(model_dir)
    except (OSError, ValueError, KeyError): return {**result, "reason": "model-unavailable"}
    gallery_refs = []
    for ref in identities:
        image = cv2.imread(ref["localPath"])
        if image is None or max(image.shape[:2]) > 8192 or image.shape[0]*image.shape[1] > 32*1024*1024:
            return {**result, "reason": "invalid-reference"}
        regions, reason, evidence = face_regions(verifier, image, family)
        if reason: return {**result, "galleries": [], "reason": reason}
        validation = {"method": family["referencePreparation"]["method"], **{key: evidence[key] for key in
            ["detectedFaceCount", "frontalAnchorCount", "selectedRegionCount"]}, "evidenceSha256": policy_sha256(evidence)}
        if evidence["minimumPairwiseCosine"] is not None: validation["minimumPairwiseCosine"] = evidence["minimumPairwiseCosine"]
        result["galleries"].append({"referenceAssetId": ref["assetId"], "canonicalName": ref["canonicalName"],
            "rawSha256": ref["rawSha256"], "faceRegions": regions, "referenceValidation": validation})
        gallery_refs.append({"hash": ref["rawSha256"], "canonicalName": ref["canonicalName"], "faceRegions": regions})
    gallery = identity_gallery_profile({"references": gallery_refs, "identityReferenceHashes": [ref["rawSha256"] for ref in identities]})
    return {**result, "status": "ready", "galleryProfileSha256": gallery["sha256"]}


def main():
    parser = argparse.ArgumentParser()
    for flag in ["input", "output", "model-dir"]: parser.add_argument("--"+flag, required=True)
    args = parser.parse_args()
    value = json.loads(Path(args.input).read_text(encoding="utf-8"))
    result = prepare(value, args.model_dir)
    Path(args.output).write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({"status": result["status"], "reason": result.get("reason"), "galleryCount": len(result["galleries"])}))


if __name__ == "__main__": main()
