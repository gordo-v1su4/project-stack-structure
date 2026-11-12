import { expect, test } from "bun:test";
import { createImportedVideoAsset } from "@/components/studio/externalClipImport";
import { listShotTakes, resolveShotTakeTarget, selectShotTake, shotTakeTargetKey } from "@/components/studio/shotTakeReview";
import { buildSpineSlots } from "@/components/studio/shell/spineSlots";
import { createGeneratedDraftSelection } from "@/components/studio/generatedDraft";
import type { EditPlanPreviewSegment } from "@/components/studio/musicVideoProject";
import { ShotTakesPanel } from "@/components/studio/ShotTakesPanel";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const target: EditPlanPreviewSegment = { kind: "gap", videoUrl: "", startTime: 0, endTime: 2, musicStart: 10, musicEnd: 12,
  planSignature: "plan", timelineItemId: "animatic:A001", animaticShotId: "A001", sectionId: "verse", label: "A001" };
function take(id: string) {
  return { ...createImportedVideoAsset({ kind: "original-footage", fileName: `${id}.mp4`, durationSeconds: 4,
    storage: { bucket: "studio", objectKey: `${id}.mp4`, storagePath: `${id}.mp4`, publicUrl: `https://media.example/${id}.mp4`, mime: "video/mp4" },
    target: { planSignature: "plan", timelineItemId: "animatic:A001", sectionId: "verse", sectionLabel: "Verse", songStart: 10, songEnd: 12 } }), id };
}

test("shot take inventory excludes neighboring shots, partial overlaps, old plans and changed references", () => {
  const a = take("a"), other = take("other"), before = JSON.stringify(a);
  expect(listShotTakes(target, [a, { ...other, target: { ...other.target!, timelineItemId: "animatic:A002" } },
    { ...other, target: { ...other.target!, songEnd: 13 } }, { ...other, target: { ...other.target!, planSignature: "old" } }], null).map(row => row.asset.id)).toEqual(["a"]);
  const binding = { shotId: "A001", bindingSha256: "b", reviewBindingSha256: "r", imageSha256: "i" };
  expect(listShotTakes({ ...target, animaticMotion: binding }, [a, { ...other, target: { ...other.target!, animaticMotion: { ...binding, imageSha256: "changed" } } }], null)).toHaveLength(0);
  expect(JSON.stringify(a)).toBe(before);
});

test("explicit Use replaces only the same-shot selection and retains pending approval and asset history", () => {
  const a = take("a"), b = take("b"), assets = [a, b], before = JSON.stringify(assets);
  const draft = { ...createGeneratedDraftSelection("plan"), assetIds: ["a", "other-shot"], revision: 3 };
  const selected = selectShotTake({ projectId: "project", target, segments: [target], assets, draft, assetId: "b", expectedTargetKey: shotTakeTargetKey("project", target), expectedRevision: 3 });
  expect(selected?.assetIds).toEqual(["other-shot", "b"]);
  expect(selected?.revision).toBe(4); expect(b.reviewStatus).toBe("pending");
  expect(draft.assetIds).toEqual(["a", "other-shot"]); expect(JSON.stringify(assets)).toBe(before);
});

test("stale target, project or draft gestures cannot replace or reset a newer selection", () => {
  const assets = [take("a")], draft = { ...createGeneratedDraftSelection("plan"), revision: 4, assetIds: ["kept"] };
  const input = { projectId: "project", target, segments: [target], assets, draft, assetId: "a", expectedTargetKey: shotTakeTargetKey("project", target), expectedRevision: 4 };
  expect(selectShotTake({ ...input, expectedRevision: 3 })).toBe(draft);
  expect(selectShotTake({ ...input, projectId: "other-project" })).toBe(draft);
  expect(selectShotTake({ ...input, segments: [{ ...target, planSignature: "new" }] })).toBe(draft);
  expect(selectShotTake({ ...input, draft: { ...draft, planSignature: "old" } })).toEqual({ ...draft, planSignature: "old" });
  expect(selectShotTake({ ...input, assets: [{ ...assets[0], reviewStatus: "rejected" }] })).toBe(draft);
});

test("resolved displayed subwindows use one unambiguous current shot and inspection mounts no video", () => {
  const [slot] = buildSpineSlots({ segments: [{ ...target, musicStart: 11, musicEnd: 12 }], project: null, generatedAssets: [] });
  expect(resolveShotTakeTarget(slot, [target])).toBe(target);
  expect(resolveShotTakeTarget(slot, [target, { ...target }])).toBe(null);
  const html = renderToStaticMarkup(createElement(ShotTakesPanel, { projectId: "project", target, assets: [take("a")], draft: null, canEdit: true, onUse() {} }));
  expect(html).toContain("Shot takes"); expect(html).toContain("Use for this shot"); expect(html).toContain("approval stays separate"); expect(html).not.toContain("<video");
});
