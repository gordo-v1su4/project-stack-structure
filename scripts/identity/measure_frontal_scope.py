"""Preregistered frontal-only project draft-filter controls; never authorizes a take."""
import argparse
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import shutil

from verify import Verifier, cosine, cv2, identity_gallery_profile, np, unit, PREPROCESS_VERSION
from download_models import sha256_file
from measure_calibration import region_image, variants, image_hash, stable_hash

PREREGISTERED_FILE_SHA256 = "01aaecbc45e26b5ce0f84138c2116c8bdc3e505c7c463902b580b21961ed16c6"


def frontal_scope(face, image_shape, scope, detected_face_count=1):
    reasons, metrics = [], {}
    quality = face["quality"]
    for name, field, bound, lower in [
        ("face_width", "widthPixels", "minimumFaceWidthPixels", True),
        ("face_height", "heightPixels", "minimumFaceHeightPixels", True),
        ("detection_confidence", "detectionScore", "minimumDetectionScore", True),
        ("blur", "blurVariance", "minimumBlurVariance", True),
        ("luminance_low", "meanLuminance", "minimumLuminance", True),
        ("luminance_high", "meanLuminance", "maximumLuminance", False)]:
        value = quality.get(field)
        if value is None or not math.isfinite(value) or (value < scope[bound] if lower else value > scope[bound]): reasons.append(name)
    if scope["requireSingleDetectedFace"] and detected_face_count != 1: reasons.append("multiple_detected_faces")
    x, y, width, height = face["box"]
    image_height, image_width = image_shape[:2]
    if scope["requireWholeFaceBoxInsideImage"] and (x < 0 or y < 0 or x+width > image_width or y+height > image_height): reasons.append("face_box_clipped")
    landmarks = np.asarray(face.get("landmarks", []), dtype=np.float64)
    if landmarks.size != 10 or not np.isfinite(landmarks).all():
        return {"eligible": False, "reasons": reasons + ["landmarks_unavailable"], "metrics": metrics}
    points = landmarks.reshape(5, 2)
    eyes = sorted(points[:2], key=lambda point: point[0])
    eye_vector = eyes[1] - eyes[0]
    distance = float(np.linalg.norm(eye_vector))
    if distance < scope["minimumEyeDistancePixels"]:
        reasons.append("eye_distance_too_small")
    if distance <= 0:
        return {"eligible": False, "reasons": reasons + ["invalid_eye_geometry"], "metrics": metrics}
    across = eye_vector / distance
    down = np.array([-across[1], across[0]])
    midpoint = (eyes[0] + eyes[1]) / 2
    nose = points[2] - midpoint
    mouth = (points[3] + points[4]) / 2 - midpoint
    metrics = {"eyeDistancePixels": distance, "absoluteRollDegrees": abs(math.degrees(math.atan2(across[1], across[0]))),
        "noseEyeMidpointOffsetOverEyeDistance": float(nose @ across / distance),
        "mouthEyeMidpointOffsetOverEyeDistance": float(mouth @ across / distance),
        "noseDepthOverEyeDistance": float(nose @ down / distance), "mouthDepthOverEyeDistance": float(mouth @ down / distance)}
    if metrics["absoluteRollDegrees"] > scope["maximumAbsoluteRollDegrees"]: reasons.append("roll_outside_scope")
    if abs(metrics["noseEyeMidpointOffsetOverEyeDistance"]) > scope["maximumAbsoluteNoseEyeMidpointOffsetOverEyeDistance"]: reasons.append("nose_yaw_proxy_outside_scope")
    if abs(metrics["mouthEyeMidpointOffsetOverEyeDistance"]) > scope["maximumAbsoluteMouthEyeMidpointOffsetOverEyeDistance"]: reasons.append("mouth_yaw_proxy_outside_scope")
    if not scope["minimumNoseDepthOverEyeDistance"] <= metrics["noseDepthOverEyeDistance"] <= scope["maximumNoseDepthOverEyeDistance"]: reasons.append("nose_depth_geometry_invalid")
    if not metrics["noseDepthOverEyeDistance"] < metrics["mouthDepthOverEyeDistance"] <= scope["maximumMouthDepthOverEyeDistance"]: reasons.append("mouth_depth_geometry_invalid")
    return {"eligible": not reasons, "reasons": reasons, "metrics": metrics}


def control(verifier, image, template, scope):
    faces = verifier.faces(image)
    evidence = [{"score": cosine(face["feature"], template), "box": face["box"], "quality": face["quality"],
        "scope": frontal_scope(face, image.shape, scope, len(faces))} for face in faces]
    eligible = [face for face in evidence if face["scope"]["eligible"]]
    return {"decodedImageSha256": image_hash(image), "faceCount": len(faces), "faces": evidence,
        "scopeEligible": len(eligible) == 1,
        "scopeScore": eligible[0]["score"] if len(eligible) == 1 else None,
        "maximumUnfilteredScore": max((face["score"] for face in evidence), default=None)}


def transform_family(name):
    if name == "original": return "original"
    if "blur" in name: return "blur"
    return name.split("-")[0]


def summarize(controls, baseline, experiment):
    positive = [c for c in controls if c["kind"] == "held-out-canonical-view" and c["view"] == "front" and c["scopeEligible"]]
    quarter = [c for c in controls if c["kind"] == "held-out-canonical-view" and c["view"] == "three-quarter"]
    excluded = [c for c in quarter if c["scopeEligible"]]
    families = sorted(set(transform_family(c["transform"]) for c in positive))
    expected = experiment["scopeValidation"]
    scope_supported = (not excluded and len(positive) >= expected["minimumApplicableFrontControls"]
        and set(expected["minimumApplicableFrontTransformFamilies"]).issubset(families))
    maximum_negative = baseline["summary"]["maximumNegative"]
    rule = experiment["scoreRule"]
    threshold = max(rule["minimumThreshold"], math.ceil((maximum_negative + rule["negativeMargin"]) * 100) / 100)
    scores = [c["scopeScore"] for c in positive]
    enough_margin = bool(scores) and min(scores) >= threshold + rule["positiveMargin"] and maximum_negative < threshold
    return {"status": "project_local_frontal_draft_filter_controls_supported" if scope_supported and enough_margin else "scope_or_score_controls_failed",
        "automaticPassEnabled": False, "runtimeGateChanged": False, "candidateThreshold": threshold,
        "applicableFrontControls": len(positive), "applicableFrontTransformFamilies": families,
        "minimumApplicablePositiveScore": min(scores) if scores else None,
        "priorMaximumNegativeScoreUnfiltered": maximum_negative, "requiredPositiveMargin": rule["positiveMargin"],
        "quarterControls": len(quarter), "quarterControlsAdmitted": len(excluded), "scopeControlSupported": scope_supported,
        "scoreControlSupported": enough_margin,
        "newNegativeControlsAdmittedAboveThreshold": sum(c["scopeEligible"] and c["scopeScore"] >= threshold for c in controls if c["kind"] != "held-out-canonical-view"),
        "quarterControlsAdmittedDetails": [{"transform": c["transform"], "faces": c["faces"]} for c in excluded]}


def measure(experiment_path, model_dir, work_dir, ffmpeg):
    if sha256_file(experiment_path) != PREREGISTERED_FILE_SHA256: raise ValueError("Preregistered experiment bytes changed")
    experiment = json.loads(experiment_path.read_text())
    if sha256_file(experiment["baselineFixturePath"]) != experiment["baselineFixtureFileSha256"]: raise ValueError("Prior fixture bytes changed")
    if sha256_file(experiment["baselineReportPath"]) != experiment["baselineReportFileSha256"]: raise ValueError("Prior failed report bytes changed")
    fixture = json.loads(Path(experiment["baselineFixturePath"]).read_text())
    baseline = json.loads(Path(experiment["baselineReportPath"]).read_text())
    for source in [fixture["target"], *fixture["wrongCharacters"], fixture["rejectedPilot"]]:
        if sha256_file(source["path"]) != source["hash"]: raise ValueError("Control authority bytes changed")
    verifier = Verifier(model_dir)
    target = fixture["target"]
    gallery = identity_gallery_profile({"references": [target], "identityReferenceHashes": [target["hash"]]})
    if gallery["sha256"] != experiment["gallerySha256"]: raise ValueError("Frozen gallery changed")
    image = cv2.imread(target["path"])
    views = []
    for region in target["faceRegions"]:
        crop = region_image(image, region)
        good = [face for face in verifier.faces(crop) if not face["qualityReasons"]]
        if len(good) != 1: raise ValueError("Canonical reference face changed")
        views.append({"name": region["name"], "image": crop, "feature": good[0]["feature"]})
    work_dir.mkdir(parents=True, exist_ok=True)
    centroid = unit(np.mean([view["feature"] for view in views], axis=0))
    controls = []
    for view in views:
        holdout = unit(np.mean([other["feature"] for other in views if other is not view], axis=0))
        for name, transformed, parameters in variants(view["image"], view["name"], work_dir, ffmpeg):
            controls.append({"kind": "held-out-canonical-view", "view": view["name"], "transform": name, "parameters": parameters,
                **control(verifier, transformed, holdout, experiment["scope"])})
    for wrong in fixture["wrongCharacters"]:
        wrong_image = cv2.imread(wrong["path"])
        for region in wrong["faceRegions"]:
            for name, transformed, parameters in variants(region_image(wrong_image, region), wrong["canonicalName"] + "-" + region["name"], work_dir, ffmpeg):
                controls.append({"kind": "wrong-canonical-character", "canonicalName": wrong["canonicalName"], "view": region["name"],
                    "transform": name, "parameters": parameters, **control(verifier, transformed, centroid, experiment["scope"])})
    pilot = fixture["rejectedPilot"]
    video = cv2.VideoCapture(pilot["path"])
    if int(video.get(cv2.CAP_PROP_FRAME_COUNT)) != pilot["frameCount"] or abs(video.get(cv2.CAP_PROP_FPS) - pilot["fps"]) > .001: raise ValueError("Prior pilot timing changed")
    for index in range(pilot["frameCount"]):
        ok, frame = video.read()
        if not ok: raise ValueError("Prior pilot did not decode completely")
        controls.append({"kind": "user-rejected-pilot", "frame": index, **control(verifier, frame, centroid, experiment["scope"])})
    video.release()
    return {"version": 1, "schema": "preregistered-frontal-project-draft-filter-controls.v1", "assessedAt": datetime.now(timezone.utc).isoformat(),
        "experiment": experiment, "experimentFileSha256": PREREGISTERED_FILE_SHA256, "measurementScriptSha256": sha256_file(__file__),
        "scopeSha256": stable_hash(experiment["scope"]), "galleryProfile": gallery,
        "preprocessVersion": PREPROCESS_VERSION + "-gallery-v2-" + gallery["sha256"],
        "modelManifest": verifier.manifest, "runtimePins": verifier.versions,
        "summary": summarize(controls, baseline, experiment), "controls": controls,
        "limitations": ["Image-landmark yaw proxies are geometry restrictions, not calibrated physical yaw angles or proof of 3D frontal pose.",
            "This separate preregistered experiment does not erase the failed broad three-view calibration.",
            "No target pickup video, frame, score or derived control was observed or included.",
            "No reliable real-video identity false-accept rate follows from correlated canonical transforms and one independently named wrong identity.",
            "Any future draft policy needs every intended frame in scope, conservative unique-track assignment and complete media/reference/model/policy binding.",
            "This is a project-local provisional draft-filter experiment, not validated identity accuracy, subjective creative approval or an enabled runtime gate."]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--experiment", required=True, type=Path)
    parser.add_argument("--model-dir", required=True, type=Path)
    parser.add_argument("--work-dir", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--ffmpeg", default=shutil.which("ffmpeg"))
    args = parser.parse_args()
    report = measure(args.experiment, args.model_dir, args.work_dir, args.ffmpeg)
    args.output.write_text(json.dumps(report, indent=2))
    print(json.dumps(report["summary"], indent=2))


if __name__ == "__main__": main()
