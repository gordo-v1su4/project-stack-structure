import { describe, expect, test } from "bun:test";
import { RAMP_PRESETS, STUTTER_PRESETS } from "../../src/components/studio/remapPresets";

describe("remap preset banks", () => {
  test("provides ten timing remap curve presets", () => {
    expect(RAMP_PRESETS).toHaveLength(10);
    expect(new Set(RAMP_PRESETS.map((preset) => preset.key)).size).toBe(10);
    for (const preset of RAMP_PRESETS) {
      expect(preset.shape.length).toBeGreaterThanOrEqual(8);
      expect(preset.minSpeed).toBeGreaterThan(0);
      expect(preset.maxSpeed).toBeGreaterThan(preset.minSpeed);
      expect(preset.shape.every((point) => point >= 0 && point <= 1)).toBe(true);
    }
  });

  test("provides ten working stutter arrangements", () => {
    expect(STUTTER_PRESETS).toHaveLength(10);
    expect(new Set(STUTTER_PRESETS.map((preset) => preset.key)).size).toBe(10);
    for (const preset of STUTTER_PRESETS) {
      expect(preset.minDur).toBeGreaterThan(0);
      expect(preset.maxDur).toBeGreaterThan(preset.minDur);
      expect(preset.lowEnergyRange).toBeLessThan(preset.highEnergyRange);
      expect(preset.laneShape.every((point) => point >= 0 && point <= 1)).toBe(true);
    }
  });
});
