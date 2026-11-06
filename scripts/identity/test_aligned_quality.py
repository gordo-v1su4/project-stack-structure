import unittest
import numpy as np
from measure_aligned_quality import metrics_from_aligned, derive_limits, quality_reasons


class AlignedQualityTests(unittest.TestCase):
    def test_quality_limits_derive_only_from_controls_by_fixed_factors(self):
        limits = derive_limits([{"laplacianVariance": 200, "meanLuminance": 100}, {"laplacianVariance": 100, "meanLuminance": 120}],
            {"minimumSharpnessFactorOfWorstPositive": .9, "minimumLuminanceFactorOfWorstPositive": .9, "maximumLuminanceFactorOfWorstPositive": 1.1})
        self.assertEqual(limits, {"minimumLaplacianVariance": 90., "minimumLuminance": 90., "maximumLuminance": 132.})
        self.assertEqual(quality_reasons({"laplacianVariance": 89., "meanLuminance": 89.}, limits), ["aligned_blur", "aligned_luminance_low"])

    def test_metric_uses_exact_aligned_size_and_excludes_transform_borders(self):
        image = np.full((112, 112, 3), 100, dtype=np.uint8)
        image[:8] = 255
        metrics = metrics_from_aligned(image)
        self.assertEqual(metrics["meanLuminance"], 100.)
        self.assertEqual(metrics["laplacianVariance"], 0.)
        with self.assertRaisesRegex(ValueError, "112x112"):
            metrics_from_aligned(np.zeros((224, 224, 3), dtype=np.uint8))


if __name__ == "__main__": unittest.main()
