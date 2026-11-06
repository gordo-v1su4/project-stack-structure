"""Separate aligned-input quality controls. Never changes runtime acceptance."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import shutil

from verify import Verifier, cosine, cv2, np, unit, identity_gallery_profile
from download_models import sha256_file
from measure_calibration import region_image, variants, stable_hash, image_hash
from measure_frontal_scope import frontal_scope
import measure_frontal_scope

PREREGISTERED_SHA256 = "ed41d1130ac936d4f14c15c6fea4f543b1a9b4214ac7a8ecf65e0d45ccba9740"


def face_vector(face):
    return np.asarray([*face["box"], *face["landmarks"], face["quality"]["detectionScore"]], dtype=np.float32)


def metrics_from_aligned(aligned):
    if aligned.shape != (112, 112, 3): raise ValueError("Expected exact112x112 recognition input")
    gray = cv2.cvtColor(aligned, cv2.COLOR_BGR2GRAY)[8:104, 8:104]
    return {"laplacianVariance": float(cv2.Laplacian(gray, cv2.CV_64F, ksize=1).var()),
        "meanLuminance": float(gray.mean()), "alignedImageSha256": image_hash(aligned)}


def aligned_metrics(verifier, image, face):
    return metrics_from_aligned(verifier.aligner.alignCrop(image, face_vector(face)))


def preserved_geometry(face, image_shape, scope, count):
    original = frontal_scope(face, image_shape, scope, count)
    reasons = [reason for reason in original["reasons"] if reason not in ["blur", "luminance_low", "luminance_high"]]
    return {**original, "eligible": not reasons, "reasons": reasons}


def derive_limits(metrics, rule):
    if not metrics: raise ValueError("No applicable canonical front controls")
    return {"minimumLaplacianVariance": rule["minimumSharpnessFactorOfWorstPositive"] * min(m["laplacianVariance"] for m in metrics),
        "minimumLuminance": rule["minimumLuminanceFactorOfWorstPositive"] * min(m["meanLuminance"] for m in metrics),
        "maximumLuminance": rule["maximumLuminanceFactorOfWorstPositive"] * max(m["meanLuminance"] for m in metrics)}


def quality_reasons(metrics, limits):
    reasons = []
    if metrics["laplacianVariance"] < limits["minimumLaplacianVariance"]: reasons.append("aligned_blur")
    if metrics["meanLuminance"] < limits["minimumLuminance"]: reasons.append("aligned_luminance_low")
    if metrics["meanLuminance"] > limits["maximumLuminance"]: reasons.append("aligned_luminance_high")
    return reasons


def control(verifier, image, template, scope):
    faces = verifier.faces(image)
    evidence = [{"cosine": cosine(face["feature"], template), "qualityNative": face["quality"],
        "geometry": preserved_geometry(face, image.shape, scope, len(faces)), "qualityAligned": aligned_metrics(verifier, image, face)} for face in faces]
    return {"imageSha256": image_hash(image), "faceCount": len(faces), "faces": evidence}


def measure(experiment_path, model_dir, work, ffmpeg):
    if sha256_file(experiment_path) != PREREGISTERED_SHA256: raise ValueError("Aligned-quality preregistration changed")
    experiment = json.loads(experiment_path.read_text())
    for path_key, hash_key in [("frontalExperimentPath", "frontalExperimentFileSha256"), ("frontalControlReportPath", "frontalControlReportFileSha256")]:
        if sha256_file(experiment[path_key]) != experiment[hash_key]: raise ValueError("Prior frontal experiment evidence changed")
    frontal = json.loads(Path(experiment["frontalExperimentPath"]).read_text())
    prior = json.loads(Path(experiment["frontalControlReportPath"]).read_text())
    if sha256_file(measure_frontal_scope.__file__) != prior["measurementScriptSha256"]: raise ValueError("Frozen frontal geometry implementation changed")
    if sha256_file(frontal["baselineFixturePath"]) != frontal["baselineFixtureFileSha256"]: raise ValueError("Canonical fixture changed")
    fixture = json.loads(Path(frontal["baselineFixturePath"]).read_text())
    for source in [fixture["target"], *fixture["wrongCharacters"], fixture["rejectedPilot"]]:
        if sha256_file(source["path"]) != source["hash"]: raise ValueError("Control media bytes changed")
    verifier = Verifier(model_dir)
    if verifier.manifest != prior["modelManifest"]: raise ValueError("Model provenance changed")
    target = fixture["target"]
    gallery = identity_gallery_profile({"references": [target], "identityReferenceHashes": [target["hash"]]})
    if gallery != prior["galleryProfile"]: raise ValueError("Raw authority gallery changed")
    work.mkdir(parents=True, exist_ok=True)
    image = cv2.imread(target["path"])
    views, controls = [], []
    for region in target["faceRegions"]:
        crop = region_image(image, region)
        good = [face for face in verifier.faces(crop) if not face["qualityReasons"]]
        if len(good) != 1: raise ValueError("Canonical reference no longer has one quality face")
        views.append({"name": region["name"], "image": crop, "face": good[0]})
    centroid = unit(np.mean([view["face"]["feature"] for view in views], axis=0))
    for view in views:
        holdout = unit(np.mean([other["face"]["feature"] for other in views if other is not view], axis=0))
        for name, transformed, parameters in variants(view["image"], "aligned-" + view["name"], work, ffmpeg):
            controls.append({"kind": "held-out-canonical-view", "view": view["name"], "transform": name, "parameters": parameters,
                **control(verifier, transformed, holdout, frontal["scope"])})
    for wrong in fixture["wrongCharacters"]:
        wrong_image = cv2.imread(wrong["path"])
        for region in wrong["faceRegions"]:
            for name, transformed, parameters in variants(region_image(wrong_image, region), "aligned-" + wrong["canonicalName"] + "-" + region["name"], work, ffmpeg):
                controls.append({"kind": "wrong-canonical-character", "canonicalName": wrong["canonicalName"], "view": region["name"],
                    "transform": name, "parameters": parameters, **control(verifier, transformed, centroid, frontal["scope"])})
    pilot = fixture["rejectedPilot"]
    video = cv2.VideoCapture(pilot["path"])
    if int(video.get(cv2.CAP_PROP_FRAME_COUNT)) != pilot["frameCount"]: raise ValueError("Prior pilot timing changed")
    for index in range(pilot["frameCount"]):
        ok, frame = video.read()
        if not ok: raise ValueError("Prior pilot decode incomplete")
        controls.append({"kind": "user-rejected-pilot", "frame": index, **control(verifier, frame, centroid, frontal["scope"])})
    video.release()
    positives = [c["faces"][0] for c in controls if c["kind"] == "held-out-canonical-view" and c["view"] == "front"
        and c["faceCount"] == 1 and c["faces"][0]["geometry"]["eligible"]]
    limits = derive_limits([c["qualityAligned"] for c in positives], experiment["limitDerivation"])
    for item in controls:
        for face in item["faces"]:
            face["alignedQualityReasons"] = quality_reasons(face["qualityAligned"], limits)
            face["scopeEligible"] = face["geometry"]["eligible"] and not face["alignedQualityReasons"]
    front = next(view for view in views if view["name"] == "front")
    challenges, invariance = [], []
    for spec in experiment["severeQualityChallenges"]:
        if "gaussianSigma" in spec:
            transformed = cv2.GaussianBlur(front["image"], (spec["gaussianKernel"], spec["gaussianKernel"]), spec["gaussianSigma"])
        else:
            transformed = np.clip(front["image"].astype(np.float32) * spec["exposureMultiplier"], 0, 255).astype(np.uint8)
        metrics = aligned_metrics(verifier, transformed, front["face"])
        challenges.append({"definition": spec, "metrics": metrics, "reasons": quality_reasons(metrics, limits)})
    for scale in experiment["resolutionInvariance"]["scaleFactors"]:
        h, w = front["image"].shape[:2]
        scaled_image = cv2.resize(front["image"], (round(w*scale), round(h*scale)), interpolation=cv2.INTER_LINEAR)
        face = {**front["face"], "box": [x*scale for x in front["face"]["box"]], "landmarks": [x*scale for x in front["face"]["landmarks"]]}
        metrics = aligned_metrics(verifier, scaled_image, face)
        x, y, width, height = face["box"]
        gray = cv2.cvtColor(scaled_image[max(0, int(y)):int(y+height), max(0, int(x)):int(x+width)], cv2.COLOR_BGR2GRAY)
        invariance.append({"scale": scale, "alignedMetrics": metrics, "nativeBoxLaplacianVariance": float(cv2.Laplacian(gray, cv2.CV_64F).var())})
    ratio = max(c["alignedMetrics"]["laplacianVariance"] for c in invariance) / min(c["alignedMetrics"]["laplacianVariance"] for c in invariance)
    native_ratio = max(c["nativeBoxLaplacianVariance"] for c in invariance) / min(c["nativeBoxLaplacianVariance"] for c in invariance)
    quarter_admitted = sum(any(f["scopeEligible"] for f in c["faces"]) for c in controls if c["kind"] == "held-out-canonical-view" and c["view"] == "three-quarter")
    negative_admitted = sum(any(f["scopeEligible"] and f["cosine"] >= .80 for f in c["faces"]) for c in controls if c["kind"] != "held-out-canonical-view")
    supported = len(positives) >= 7 and min(c["cosine"] for c in positives) >= .805 and quarter_admitted == 0 and negative_admitted == 0
    supported = supported and all(c["reasons"] for c in challenges) and ratio <= experiment["resolutionInvariance"]["maximumAlignedSharpnessMaxMinRatio"]
    policy = {"version": 1, "id": experiment["id"], "experimentFileSha256": PREREGISTERED_SHA256,
        "qualityMethod": experiment["qualityMethod"], "limits": limits, "frontalScope": frontal["scope"],
        "replacedNativeScopeMetricsOnly": ["minimumBlurVariance", "minimumLuminance", "maximumLuminance"],
        "threshold": .80, "galleryProfile": gallery, "modelManifest": verifier.manifest, "runtimePins": verifier.versions,
        "measurementScriptSha256": sha256_file(__file__), "automaticPassEnabled": False, "runtimeGateChanged": False}
    policy["frontalGeometryScriptSha256"] = prior["measurementScriptSha256"]
    return {"version": 1, "schema": "aligned112-project-local-quality-controls.v1", "assessedAt": datetime.now(timezone.utc).isoformat(),
        "experiment": experiment, "policy": policy, "policySha256": stable_hash(policy),
        "summary": {"status": "controls_support_provisional_aligned_input_quality" if supported else "aligned_quality_controls_failed",
            "limits": limits, "applicableFrontControls": len(positives), "minimumHeldOutFrontCosine": min(c["cosine"] for c in positives),
            "quarterControlsAdmitted": quarter_admitted, "negativeControlsAdmittedAboveThreshold": negative_admitted,
            "allSevereQualityChallengesRejected": all(bool(c["reasons"]) for c in challenges),
            "alignedSharpnessResolutionMaxMinRatio": ratio, "nativeSharpnessResolutionMaxMinRatio": native_ratio,
            "automaticPassEnabled": False, "runtimeGateChanged": False},
        "severeQualityChallenges": challenges, "resolutionInvariance": invariance, "controls": controls,
        "limitations": ["Aligned112 quality is a fixed-input diagnostic envelope, not universally calibrated optical sharpness or exposure.",
            "Positive limits derive from correlated canonical held-out front transforms, not independent accepted generated videos.",
            "Pure resampling invariance uses scaled original landmarks to isolate metric effects; real detector/landmark instability can still alter aligned quality.",
            "All prior failed experiments remain intact. The observed v2 pickup is excluded from controls/limit derivation and is not independent holdout.",
            "A fresh unobserved clip is required for a prospective check after these limits freeze; runtime acceptance remains disabled."]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--experiment", required=True, type=Path)
    parser.add_argument("--model-dir", required=True, type=Path)
    parser.add_argument("--work-dir", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--policy-output", required=True, type=Path)
    parser.add_argument("--ffmpeg", default=shutil.which("ffmpeg"))
    args = parser.parse_args()
    report = measure(args.experiment, args.model_dir, args.work_dir, args.ffmpeg)
    args.output.write_text(json.dumps(report, indent=2))
    args.policy_output.write_text(json.dumps(report["policy"], indent=2))
    print(json.dumps({**report["summary"], "policySha256": report["policySha256"]}, indent=2))


if __name__ == "__main__": main()
