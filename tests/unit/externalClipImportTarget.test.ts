import { expect, test } from "bun:test";
import { externalImportTarget, externalImportWindows, importExternalClipCandidate } from "@/components/studio/externalClipImportTarget";
import { createImportedVideoAsset } from "@/components/studio/externalClipImport";
import { applyDraftGeneratedAssets, selectGeneratedDraftAsset } from "@/components/studio/generatedDraft";
import type { EditPlanPreviewSegment } from "@/components/studio/musicVideoProject";
import type { GeneratedStudioAsset } from "@/components/studio/generatedAssets";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GenerateTab } from "@/components/studio/panels/GenerateTab";

const storage = { bucket: "studio", objectKey: "media-uploads/owner/edit.mp4", storagePath: "media-uploads/owner/edit.mp4", publicUrl: "https://media.test/edit.mp4", mime: "video/mp4" };
const cut: EditPlanPreviewSegment = { kind: "gap", videoUrl: "", startTime: 0, endTime: 6.836, musicStart: 220.874, musicEnd: 227.710,
  sectionId: "closing", label: "Closing action", timelineItemId: "slot", planSignature: "current", requirementId: "closing-requirement", placementId: "placement" };
const candidate = (start: number, end: number, name: string) => createImportedVideoAsset({ kind: "original-footage", fileName: name, durationSeconds: end - start + .01,
  storage: { ...storage, objectKey: `${storage.objectKey}-${name}` }, target: externalImportTarget(cut, { songStart: start, songEnd: end }, [], "slot") });
function fixture() {
  // Actual R40 boundaries/trims, represented as synthetic editorial candidates:
  // the fixture does not confer historical H3 identity evidence.
  const p27 = { ...candidate(223.179, 224.769, "P27.mp4"), trimStart: 3.267, durationSeconds: 5.166667 };
  const p28 = { ...candidate(224.769, 227.710, "P28.mp4"), trimStart: 0, durationSeconds: 5.166667 };
  const assets = [p27, p28];
  const draft = { planSignature: "current", revision: 3, assetIds: assets.map(asset => asset.id) };
  const resolved = applyDraftGeneratedAssets([cut], assets, draft);
  return { assets, draft, resolved };
}

test("an imported clip retains the exact reviewed animatic binding and stale selected history does not reserve it", () => {
  const motion = { shotId: "A001", bindingSha256: "a".repeat(64), reviewBindingSha256: "b".repeat(64), imageSha256: "c".repeat(64) };
  const segment = { ...cut, animaticShotId: "A001", animaticMotion: motion };
  const range = { songStart: segment.musicStart, songEnd: segment.musicEnd };
  const old = candidate(range.songStart, range.songEnd, "old.mp4");
  expect(externalImportWindows(segment, [segment], [old]).reserved).toEqual([]);
  const target = externalImportTarget(segment, range, [], "fallback"); expect(target.animaticMotion).toEqual(motion);
  const asset = createImportedVideoAsset({ kind: "original-footage", fileName: "reviewed-edit.mp4", durationSeconds: 7, storage, target });
  const draft = selectGeneratedDraftAsset({ draft: { planSignature: "current", revision: 0, assetIds: [] }, assets: [asset], asset, segments: [segment] });
  expect(applyDraftGeneratedAssets([segment], [asset], draft)[0].kind).toBe("source");
  expect(() => externalImportTarget(segment, { ...range, songEnd: range.songEnd - 1 }, [], "fallback")).toThrow("complete reviewed");
  expect(() => externalImportTarget({ ...segment, animaticMotion: undefined }, range, [], "fallback")).toThrow("complete reviewed");
});

test("the P26 import defaults to the actual uncovered 2.305s and retains P27/P28 lineage", () => {
  const { assets, draft, resolved } = fixture(), before = JSON.stringify({ cut, assets, draft });
  const windows = externalImportWindows(cut, resolved, assets);
  expect(windows.uncovered).toEqual([{ songStart: 220.874, songEnd: 223.179 }]);
  const target = externalImportTarget(cut, windows.defaultRange, windows.reserved, "fallback");
  expect(target).toMatchObject({ songStart: 220.874, songEnd: 223.179, timelineItemId: "slot", planSignature: "current", requirementId: "closing-requirement" });
  const p26 = candidate(target.songStart, target.songEnd, "P26.mp4");
  expect(p26.reviewStatus).toBe("pending"); expect(p26.jobId).toBe(undefined); expect(p26.identityVerification).toBe(undefined);
  expect(applyDraftGeneratedAssets([cut], [...assets, p26], draft)).toEqual(resolved); // Bank-only never selects.
  const selected = selectGeneratedDraftAsset({ draft, assets: [...assets, p26], asset: p26, segments: [cut] });
  expect(selected.assetIds).toEqual([...draft.assetIds, p26.id]);
  expect(applyDraftGeneratedAssets([cut], [...assets, p26], selected).some(segment => segment.kind === "gap")).toBe(false);
  expect(JSON.stringify({ cut, assets, draft })).toBe(before);
});

test("custom subranges remain exact, finite, ordered, inside the resolved cut and outside selected takes", () => {
  const { assets, resolved } = fixture(), windows = externalImportWindows(cut, resolved, assets);
  expect(externalImportTarget(cut, { songStart: 221.125123, songEnd: 222.875987 }, windows.reserved, "slot")).toMatchObject({ songStart: 221.125123, songEnd: 222.875987 });
  for (const range of [{ songStart: NaN, songEnd: 223 }, { songStart: 221, songEnd: Infinity }, { songStart: 222, songEnd: 221 },
    { songStart: 221, songEnd: 221 }, { songStart: 220, songEnd: 221 }, { songStart: 221, songEnd: 228 }, { songStart: 221, songEnd: 224 }]) {
    expect(() => externalImportTarget(cut, range, windows.reserved, "slot")).toThrow();
  }
  expect(() => externalImportTarget({ ...cut, planSignature: undefined }, windows.defaultRange, [], "slot")).toThrow();
});

test("awaiting-check selected takes stay reserved, rejected/unselected history cannot occupy a gap", () => {
  const { assets } = fixture();
  const blocked = { ...assets[0], identityVerification: { status: "unverifiable" as const, reason: "Pending check" } } as GeneratedStudioAsset;
  const windows = externalImportWindows(cut, [cut], [blocked]);
  expect(windows.uncovered).toEqual([{ songStart: 220.874, songEnd: 223.179 }, { songStart: 224.769, songEnd: 227.710 }]);
  expect(() => externalImportTarget(cut, { songStart: 223.179, songEnd: 224 }, windows.reserved, "slot")).toThrow("selected take");
  expect(externalImportWindows(cut, [cut], []).defaultRange).toEqual({ songStart: cut.musicStart, songEnd: cut.musicEnd });
});

test("multiple/overlapping gap fragments are clipped and merged without mutating the cut or inputs", () => {
  const fragments = [{ ...cut, musicStart: 210, musicEnd: 222 }, { ...cut, musicStart: 221, musicEnd: 224 },
    { ...cut, musicStart: 226, musicEnd: 230 }, { ...cut, planSignature: "old", musicStart: 224, musicEnd: 226 }];
  const before = JSON.stringify(fragments), windows = externalImportWindows(cut, fragments, []);
  expect(windows.uncovered).toEqual([{ songStart: 220.874, songEnd: 224 }, { songStart: 226, songEnd: 227.710 }]);
  expect(JSON.stringify(fragments)).toBe(before);
});

test("malformed selected targets fail closed rather than losing their reservation", () => {
  const { assets } = fixture();
  expect(() => externalImportWindows(cut, [cut], [{ ...assets[0], target: undefined }])).toThrow("no target");
  expect(() => externalImportWindows(cut, [cut], [{ ...assets[0], target: { ...assets[0].target!, songEnd: NaN } }])).toThrow("invalid target");
});

test("metadata and upload awaits cannot deliver an old project/cut/range into the bank", async () => {
  const target = externalImportTarget(cut, { songStart: 220.874, songEnd: 223.179 }, [], "slot"), file = new File(["fixture"], "P26.mp4", { type: "video/mp4" });
  for (const driftAt of ["before", "metadata", "upload"]) {
    let current = driftAt !== "before", uploads = 0, deliveries = 0;
    await expect(importExternalClipCandidate({ file, kind: "original-footage", target, isCurrent: () => current,
      readDuration: async () => { if (driftAt === "metadata") current = false; return 56 / 24; },
      upload: async () => { uploads++; current = false; return storage; }, deliver: () => { deliveries++; } })).rejects.toThrow("not added to the bank");
    expect(uploads).toBe(driftAt === "upload" ? 1 : 0); expect(deliveries).toBe(0);
  }
});

test("short or nonfinite media is rejected before upload; a long enough original edit stays pending", async () => {
  const target = externalImportTarget(cut, { songStart: 220.874, songEnd: 223.179 }, [], "slot"), file = new File(["fixture"], "P26.mp4", { type: "video/mp4" });
  const delivered: GeneratedStudioAsset[] = []; let uploads = 0;
  for (const duration of [0, -1, NaN, Infinity, 2.2]) await expect(importExternalClipCandidate({ file, kind: "original-footage", target,
    isCurrent: () => true, readDuration: async () => duration, upload: async () => { uploads++; return storage; }, deliver: asset => delivered.push(asset) })).rejects.toThrow("shorter");
  expect(uploads).toBe(0);
  await importExternalClipCandidate({ file, kind: "original-footage", target, isCurrent: () => true, readDuration: async () => 56 / 24,
    upload: async () => storage, deliver: asset => delivered.push(asset) });
  expect(delivered).toHaveLength(1); expect(delivered[0]).toMatchObject({ target, reviewStatus: "pending", provider: "editorial", model: "original-footage-edit" });
  await importExternalClipCandidate({ file, kind: "original-footage", target, isCurrent: () => true, readDuration: async () => 2.305,
    upload: async () => storage, deliver: asset => delivered.push(asset) });
  expect(delivered).toHaveLength(2); // Addition avoids subtractive cancellation at large song offsets.
});

test("the real import panel renders exact remaining interval controls and fails closed on a missing selected bank take", () => {
  const { assets, draft, resolved } = fixture();
  const props: ComponentProps<typeof GenerateTab> = { project: null, analysis: null, storyGenerated: false, onsetDensity: 50, lyricCueBlend: 50,
    lyricMergeWindow: 1, previewSegments: [cut], resolvedDraftSegments: resolved, selectedDraftAssetIds: draft.assetIds, referenceAssets: [],
    persistedGeneratedAssets: assets, masterAudioRef: null, selectedPreviewRange: { startIndex: 0, endIndex: 0 },
    onEnsureOwnedMasterAudio: async () => { throw new Error("No audio operation requested"); }, onGeneratedAsset: () => {}, onSelectMatch: () => {}, onSelectJoin: () => {},
    onSelectedPreviewRange: () => {}, onAuditionPreviewRange: () => {}, onAuditionGeneratedAsset: () => {} };
  const markup = renderToStaticMarkup(createElement(GenerateTab, props));
  expect(markup).toContain('aria-label="Import song start"'); expect(markup).toContain('value="220.874"'); expect(markup).toContain('value="223.179"');
  expect(markup).toContain("Pending take targets 220.874–223.179"); expect(markup).toContain("2.305s");
  const missing = renderToStaticMarkup(createElement(GenerateTab, { ...props, selectedDraftAssetIds: [...draft.assetIds, "unavailable-selected-take"] }));
  expect(missing).toContain("selected take is missing from the bank");
  expect(missing).not.toContain("Pending take targets");
});
