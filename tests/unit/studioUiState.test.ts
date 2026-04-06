import { describe, expect, test } from "bun:test";

import { createSectionRecomputeState } from "../../src/components/studio/sectionRecompute";
import {
  buildPreviewAssetUrl,
  deriveActionDisabledState,
  deriveCompletedLabel,
  deriveEffectiveClipOrder,
  deriveManifestRankingMode,
  derivePreviewStatusLabel,
  derivePreviewWindow,
  getPreviewAssetFileName,
  normalizeColorScore,
} from "../../src/components/studio/studioUiState";

describe("studioUiState", () => {
  test("derives a bounded preview window from the active segment", () => {
    const window = derivePreviewWindow({
      tab: "split",
      splitSegments: [{ duration: 2.4 }, { duration: 0.8 }],
      beatSplitSegments: [],
      splitActiveClip: 1,
      beatActiveClip: 0,
      rampDur: 0.4,
    });

    expect(window.startTime).toBe(0);
    expect(window.endTime).toBe(0.8);
  });

  test("maps shuffle modes to supported manifest ranking modes", () => {
    expect(deriveManifestRankingMode("motion")).toBe("motion");
    expect(deriveManifestRankingMode("color")).toBe("color");
    expect(deriveManifestRankingMode("size")).toBe("random");
    expect(deriveManifestRankingMode("simple")).toBe("random");
  });

  test("prefers ranked order only when it matches the segment preview count", () => {
    expect(
      deriveEffectiveClipOrder({ manifestSegmentCount: 3, segmentPreviewCount: 3, rankedOrder: [2, 1, 0], fallbackOrder: [0, 1, 2] }),
    ).toEqual([2, 1, 0]);
    expect(
      deriveEffectiveClipOrder({ manifestSegmentCount: 2, segmentPreviewCount: 3, rankedOrder: [1, 0], fallbackOrder: [0, 1, 2] }),
    ).toEqual([0, 1, 2]);
  });

  test("derives disabled state and reason from missing sources or active preview", () => {
    expect(
      deriveActionDisabledState({ needsVideoSource: true, videoSourceCount: 0, requiresAudioSource: false, hasAudioSource: false, activeRequestKey: null }),
    ).toEqual({ disabled: true, reason: "Upload video clips to continue." });
    expect(
      deriveActionDisabledState({ needsVideoSource: false, videoSourceCount: 3, requiresAudioSource: true, hasAudioSource: false, activeRequestKey: null }),
    ).toEqual({ disabled: true, reason: "Upload a song to unlock Beat Join." });
    expect(
      deriveActionDisabledState({ needsVideoSource: false, videoSourceCount: 3, requiresAudioSource: false, hasAudioSource: true, activeRequestKey: "req-1" }),
    ).toEqual({ disabled: true, reason: "Preview already running." });
  });

  test("derives preview status labels and completed labels", () => {
    const state = createSectionRecomputeState();
    expect(derivePreviewStatusLabel(state)).toBe("Ready");
    expect(deriveCompletedLabel(null)).toBe("Prepared Preview Complete");
    expect(deriveCompletedLabel("/tmp/preview.mp4")).toBe("Prepared Preview — preview.mp4");
    expect(getPreviewAssetFileName("/tmp/preview.mp4")).toBe("preview.mp4");
    expect(getPreviewAssetFileName("C:\\temp\\preview.mov")).toBe("preview.mov");
    expect(buildPreviewAssetUrl("/tmp/preview.mp4")).toBe("/api/preview/asset?assetKey=%2Ftmp%2Fpreview.mp4");
  });

  test("normalizes color scores by gradient and clip count", () => {
    expect(normalizeColorScore({ sourceClipId: 0, gradient: "Sunset", clipCount: 4 })).toBeGreaterThan(0);
    expect(normalizeColorScore({ sourceClipId: 3, gradient: "Ocean", clipCount: 4 })).toBe(1);
  });
});
