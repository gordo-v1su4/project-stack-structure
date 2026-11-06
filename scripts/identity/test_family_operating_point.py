import copy
import unittest

import numpy as np

from draft_similarity_filter import requested_draft_filter
from issued_policy import load_family
from prepare_policy import face_regions
from test_issued_policy import fixture, face


class FamilyOperatingPointTests(unittest.TestCase):
    def test_v2_changes_only_id_and_detection_minimum_while_v1_pins_remain_exact(self):
        old_pins = {"foreground": "15c8acceeb809a13c4d322b03fd4967c3013ab78610774df1f3b3b28f3ad391b",
            "joint": "b6f5526099fc483a1fa0573f79636b40304e00e37c0074b1014cba15d6424b95"}
        for kind, pin in old_pins.items():
            old = load_family(f"sface-yunet-{kind}-frontal-v1")
            new = load_family(f"sface-yunet-{kind}-frontal-v2")
            self.assertEqual(old["sha256"], pin)
            self.assertEqual(old["frontalGeometry"]["minimumDetectionScore"], .94)
            self.assertEqual(new["frontalGeometry"]["minimumDetectionScore"], .90)
            normalized = copy.deepcopy(new)
            normalized.update(id=old["id"], sha256=old["sha256"])
            normalized["frontalGeometry"]["minimumDetectionScore"] = .94
            self.assertEqual(normalized, old)

    def evaluate(self, joint, version, change=None):
        value, metadata, manifest, gallery = fixture(joint=joint, version=version)
        evaluator = requested_draft_filter(value, metadata, manifest, gallery)
        hashes = value["identityReferenceHashes"]
        templates = {raw: np.eye(3)[index] for index, raw in enumerate(hashes)}
        for index in range(3):
            faces = [face(x=20, track="first", feature=[.9, .1, np.sqrt(.18)])]
            if joint: faces.append(face(x=700, track="second", feature=[.1, .9, np.sqrt(.18)]))
            for detected in faces: detected["quality"]["detectionScore"] = .934
            if index == 1 and change:
                if change == "low_detection": faces[0]["quality"]["detectionScore"] = .899
                if change == "low_similarity": faces[0]["feature"] = np.array([.79, .1, np.sqrt(1-.79**2-.1**2)])
                if change == "yaw": faces[0]["landmarks"][4] += 50
                if change == "track": faces[0]["trackId"] = "changed"
                if change == "small": faces[0]["quality"]["widthPixels"] = 127
                if change == "missing": faces = faces[:-1]
            evaluator.observe(index, 24, f"{index:064x}", (768, 1344, 3), faces, templates if joint else templates[hashes[0]])
        return evaluator.finish()

    def test_934_detector_confidence_passes_only_new_family_if_every_other_check_passes(self):
        for joint in [False, True]:
            old, new = self.evaluate(joint, 1), self.evaluate(joint, 2)
            self.assertEqual((old["status"], old["eligibleFrameCount"]), ("ineligible", 0))
            self.assertEqual((new["status"], new["eligibleFrameCount"]), ("eligible", 3))
            self.assertEqual(old["threshold"], .8)
            self.assertEqual(new["threshold"], .8)

    def test_v2_still_rejects_low_score_detection_geometry_size_missing_faces_and_track_changes(self):
        for joint in [False, True]:
            for change in ["low_detection", "low_similarity", "yaw", "small", "missing", "track"]:
                with self.subTest(joint=joint, change=change):
                    self.assertNotEqual(self.evaluate(joint, 2, change)["status"], "eligible")

    def test_preflight_uses_explicit_requested_family_and_cannot_change_other_bounds(self):
        class Fake:
            def __init__(self): self.calls = 0
            def faces(self, image):
                self.calls += 1
                candidate = face(x=100) if self.calls == 1 else face(x=72, y=86)
                candidate["quality"]["detectionScore"] = .934
                return [candidate]
        image = np.zeros((768, 1344, 3), dtype=np.uint8)
        for kind in ["foreground", "joint"]:
            self.assertEqual(face_regions(Fake(), image, load_family(f"sface-yunet-{kind}-frontal-v1"))[1], "no-frontal-anchor")
            self.assertIsNone(face_regions(Fake(), image, load_family(f"sface-yunet-{kind}-frontal-v2"))[1])


if __name__ == "__main__": unittest.main()
