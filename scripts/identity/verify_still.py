"""One-image H3 I2VA preflight; never a video proof or identity certificate."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import struct
from verify import Verifier, identity_gallery_profile, cv2, np
from issued_policy import load_family, validate_issued_policy, policy_sha256, issued_draft_filter
from joint_similarity_filter import similarity
from draft_similarity_filter import geometry_reasons
MAX_BYTES = 32 * 1024 * 1024

def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_bounded(path):
    path = Path(path)
    if not 0 < path.stat().st_size <= MAX_BYTES:
        raise ValueError('Input exceeds the32MiB bound or is empty')
    with path.open('rb') as stream:
        data = stream.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError('Input changed or exceeded its byte bound')
    return data


def decode_png(path):
    data = read_bounded(path)
    if data[:8] != b'\x89PNG\r\n\x1a\n' or data[12:16] != b'IHDR' or len(data) < 33:
        raise ValueError('Input must be an actual PNG')
    width, height = struct.unpack('>II', data[16:24])
    if (width, height) != (1344, 768):
        raise ValueError('Conditioning PNG must be exactly1344x768; no automatic crop or stretch')
    if data[24] != 8 or data[25] not in (2, 6):
        raise ValueError('Conditioning PNG must be8bit RGB or opaque RGBA')
    # Reject APNG: this artifact is one still, never a hidden sequence.
    offset, ended = 8, False
    while offset + 12 <= len(data):
        length = struct.unpack('>I', data[offset:offset + 4])[0]
        kind = data[offset + 4:offset + 8]
        if length > len(data) - offset - 12:
            raise ValueError('PNG chunk is truncated')
        if kind == b'acTL':
            raise ValueError('Animated PNG is not a single-still artifact')
        offset += length + 12
        if kind == b'IEND':
            ended = True
            break
    if not ended or offset != len(data):
        raise ValueError('Conditioning PNG must contain exactly one complete image')
    image = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_UNCHANGED)
    if image is None or image.dtype != np.uint8 or image.ndim != 3 or image.shape[:2] != (768, 1344):
        raise ValueError('PNG must decode to native-size8bit RGB pixels')
    channels = image.shape[2]
    if channels == 4:
        if not np.all(image[:, :, 3] == 255):
            raise ValueError('Conditioning PNG must be opaque; alpha composition is ambiguous')
        image = cv2.cvtColor(image, cv2.COLOR_BGRA2BGR)
    elif channels != 3:
        raise ValueError('Unsupported PNG channel count')
    image = np.ascontiguousarray(image)
    return image, {'byteSha256': sha(data), 'byteCount': len(data), 'width': width, 'height': height,
        'sourceChannels': channels, 'decodedPixelSha256': sha(image.tobytes()),
        'decodedPixelEncoding': 'uint8-BGR-row-major-768x1344x3', 'pixelPreparation': 'none'}


def geometry_metrics(face):
    points = np.asarray(face['landmarks'], dtype=np.float64).reshape(5, 2)
    eyes = sorted(points[:2], key=lambda point: point[0])
    vector = eyes[1] - eyes[0]
    distance = float(np.linalg.norm(vector))
    if distance <= 0: return {'eyeDistancePixels': distance}
    across, midpoint = vector / distance, (eyes[0] + eyes[1]) / 2
    down = np.array([-across[1], across[0]])
    nose, mouth = points[2] - midpoint, (points[3] + points[4]) / 2 - midpoint
    return {'eyeDistancePixels': distance, 'rollDegrees': float(math.degrees(math.atan2(across[1], across[0]))),
        'noseYawProxy': float(nose @ across / distance), 'mouthYawProxy': float(mouth @ across / distance),
        'noseDepthOverEyeDistance': float(nose @ down / distance), 'mouthDepthOverEyeDistance': float(mouth @ down / distance)}


def screen_faces(faces, templates, hashes, family, image_shape=(768, 1344, 3)):
    """Same joint-v2 two-bijection/spatial rules; no temporal/minimum-frame claims."""
    scope = {**family['frontalGeometry'], **family['scope']}
    evidence = {'status': 'unverifiable', 'detectedFaceCount': len(faces), 'reasons': [], 'assignments': [],
        'candidateScores': [], 'detections': []}
    for index, face in enumerate(faces):
        evidence['detections'].append({'detectionIndex': index, 'box': face['box'], 'landmarks': face['landmarks'],
            'quality': face['quality'], 'geometry': geometry_metrics(face),
            'spatialReasons': geometry_reasons(face, image_shape, scope)})
    if len(faces) != scope['requiredDetectedFaceCount']:
        evidence['reasons'].append('missing_required_face' if len(faces) < 2 else 'ambiguous_face_count')
        return evidence
    if len(hashes) != 2 or any(raw not in templates for raw in hashes):
        evidence['reasons'].append('missing_reference_template')
        return evidence
    matrix = [[similarity(face['feature'], templates[raw]) for face in faces] for raw in hashes]
    if not all(math.isfinite(score) for row in matrix for score in row):
        evidence['reasons'].append('non_finite_similarity')
        return evidence
    evidence['candidateScores'] = [{'referenceHash': raw, 'detectionIndex': fi, 'score': matrix[ri][fi]}
        for ri, raw in enumerate(hashes) for fi in range(2)]
    order = [0, 1] if matrix[0][0] + matrix[1][1] >= matrix[0][1] + matrix[1][0] else [1, 0]
    ambiguous = False
    failures = []
    for ri, fi in enumerate(order):
        face = faces[fi]
        own_face_margin = matrix[ri][fi] - matrix[ri][1 - fi]
        own_identity_margin = matrix[ri][fi] - matrix[1 - ri][fi]
        margin = min(own_face_margin, own_identity_margin)
        ambiguous |= margin < scope['minimumAssignmentCosineMargin']
        reasons = geometry_reasons(face, image_shape, scope)
        if matrix[ri][fi] < family['threshold']: reasons.append('below_similarity_threshold')
        failures.extend(reasons)
        evidence['assignments'].append({'referenceHash': hashes[ri], 'detectionIndex': fi, 'score': matrix[ri][fi],
            'sameIdentityOverOtherFaceMargin': own_face_margin, 'sameFaceOverOtherIdentityMargin': own_identity_margin,
            'minimumAssignmentMargin': margin, 'reasons': reasons})
    if ambiguous: failures.append('assignment_margin')
    evidence['reasons'] = sorted(set(failures))
    evidence['status'] = 'unverifiable' if ambiguous else 'ineligible' if failures else 'eligible'
    return evidence


def assess_still(value, model_dir):
    artifact = value["artifact"]
    body = artifact["body"]
    descriptor = policy_sha256(body)
    binding = {"artifactId": "h3-frame-" + descriptor, "descriptorSha256": descriptor,
        "pngSha256": body["pngSha256"], "preparationVersion": "first-frame-native-v1"}
    if (artifact.get("version") != 1 or body.get("version") != 1 or artifact.get("id") != binding["artifactId"]
        or artifact.get("sha256") != descriptor or value.get("firstFrame") != binding
        or body.get("ownerId") != value.get("ownerId") or body.get("projectId") != value.get("projectId")
        or body.get("preparationVersion") != binding["preparationVersion"] or body.get("width") != 1344 or body.get("height") != 768
        or value.get("generationModel") != "h3-i2va-fl2va-int8-v1"):
        raise ValueError("Owned native first-frame descriptor differs")
    image, png = decode_png(value["imagePath"])
    if png["byteSha256"] != body["pngSha256"] or png["byteCount"] != body["byteCount"]:
        raise ValueError("Actual first-frame bytes differ")
    verifier = Verifier(model_dir)
    gallery = identity_gallery_profile(value)
    family = load_family(value["issuedPolicy"]["familyId"])
    if family["id"] not in ("sface-yunet-joint-frontal-v2", "sface-yunet-foreground-frontal-v2"): raise ValueError("Unsupported still screen family")
    model = family["model"]
    metadata = {"method": model["method"], "model": model["model"], "modelSha256": model["recognitionSha256"],
        "version": model["verifierVersion"], "preprocessVersion": model["preprocessBaseVersion"] + "-gallery-v2-" + gallery["sha256"]}
    validate_issued_policy(value, metadata, verifier.manifest, gallery)
    refs = value["references"]
    if body["references"] != [{k: v for k, v in ref.items() if k != "rawSha256"} for ref in value["issuedPolicy"]["body"]["references"]]:
        raise ValueError("Canonical still descriptor reference versions differ")
    for local in refs:
        if sha(read_bounded(local["path"])) != local["hash"]: raise ValueError("Canonical still authority bytes differ")
    if len(refs) != len(body["references"]): raise ValueError("Still authority count differs")
    templates = {}
    for reference in refs:
        if reference["role"] != "identity": continue
        template, _ = verifier.gallery(reference)
        if template is None: raise ValueError("Canonical still gallery is unverifiable")
        templates[reference["hash"]] = template
    faces = verifier.faces(image)
    evidence = screen_spatial(value, metadata, verifier.manifest, gallery, faces, templates, family, image.shape)
    # No embedding vectors, raw image pixels, application credentials or private story data are persisted.
    evidence.pop("detections", None)
    for assignment in evidence["assignments"]:
        assignment.pop("sameIdentityOverOtherFaceMargin", None)
        assignment.pop("sameFaceOverOtherIdentityMargin", None)
    return {"version": 1, "kind": "single-image", "status": evidence["status"], **binding,
        "decodedPixelSha256": png["decodedPixelSha256"], "policyId": value["issuedPolicy"]["id"],
        "policySha256": value["issuedPolicy"]["sha256"], "galleryProfileSha256": gallery["sha256"],
        "modelSha256": model["recognitionSha256"], "verifierVersion": model["verifierVersion"], "familyId": family["id"], "threshold": family["threshold"],
        "spatialEvidence": evidence, "warnings": ["One-image provisional numerical spatial screen; not identity accuracy calibration, temporal coverage, video eligibility or creative approval."]}


def screen_spatial(value, metadata, manifest, gallery, faces, templates, family, image_shape):
    if family["scope"]["kind"] == "joint-frontal":
        return screen_faces(faces, templates, value["identityReferenceHashes"], family, image_shape)
    # Reuse the unchanged foreground evaluator's spatial branch, with one fresh
    # observation. Do not call finish(): its video minimum-frame rule is inapplicable.
    framed = {**value, "verifiedStartFrame": 0, "verifiedEndFrameExclusive": 1}
    instance = issued_draft_filter(framed, metadata, manifest, gallery)
    for i, face in enumerate(faces): face["trackId"] = "still-face-" + str(i)
    raw = value["identityReferenceHashes"][0]
    if raw not in templates: raise ValueError("Missing still foreground template")
    instance.observe(0, 24, "0" * 64, image_shape, faces, templates[raw])
    e = instance.evidence
    sample = e["samples"][0]
    index = {face["trackId"]: i for i, face in enumerate(faces)}
    assignments = []
    for score in sample["scores"]:
        others = [c["score"] for c in sample["candidateScores"] if c["trackId"] != score["trackId"]]
        assignments.append({"referenceHash": raw, "detectionIndex": index[score["trackId"]], "score": score["score"],
            "minimumAssignmentMargin": score["score"] - max(others) if others else 1.0, "reasons": []})
    return {"status": "eligible" if e["eligibleFrameCount"] == 1 and not instance.unresolved else "unverifiable" if instance.unresolved else "ineligible",
        "detectedFaceCount": len(faces), "reasons": sorted(getattr(instance, "failure_reason_counts", {}).keys()), "assignments": assignments,
        "candidateScores": [{"referenceHash": c["referenceHash"], "detectionIndex": index[c["trackId"]], "score": c["score"]} for c in sample["candidateScores"]]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model-dir", required=True)
    args = parser.parse_args()
    value = json.loads(read_bounded(args.input))
    report = assess_still(value, args.model_dir)
    with Path(args.output).open("x", encoding="utf-8") as output:
        output.write(json.dumps(report, allow_nan=False))
    # A completed negative screen exits normally; the trusted worker consumes its explicit status.
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
