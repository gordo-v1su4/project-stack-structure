"""Deterministic CPU face measurements. An uncalibrated profile NEVER passes."""
import os
os.environ["OMP_NUM_THREADS"] = "2"
os.environ["OPENBLAS_NUM_THREADS"] = "2"
os.environ["MKL_NUM_THREADS"] = "2"

import argparse
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
import math
from pathlib import Path
import platform
import re

import cv2
import numpy as np
import onnxruntime as ort
from download_models import sha256_file

VERSION = "sface-yunet-cpu-v1"
PREPROCESS_VERSION = "opencv412-aligncrop112-rgb-f32-nchw-unit-centroid-v1"
MODEL = "opencv-sface-2021dec-yunet-2023mar"
HASH = re.compile(r"^[a-f0-9]{64}$")
PINS = {"numpy": "2.2.6", "opencv-python-headless": "4.12.0.88", "onnxruntime": "1.23.2"}


def unit(vector):
    vector = np.asarray(vector, dtype=np.float32).reshape(-1)
    norm = float(np.linalg.norm(vector))
    if not np.isfinite(vector).all() or norm <= 0:
        raise ValueError("Invalid face feature vector")
    return vector / norm


def cosine(left, right):
    return float(np.clip(unit(left) @ unit(right), -1, 1))


def overlap(left, right):
    x, y = max(left[0], right[0]), max(left[1], right[1])
    width = max(0, min(left[0] + left[2], right[0] + right[2]) - x)
    height = max(0, min(left[1] + left[3], right[1] + right[3]) - y)
    intersection = width * height
    return float(intersection / max(1, left[2] * left[3] + right[2] * right[3] - intersection))


def validate_input(value):
    if value.get("version") != 1:
        raise ValueError("Unsupported identity input version")
    for field in ["assetId", "jobId", "generationModel", "videoPath"]:
        if not isinstance(value.get(field), str) or not value[field].strip():
            raise ValueError("Missing identity binding: " + field)
    for field in ["generationReferenceHashes", "identityReferenceHashes"]:
        hashes = value.get(field)
        if not isinstance(hashes, list) or len(hashes) > 32 or len(set(hashes)) != len(hashes) or any(not isinstance(h, str) or not HASH.fullmatch(h) for h in hashes):
            raise ValueError("Invalid identity binding hashes: " + field)
    if not HASH.fullmatch(value.get("mediaSha256", "")):
        raise ValueError("Missing media SHA256")
    if not set(value["identityReferenceHashes"]).issubset(value["generationReferenceHashes"]):
        raise ValueError("Identity references are outside the generation package")
    if not isinstance(value.get("frameCount"), int) or not 1 <= value["frameCount"] <= 512:
        raise ValueError("Identity verification requires 1–512 measured video frames")
    if not isinstance(value.get("fps"), (int, float)) or not math.isfinite(value["fps"]) or value["fps"] <= 0:
        raise ValueError("Missing measured frame rate")
    if not isinstance(value.get("durationSeconds"), (int, float)) or not math.isfinite(value["durationSeconds"]) or value["durationSeconds"] <= 0:
        raise ValueError("Missing measured video duration")
    start = value.get("verifiedStartFrame", 0)
    end = value.get("verifiedEndFrameExclusive", value.get("verifiedEndFrame", value["frameCount"]))
    if not isinstance(start, int) or not isinstance(end, int) or not 0 <= start < end <= value["frameCount"]:
        raise ValueError("Invalid half-open verification frame scope")
    value["verifiedStartFrame"], value["verifiedEndFrameExclusive"] = start, end
    references = value.get("references")
    if not isinstance(references, list) or len(references) > 32:
        raise ValueError("Missing reference image bindings")
    by_hash = {}
    for reference in references:
        if not isinstance(reference, dict) or not HASH.fullmatch(reference.get("hash", "")) or reference["hash"] in by_hash:
            raise ValueError("Invalid or duplicate reference image binding")
        if not isinstance(reference.get("path"), str) or not isinstance(reference.get("canonicalName"), str) or not reference["canonicalName"].strip():
            raise ValueError("Missing local named reference image")
        by_hash[reference["hash"]] = reference
        for region in reference.get("faceRegions", []):
            rect = region.get("rect", [])
            if len(rect) != 4 or any(not isinstance(x, (int, float)) or not math.isfinite(x) for x in rect):
                raise ValueError("Invalid normalized reference face region")
            if min(rect) < 0 or rect[2] <= 0 or rect[3] <= 0 or rect[0] + rect[2] > 1 or rect[1] + rect[3] > 1:
                raise ValueError("Reference face region is outside its image")
    if set(by_hash) != set(value["generationReferenceHashes"]):
        raise ValueError("Reference files do not match the generation package")
    declared_identity_hashes = [h for h in value["generationReferenceHashes"] if by_hash[h].get("role") == "identity"]
    if declared_identity_hashes != value["identityReferenceHashes"]:
        raise ValueError("Identity hashes do not match the ordered identity-conditioning references")
    for reference_hash in value["identityReferenceHashes"]:
        if by_hash[reference_hash].get("role") != "identity":
            raise ValueError("Required character reference is not declared as identity")
    return value


class Verifier:
    def __init__(self, model_dir):
        versions = {name: importlib.metadata.version(name) for name in PINS}
        if versions != PINS:
            raise ValueError("Identity runtime differs from the pinned requirements")
        cv2.setNumThreads(2)
        cv2.ocl.setUseOpenCL(False)
        manifest = json.loads(Path(__file__).with_name("model-manifest.json").read_text())
        self.manifest = manifest
        self.versions = versions
        self.paths = {}
        for model in manifest["models"]:
            path = Path(model_dir) / model["file"]
            if not path.is_file() or path.stat().st_size != model["size"] or sha256_file(path) != model["sha256"]:
                raise ValueError("Identity model does not match the pinned official SHA256: " + model["file"])
            self.paths[model["file"]] = str(path)
        recognition = self.paths["face_recognition_sface_2021dec.onnx"]
        self.detector = cv2.FaceDetectorYN.create(self.paths["face_detection_yunet_2023mar.onnx"], "", (640, 640), .6, .3, 5000, cv2.dnn.DNN_BACKEND_OPENCV, cv2.dnn.DNN_TARGET_CPU)
        self.aligner = cv2.FaceRecognizerSF.create(recognition, "", cv2.dnn.DNN_BACKEND_OPENCV, cv2.dnn.DNN_TARGET_CPU)
        options = ort.SessionOptions()
        options.intra_op_num_threads, options.inter_op_num_threads = 2, 1
        options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        options.log_severity_level = 3
        self.recognizer = ort.InferenceSession(recognition, sess_options=options, providers=["CPUExecutionProvider"])
        self.input_name = self.recognizer.get_inputs()[0].name

    def feature(self, image, face):
        aligned = self.aligner.alignCrop(image, np.asarray(face, dtype=np.float32))
        # Match official FaceRecognizerSF::feature: RGB float32, scale=1, mean=0.
        tensor = np.ascontiguousarray(cv2.cvtColor(aligned, cv2.COLOR_BGR2RGB).transpose(2, 0, 1)[None], dtype=np.float32)
        return unit(self.recognizer.run(None, {self.input_name: tensor})[0])

    def faces(self, image):
        height, width = image.shape[:2]
        scale = min(1, 640 / max(height, width))
        small = cv2.resize(image, (max(1, round(width * scale)), max(1, round(height * scale)))) if scale < 1 else image
        self.detector.setInputSize((small.shape[1], small.shape[0]))
        _, detected = self.detector.detect(small)
        output = []
        for raw in [] if detected is None else detected:
            face = raw.copy()
            face[:14] /= scale
            x, y, w, h = [float(v) for v in face[:4]]
            crop = image[max(0, int(y)):min(height, int(y+h)), max(0, int(x)):min(width, int(x+w))]
            if not crop.size:
                continue
            gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
            quality = {"detectionScore": float(face[14]), "widthPixels": w, "heightPixels": h,
                "blurVariance": float(cv2.Laplacian(gray, cv2.CV_64F).var()), "meanLuminance": float(gray.mean())}
            # Conservative diagnostic limits, not validated production quality calibration.
            reasons = []
            if quality["detectionScore"] < .9: reasons.append("low_detection_confidence")
            if min(w, h) < 64: reasons.append("face_too_small")
            if quality["blurVariance"] < 50: reasons.append("face_blurred")
            if not 30 <= quality["meanLuminance"] <= 225: reasons.append("face_illumination_insufficient")
            output.append({"box": [x, y, w, h], "feature": self.feature(image, face), "quality": quality, "qualityReasons": reasons, "landmarks": face[4:14].tolist()})
        return output

    def gallery(self, reference):
        image = cv2.imread(reference["path"])
        if image is None: raise ValueError("Reference image cannot be decoded")
        views = []
        regions = reference.get("faceRegions")
        for region in regions or [{"name": "whole-sheet", "rect": [0, 0, 1, 1]}]:
            x, y, w, h = region["rect"]
            height, width = image.shape[:2]
            crop = image[round(y*height):round((y+h)*height), round(x*width):round((x+w)*width)]
            faces = self.faces(crop)
            good = [face for face in faces if not face["qualityReasons"]]
            if regions and len(good) != 1:
                return None, {"reason": "reference_region_has_no_unique_quality_face", "region": region["name"]}
            for index, face in enumerate(good):
                views.append({**face, "name": region["name"] + (f"-{index}" if not regions else "")})
        if not views or len(views) > 9:
            return None, {"reason": "reference_gallery_unverifiable"}
        centroid = unit(np.mean([view["feature"] for view in views], axis=0))
        pairs = {view["name"]: {other["name"]: cosine(view["feature"], other["feature"]) for other in views} for view in views}
        loo = {view["name"]: cosine(view["feature"], np.mean([other["feature"] for other in views if other is not view], axis=0)) for view in views} if len(views) > 1 else {}
        evidence = {"viewCount": len(views), "pairCosines": pairs, "leaveOneViewOutCosines": loo,
            "views": [{"name": view["name"], "quality": view["quality"]} for view in views]}
        return centroid, evidence


def assess(value, model_dir, sample_count=None):
    value = validate_input(value)
    if sha256_file(value["videoPath"]) != value["mediaSha256"]:
        raise ValueError("Video bytes changed from the worker binding")
    for reference in value["references"]:
        if sha256_file(reference["path"]) != reference["hash"]:
            raise ValueError("Reference bytes changed from the worker binding")
    verifier = Verifier(model_dir)
    start, end = value["verifiedStartFrame"], value["verifiedEndFrameExclusive"]
    report = {"version": 1, "status": "unverifiable", "assetId": value["assetId"], "jobId": value["jobId"],
        "generationModel": value["generationModel"], "mediaSha256": value["mediaSha256"],
        "referenceHashes": value["generationReferenceHashes"], "identityReferenceHashes": value["identityReferenceHashes"],
        "durationSeconds": value["durationSeconds"], "frameCount": value["frameCount"], "frameRate": value["fps"],
        "verifiedStartFrame": start, "verifiedEndFrameExclusive": end, "examinedFrameCount": 0,
        "unverifiableFrameCount": 0, "ambiguousFrameCount": 0,
        "assessedAt": datetime.now(timezone.utc).isoformat(), "verifier": {"method": "face-embedding-cosine", "model": MODEL,
        "modelSha256": verifier.manifest["models"][0]["sha256"], "version": VERSION, "preprocessVersion": PREPROCESS_VERSION,
        "calibrationId": "uncalibrated-no-automatic-pass-v1"}, "coverage": "incomplete", "samples": [],
        "reason": "No validated SFace likeness calibration exists. Measurements cannot authorize automatic selection.",
        "diagnostics": {"runtime": {**verifier.versions, "python": platform.python_version(), "recognitionProvider": "CPUExecutionProvider",
        "intraOpThreads": 2, "interOpThreads": 1, "opencvThreads": 2}, "modelManifest": verifier.manifest,
        "qualityLimitsStatus": "provisional-not-calibrated", "galleries": {}, "frames": []}}
    if not value["identityReferenceHashes"]:
        report.update(status="not_required", coverage="not_required", reason="The shot has no identity-conditioning references.")
        return report
    references = {reference["hash"]: reference for reference in value["references"]}
    templates = {}
    for reference_hash in value["identityReferenceHashes"]:
        template, evidence = verifier.gallery(references[reference_hash])
        report["diagnostics"]["galleries"][reference_hash] = evidence
        if template is not None: templates[reference_hash] = template
    if len(templates) != len(value["identityReferenceHashes"]):
        report["reason"] = "A required canonical face gallery could not be verified."
        return report
    video = cv2.VideoCapture(value["videoPath"])
    if not video.isOpened(): raise ValueError("Video cannot be decoded")
    measured_count, measured_fps = int(video.get(cv2.CAP_PROP_FRAME_COUNT)), float(video.get(cv2.CAP_PROP_FPS))
    if measured_count != value["frameCount"] or abs(measured_fps-value["fps"]) > .001:
        video.release()
        raise ValueError("Decoded video timing differs from the worker binding")
    selected = set(range(start, end))
    if sample_count is not None:
        if sample_count < 1 or sample_count > 512: raise ValueError("Invalid diagnostic sample count")
        selected = set(int(round(i)) for i in np.linspace(start, end-1, min(sample_count, end-start)))
    previous = []
    next_track = 0
    required_tracks = {}
    try:
        for index in range(end):
            ok, image = video.read()
            if not ok: break
            if index not in selected: continue
            report["examinedFrameCount"] += 1
            faces = verifier.faces(image)
            associations = sorted([(overlap(face["box"], old["box"]), fi, oi) for fi, face in enumerate(faces) for oi, old in enumerate(previous)], reverse=True)
            used_faces, used_old = set(), set()
            for score, fi, oi in associations:
                if score < .15 or fi in used_faces or oi in used_old: continue
                faces[fi]["trackId"] = previous[oi]["trackId"]
                used_faces.add(fi); used_old.add(oi)
            for face in faces:
                if "trackId" not in face:
                    face["trackId"] = f"face-{next_track}"
                    next_track += 1
            previous = faces
            frame_hash = hashlib.sha256(str(image.shape).encode() + image.tobytes()).hexdigest()
            sample = {"timeSeconds": index/value["fps"], "frameSha256": frame_hash, "scores": []}
            diagnostic = {"frame": index, "faces": [{key: face[key] for key in ["box", "trackId", "quality", "qualityReasons"]} for face in faces], "assignments": []}
            assigned, missing, ambiguous = set(), False, False
            for reference_hash, template in templates.items():
                ranked = sorted([(cosine(face["feature"], template), fi) for fi, face in enumerate(faces)], reverse=True)
                if not ranked:
                    missing = True
                    diagnostic["assignments"].append({"referenceHash": reference_hash, "reason": "no_detectable_face"})
                    continue
                score, fi = ranked[0]
                face = faces[fi]
                reasons = list(face["qualityReasons"])
                if fi in assigned or (len(ranked) > 1 and score-ranked[1][0] < .08):
                    ambiguous = True; reasons.append("face_assignment_ambiguous")
                if reference_hash in required_tracks and required_tracks[reference_hash] != face["trackId"]:
                    ambiguous = True; reasons.append("required_character_track_changed")
                required_tracks.setdefault(reference_hash, face["trackId"])
                assigned.add(fi)
                diagnostic["assignments"].append({"referenceHash": reference_hash, "trackId": face["trackId"], "score": score, "reasons": reasons})
                if reasons:
                    missing = True
                else:
                    sample["scores"].append({"referenceHash": reference_hash, "trackId": face["trackId"], "score": score})
            if missing: report["unverifiableFrameCount"] += 1
            if ambiguous: report["ambiguousFrameCount"] += 1
            report["samples"].append(sample)
            report["diagnostics"]["frames"].append(diagnostic)
    finally:
        video.release()
    if report["ambiguousFrameCount"]:
        report["coverage"] = "ambiguous"
    elif report["examinedFrameCount"] == end-start and not report["unverifiableFrameCount"]:
        report["coverage"] = "complete"
    threshold = value.get("provisionalThreshold")
    if threshold is not None:
        if not isinstance(threshold, (int, float)) or not math.isfinite(threshold) or not 0 < threshold <= 1:
            raise ValueError("Invalid provisional diagnostic threshold")
        report["threshold"] = threshold
        report["diagnostics"]["provisionalThresholdCannotGrantPass"] = True
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--sample-count", type=int, help="Diagnostic only; does not establish full frame coverage")
    args = parser.parse_args()
    value = json.loads(Path(args.input).read_text(encoding="utf-8-sig"))
    report = assess(value, args.model_dir, args.sample_count)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + ".partial")
    temporary.write_text(json.dumps(report, indent=2, allow_nan=False), encoding="utf-8")
    temporary.replace(output)
    print(json.dumps({"status": report["status"], "coverage": report["coverage"], "examinedFrameCount": report["examinedFrameCount"], "output": str(output)}))


if __name__ == "__main__":
    main()
