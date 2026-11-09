import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { currentCompletedExport, discardStaleCompletedExport } from "@/components/studio/completedExportFreshness";
import { finalExportSnapshotSha256, releaseStaleFinalExportPreview, type FinalExportIntent } from "@/components/studio/finalExportRecovery";
import { createSectionRecomputeState, startSectionRecompute } from "@/components/studio/sectionRecompute";
import { createPersistableStudioProjectDraft, hydrateStudioProjectDraft } from "@/components/studio/projectPersistence";
import { ComposeTab } from "@/components/studio/panels/ComposeTab";
import { describeMusicVideoShaderPreset } from "@/components/studio/shaderEffectPlan";
import { buildPipelineState, type PipelineStageInput } from "@/components/studio/studioPipeline";
import { currentReferenceIdentityFixture } from "../helpers/currentReferenceIdentity";

function fixture() {
  const source = currentReferenceIdentityFixture().saved.draft;
  const draft = createPersistableStudioProjectDraft({ ...hydrateStudioProjectDraft({ draft: source }),
    workflowUiSettings: { shaderPresetId: "high-energy-glitch", shaderAccentKinds: { beat: "glitch-cut" } } });
  const artifact = { videoUrl: "https://media.example/final.mp4", downloadFileName: "final.mp4", cueCount: 2, status: "Final MP4 ready" };
  const intent: FinalExportIntent = { version: 1, projectId: "film", requestKey: "final-export-completed", snapshotSha256: finalExportSnapshotSha256(draft),
    createdAt: "2026-11-08T00:00:00Z", runId: "run_finished", state: "ready" };
  draft.workflowUiSettings = { ...draft.workflowUiSettings, finalExportIntent: intent, finalExport: artifact };
  return { draft, artifact, intent };
}

function reload(draft: ReturnType<typeof fixture>["draft"]) {
  return createPersistableStudioProjectDraft(hydrateStudioProjectDraft({ draft: JSON.parse(JSON.stringify(draft)) }));
}

function renderFinish(draft: ReturnType<typeof fixture>["draft"]) {
  const artifact = currentCompletedExport(draft, "film");
  const input: PipelineStageInput = { activeTab: "compose", hasAudioAnalysis: true, hasLyricTranscript: false, hasRequiredReferences: true,
    videoCount: 0, sceneCount: 0, captionReadyCount: 0, captionTotalCount: 0, storyTreatmentSelected: true, storyAnchorsResolved: true,
    storyPlanConfirmed: true, editSlotCount: 1, matchedSlotCount: 1, gapSlotCount: 0, weakMatchSlotCount: 0, shortReviewSlotCount: 0,
    storySegmentCount: 1, hasCommittedSplit: false, shaderPresetLabel: "Test", finalExportReady: Boolean(artifact) };
  const complete = buildPipelineState(input).stages.find(stage => stage.key === "compose")!.complete;
  const markup = renderToStaticMarkup(createElement(ComposeTab, {
    analysis: null, storyGenerated: true, editSlotCount: 1, storySegmentCount: 1, lyricChunkCount: 0, videoSourceCount: 0,
    shaderPresetId: draft.workflowUiSettings!.shaderPresetId!, shaderPresetSummary: describeMusicVideoShaderPreset(draft.workflowUiSettings!.shaderPresetId!),
    finalExportStatus: artifact?.status ?? "Export the current cut", finalExportError: null, finalExportUrl: artifact?.videoUrl ?? null,
    finalExportName: artifact?.downloadFileName ?? null, finalExportCueCount: artifact?.cueCount ?? 0, finalExportDisabledReason: null,
    isFinalExporting: false, isShaderCaptureExporting: false, onShaderPresetId: () => {}, onFinalExport: () => {}, onWebGpuExport: () => {}, onSelectStory: () => {},
  }));
  return { markup, complete };
}

test("unchanged completed snapshot survives real serialization/hydration and exposes the same Finish download", () => {
  const { draft, artifact } = fixture();
  const restored = reload(draft);
  expect(currentCompletedExport(restored, "film")).toEqual(artifact);
  expect(discardStaleCompletedExport(restored, "film")).toBe(restored);
  const view = renderFinish(restored);
  expect(view.complete).toBe(true); expect(view.markup).toContain(`href="${artifact.videoUrl}"`); expect(view.markup).toContain("Download final.mp4");
});

for (const change of ["shader", "accent"] as const) test(`completed ${change} change immediately hides the previous URL and remains stale across reload`, () => {
  const { draft, artifact, intent } = fixture();
  if (change === "shader") draft.workflowUiSettings!.shaderPresetId = "balanced-music-video";
  else draft.workflowUiSettings!.shaderAccentKinds = { beat: "duotone-pulse" };
  // Keep the old URI and ready receipt present: this tests the derived guard,
  // independently of a settings handler clearing state or an effect firing.
  expect(draft.workflowUiSettings!.finalExport?.videoUrl).toBe(artifact.videoUrl);
  for (const value of [draft, reload(draft)]) {
    expect(currentCompletedExport(value, "film")).toBe(undefined);
    const view = renderFinish(value); expect(view.complete).toBe(false); expect(view.markup).not.toContain(artifact.videoUrl); expect(view.markup).not.toContain("Download final.mp4");
    const safe = discardStaleCompletedExport(value, "film");
    expect(safe.workflowUiSettings?.finalExport).toBe(undefined);
    expect(safe.workflowUiSettings?.finalExportIntent).toEqual(intent);
  }
});

test("legacy unbound metadata and another project's receipt fail closed without mutating the durable history", () => {
  const { draft, artifact } = fixture();
  expect(currentCompletedExport(draft, "another-project")).toBe(undefined);
  draft.workflowUiSettings!.finalExportIntent = undefined;
  const before = JSON.stringify(draft);
  expect(currentCompletedExport(reload(draft), "film")).toBe(undefined);
  expect(discardStaleCompletedExport(draft, "film").workflowUiSettings?.finalExport).toBe(undefined);
  expect(JSON.stringify(draft)).toBe(before); expect(draft.workflowUiSettings!.finalExport).toEqual(artifact);
});

test("pending/late completions cannot claim the current ready result; current WebGPU receipts also round-trip", () => {
  const { draft, artifact, intent } = fixture();
  draft.workflowUiSettings!.finalExportIntent = { ...intent, state: "running" };
  expect(renderFinish(draft).complete).toBe(false);
  expect(renderFinish(draft).markup).not.toContain(artifact.videoUrl);
  draft.workflowUiSettings!.shaderAccentKinds = { section: "duotone-pulse" };
  draft.workflowUiSettings!.finalExportIntent = { ...intent, state: "ready" }; // Old callback arrives after settings changed.
  expect(renderFinish(draft).markup).not.toContain(artifact.videoUrl);
  draft.workflowUiSettings!.finalExportIntent = { ...intent, requestKey: "final-export-webgpu-fixture", runId: undefined,
    snapshotSha256: finalExportSnapshotSha256(draft), state: "ready" };
  expect(currentCompletedExport(reload(draft), "film")).toEqual(artifact);
});

test("shader/accent drift settles the stale capture's busy request and preserves another project's newer request", () => {
  const { draft, intent } = fixture();
  const capture = { ...intent, requestKey: "final-export-webgpu-capture" };
  const busy = startSectionRecompute(createSectionRecomputeState(), { requestKey: capture.requestKey,
    sectionId: "story:webgpu-final-export", continuityMode: "fixed", paramsHash: "settings", startedAt: intent.createdAt, progress: 5 });
  for (const change of ["shader", "accent"] as const) {
    const changed = structuredClone(draft);
    if (change === "shader") changed.workflowUiSettings!.shaderPresetId = "dream-sync";
    else changed.workflowUiSettings!.shaderAccentKinds = { beat: "duotone-pulse" };
    expect(currentCompletedExport(changed, "film")).toBe(undefined);
    const settled = releaseStaleFinalExportPreview(busy, capture, "film");
    expect(settled.activeRequestKey).toBe(null);
    // The same request guard used by export buttons can now accept the next render.
    const next = startSectionRecompute(settled, { requestKey: "final-export-next", sectionId: "story:final-export",
      continuityMode: "fixed", paramsHash: "new-settings", startedAt: intent.createdAt, progress: 5 });
    expect(next.activeRequestKey).toBe("final-export-next");
  }
  expect(releaseStaleFinalExportPreview(busy, capture, "other-film")).toBe(busy);
  const newer = { ...busy, activeRequestKey: "final-export-newer" };
  expect(releaseStaleFinalExportPreview(newer, capture, "film")).toBe(newer);
});
