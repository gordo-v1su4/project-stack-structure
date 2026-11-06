import copy
import json
from pathlib import Path
import unittest
from measure_frontal_scope import frontal_scope


class FrontalScopeTests(unittest.TestCase):
    def setUp(self):
        self.scope = json.loads(Path(__file__).with_name("frontal-draft-filter-experiment.v1.json").read_text())["scope"]
        self.face = {"box": [20, 20, 180, 220], "quality": {"widthPixels": 180, "heightPixels": 220,
            "detectionScore": .97, "blurVariance": 200, "meanLuminance": 110},
            "landmarks": [70, 80, 150, 80, 110, 130, 85, 170, 135, 170]}

    def test_frontal_geometry_passes_and_asymmetric_nose_mouth_or_roll_abstain(self):
        self.assertTrue(frontal_scope(self.face, (300, 250, 3), self.scope)["eligible"])
        for landmarks in [[70, 80, 150, 80, 135, 130, 85, 170, 135, 170],
            [70, 80, 150, 80, 110, 130, 100, 170, 150, 170],
            [70, 70, 150, 90, 110, 130, 85, 170, 135, 170]]:
            self.assertFalse(frontal_scope({**self.face, "landmarks": landmarks}, (300, 250, 3), self.scope)["eligible"])

    def test_inadequate_quality_clipped_geometry_missing_landmarks_and_extra_faces_abstain(self):
        for field, value in [("widthPixels", 127), ("heightPixels", 159), ("detectionScore", .93),
            ("blurVariance", 99), ("meanLuminance", 59), ("meanLuminance", 191)]:
            face = copy.deepcopy(self.face)
            face["quality"][field] = value
            self.assertFalse(frontal_scope(face, (300, 250, 3), self.scope)["eligible"])
        self.assertFalse(frontal_scope({**self.face, "landmarks": []}, (300, 250, 3), self.scope)["eligible"])
        self.assertFalse(frontal_scope({**self.face, "box": [-1, 0, 180, 220]}, (300, 250, 3), self.scope)["eligible"])
        self.assertFalse(frontal_scope(self.face, (300, 250, 3), self.scope, 2)["eligible"])


if __name__ == "__main__": unittest.main()
