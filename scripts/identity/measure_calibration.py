"""Offline diagnostic controls only. Does not modify the verifier or authorize a take."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import shutil
import subprocess

from verify import Verifier, cosine, cv2, identity_gallery_profile, np, unit, PREPROCESS_VERSION
from download_models import sha256_file

RULE = {"minimumThreshold": .78, "negativeMargin": .02, "thresholdRoundingStep": .01, "positiveMargin": .005}
AUGMENTATION_PROFILE = "mild-exposure90-110-downscale75-50-gaussian3-sigma05-motion3-h264crf19-23-v1"


def stable_hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def decision(positive_scores, negative_scores, unresolved_positive=0, unresolved_negative=0):
    if not positive_scores or not negative_scores:
        return {"status": "insufficient_controls", "automaticPassEnabled": False}
    minimum, maximum = min(positive_scores), max(negative_scores)
    threshold = max(.78, math.ceil((maximum + .02) * 100) / 100)
    separated = minimum >= threshold + .005 and maximum < threshold
    return {"status": "provisionally_separated" if separated and not unresolved_positive and not unresolved_negative else "controls_overlap_or_abstain",
        "automaticPassEnabled": False, "candidateThreshold": threshold,
        "minimumPositive": minimum, "maximumNegative": maximum,
        "scoreIntervalGap": minimum - maximum, "positiveMarginAboveThreshold": minimum - threshold,
        "requiredPositiveMargin": .005, "negativeMarginBelowThreshold": threshold - maximum,
        "unresolvedPositiveControls": unresolved_positive, "unresolvedNegativeControls": unresolved_negative,
        "positiveScoreFailures": sum(score < threshold + .005 for score in positive_scores),
        "negativeScoreFailures": sum(score >= threshold for score in negative_scores),
        "sensitivity": [{"threshold": candidate, "positiveBelowThreshold": sum(score < candidate for score in positive_scores),
            "positiveBelowRequiredMargin": sum(score < candidate + .005 for score in positive_scores),
            "negativeAtOrAboveThreshold": sum(score >= candidate for score in negative_scores)}
            for candidate in [.76, .77, .78, .79, .80, .81, .82]]}


def region_image(image, region):
    x, y, width, height = region["rect"]
    h, w = image.shape[:2]
    return image[round(y*h):round((y+height)*h), round(x*w):round((x+width)*w)].copy()


def image_hash(image):
    return hashlib.sha256(str(image.shape).encode() + image.tobytes()).hexdigest()


def h264_roundtrip(image, output, ffmpeg, crf):
    # Pixel translation tests only mild acquisition motion; it is not new facial motion.
    height, width = image.shape[:2]
    padded = cv2.copyMakeBorder(image, 0, height % 2, 0, width % 2, cv2.BORDER_REPLICATE)
    height, width = padded.shape[:2]
    frames = []
    for dx, dy in [(0, 0), (1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (0, 0), (0, -1), (1, -1), (1, 0), (0, 0), (0, 0)]:
        matrix = np.float32([[1, 0, dx], [0, 1, dy]])
        frames.append(cv2.warpAffine(padded, matrix, (width, height), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE))
    command = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-threads", "2", "-filter_threads", "1",
        "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{width}x{height}", "-r", "24", "-i", "pipe:0",
        "-an", "-c:v", "libx264", "-preset", "medium", "-crf", str(crf), "-pix_fmt", "yuv420p", "-threads", "2",
        "-g", "12", "-bf", "0", "-map_metadata", "-1", "-frames:v", "12", str(output)]
    subprocess.run(command, input=b"".join(frame.tobytes() for frame in frames), capture_output=True, check=True, timeout=30)
    video = cv2.VideoCapture(str(output))
    decoded = None
    for _ in range(7):
        ok, decoded = video.read()
        if not ok: raise ValueError("H264 control did not decode its seventh frame")
    video.release()
    return decoded, sha256_file(output)


def variants(image, prefix, work, ffmpeg):
    yield "original", image, {}
    for exposure in [.9, 1.1]:
        yield f"exposure-{exposure:.1f}", np.clip(image.astype(np.float32) * exposure, 0, 255).astype(np.uint8), {"multiplier": exposure}
    for scale in [.75, .5]:
        h, w = image.shape[:2]
        yield f"downscale-{scale}", cv2.resize(image, (round(w*scale), round(h*scale)), interpolation=cv2.INTER_AREA), {"scale": scale}
    yield "gaussian-blur-3-sigma0.5", cv2.GaussianBlur(image, (3, 3), .5), {"kernel": [3, 3], "sigma": .5}
    yield "horizontal-motion-blur-3", cv2.filter2D(image, -1, np.array([[1/3, 1/3, 1/3]], dtype=np.float32)), {"kernelWidth": 3}
    for crf in [19, 23]:
        output = work / f"{prefix}-h264-crf{crf}.mp4"
        decoded, encoded_hash = h264_roundtrip(image, output, ffmpeg, crf)
        yield f"h264-crf{crf}-translation1px", decoded, {"crf": crf, "frames": 12, "sampledFrame": 6, "encodedSha256": encoded_hash}


def score_image(verifier, image, template, allow_multiple=False):
    faces = verifier.faces(image)
    evidence = [{"score": cosine(face["feature"], template), "quality": face["quality"], "qualityReasons": face["qualityReasons"]} for face in faces]
    good = [face for face in evidence if not face["qualityReasons"]]
    if allow_multiple:
        # All detectable negative faces count, including those failing quality: never hide a hard negative.
        chosen = max(evidence, key=lambda face: face["score"]) if evidence else None
    else:
        chosen = good[0] if len(good) == 1 else None
    return {"decodedImageSha256": image_hash(image), "faceCount": len(faces), "qualityFaceCount": len(good),
        "score": chosen["score"] if chosen else None, "faces": evidence,
        "unresolved": chosen is None}


def measure(fixture, model_dir, work, ffmpeg):
    if fixture.get("version") != 1 or fixture.get("preregisteredRule") != RULE or fixture.get("augmentationProfile") != AUGMENTATION_PROFILE:
        raise ValueError("Calibration fixture changed the preregistered rule or transform profile")
    target = fixture["target"]
    for source in [target, *fixture["wrongCharacters"], fixture["rejectedPilot"]]:
        if sha256_file(source["path"]) != source["hash"]: raise ValueError("Calibration fixture source byte hash changed")
    verifier = Verifier(model_dir)
    work.mkdir(parents=True, exist_ok=True)
    image = cv2.imread(target["path"])
    views, positives, negatives = [], [], []
    for region in target["faceRegions"]:
        crop = region_image(image, region)
        good = [face for face in verifier.faces(crop) if not face["qualityReasons"]]
        if len(good) != 1: raise ValueError("Frozen reference ROI lacks one quality face: " + region["name"])
        views.append({"name": region["name"], "image": crop, "feature": good[0]["feature"]})
    gallery = identity_gallery_profile({"references": [target], "identityReferenceHashes": [target["hash"]]})
    centroid = unit(np.mean([view["feature"] for view in views], axis=0))
    for view in views:
        # Every transformed held-out view stays outside its two-view template.
        holdout = unit(np.mean([other["feature"] for other in views if other is not view], axis=0))
        for name, transformed, parameters in variants(view["image"], view["name"], work, ffmpeg):
            positives.append({"kind": "augmented-canonical-held-out-view", "view": view["name"], "transform": name,
                "parameters": parameters, "templateViews": [other["name"] for other in views if other is not view],
                **score_image(verifier, transformed, holdout)})
    for wrong in fixture["wrongCharacters"]:
        wrong_image = cv2.imread(wrong["path"])
        for region in wrong["faceRegions"]:
            for name, transformed, parameters in variants(region_image(wrong_image, region), wrong["canonicalName"] + "-" + region["name"], work, ffmpeg):
                negatives.append({"kind": "wrong-canonical-character", "canonicalName": wrong["canonicalName"], "rawSha256": wrong["hash"],
                    "view": region["name"], "transform": name, "parameters": parameters, **score_image(verifier, transformed, centroid, True)})
    pilot = fixture["rejectedPilot"]
    video = cv2.VideoCapture(pilot["path"])
    if int(video.get(cv2.CAP_PROP_FRAME_COUNT)) != pilot["frameCount"] or abs(video.get(cv2.CAP_PROP_FPS) - pilot["fps"]) > .001:
        raise ValueError("Rejected pilot timing changed")
    for index in range(pilot["frameCount"]):
        ok, frame = video.read()
        if not ok: raise ValueError("Rejected pilot ended before all frames were measured")
        negatives.append({"kind": "user-rejected-pilot", "frame": index,
            "inIntendedTrim": pilot["intendedStartFrame"] <= index < pilot["intendedEndFrameExclusive"],
            **score_image(verifier, frame, centroid, True)})
    video.release()
    positive_scores = [control["score"] for control in positives if control["score"] is not None]
    negative_scores = [control["score"] for control in negatives if control["score"] is not None]
    summary = decision(positive_scores, negative_scores, sum(control["unresolved"] for control in positives), sum(control["unresolved"] for control in negatives))
    summary["negativeGroups"] = {kind: {"count": len(group), "scored": sum(control["score"] is not None for control in group),
        "maximum": max((control["score"] for control in group if control["score"] is not None), default=None)}
        for kind in ["wrong-canonical-character", "user-rejected-pilot"] if (group := [c for c in negatives if c["kind"] == kind])}
    summary["positiveGroups"] = {view["name"]: {"count": len(group), "scored": sum(c["score"] is not None for c in group),
        "minimum": min((c["score"] for c in group if c["score"] is not None), default=None)}
        for view in views if (group := [c for c in positives if c["view"] == view["name"]])}
    summary["pilotIntendedTrimMaximum"] = max((c["score"] for c in negatives
        if c["kind"] == "user-rejected-pilot" and c["inIntendedTrim"] and c["score"] is not None), default=None)
    return {"version": 1, "schema": "project-provisional-identity-controls.v1", "fixtureId": fixture["id"],
        "assessedAt": datetime.now(timezone.utc).isoformat(), "fixtureSha256": stable_hash(fixture),
        "measurementScriptSha256": sha256_file(__file__),
        "automaticPassEnabled": False, "runtimeGateChanged": False, "rule": RULE, "augmentationProfile": AUGMENTATION_PROFILE,
        "modelManifest": verifier.manifest, "runtimePins": verifier.versions,
        "ffmpegVersion": subprocess.run([ffmpeg, "-version"], capture_output=True, text=True, check=True, timeout=10).stdout.splitlines()[0],
        "galleryProfile": gallery, "preprocessVersion": PREPROCESS_VERSION + "-gallery-v2-" + gallery["sha256"],
        "sources": {"target": target, "wrongCharacters": fixture["wrongCharacters"], "rejectedPilot": pilot},
        "summary": summary, "positiveControls": positives, "negativeControls": negatives,
        "limitations": ["Canonical held-out views and their deterministic transforms are correlated controls, not independent accepted generated videos.",
            "Only one independently named wrong-character identity is available; this does not measure population false acceptance or establish a guarantee of subjective likeness.",
            "Synthetic pixel translations, blur and H264 test acquisition robustness, not new expressions, facial motion, occlusions or generated identity drift.",
            "The pilot is a user-rejected clip regression negative; its individual frames are not separately user-labelled identity decisions.",
            "No runtime acceptance policy or automatic pass is enabled by this diagnostic report."]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixture", required=True, type=Path)
    parser.add_argument("--model-dir", required=True, type=Path)
    parser.add_argument("--work-dir", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--ffmpeg", default=shutil.which("ffmpeg"))
    args = parser.parse_args()
    if not args.ffmpeg: raise ValueError("FFmpeg is required for the preregistered compression controls")
    report = measure(json.loads(args.fixture.read_text()), args.model_dir, args.work_dir, args.ffmpeg)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2))
    print(json.dumps(report["summary"], indent=2))


if __name__ == "__main__": main()
