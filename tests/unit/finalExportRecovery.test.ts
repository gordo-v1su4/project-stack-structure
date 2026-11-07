import { describe, expect, test } from "bun:test";
import { assertFinalExportReplayAllowed, finalExportSnapshotSha256, isFinalExportIntentCurrent, normalizeFinalExportIntent, rebindFinalExportAfterMigration, releaseStaleFinalExportPreview, waitForCurrentFinalExport, type FinalExportIntent } from "@/components/studio/finalExportRecovery";
import { createPersistableStudioProjectDraft, hydrateStudioProjectDraft } from "@/components/studio/projectPersistence";
import { createSectionRecomputeState, startSectionRecompute } from "@/components/studio/sectionRecompute";

function fixture() {
  const draft = createPersistableStudioProjectDraft({ analysis: null, videoSources: [], musicVideoProject: null,
    storyState: { vocalStemName: "", transcriptSummary: null, storyBeats: [], activeBeatId: "", storyGenerated: false },
    workflowUiSettings: { shaderPresetId: "none", shaderAccentKinds: { beat: "glitch-cut" } } });
  const intent: FinalExportIntent = { version: 1, projectId: "film-a", requestKey: "final-export-saved-intent",
    snapshotSha256: finalExportSnapshotSha256(draft), createdAt: "2026-11-07T02:00:00.000Z", state: "running", runId: "run_original" };
  return { draft, intent };
}

describe("durable final export recovery", () => {
  test("reload reattaches the saved run and exact request without dispatching again", async () => {
    const { draft, intent } = fixture();
    draft.workflowUiSettings!.finalExportIntent = intent;
    const stored = JSON.parse(JSON.stringify(draft));
    const restored = hydrateStudioProjectDraft({ draft: stored });
    const reserialized = createPersistableStudioProjectDraft(restored);
    const receipt = restored.workflowUiSettings!.finalExportIntent!;
    expect(receipt).toEqual(intent);
    expect(isFinalExportIntentCurrent(receipt, "film-a", reserialized)).toBe(true);
    const reads: string[] = [];
    const output = await waitForCurrentFinalExport(receipt, {
      isCurrent: () => isFinalExportIntentCurrent(receipt, "film-a", reserialized),
      waitForOutput: async runId => { reads.push(runId); return { requestKey: intent.requestKey, videoUrl: "https://media.test/final.mp4" }; },
    });
    expect(reads).toEqual(["run_original"]);
    expect(output.videoUrl).toBe("https://media.test/final.mp4");
  });

  for (const change of ["project", "arrangement", "shader", "master", "references", "evidence", "audio"]) {
    test(`a late result cannot attach after a changed ${change}`, async () => {
      const { draft, intent } = fixture();
      let projectId = "film-a";
      let finish!: (value: { requestKey: string }) => void;
      const pending = waitForCurrentFinalExport(intent, {
        isCurrent: () => isFinalExportIntentCurrent(intent, projectId, draft),
        waitForOutput: () => new Promise(resolve => { finish = resolve; }),
      });
      if (change === "project") projectId = "film-b";
      else if (change === "arrangement") draft.generatedDraft = { planSignature: "changed", revision: 2, assetIds: ["new-take"] };
      else if (change === "shader") draft.workflowUiSettings!.shaderPresetId = "different";
      else if (change === "master") draft.analysis = { storagePath: "different.wav" } as never;
      else if (change === "references") draft.referenceAssets = [{ storagePath: "different.png" }] as never;
      else if (change === "evidence") draft.generatedAssets = [{ reviewStatus: "approved", approvedIdentityEvidenceSha256: "changed" }] as never;
      else draft.clipAudioSettings = { useClipAudio: true, overrides: {} };
      finish({ requestKey: intent.requestKey });
      await expect(pending).rejects.toThrow("project or arrangement changed");
    });
  }

  test("ordinary UI saves and export receipts do not change replay's canonical snapshot", () => {
    const { draft, intent } = fixture();
    const before = finalExportSnapshotSha256(draft);
    draft.savedAt = "2026-11-07T02:15:00Z";
    draft.workflowUiSettings = { ...draft.workflowUiSettings, activeTab: "compose", isPreviewExpanded: true,
      finalExportIntent: intent, finalExport: { videoUrl: "https://media.test/final.mp4", downloadFileName: "final.mp4", cueCount: 0, status: "ready" } };
    expect(finalExportSnapshotSha256(draft)).toBe(before);
  });

  test("an unknown ACK replays the saved key only inside the provider deduplication window", () => {
    const { draft, intent } = fixture();
    const prepared = { ...intent, runId: undefined, state: "dispatching" as const };
    draft.workflowUiSettings!.finalExportIntent = prepared;
    const restored = hydrateStudioProjectDraft({ draft: JSON.parse(JSON.stringify(draft)) }).workflowUiSettings!.finalExportIntent!;
    expect(restored.requestKey).toBe(prepared.requestKey);
    expect(() => assertFinalExportReplayAllowed(restored, Date.parse(intent.createdAt) + 60_000)).not.toThrow();
    expect(() => assertFinalExportReplayAllowed(restored, Date.parse(intent.createdAt) + 24 * 60 * 60_000)).toThrow("Reconcile the original run");
    expect(() => assertFinalExportReplayAllowed(intent, Date.parse(intent.createdAt) + 48 * 60 * 60_000)).not.toThrow();
  });

  test("malformed run receipts and mismatched result keys fail closed", async () => {
    const { intent } = fixture();
    expect(normalizeFinalExportIntent({ ...intent, runId: undefined })).toBe(undefined);
    expect(normalizeFinalExportIntent({ ...intent, snapshotSha256: "bad" })).toBe(undefined);
    expect(normalizeFinalExportIntent({ ...intent, runId: "https://foreign.test" })).toBe(undefined);
    await expect(waitForCurrentFinalExport(intent, { isCurrent: () => true,
      waitForOutput: async () => ({ requestKey: "another-export" }) })).rejects.toThrow("does not match");
  });

  test("a rejected legacy request can migrate storage refs and retry its same unsubmitted intent", () => {
    const { draft, intent } = fixture();
    const prepared = { ...intent, runId: undefined, state: "dispatching" as const };
    const migrated = structuredClone(draft);
    migrated.analysis = { storageBucket: "studio", storagePath: "media-uploads/owner/audio.wav" } as never;
    const rebound = rebindFinalExportAfterMigration(prepared, "film-a", draft, migrated);
    expect(rebound.requestKey).toBe(prepared.requestKey);
    expect(rebound.createdAt).toBe(prepared.createdAt);
    expect(isFinalExportIntentCurrent(rebound, "film-a", migrated)).toBe(true);
    expect(() => rebindFinalExportAfterMigration(prepared, "film-b", draft, migrated)).toThrow("changed during media migration");
    const changed = { ...draft, generatedDraft: { planSignature: "changed", revision: 1, assetIds: [] } };
    expect(() => rebindFinalExportAfterMigration(prepared, "film-a", changed, migrated)).toThrow("changed during media migration");
    expect(() => rebindFinalExportAfterMigration(intent, "film-a", draft, migrated)).toThrow("changed during media migration");
  });

  test("unselected pending bank delivery does not invalidate the exporting cut", () => {
    const { draft, intent } = fixture();
    draft.generatedAssets = [{ id: "unrelated", reviewStatus: "pending", mediaSha256: "new" }] as never;
    expect(isFinalExportIntentCurrent(intent, "film-a", draft)).toBe(true);
    draft.generatedDraft = { planSignature: "same-plan", revision: 1, assetIds: ["unrelated"] };
    expect(isFinalExportIntentCurrent(intent, "film-a", draft)).toBe(false);
  });

  test("a stale cut releases its own busy preview without cancelling a new project's preview", () => {
    const { intent } = fixture();
    const busy = startSectionRecompute(createSectionRecomputeState(), { requestKey: intent.requestKey,
      sectionId: "story:final-export", continuityMode: "fixed", paramsHash: "cut", startedAt: intent.createdAt, progress: 10 });
    expect(releaseStaleFinalExportPreview(busy, intent, "film-a").activeRequestKey).toBe(null);
    expect(releaseStaleFinalExportPreview(busy, intent, "film-b")).toBe(busy);
    const newer = { ...busy, activeRequestKey: "new-preview" };
    expect(releaseStaleFinalExportPreview(newer, intent, "film-a")).toBe(newer);
  });

  test("ambiguous byte-upload acknowledgement cannot launch another upload or inference", () => {
    const { draft, intent } = fixture();
    const prepared = { ...intent, runId: undefined, state: "dispatching" as const, replayable: false };
    draft.workflowUiSettings!.finalExportIntent = prepared;
    const restored = hydrateStudioProjectDraft({ draft: JSON.parse(JSON.stringify(draft)) }).workflowUiSettings!.finalExportIntent!;
    expect(() => assertFinalExportReplayAllowed(restored, Date.parse(intent.createdAt) + 60_000)).toThrow("upload-based export acknowledgement is unresolved");
    expect(() => assertFinalExportReplayAllowed({ ...restored, runId: "run_acknowledged", state: "running" })).not.toThrow();
  });
});
