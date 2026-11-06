import { describe, expect, test } from "bun:test";
import { buildStudioPipelineInput } from "@/components/studio/buildStudioPipelineInput";
import { buildPipelineState } from "@/components/studio/studioPipeline";
import { applyDraftGeneratedAssets } from "@/components/studio/generatedDraft";
import { createImportedVideoAsset } from "@/components/studio/externalClipImport";
import { planH3DraftWindows } from "@/components/studio/h3DraftPlan";
import type { EditPlanPreviewSegment, MusicVideoProject } from "@/components/studio/musicVideoProject";

const project: MusicVideoProject = { id: "project", song: null, duration: 30, lyricChunks: [], storySections: [], videoMoments: [], reviewFindings: [],
  editPlan: { id: "plan", createdAt: "2026-11-06T00:00:00Z", timelineItems: [
    { id: "slot", sectionId: "ending", lyricChunkIds: [], videoMomentId: null, start: 0, end: 30, label: "Ending", prompt: "Closing landscape" },
  ] } };
const gap: EditPlanPreviewSegment = { kind: "gap", videoUrl: "", startTime: 0, endTime: 30, musicStart: 0, musicEnd: 30,
  label: "Closing gap", sectionId: "ending", planSignature: "current", timelineItemId: "slot" };
const candidate = (start: number, end: number) => createImportedVideoAsset({ kind: "original-footage", fileName: "landscape.mp4", durationSeconds: end-start,
  storage: { bucket: "stack-structure", objectKey: "media-uploads/owner/landscape.mp4", storagePath: "media-uploads/owner/landscape.mp4", publicUrl: "https://media.example/landscape.mp4", mime: "video/mp4" },
  target: { planSignature: "current", timelineItemId: "slot", sectionId: "ending", sectionLabel: "Ending", songStart: start, songEnd: end } });
function inputFor(assets: ReturnType<typeof candidate>[], selected: string[]) {
  const resolved = applyDraftGeneratedAssets([gap], assets, { planSignature: "current", revision: 1, assetIds: selected });
  const input = buildStudioPipelineInput({ activeTab: "generate", hasAudioAnalysis: true, hasLyricTranscript: false,
    referenceAssets: [], videoCount: 0, sceneCount: 0, captionReadyCount: 0, captionTotalCount: 0,
    storyTreatmentSelected: true, storyAnchorsResolved: true, storyPlanConfirmed: true, musicVideoProject: project,
    generatedAssets: assets, resolvedDraftSegments: resolved, storySegmentCount: 1, hasCommittedSplit: false,
    shaderPresetLabel: "None", finalExportReady: false });
  return { resolved, input, state: buildPipelineState({ ...input, hasRequiredReferences: true }) };
}

describe("resolved draft coverage displayed across workflow stages", () => {
  test("partial selected coverage counts residual generation windows instead of original story slots", () => {
    const take = candidate(5, 7);
    const { resolved, input, state } = inputFor([take], [take.id]);
    expect(input.gapSlotCount).toBe(1); // Approved coverage remains the Finish gate.
    expect(input.draftGapSlotCount).toBe(planH3DraftWindows(resolved).length);
    expect(input.draftGapSlotCount).toBe(3);
    expect(state.stages.find(s => s.key === "generate")?.status).toBe("3 unfilled windows");
    expect(state.stages.find(s => s.key === "compose")).toMatchObject({ available: false, status: "3 gaps · final export blocked" });
  });

  test("full pending coverage requires whole-draft consent and cannot unlock Finish", () => {
    const take = candidate(0, 30);
    const { input, state } = inputFor([take], [take.id]);
    expect(input.draftGapSlotCount).toBe(0);
    expect(input.gapSlotCount).toBe(1);
    expect(state.stages.find(s => s.key === "generate")).toMatchObject({ ready: false, status: "Draft covered · review required" });
    expect(state.stages.find(s => s.key === "compose")).toMatchObject({ available: false, ready: false, complete: false,
      status: "Draft review required · final export blocked", blockedReason: "Review and accept the assembled draft before final export." });
    expect(take.reviewStatus).toBe("pending");
  });

  test("unselected, rejected, stale and identity-blocked takes never reduce displayed missing coverage", () => {
    const take = candidate(0, 30);
    for (const [asset, selected] of [[take, []], [{ ...take, reviewStatus: "rejected" as const }, [take.id]],
      [{ ...take, target: { ...take.target!, planSignature: "old" } }, [take.id]],
      [{ ...take, provider: "swarmui" as const, model: "h3-ref2va-int8-v3", jobId: "h3-needs-proof" }, [take.id]]] as const) {
      expect(inputFor([asset], [...selected]).input.draftGapSlotCount).toBe(3);
    }
  });
});
