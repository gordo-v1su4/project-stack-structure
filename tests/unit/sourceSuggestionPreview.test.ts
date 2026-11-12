import { expect, test } from "bun:test";
import { resolveSourceSuggestionPreview } from "@/components/studio/sourceSuggestionPreview";
import type { SlotEvidence } from "@/components/studio/shell/spineSlots";
import type { UploadedVideoSource } from "@/components/studio/types";
import { SlotInspector } from "@/components/studio/shell/SlotInspector";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const evidence = { slot: { sectionId: "verse", start: 20, end: 23, kind: "footage", label: "A010", sectionLabel: "Verse" },
  lyrics: [], generated: null, caption: null, moment: null, match: null,
  takes: [{ selected: false, scorePercent: 61, moment: { id: "source-1", sourceClipId: 4, start: 1, end: 5, label: "Dancers" }, reason: "Action fit" }],
} as unknown as SlotEvidence;
const sources = [{ id: 4, duration: 10, videoUrl: "blob:source-4" }] as UploadedVideoSource[];

test("source inspection resolves exact current-section suggestion and source trim without changing the project", () => {
  const before = JSON.stringify({ evidence, sources });
  expect(resolveSourceSuggestionPreview(evidence, "source-1", sources)).toEqual({ videoUrl: "blob:source-4", start: 1, end: 5, label: "Dancers" });
  expect(resolveSourceSuggestionPreview(evidence, "other-section-moment", sources)).toBe(null);
  expect(resolveSourceSuggestionPreview(evidence, "source-1", [{ ...sources[0], id: 7 }])).toBe(null);
  expect(resolveSourceSuggestionPreview(evidence, "source-1", [{ ...sources[0], duration: 3 }])).toBe(null);
  expect(JSON.stringify({ evidence, sources })).toBe(before);
});

test("inspector distinguishes matching fit and preview-only sources without eagerly mounting media", () => {
  const html = renderToStaticMarkup(createElement(SlotInspector, { evidence, onClose() {}, onPlayFrom() {}, onPreviewSource() {}, onReopenGenerated() {}, onOpenGenerate() {} }));
  expect(html).toContain("Source suggestions");
  expect(html).toContain("61% fit");
  expect(html).toContain("Preview source: Dancers");
  expect(html).not.toContain("Other takes");
  expect(html).not.toContain("<video");
});
