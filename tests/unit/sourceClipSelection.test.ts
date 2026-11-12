import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { assertCurrentSourceClipCandidate, createSourceClipCandidate, sourceClipBinding } from "@/components/studio/sourceClipSelection";
import { hydrateGeneratedStudioAssets, sanitizeGeneratedStudioAssetForStorage } from "@/components/studio/generatedAssets";
import { applyAcceptedGeneratedDraft, applyDraftGeneratedAssets, approveGeneratedDraft, captureGeneratedDraftReview, selectGeneratedDraftAsset } from "@/components/studio/generatedDraft";
import { AnimaticSourceFootagePanel } from "@/components/studio/panels/AnimaticSourceFootagePanel";
import type { UploadedVideoSource } from "@/components/studio/types";
import type { EditPlanPreviewSegment } from "@/components/studio/musicVideoProject";

const source: UploadedVideoSource = { id: 10, name: "existing-escape.mp4", duration: 7.458, size: 200, thumbnailUrl: "", videoUrl: "blob:runtime-only",
  storageBucket: "media", storagePath: "media-uploads/owner/existing-escape.mp4", storageStatus: "uploaded" };
const segment: EditPlanPreviewSegment = { kind: "gap", videoUrl: "", startTime: 0, endTime: 2, musicStart: 5, musicEnd: 7,
  planSignature: "scope", timelineItemId: "animatic:A001", placementId: "animatic:A001", sectionId: "escape", label: "A001 escape", animaticShotId: "A001",
  animaticMotion: { shotId: "A001", bindingSha256: "a".repeat(64), reviewBindingSha256: "b".repeat(64), imageSha256: "c".repeat(64) } };

test("stored footage enters an exact animatic window as a pending candidate, survives reload and requires whole-draft consent", () => {
  const before = JSON.stringify(source), candidate = createSourceClipCandidate(source, segment, 3, 6.708333);
  expect(candidate.provider).toBe("editorial"); expect(candidate.jobId).toBe(undefined); expect(candidate.identityVerification).toBe(undefined);
  expect(candidate.reviewStatus).toBe("pending"); expect(candidate.fullStorage!.objectKey).toBe(source.storagePath!);
  expect(candidate.durationSeconds).toBe(6.708333); expect(candidate.trimStart).toBe(3);
  const [restored] = hydrateGeneratedStudioAssets(JSON.parse(JSON.stringify([sanitizeGeneratedStudioAssetForStorage(candidate)])));
  expect(restored.sourceClip).toEqual(candidate.sourceClip);
  expect(assertCurrentSourceClipCandidate(restored, [source])).toBe(source);
  const draft = selectGeneratedDraftAsset({ draft: { planSignature: "scope", revision: 0, assetIds: [] }, assets: [restored], asset: restored, segments: [segment] });
  const audition = applyDraftGeneratedAssets([segment], [restored], draft);
  expect(audition[0]).toMatchObject({ kind: "source", musicStart: 5, musicEnd: 7, startTime: 3, endTime: 5 });
  expect(applyAcceptedGeneratedDraft([segment], [restored], draft)[0].kind).toBe("gap");
  const review = captureGeneratedDraftReview([segment], [restored], draft)!;
  const accepted = approveGeneratedDraft({ draft, assets: [restored], segments: [segment], review }); expect(accepted.error).toBeNull();
  expect(applyAcceptedGeneratedDraft([segment], accepted.assets, accepted.draft)[0].kind).toBe("source");
  expect(JSON.stringify(source)).toBe(before);
});

test("browser-reported duration bounds source selection instead of the stale inventory duration", () => {
  expect(() => createSourceClipCandidate(source, segment, 5, 6.708333)).toThrow("browser-reported clip duration");
  expect(() => createSourceClipCandidate(source, segment, -1, 6.708333)).toThrow();
  expect(() => createSourceClipCandidate(source, segment, 0, NaN)).toThrow();
  expect(() => createSourceClipCandidate({ ...source, storageStatus: "uploading" }, segment, 0, 6)).toThrow("single-file");
  expect(() => createSourceClipCandidate({ ...source, uploadChunks: { size: 10, chunks: [{ bucket: "media", objectKey: "part" }] } }, segment, 0, 6)).toThrow("single-file");
  expect(() => createSourceClipCandidate(source, { ...segment, animaticMotion: undefined }, 0, 6)).toThrow("Review");
});

test("source binding and prepared review reject changes to source inventory, selected media, duration and trim", () => {
  const candidate = createSourceClipCandidate(source, segment, 3, 6.708333), draft = { planSignature: "scope", revision: 1, assetIds: [candidate.id] };
  const review = captureGeneratedDraftReview([segment], [candidate], draft)!;
  expect(sourceClipBinding({ ...source, videoUrl: "https://temporary.test/refreshed", uploadChunks: null })).toBe(sourceClipBinding(source));
  expect(() => assertCurrentSourceClipCandidate(candidate, [{ ...source, storagePath: source.storagePath + "changed" }])).toThrow();
  for (const changed of [
    { ...candidate, sourceClip: undefined },
    { ...candidate, sourceClip: { ...candidate.sourceClip!, sourceId: 999 } },
    { ...candidate, durationSeconds: 100 },
    { ...candidate, trimStart: 6 },
    { ...candidate, fullStorage: { ...candidate.fullStorage!, objectKey: "foreign" } },
  ]) expect(() => assertCurrentSourceClipCandidate(changed, [source])).toThrow();
  const changed = { ...candidate, sourceClip: { ...candidate.sourceClip!, sourceBindingSha256: "d".repeat(64) } };
  expect(approveGeneratedDraft({ draft, assets: [changed], segments: [segment], review }).error).toContain("changed");
});

test("the source inspector renders one stored source and disables selection until it is decoded", () => {
  const markup = renderToStaticMarkup(createElement(AnimaticSourceFootagePanel, { sources: [source], segments: [segment], onSelect: () => {} }));
  expect(markup).toContain("Source footage animatic shot"); expect(markup).toContain("Existing project source"); expect(markup).toContain("Source footage in");
  expect(markup.match(/<video/g)).toHaveLength(1); expect(markup).not.toContain("blob:runtime-only");
  expect(markup).toContain("/api/storage/media?bucket=media"); expect(markup).toContain("Duration unchecked");
  expect(markup).toContain("disabled"); expect(markup).not.toContain("autoPlay");
});
