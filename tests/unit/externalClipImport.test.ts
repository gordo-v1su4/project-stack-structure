import { describe, expect, test } from "bun:test";
import { createImportedVideoAsset } from "@/components/studio/externalClipImport";
import { applyApprovedGeneratedAssets, buildGeneratedAssetContextPreview, generatedAssetDraftIdentityBlockReason, mergeGeneratedAssetDelivery } from "@/components/studio/generatedAssets";
import { applyDraftGeneratedAssets, createGeneratedDraftSelection, selectGeneratedDraftAsset } from "@/components/studio/generatedDraft";
import { createPersistableStudioProjectDraft, hydrateStudioProjectDraft } from "@/components/studio/projectPersistence";
import type { EditPlanPreviewSegment } from "@/components/studio/musicVideoProject";
import { draftSimilarityFixture } from "../helpers/draftSimilarity";

const storage = { bucket: "stack-structure", objectKey: "media-uploads/owner/editorial/outro.mp4", storagePath: "media-uploads/owner/editorial/outro.mp4",
  publicUrl: "https://media.example/files/stack-structure/media-uploads/owner/editorial/outro.mp4", mime: "video/mp4" };
const target = { planSignature: "plan-v1", requirementId: "shot-7", narrativeMomentId: "ending", timelineItemId: "closing",
  sectionId: "chorus-6", sectionLabel: "Together after escape", songStart: 243.85, songEnd: 246.69995464852607 };
const gap: EditPlanPreviewSegment = { ...target, label: "Closing gap", kind: "gap", musicStart: target.songStart, musicEnd: target.songEnd,
  videoUrl: "", startTime: 0, endTime: target.songEnd-target.songStart };

describe("external video provenance", () => {
  test("default import retains Seedance provider, inference and pending review", () => {
    for (const [fileName, model] of [["shot-seedance-2.5.mp4", "seedance_2_5"], ["shot-seedance-2.0.mov", "seedance_2_0"], ["shot.mp4", "seedance"]]) {
      const asset = createImportedVideoAsset({ fileName, durationSeconds: 3, storage, target });
      expect(asset.id.startsWith("seedance:")).toBe(true);
      expect(asset).toMatchObject({ provider: "higgsfield", model, reviewStatus: "pending", prompt: "Imported completed Seedance continuation for explicit review." });
    }
  });

  test("edited original footage stays pending and needs explicit draft selection", () => {
    const asset = createImportedVideoAsset({ kind: "original-footage", fileName: "outro.mp4", durationSeconds: 3, storage, target });
    expect(asset.id.startsWith("editorial:")).toBe(true);
    expect(asset).toMatchObject({ provider: "editorial", model: "original-footage-edit", reviewStatus: "pending", target, trimStart: 0 });
    expect(asset.prompt).toContain("original footage");
    expect(asset.jobId).toBe(undefined); expect(asset.identityVerification).toBe(undefined); expect(asset.approvedAt).toBe(undefined);
    expect(applyApprovedGeneratedAssets([gap], [asset])[0].videoUrl).toBe("");
    const empty = createGeneratedDraftSelection("plan-v1");
    expect(applyDraftGeneratedAssets([gap], [asset], empty)[0].videoUrl).toBe("");
    const selected = selectGeneratedDraftAsset({ draft: empty, assets: [asset], asset, segments: [gap] });
    expect(selected.assetIds).toEqual([asset.id]);
    expect(applyDraftGeneratedAssets([gap], [asset], selected)[0].videoUrl).toContain("/api/storage/media?");
    expect(applyDraftGeneratedAssets([gap], [asset], selected)[0].sourceRefLabel).toBe("EDIT · original-footage-edit");
    expect(buildGeneratedAssetContextPreview([gap], asset)!.segments[0].label).toContain("EDITED FOOTAGE CANDIDATE");
    expect(asset.reviewStatus).toBe("pending");
  });

  test("project JSON save and reload preserves editorial provenance, exact target and pending selection", () => {
    const asset = createImportedVideoAsset({ kind: "original-footage", fileName: "outro.mp4", durationSeconds: 3, storage, target });
    const selected = { planSignature: "plan-v1", revision: 1, assetIds: [asset.id] };
    const persisted = createPersistableStudioProjectDraft({ analysis: null, videoSources: [], musicVideoProject: null,
      storyState: { vocalStemName: "", transcriptSummary: null, storyBeats: [], activeBeatId: "intro", storyGenerated: false },
      generatedAssets: [asset], generatedDraft: selected });
    const hydrated = hydrateStudioProjectDraft({ draft: JSON.parse(JSON.stringify(persisted)) });
    expect(hydrated.generatedAssets[0]).toMatchObject({ id: asset.id, provider: "editorial", model: "original-footage-edit", reviewStatus: "pending", target, fullStorage: storage });
    expect(hydrated.generatedDraft).toEqual(selected);
    expect(hydrated.generatedAssets[0].identityVerification).toBe(undefined);
  });

  test("an original-footage import neither relabels nor revives a rejected H3 take", () => {
    const failed = { ...draftSimilarityFixture().asset, reviewStatus: "rejected" as const };
    const before = JSON.stringify(failed);
    const imported = createImportedVideoAsset({ kind: "original-footage", fileName: "outro.mp4", durationSeconds: 3, storage, target });
    expect(generatedAssetDraftIdentityBlockReason(failed)).toBe("Rejected");
    expect(mergeGeneratedAssetDelivery(failed, { ...failed, reviewStatus: "pending" }).reviewStatus).toBe("rejected");
    expect(JSON.stringify(failed)).toBe(before);
    expect(imported.id === failed.id).toBe(false);
    expect(imported.generationReferenceHashes).toBe(undefined);
  });
});
