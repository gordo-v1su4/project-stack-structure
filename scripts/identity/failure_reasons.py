"""Bounded diagnostic counts only; never decides draft eligibility."""

REASON_NAMES = {
    "minimumFaceWidthPixels": "face_too_small",
    "minimumFaceHeightPixels": "face_too_small",
    "minimumDetectionScore": "low_detection_confidence",
    **{name: name for name in (
        "invalid_face_box", "face_box_clipped", "landmarks_unavailable",
        "eye_distance_too_small", "invalid_eye_geometry", "roll_outside_scope",
        "nose_yaw_proxy_outside_scope", "mouth_yaw_proxy_outside_scope",
        "nose_depth_geometry_invalid", "mouth_depth_geometry_invalid",
        "missing_face", "missing_required_face", "ambiguous_face_count",
        "excessive_face_count", "missing_reference_template", "non_finite_similarity",
        "below_similarity_threshold", "background_outside_dominance_scope",
        "lead_not_unique_largest", "duplicate_track_id", "assignment_margin",
        "track_changed", "track_discontinuous", "frame_sequence_gap",
    )},
}


def record_failure_reasons(evaluator, reasons):
    # Each observe path records once. Deduplicate joint-face and width/height
    # failures within that frame so the denominator is always assessed frames.
    if not hasattr(evaluator, "failure_reason_counts"):
        evaluator.failure_reason_counts = {}
    for name in {REASON_NAMES[reason] for reason in reasons if reason in REASON_NAMES}:
        evaluator.failure_reason_counts[name] = evaluator.failure_reason_counts.get(name, 0) + 1


def append_failure_reason_warnings(evaluator):
    assessed = evaluator.evidence["examinedFrameCount"]
    for name, count in sorted(getattr(evaluator, "failure_reason_counts", {}).items()):
        warning = f"Draft filter reason: {name} on {count}/{assessed} frames."
        if warning not in evaluator.evidence["warnings"]:
            evaluator.evidence["warnings"].append(warning)
