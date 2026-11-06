"""Apply frozen control geometry to a target clip; diagnostic only, no runtime proof writes."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import json
import math
from pathlib import Path

from download_models import sha256_file
from verify import Verifier, cv2, identity_gallery_profile, overlap
from measure_frontal_scope import control, PREREGISTERED_FILE_SHA256
import measure_frontal_scope


def measure(control_path, video_path, jobs_path, job_id, model_dir):
    controls = json.loads(control_path.read_text())
    if controls["experimentFileSha256"] != PREREGISTERED_FILE_SHA256 or controls["summary"]["status"] != "project_local_frontal_draft_filter_controls_supported":
        raise ValueError("The frontal control experiment is not supported or has changed")
    if sha256_file(measure_frontal_scope.__file__) != controls["measurementScriptSha256"]:
        raise ValueError("Frozen frontal-scope measurement code changed")
    experiment = controls["experiment"]
    if sha256_file(experiment["baselineFixturePath"]) != experiment["baselineFixtureFileSha256"]:
        raise ValueError("Frozen reference fixture bytes changed")
    fixture = json.loads(Path(experiment["baselineFixturePath"]).read_text())
    value = json.loads(jobs_path.read_text())
    jobs = value if isinstance(value, list) else value.get("jobs", [value.get("job", value)])
    job = next(job for job in jobs if job["id"] == job_id)
    asset = job["result"]["asset"]
    media_hash = sha256_file(video_path)
    if media_hash != asset["mediaSha256"]: raise ValueError("Target media differs from stored output binding")
    target = fixture["target"]
    if sha256_file(target["path"]) != target["hash"] or target["hash"] not in job["referenceHashes"]:
        raise ValueError("Target reference bytes differ from frozen raw authority")
    gallery = identity_gallery_profile({"references": [target], "identityReferenceHashes": [target["hash"]]})
    if gallery != controls["galleryProfile"]: raise ValueError("Target gallery differs from frozen controls")
    verifier = Verifier(model_dir)
    if verifier.manifest != controls["modelManifest"] or verifier.versions != controls["runtimePins"]:
        raise ValueError("Target model runtime differs from frozen controls")
    template, evidence = verifier.gallery(target)
    if template is None: raise ValueError("Frozen raw authority face gallery is unavailable")
    video = cv2.VideoCapture(str(video_path))
    frame_count, fps = int(video.get(cv2.CAP_PROP_FRAME_COUNT)), float(video.get(cv2.CAP_PROP_FPS))
    if frame_count != job["frames"] or fps != 24: raise ValueError("Target video timing differs from stored output")
    start = math.floor(asset.get("trimStart", 0) * fps + 1e-6)
    end = start + math.ceil((job["request"]["songEnd"] - job["request"]["songStart"]) * fps - 1e-6)
    if not 0 <= start < end <= frame_count: raise ValueError("Target requested trim is outside the measured output")
    threshold = controls["summary"]["candidateThreshold"]
    if threshold < .80: raise ValueError("Target threshold is below the frozen floor")
    frames, previous_box = [], None
    for index in range(end):
        ok, image = video.read()
        if not ok: raise ValueError("Target video did not decode its entire selected trim")
        if index < start: continue
        measured = control(verifier, image, template, experiment["scope"])
        box = measured["faces"][0]["box"] if measured["faceCount"] == 1 else None
        continuity = overlap(box, previous_box) if box is not None and previous_box is not None else None
        frames.append({"frame": index, "timeSeconds": index / fps, **measured,
            "meetsFrozenScopeAndScore": measured["scopeEligible"] and measured["scopeScore"] >= threshold,
            "singleFacePreviousBoxIoU": continuity})
        previous_box = box
    video.release()
    reason_counts = Counter(reason for frame in frames for face in frame["faces"] for reason in face["scope"]["reasons"])
    scores = [frame["maximumUnfilteredScore"] for frame in frames if frame["maximumUnfilteredScore"] is not None]
    eligible_scores = [frame["scopeScore"] for frame in frames if frame["scopeEligible"]]
    summary = {"intendedFrames": end-start, "examinedFrames": len(frames), "scopeEligibleFrames": len(eligible_scores),
        "outOfScopeFrames": sum(not frame["scopeEligible"] for frame in frames),
        "minimumCosineAllDetectableFrames": min(scores) if scores else None,
        "maximumCosineAllDetectableFrames": max(scores) if scores else None,
        "minimumCosineInScope": min(eligible_scores) if eligible_scores else None,
        "scopeAndScoreEligibleFrames": sum(frame["meetsFrozenScopeAndScore"] for frame in frames),
        "inScopeFramesBelowThreshold": sum(frame["scopeEligible"] and frame["scopeScore"] < threshold for frame in frames),
        "allIntendedFramesMeetFrozenScopeAndScore": all(frame["meetsFrozenScopeAndScore"] for frame in frames),
        "outOfScopeReasonCounts": dict(reason_counts),
        "missingOrMultipleFaceFrames": sum(frame["faceCount"] != 1 for frame in frames),
        "singleFaceTrackingIoUBelow0_15": sum(frame["singleFacePreviousBoxIoU"] is not None and frame["singleFacePreviousBoxIoU"] < .15 for frame in frames)}
    return {"version": 1, "schema": "frozen-frontal-project-draft-filter-target-measurement.v1",
        "assessedAt": datetime.now(timezone.utc).isoformat(), "automaticPassEnabled": False, "runtimeGateChanged": False,
        "assetId": asset["id"], "jobId": job["id"], "generationModel": job["profile"],
        "mediaSha256": media_hash, "rawAuthorityHashes": job["referenceHashes"],
        "conditioningReferenceHashes": job.get("conditioningReferenceHashes"),
        "frameCount": frame_count, "fps": fps, "verifiedStartFrame": start, "verifiedEndFrameExclusive": end,
        "threshold": threshold, "controlReportFileSha256": sha256_file(control_path),
        "experimentFileSha256": controls["experimentFileSha256"], "scopeSha256": controls["scopeSha256"],
        "frozenScopeScriptSha256": controls["measurementScriptSha256"], "targetMeasurementScriptSha256": sha256_file(__file__),
        "galleryProfile": gallery, "preprocessVersion": controls["preprocessVersion"], "modelManifest": verifier.manifest,
        "summary": summary, "frames": frames,
        "limitations": ["This applies an unchanged project-local provisional draft filter; it is not validated identity accuracy or creative approval.",
            "The target was not included in the frozen canonical controls or threshold selection.",
            "All intended frames must satisfy the frozen scope and threshold; no mean/percentile/best-frame exemption is applied.",
            "Numeric evidence is not written into the production job, asset proof or selection state by this diagnostic tool."]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--control-report", required=True, type=Path)
    parser.add_argument("--video", required=True, type=Path)
    parser.add_argument("--jobs", required=True, type=Path)
    parser.add_argument("--job-id", required=True)
    parser.add_argument("--model-dir", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    report = measure(args.control_report, args.video, args.jobs, args.job_id, args.model_dir)
    args.output.write_text(json.dumps(report, indent=2))
    print(json.dumps(report["summary"], indent=2))


if __name__ == "__main__": main()
