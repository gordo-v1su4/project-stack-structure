import { describe, expect, test } from "bun:test";
import { describePreviewBlocks, formatTimelineBlockCount } from "@/components/studio/previewBlockSummary";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProgramMonitor } from "@/components/studio/shell/ProgramMonitor";
import { PreviewPlayer } from "@/components/studio/PreviewPlayerComponent";
import { BrowserPreviewPlayer, createPreviewPlayerState, type PreviewSegment } from "@/components/studio/previewPlayer";

describe("preview block summaries", () => {
  test("counts timeline entries without implying physical camera cuts", () => {
    expect(formatTimelineBlockCount(0)).toBe("0 timeline blocks");
    expect(formatTimelineBlockCount(1)).toBe("1 timeline block");
    expect(formatTimelineBlockCount(137)).toBe("137 timeline blocks");
    expect(describePreviewBlocks([{ kind: "source" }, {}])).toBe("2 timeline blocks");
  });

  test("includes missing-footage gaps in the total and identifies them separately", () => {
    const segments = [{ kind: "source" }, { kind: "gap" }, { kind: "gap" }] as const;
    expect(describePreviewBlocks(segments)).toBe("3 timeline blocks · 2 gaps");
    expect(describePreviewBlocks([{ kind: "gap" }])).toBe("1 timeline block · 1 gap");
  });

  test("monitor and preview timeline render metadata counts as blocks with explicit gaps", () => {
    const segments: PreviewSegment[] = [
      { kind: "source", videoUrl: "", startTime: 0, endTime: 2, musicStart: 0, musicEnd: 2, label: "Several camera angles" },
      { kind: "gap", videoUrl: "", startTime: 0, endTime: 1, musicStart: 2, musicEnd: 3, label: "Missing footage" },
    ];
    const player = new BrowserPreviewPlayer();
    const state = { ...createPreviewPlayerState(), totalDuration: 3 };
    const monitor = renderToStaticMarkup(createElement(ProgramMonitor, {
      previewPlayer: player, browserPreviewSegments: segments, browserPreviewState: state,
      isBrowserPreviewActive: true, previewEffectCues: [], audioTimeline: null, masterAudioUrl: null,
      previewAssetKey: null, previewAssetUrl: null, empty: { headline: "Preview", meta: null, next: null },
      focused: false, onToggleFocused: () => {},
    }));
    const timeline = renderToStaticMarkup(createElement(PreviewPlayer, { player, segments, state, isExpanded: true }));
    expect(monitor).toContain("2 timeline blocks · 1 gap");
    expect(timeline).toContain("2 timeline blocks · 1 gap");
    expect(monitor).not.toContain("2 cuts");
    expect(timeline).not.toContain("2 cuts");
  });
});
