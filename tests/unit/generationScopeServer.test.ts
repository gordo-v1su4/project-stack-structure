import { afterEach, describe, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import { h3ProjectFixture } from "../helpers/h3Project";
import { buildStudioSourceContextSignature, studioSourceContextInput } from "@/components/studio/studioSourceContext";
import { buildStoryContentSignature } from "@/components/studio/storyTreatments";
import { buildEditPlanPreviewSegments, placementInputSignature } from "@/components/studio/musicVideoProject";
import { effectiveGenerationScope, generationScopeSha256, generationSemanticSha256, type GenerationScopeReceipt } from "@/components/studio/generationScope";
import { applyDraftGeneratedAssets, approveGeneratedDraft, captureGeneratedDraftReview, sanitizeGeneratedDraftSelection } from "@/components/studio/generatedDraft";
import type { GeneratedStudioAsset } from "@/components/studio/generatedAssets";
import type { H3GenerationJob } from "@/components/studio/h3Generation";
import type { ReferenceAsset } from "@/components/studio/referenceAssets";
import type { SavedStudioProject } from "@/lib/studioProjectStore";

const receipts = new Map<string, GenerationScopeReceipt>(), baselines = new Map<string, GenerationScopeReceipt>();
let rawBytesIntact = true, sourceMediaIntact = true;
mock.module("@/lib/generationScopeMedia", () => ({ bootstrapR31SourceMedia: async () => [], pinGenerationScopeMedia: async () => [],
  verifyGenerationScopeMedia: async (_owner: string, _draft: unknown, expected: unknown) => { if (!sourceMediaIntact) throw new Error("Synthetic changed source object"); return expected; } }));
mock.module("@/lib/generationScopeRawReferences", () => ({
  pinGenerationScopeRawReferences: async (_owner: string, references: GenerationScopeReceipt["body"]["references"]) => references.map(reference => ({ assetId: reference.id,
    bucket: reference.storageBucket!, objectKey: reference.storagePath!, etag: '"fixed"', sha256: "a".repeat(64), byteLength: 10 })),
  verifyGenerationScopeRawReferences: async (_owner: string, _references: unknown, expected: GenerationScopeReceipt["body"]["rawReferences"]) => {
    if (!rawBytesIntact) throw new Error("Synthetic changed reference object"); return expected;
  },
}));
let writes = 0;
mock.module("@/lib/generationScopeStore", () => ({
  readGenerationScopeReceipt: async (_owner: string, _project: string, id: string) => receipts.get(id) ?? null,
  storeGenerationScopeReceipt: async (value: GenerationScopeReceipt) => { writes++; receipts.set(value.id, structuredClone(value)); },
  readGenerationScopeBaseline: async (owner: string, project: string, scope: string, semantic: string) => baselines.get(JSON.stringify([owner, project, scope, semantic])) ?? null,
  storeGenerationScopeBaseline: async (value: GenerationScopeReceipt) => { writes++; const b = value.body; baselines.set(JSON.stringify([b.ownerId, b.projectId, b.scopeSignature, b.semanticSha256]), structuredClone(value)); },
}));
const { materializeH3Job } = await import("@/lib/h3GenerationServer");
const { prepareAdditiveSourceConfirmation, validateSavedGenerationScope, recordGenerationScopeBaseline } = await import("@/lib/generationScopeServer");
type Versioned = SavedStudioProject & { revision: string };
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function addedReference(id = "extras"): ReferenceAsset {
  return { id, role: "crowd", kind: "crowd", displayName: `Supplemental ${id}`, fileName: `${id}.png`, previewUrl: "", promptHint: "", storageStatus: "uploaded",
    storageBucket: "studio", storagePath: `media-uploads/github-test/references/${id}/sheet.png`, createdAt: "2026-11-07T00:00:00Z" };
}
async function fixture() {
  const { saved: original, request } = h3ProjectFixture();
  const saved = original as Versioned;
  saved.revision = '"initial"';
  const story = saved.draft.storyState;
  story.confirmedTreatmentSnapshot!.anchors = [];
  story.editSettings = saved.draft.musicVideoProject!.placementPlan!.settings;
  story.storyContentSignature = buildStoryContentSignature(story.confirmedTreatmentSnapshot!, story.storyBeats);
  const context = buildStudioSourceContextSignature({ analysis: null, videoSources: [], referenceAssets: saved.draft.referenceAssets });
  story.confirmedSourceContextSignature = context;
  const project = saved.draft.musicVideoProject!;
  project.sourceContextSignature = context;
  project.generationScopeVersion = 2;
  project.generationSourceContextSha256 = generationScopeSha256(studioSourceContextInput({ analysis: null, videoSources: [], referenceAssets: saved.draft.referenceAssets }));
  project.generationStorySha256 = generationScopeSha256({ storyBeats: story.storyBeats, confirmedTreatmentSnapshot: story.confirmedTreatmentSnapshot,
    storyContentSignature: story.storyContentSignature, editSettings: story.editSettings });
  project.placementPlan!.inputSignature = placementInputSignature(project);
  request.planSignature = effectiveGenerationScope(project)!;
  request.songEnd = 10;
  const job = materializeH3Job("github-test", saved, request, "studio");
  job.references = job.references.map(reference => ({ ...reference, etag: '"fixed"', version: digest([reference.version, '"fixed"']) }));
  const asset: GeneratedStudioAsset = { id: "take", provider: "swarmui", model: "MiniMax H3", prompt: "Diego crosses the club floor.",
    createdAt: "2026-11-06T00:00:00Z", status: "completed", mediaKind: "video", durationSeconds: 12, reviewStatus: "pending",
    resultUrl: "https://media.test/take.mp4", target: job.target };
  saved.draft.generatedAssets = [asset];
  saved.draft.generatedDraft = { planSignature: request.planSignature, revision: 31, assetIds: [asset.id] };
  saved.draft.workflowUiSettings = { finalExportIntent: { version: 1, projectId: saved.project.id, requestKey: "final-export-old", createdAt: "2026-11-06T00:00:00Z", snapshotSha256: "a".repeat(64), state: "ready" } };
  await recordGenerationScopeBaseline("github-test", saved);
  saved.draft.referenceAssets!.push(addedReference());
  project.placementPlan!.inputSignature = `stale-source:${buildStudioSourceContextSignature({ analysis: null, videoSources: [], referenceAssets: saved.draft.referenceAssets })}`;
  saved.revision = '"appended"';
  return { saved, request, jobs: [job], originalAsset: JSON.stringify(asset) };
}
const prepare = (saved: Versioned, jobs: H3GenerationJob[]) => prepareAdditiveSourceConfirmation({ ownerId: "github-test", saved, expectedRevision: saved.revision, jobs, bucket: "studio" });
afterEach(() => { receipts.clear(); baselines.clear(); writes = 0; rawBytesIntact = true; sourceMediaIntact = true; });

describe("strong additive generation scope", () => {
  test("normal v2 validation requires an issued baseline at export and checks current raw/media versions before any append", async () => {
    const { saved, request } = await fixture();
    saved.draft.referenceAssets!.pop();
    saved.draft.musicVideoProject!.placementPlan!.inputSignature = placementInputSignature(saved.draft.musicVideoProject!);
    expect(await validateSavedGenerationScope("github-test", saved)).toBe(request.planSignature);
    rawBytesIntact = false;
    await expect(validateSavedGenerationScope("github-test", saved)).rejects.toThrow("versions differ");
    rawBytesIntact = true; sourceMediaIntact = false;
    await expect(validateSavedGenerationScope("github-test", saved)).rejects.toThrow("versions differ");
    sourceMediaIntact = true; baselines.clear();
    await expect(validateSavedGenerationScope("github-test", saved)).rejects.toThrow("unavailable");
    expect(await validateSavedGenerationScope("github-test", saved, { allowUnissuedBaseline: true })).toBe(request.planSignature);
  });
  test("new v2 ranges and policies change the strong scope before an append; unmarked legacy round-trips retain their exact signature", async () => {
    const { saved, request } = await fixture();
    const baseline = [...baselines.values()][0];
    const project = structuredClone(saved.draft.musicVideoProject!);
    project.placementPlan!.inputSignature = placementInputSignature(project);
    expect(effectiveGenerationScope(project)).toBe(request.planSignature);
    const changedRange = structuredClone(project);
    changedRange.placementPlan!.placements[0].songEnd = 9;
    expect(effectiveGenerationScope(changedRange)).not.toBe(request.planSignature);
    const changedPolicy = structuredClone(project);
    changedPolicy.placementPlan!.policy = "best-effort";
    expect(effectiveGenerationScope(changedPolicy)).not.toBe(request.planSignature);
    const legacy = structuredClone(project);
    delete legacy.generationScopeVersion; delete legacy.generationSourceContextSha256;
    expect(effectiveGenerationScope(legacy)).toBe(legacy.placementPlan!.inputSignature);
    expect(effectiveGenerationScope(JSON.parse(JSON.stringify(legacy)))).toBe(legacy.placementPlan!.inputSignature);
    expect(baseline.body.kind).toBe("baseline");
  });
  test("retains canonical targets and selected footage, resets review, and requires canonical authorization at materialization", async () => {
    const { saved, request, jobs, originalAsset } = await fixture();
    const before = JSON.stringify(saved), oldScope = request.planSignature;
    const candidate = await prepare(saved, jobs);
    expect(JSON.stringify(saved)).toBe(before);
    expect(JSON.stringify(candidate.draft.generatedAssets![0])).toBe(originalAsset);
    expect(candidate.draft.generatedDraft).toMatchObject({ planSignature: oldScope, revision: 32, assetIds: ["take"], sourceReviewRequired: true });
    expect(candidate.draft.workflowUiSettings?.finalExportIntent).toBe(undefined);
    expect(sanitizeGeneratedDraftSelection(candidate.draft.generatedDraft)).toEqual(candidate.draft.generatedDraft);
    const next = { ...saved, draft: candidate.draft };
    expect(effectiveGenerationScope(next.draft.musicVideoProject!)).toBe(oldScope);
    expect(next.draft.musicVideoProject!.placementPlan!.inputSignature).not.toBe(oldScope);
    expect(() => materializeH3Job("github-test", next, request, "studio")).toThrow("Validate the canonical");
    expect(await validateSavedGenerationScope("github-test", next)).toBe(oldScope);
    expect(materializeH3Job("github-test", next, request, "studio").target).toEqual(jobs[0].target);
    const base = buildEditPlanPreviewSegments({ project: next.draft.musicVideoProject, videoSources: [] });
    expect(applyDraftGeneratedAssets(base, next.draft.generatedAssets!, next.draft.generatedDraft).every(segment => segment.kind === "source")).toBe(true);
    const review = captureGeneratedDraftReview(base, next.draft.generatedAssets!, next.draft.generatedDraft)!;
    const staleReview = { ...review, revision: 31 };
    expect(approveGeneratedDraft({ draft: next.draft.generatedDraft!, assets: next.draft.generatedAssets!, segments: base, review: staleReview }).error).toContain("changed");
    const approved = approveGeneratedDraft({ draft: next.draft.generatedDraft!, assets: next.draft.generatedAssets!, segments: base, review });
    expect(approved.error).toBeNull();
    expect(approved.draft.sourceReviewRequired).toBe(false);
    expect(approved.draft.sourceConfirmationSha256).toBe(candidate.receipt.sha256);
  });

  test("a subsequent append uses its prior canonical receipt and retains all old references and selected IDs", async () => {
    const { saved, jobs } = await fixture();
    const first = await prepare(saved, jobs);
    saved.draft = first.draft;
    saved.revision = '"second-append"';
    saved.draft.referenceAssets!.push(addedReference("more-extras"));
    saved.draft.musicVideoProject!.placementPlan!.inputSignature = "stale-source:new-library";
    const second = await prepare(saved, jobs);
    expect(second.receipt.body.previousReceiptSha256).toBe(first.receipt.sha256);
    expect(second.draft.referenceAssets).toHaveLength(4);
    expect(second.draft.generatedDraft?.assetIds).toEqual(["take"]);
    expect(second.draft.generatedDraft?.revision).toBe(33);
    expect(second.receipt.body.appendedReferenceIds).toEqual(["more-extras"]);
  });

  test("approved history retains its exact playback order and byte-exact assets while requiring a new whole-cut review", async () => {
    const { saved, jobs } = await fixture();
    const asset = saved.draft.generatedAssets![0];
    asset.reviewStatus = "approved"; asset.approvedAt = "2026-11-06T00:00:00Z";
    saved.draft.generatedDraft!.assetIds = [];
    const before = JSON.stringify(saved.draft.generatedAssets);
    const candidate = await prepare(saved, jobs);
    expect(candidate.draft.generatedDraft?.assetIds).toEqual([]);
    expect(JSON.stringify(candidate.draft.generatedAssets)).toBe(before);
    const base = buildEditPlanPreviewSegments({ project: candidate.draft.musicVideoProject, videoSources: [] });
    const review = captureGeneratedDraftReview(base, candidate.draft.generatedAssets!, candidate.draft.generatedDraft)!;
    const approved = approveGeneratedDraft({ draft: candidate.draft.generatedDraft!, assets: candidate.draft.generatedAssets!, segments: base, review });
    expect(approved.error).toBeNull();
    expect(approved.draft.sourceReviewRequired).toBe(false);
    expect(JSON.stringify(approved.assets)).toBe(before);
  });

  for (const change of ["master", "old reference name", "old reference path", "removed reference", "story", "settings", "source range", "policy", "foreign sheet", "named new sheet", "used new sheet", "stale revision", "unanchored legacy", "reference pixels", "source object version"]) {
    test(`rejects ${change} without issuing a receipt or changing the bank`, async () => {
      const { saved, jobs } = await fixture();
      const original = JSON.stringify(saved.draft.generatedAssets), count = writes;
      if (change === "master") saved.draft.analysis = { sourceLabel: "new.wav", duration: 10, mediaKey: "new", waveform: [], energy: [], sections: [], beats: [], onsets: [] };
      if (change === "old reference name") saved.draft.referenceAssets![0].displayName = "Someone else";
      if (change === "old reference path") saved.draft.referenceAssets![0].storagePath += ".changed";
      if (change === "removed reference") saved.draft.referenceAssets!.shift();
      if (change === "story") saved.draft.musicVideoProject!.editPlan.timelineItems[0].prompt = "A different action";
      if (change === "settings") saved.draft.musicVideoProject!.placementPlan!.settings.cutDensity = .3;
      if (change === "source range") saved.draft.musicVideoProject!.placementPlan!.placements[0].songEnd = 9;
      if (change === "policy") saved.draft.musicVideoProject!.placementPlan!.policy = "best-effort";
      if (change === "foreign sheet") saved.draft.referenceAssets!.at(-1)!.storagePath = "media-uploads/someone-else/references/sheet.png";
      if (change === "named new sheet") saved.draft.referenceAssets!.at(-1)!.displayName = "Diego";
      if (change === "used new sheet") jobs[0].references.push({ ...jobs[0].references[0], assetId: "extras" });
      if (change === "stale revision") saved.revision = "";
      if (change === "unanchored legacy") baselines.clear();
      if (change === "reference pixels") rawBytesIntact = false;
      if (change === "source object version") sourceMediaIntact = false;
      await expect(prepare(saved, jobs)).rejects.toThrow();
      expect(writes).toBe(count);
      expect(JSON.stringify(saved.draft.generatedAssets)).toBe(original);
    });
  }

  test("inline forged, foreign, removed and changed canonical receipts cannot authorize generation", async () => {
    const { saved, jobs, request } = await fixture();
    const candidate = await prepare(saved, jobs);
    saved.draft = candidate.draft;
    receipts.clear();
    await expect(validateSavedGenerationScope("github-test", saved)).rejects.toThrow("canonical");
    expect(() => materializeH3Job("github-test", saved, request, "studio")).toThrow("canonical");
    receipts.set(candidate.receipt.id, candidate.receipt);
    await expect(validateSavedGenerationScope("someone-else", saved)).rejects.toThrow();
    const changed = structuredClone(candidate.receipt);
    changed.body.scopeSignature = "placements-v1-forged";
    saved.draft.musicVideoProject!.generationScope = changed;
    expect(effectiveGenerationScope(saved.draft.musicVideoProject!)).toBe(undefined);
    expect(generationScopeSha256(changed.body)).not.toBe(changed.sha256);
    expect(generationSemanticSha256(saved.draft.musicVideoProject!)).toBe(candidate.receipt.body.semanticSha256);
  });
});
