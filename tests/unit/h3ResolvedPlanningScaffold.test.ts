import { describe, expect, test } from "bun:test";
import { buildH3ResolvedPlanningScaffold } from "@/components/studio/h3ResolvedPlanningScaffold";
import { applyDraftGeneratedAssets, orderedDraftGeneratedAssets } from "@/components/studio/generatedDraft";
import type { GeneratedStudioAsset } from "@/components/studio/generatedAssets";
import { h3WindowKey, planH3DraftWindows } from "@/components/studio/h3DraftPlan";
import { buildEditPlanPreviewSegments, createMusicVideoProject, placementInputSignature, prepareApprovedPlacements } from "@/components/studio/musicVideoProject";
import type { UploadedVideoSource } from "@/components/studio/types";

function fixture(duration = 10) {
  const project = prepareApprovedPlacements({ project: createMusicVideoProject({ analysis: null, duration, videoSources: [],
    storyDrafts: [{ id: "arrival", label: "Arrival", start: 0, end: duration, prompt: "Diego reaches the doorway." }] }),
    videoSources: [], editSettings: { cutDensity: 1, preferOnsets: true } });
  const base = buildEditPlanPreviewSegments({ project, videoSources: [] });
  const signature = base[0].planSignature!;
  const draft = { planSignature: signature, revision: 1, assetIds: [] as string[] };
  const asset = (id: string, start = 0, end = 3, overrides: Partial<GeneratedStudioAsset> = {}): GeneratedStudioAsset => ({
    id, provider: "editorial", model: "original-footage-edit", prompt: "Unobserved generation instructions.",
    createdAt: "2026-11-05T00:00:00Z", status: "completed", mediaKind: "video", reviewStatus: "pending",
    durationSeconds: end - start + 4, trimStart: 2, resultUrl: `https://media.example/${id}.mp4`, mediaSha256: "a".repeat(64),
    target: { planSignature: signature, timelineItemId: base[0].timelineItemId!, sectionId: base[0].sectionId,
      sectionLabel: "Arrival", songStart: start, songEnd: end }, ...overrides });
  return { project, base, draft, asset };
}

describe("resolved H3 planning scaffold", () => {
  test("retains a selected partial prefix and the exact 3–10 missing-window key", () => {
    const { project, base, draft, asset } = fixture();
    const a = asset("prefix"); draft.assetIds = [a.id];
    const result = buildH3ResolvedPlanningScaffold({ project, generatedAssets: [a], draft });
    expect(result.coverageLedger.map(row => [row.kind, row.songStart, row.songEnd])).toEqual([["generated", 0, 3], ["missing", 3, 10]]);
    expect(result.coverageLedger[0]).toMatchObject({ generatedAssetId: "prefix", sourceStart: 2, sourceEnd: 5 });
    const actualMissing = planH3DraftWindows(applyDraftGeneratedAssets(base, [a], draft));
    expect(result.coverageLedger.filter(row => row.kind === "missing").map(row => row.windowKey)).toEqual(actualMissing.map(h3WindowKey));
    expect(result.segments.map(segment => segment.generatedAssetId)).toEqual(["prefix", undefined]);
    expect(JSON.stringify(result.stableBindingPayload)).not.toContain("Unobserved generation");
    expect(JSON.stringify(result.stableBindingPayload)).not.toContain("https:");
  });

  test("selected overlap wins over the latest approved overlay and preserves sliced trims", () => {
    const { project, base, draft, asset } = fixture();
    const old = asset("old", 0, 10, { reviewStatus: "approved", approvedAt: "2026-11-05T00:00:00Z" });
    const newer = asset("newer", 2, 8, { reviewStatus: "approved", approvedAt: "2026-11-06T00:00:00Z", trimStart: 1 });
    const selected = asset("selected", 3, 5, { trimStart: 3 }); draft.assetIds = [selected.id];
    const assets = [newer, selected, old];
    expect(orderedDraftGeneratedAssets(base, assets, draft).map(candidate => candidate.id)).toEqual(["old", "newer", "selected"]);
    const result = buildH3ResolvedPlanningScaffold({ project, generatedAssets: assets, draft });
    expect(result.coverageLedger.map(row => [row.generatedAssetId, row.songStart, row.songEnd, row.sourceStart, row.sourceEnd]))
      .toEqual([["old", 0, 2, 2, 4], ["newer", 2, 3, 1, 2], ["selected", 3, 5, 3, 5], ["newer", 5, 8, 4, 7], ["old", 8, 10, 10, 12]]);
    expect(result.segments).toEqual(applyDraftGeneratedAssets(base, assets, draft));
  });

  test("unselected bank, rejected, stale-target and stale-selection assets do not fill holes or change binding", () => {
    const { project, draft, asset } = fixture();
    const empty = buildH3ResolvedPlanningScaffold({ project, generatedAssets: [], draft });
    const pending = asset("pending"), rejected = asset("rejected", 0, 3, { reviewStatus: "rejected" });
    const stale = asset("stale", 0, 3, { reviewStatus: "approved" }); stale.target!.planSignature = "stale";
    const assets = [pending, rejected, stale]; draft.assetIds = [rejected.id, stale.id];
    expect(buildH3ResolvedPlanningScaffold({ project, generatedAssets: assets, draft }).stableBindingPayload).toEqual(empty.stableBindingPayload);
    draft.assetIds = [pending.id]; draft.planSignature = "stale";
    expect(buildH3ResolvedPlanningScaffold({ project, generatedAssets: assets, draft }).stableBindingPayload).toEqual(empty.stableBindingPayload);
  });

  test("runtime URL, bank order, unrelated draft revision and generation prose do not bind; actual trim and media do", () => {
    const { project, draft, asset } = fixture(); const a = asset("chosen"); draft.assetIds = [a.id];
    const before = buildH3ResolvedPlanningScaffold({ project, generatedAssets: [a], draft }).stableBindingPayload;
    const changed = { ...a, resultUrl: "blob:refreshed", prompt: "Completely different unobserved prose", title: "New title" };
    expect(buildH3ResolvedPlanningScaffold({ project, generatedAssets: [asset("unused"), changed], draft: { ...draft, revision: 999 } }).stableBindingPayload).toEqual(before);
    changed.trimStart = 1;
    expect(buildH3ResolvedPlanningScaffold({ project, generatedAssets: [changed], draft }).stableBindingPayload).not.toEqual(before);
    changed.trimStart = 2; changed.mediaSha256 = "b".repeat(64);
    expect(buildH3ResolvedPlanningScaffold({ project, generatedAssets: [changed], draft }).stableBindingPayload).not.toEqual(before);
  });

  test("recomputes current-reference eligibility rather than trusting bank runtime identity flags", () => {
    const { project, draft, asset } = fixture();
    const a = asset("historical", 0, 3, { identityReferenceHashes: ["a".repeat(64)] }); draft.assetIds = [a.id];
    expect(buildH3ResolvedPlanningScaffold({ project, generatedAssets: [a], draft }).coverageLedger[0].kind).toBe("generated");
    project.currentIdentity = { migrationSha256: "c".repeat(64), contextSha256: "d".repeat(64),
      replacements: [{ assetId: "diego", fromSha256: "a".repeat(64), toSha256: "b".repeat(64) }], assessments: {}, activeAssessments: {} };
    a.currentReferenceIdentity = { required: false, context: project.currentIdentity };
    const result = buildH3ResolvedPlanningScaffold({ project, generatedAssets: [a], draft });
    expect(result.coverageLedger.map(row => row.kind)).toEqual(["missing"]);
    expect(a.currentReferenceIdentity.required).toBe(false);
  });

  test("canonical source coverage and trim survive missing browser URLs and match hydrated source binding", () => {
    const { project } = fixture();
    project.videoMoments = [{ id: "moment", sourceClipId: 7, label: "Doorway", start: 0, end: 20, duration: 20, contentHash: "source-hash" }];
    Object.assign(project.placementPlan!.placements[0], { kind: "source", momentId: "moment", sourceStart: 4, sourceEnd: 14 });
    project.placementPlan!.inputSignature = placementInputSignature(project, project.placementPlan!.settings);
    const before = structuredClone(project);
    const absent = buildH3ResolvedPlanningScaffold({ project, generatedAssets: [], draft: null });
    expect(absent.coverageLedger[0]).toMatchObject({ kind: "source", momentId: "moment", sourceClipId: 7, sourceStart: 4, sourceEnd: 14 });
    expect(absent.segments[0].videoUrl).toBe("");
    const source: UploadedVideoSource = { id: 7, name: "door.mp4", duration: 20, size: 100, thumbnailUrl: "", videoUrl: "blob:available", storageBucket: "media", storagePath: "door.mp4" };
    expect(buildH3ResolvedPlanningScaffold({ project, generatedAssets: [], draft: null, videoSources: [source] }).stableBindingPayload).toEqual(absent.stableBindingPayload);
    expect(project).toEqual(before);
  });

  test("splits each long fragment independently and carries actual per-window source trim", () => {
    const { project, draft, asset } = fixture(30); const a = asset("long", 0, 16); draft.assetIds = [a.id];
    const result = buildH3ResolvedPlanningScaffold({ project, generatedAssets: [a], draft });
    expect(result.coverageLedger.map(row => [row.kind, row.songStart, row.songEnd])).toEqual([
      ["generated", 0, 8], ["generated", 8, 16], ["missing", 16, 23], ["missing", 23, 30],
    ]);
    expect(result.coverageLedger.slice(0, 2).map(row => [row.sourceStart, row.sourceEnd])).toEqual([[2, 10], [10, 18]]);
    expect(new Set(result.coverageLedger.map(row => row.windowKey)).size).toBe(4);
  });

  test("rejects stale plans and oversized scaffolds", () => {
    const { project } = fixture(); project.placementPlan!.inputSignature = "stale";
    expect(() => buildH3ResolvedPlanningScaffold({ project, generatedAssets: [], draft: null })).toThrow("current placement");
    const oversized = fixture(12 * 513).project;
    expect(() => buildH3ResolvedPlanningScaffold({ project: oversized, generatedAssets: [], draft: null })).toThrow("window bound");
  });

  test("bounds UTF-8 ledger bytes and rejects invalid canonical source trims", () => {
    const { project, draft, asset } = fixture();
    const huge = asset("界".repeat(200_000)); draft.assetIds = [huge.id];
    expect(() => buildH3ResolvedPlanningScaffold({ project, generatedAssets: [huge], draft })).toThrow("binding byte bound");
    project.videoMoments = [{ id: "source", sourceClipId: 1, label: "Door", start: 0, end: 20, duration: 20 }];
    Object.assign(project.placementPlan!.placements[0], { kind: "source", momentId: "source", sourceStart: -1, sourceEnd: 9 });
    project.placementPlan!.inputSignature = placementInputSignature(project, project.placementPlan!.settings);
    expect(() => buildH3ResolvedPlanningScaffold({ project, generatedAssets: [], draft: null })).toThrow("placement trims");
  });
});
