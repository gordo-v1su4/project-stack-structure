import { describe, expect, test } from "bun:test";
import { assertFinalExportReplayAllowed, finalExportSnapshotSha256, isFinalExportIntentCurrent, normalizeFinalExportIntent, rebindFinalExportAfterMigration, releaseStaleFinalExportPreview, waitForCurrentFinalExport, type FinalExportIntent } from "@/components/studio/finalExportRecovery";
import { createPersistableStudioProjectDraft, hydrateStudioProjectDraft, withPersistedWorkflowUiSettings } from "@/components/studio/projectPersistence";
import { createSectionRecomputeState, startSectionRecompute } from "@/components/studio/sectionRecompute";
import { OWNED_FINAL_EXPORT_PREFIX, OWNED_CAPTURE_EXPORT_PREFIX, isOwnedExportRequestKey } from "@/components/studio/exportDispatchProtocol";

function fixture() {
  const draft = createPersistableStudioProjectDraft({ analysis: null, videoSources: [], musicVideoProject: null,
    storyState: { vocalStemName: "", transcriptSummary: null, storyBeats: [], activeBeatId: "", storyGenerated: false },
    workflowUiSettings: { shaderPresetId: "none", shaderAccentKinds: { beat: "glitch-cut" } } });
  const intent: FinalExportIntent = { version: 1, projectId: "film-a", requestKey: "final-export-saved-intent",
    snapshotSha256: finalExportSnapshotSha256(draft), createdAt: "2026-11-07T02:00:00.000Z", state: "running", runId: "run_original" };
  return { draft, intent };
}

describe("durable final export recovery", () => {
  test("view settings reuse prepared content without changing the export binding; shader and content changes still invalidate it", () => {
    const { draft, intent } = fixture();
    const before = JSON.stringify(draft);
    const viewed = withPersistedWorkflowUiSettings(draft, { ...draft.workflowUiSettings, activeTab: "generate",
      isPreviewExpanded: true, matchOnsetDensity: 1000 });
    expect(viewed.videoSources).toBe(draft.videoSources);
    expect(viewed.storyState).toBe(draft.storyState);
    expect(viewed.generatedAssets).toBe(draft.generatedAssets);
    expect(viewed.workflowUiSettings?.matchOnsetDensity).toBe(100);
    expect(JSON.stringify(draft)).toBe(before);
    expect(isFinalExportIntentCurrent(intent, "film-a", viewed)).toBe(true);
    expect(isFinalExportIntentCurrent(intent, "film-a", withPersistedWorkflowUiSettings(viewed, {
      ...viewed.workflowUiSettings, shaderPresetId: "changed",
    }))).toBe(false);
    expect(isFinalExportIntentCurrent(intent, "film-a", { ...viewed,
      generatedDraft: { planSignature: "new-cut", revision: 2, assetIds: [] },
    })).toBe(false);
  });

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
    const prepared = { ...intent, requestKey: `${OWNED_FINAL_EXPORT_PREFIX}new-intent`, runId: undefined, state: "dispatching" as const };
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
  test("release migration preserves unresolved legacy ACKs but cannot redispatch or silently version their keys", () => {
    const { draft, intent } = fixture();
    const legacy = { ...intent, runId: undefined, state: "dispatching" as const };
    draft.workflowUiSettings!.finalExportIntent = legacy;
    const restored = hydrateStudioProjectDraft({ draft: JSON.parse(JSON.stringify(draft)) });
    const receipt = restored.workflowUiSettings!.finalExportIntent!;
    expect(receipt.requestKey).toBe(legacy.requestKey);
    for (let click = 0; click < 2; click++) {
      expect(() => assertFinalExportReplayAllowed(receipt, Date.parse(intent.createdAt) + 60_000)).toThrow("The app was updated");
      try { assertFinalExportReplayAllowed(receipt); } catch (error) { expect((error as Error).constructor).toBe(Error); }
      expect(receipt.state).toBe("dispatching");
      expect(createPersistableStudioProjectDraft(restored).workflowUiSettings!.finalExportIntent).toEqual(receipt);
    }
    expect(() => assertFinalExportReplayAllowed(intent)).not.toThrow();
  });
  test("protocol keys remain bounded and cannot be confused with another export kind", () => {
    const final = `${OWNED_FINAL_EXPORT_PREFIX}new-intent`;
    const capture = `${OWNED_CAPTURE_EXPORT_PREFIX}new-intent`;
    expect(isOwnedExportRequestKey(final, "final")).toBe(true);
    expect(isOwnedExportRequestKey(capture, "capture")).toBe(true);
    for (const key of [capture, `${OWNED_FINAL_EXPORT_PREFIX}`, `${final}/suffix`, `${final}.suffix`, `${final}${"a".repeat(114)}`]) {
      expect(isOwnedExportRequestKey(key, "final")).toBe(false);
    }
    expect(isOwnedExportRequestKey(final, "capture")).toBe(false);
  });
  test("both versioned final and capture keys survive saved ready receipts and legacy known runs remain readable", async () => {
    const { intent } = fixture();
    for (const prefix of [OWNED_FINAL_EXPORT_PREFIX, OWNED_CAPTURE_EXPORT_PREFIX, "final-export-webgpu-"]) {
      const receipt = normalizeFinalExportIntent({ ...intent, requestKey: `${prefix}saved-intent`, state: "ready" })!;
      expect(receipt.requestKey).toBe(`${prefix}saved-intent`);
      expect(() => assertFinalExportReplayAllowed(receipt)).not.toThrow();
      expect(await waitForCurrentFinalExport(receipt, { isCurrent: () => true,
        waitForOutput: async () => ({ requestKey: receipt.requestKey }) })).toEqual({ requestKey: receipt.requestKey });
    }
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
    const prepared = { ...intent, requestKey: `${OWNED_FINAL_EXPORT_PREFIX}new-intent`, runId: undefined, state: "dispatching" as const, replayable: false };
    draft.workflowUiSettings!.finalExportIntent = prepared;
    const restored = hydrateStudioProjectDraft({ draft: JSON.parse(JSON.stringify(draft)) }).workflowUiSettings!.finalExportIntent!;
    expect(() => assertFinalExportReplayAllowed(restored, Date.parse(intent.createdAt) + 60_000)).toThrow("upload-based export acknowledgement is unresolved");
    expect(() => assertFinalExportReplayAllowed({ ...restored, runId: "run_acknowledged", state: "running" })).not.toThrow();
  });
});
