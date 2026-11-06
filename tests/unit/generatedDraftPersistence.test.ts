import { describe, expect, test } from "bun:test";
import { applyDraftGeneratedAssets, createGeneratedDraftSelection, selectGeneratedDraftAsset } from "@/components/studio/generatedDraft";
import type { GeneratedStudioAsset } from "@/components/studio/generatedAssets";
import { buildEditPlanPreviewSegments, prepareApprovedPlacements, type MusicVideoProject } from "@/components/studio/musicVideoProject";
import { createPersistableStudioProjectDraft, hydrateStudioProjectDraft } from "@/components/studio/projectPersistence";

function fixture() {
  const project = prepareApprovedPlacements({
    videoSources: [],
    project: {
      id: "generated-project", duration: 10, song: null, lyricChunks: [], storySections: [], videoMoments: [], reviewFindings: [],
      editPlan: { id: "edit", createdAt: "fixed", timelineItems: [{ id: "intro", requirementId: "arrival", sectionId: "intro", start: 0, end: 10, label: "Arrival", prompt: "Milo arrives", lyricChunkIds: [], videoMomentId: null }] },
    } satisfies MusicVideoProject,
  });
  const asset: GeneratedStudioAsset = {
    id: "h3-arrival", provider: "swarmui", model: "MiniMax H3", prompt: "Milo arrives", createdAt: "2026-11-06T00:00:00.000Z",
    mediaKind: "video", status: "completed", reviewStatus: "pending", durationSeconds: 12, trimStart: 1,
    triggerRunId: "run_h3_arrival", fullStorage: { bucket: "studio", objectKey: "generated/arrival.mp4", storagePath: "generated/arrival.mp4", publicUrl: "https://media.example/arrival.mp4", mime: "video/mp4" },
    target: { planSignature: project.placementPlan!.inputSignature, timelineItemId: "intro", requirementId: "arrival", sectionId: "intro", sectionLabel: "Intro", songStart: 0, songEnd: 10 },
  };
  const segments = buildEditPlanPreviewSegments({ project, videoSources: [] });
  const draft = selectGeneratedDraftAsset({ draft: createGeneratedDraftSelection(project.placementPlan!.inputSignature), assets: [asset], asset, segments });
  const params = {
    analysis: null, videoSources: [], musicVideoProject: project, generatedAssets: [asset], generatedDraft: draft,
    storyState: { vocalStemName: "", transcriptSummary: null, storyBeats: [], activeBeatId: "", storyGenerated: false },
  };
  return { params, project, asset, draft };
}

describe("generated draft persistence", () => {
  test("restores the selected pending take and trim for a zero-footage project", () => {
    const { params, draft, asset } = fixture();
    const stored = createPersistableStudioProjectDraft(params);
    const restored = hydrateStudioProjectDraft({ draft: JSON.parse(JSON.stringify(stored)) });
    expect(restored.generatedDraft).toEqual(draft);
    expect(restored.generatedAssets[0]).toMatchObject({ reviewStatus: "pending", trimStart: 1, target: asset.target, triggerRunId: "run_h3_arrival" });
    const base = buildEditPlanPreviewSegments({ project: restored.musicVideoProject, videoSources: [] });
    const preview = applyDraftGeneratedAssets(base, restored.generatedAssets, restored.generatedDraft);
    expect(preview).toHaveLength(1);
    expect(preview[0]).toMatchObject({ kind: "source", startTime: 1, endTime: 11, musicStart: 0, musicEnd: 10, videoUrl: "/api/storage/media?bucket=studio&objectKey=generated%2Farrival.mp4" });
  });

  test("legacy drafts restore with no pending selection instead of choosing an asset implicitly", () => {
    const { params } = fixture();
    const stored = createPersistableStudioProjectDraft(params);
    delete stored.generatedDraft;
    const restored = hydrateStudioProjectDraft({ draft: stored });
    expect(restored.generatedDraft).toBeNull();
    const base = buildEditPlanPreviewSegments({ project: restored.musicVideoProject, videoSources: [] });
    expect(applyDraftGeneratedAssets(base, restored.generatedAssets, restored.generatedDraft)).toEqual(base);
  });

  test("invalid persisted selections fail closed while queued run identity survives reload", () => {
    const { params, asset } = fixture();
    const stored = createPersistableStudioProjectDraft({ ...params, generatedAssets: [{ ...asset, status: "queued", durationSeconds: undefined }] });
    const raw = { ...stored, generatedDraft: { planSignature: "", revision: 2, assetIds: [asset.id] } };
    const restored = hydrateStudioProjectDraft({ draft: raw });
    expect(restored.generatedDraft).toBeNull();
    expect(restored.generatedAssets[0]).toMatchObject({ status: "queued", reviewStatus: "pending", triggerRunId: "run_h3_arrival", target: asset.target });
  });
});
