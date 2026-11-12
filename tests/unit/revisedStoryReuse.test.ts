import { beforeEach, describe, expect, mock, test } from "bun:test";
import { revisedStoryReuseFixture } from "../helpers/revisedStoryReuse";
import { createMusicVideoProject, buildEditPlanPreviewSegments, prepareApprovedPlacements } from "@/components/studio/musicVideoProject";
import { generationScopeSha256, generationSemanticSha256, effectiveGenerationScope, type GenerationScopeReceipt } from "@/components/studio/generationScope";
import { buildStoryContentSignature } from "@/components/studio/storyTreatments";
import { confirmStoryProjectRevision, prepareStoryTabPlacements } from "@/components/studio/panels/StoryTab";
import { selectReusedTakePlacement, reuseOriginAssetSha256, sanitizeReusedTakePlacements } from "@/components/studio/reusedTakePlacements";
import { applyAcceptedGeneratedDraft, applyDraftGeneratedAssets, captureGeneratedDraftReview, approveGeneratedDraft, selectGeneratedDraftAsset, rejectGeneratedDraftAsset } from "@/components/studio/generatedDraft";
import { buildH3DraftPlanningInput } from "@/components/studio/h3PlannedDraftRequests";
import { planH3DraftWindows } from "@/components/studio/h3DraftPlan";
import { finalExportSnapshotSha256 } from "@/components/studio/finalExportRecovery";
import type { H3GenerationJob } from "@/components/studio/h3Generation";
import type { SavedStudioProject } from "@/lib/studioProjectStore";
import { createPersistableStudioProjectDraft, hydrateStudioProjectDraft } from "@/components/studio/projectPersistence";
import { buildStoryBibleBinding } from "@/components/studio/storyBibleBinding";
import { STORY_BIBLE_ADAPTER } from "@/components/studio/storyBible";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReusedFootagePanel } from "@/components/studio/panels/ReusedFootagePanel";
import { prepareSceneProofPlan } from "@/components/studio/sceneProofs";
import { animaticShotBinding, importStillAnimatic, stillAnimaticShotRequest } from "@/components/studio/stillAnimatic";
import { animaticReviewBinding, reviewAnimatic } from "@/components/studio/animaticReview";
import { buildStoryDraftSegments } from "@/components/studio/animaticDraft";
import { parseH3StillRequest } from "@/lib/h3StillRequest";

let saved: SavedStudioProject, jobs: H3GenerationJob[], bytesIntact: boolean, signedIn: boolean, writes: number;
const receipts = new Map<string, GenerationScopeReceipt>(), baselines = new Map<string, GenerationScopeReceipt>();
const baselineKey = (value: GenerationScopeReceipt) => generationScopeSha256([value.body.scopeSignature, value.body.semanticSha256]);
mock.module("@/lib/generationScopeStore", () => ({
  sourceConfirmationStorage: () => { throw new Error("No external storage in offline reuse tests"); },
  readGenerationScopeReceipt: async (owner: string, project: string, id: string) => owner === "owner" && project === "project" ? receipts.get(id) ?? null : null,
  readGenerationScopeBaseline: async (owner: string, project: string, scope: string, semantic: string) => owner === "owner" && project === "project" ? baselines.get(generationScopeSha256([scope, semantic])) ?? null : null,
  storeGenerationScopeReceipt: async (receipt: GenerationScopeReceipt) => { writes++; receipts.set(receipt.id, structuredClone(receipt)); },
  storeGenerationScopeBaseline: async (receipt: GenerationScopeReceipt) => {
    const key = baselineKey(receipt), old = baselines.get(key);
    if (old && generationScopeSha256(old) !== generationScopeSha256(receipt)) throw new Error("Immutable baseline differs");
    writes++; baselines.set(key, structuredClone(receipt));
  },
}));
mock.module("@/lib/generationScopeRawReferences", () => ({ verifyGenerationScopeRawReferences: async (_owner: string, _refs: unknown, expected: unknown) => {
  if (!bytesIntact) throw new Error("Reference pixels changed"); return expected;
}, pinGenerationScopeRawReferences: async () => { throw new Error("Historical bytes must not be enrolled afresh"); } }));
mock.module("@/lib/generationScopeMedia", () => ({ verifyGenerationScopeMedia: async (_owner: string, _draft: unknown, expected: unknown) => {
  if (!bytesIntact) throw new Error("Source bytes changed"); return expected;
}, pinGenerationScopeMedia: async () => { throw new Error("Historical media must not be enrolled afresh"); }, bootstrapR31SourceMedia: async () => { throw new Error("No bootstrap"); } }));
mock.module("@/lib/h3JobStore", () => ({ readH3Job: async (owner: string, project: string, id: string) => jobs.find(job => job.ownerId === owner && job.projectId === project && job.id === id) ?? null,
  listH3Jobs: async (owner: string, project: string) => jobs.filter(job => job.ownerId === owner && job.projectId === project) }));
mock.module("@/lib/studioProjectStore", () => ({ readStudioProject: async (owner: string, project: string, options: { fresh?: boolean }) => {
  expect(options.fresh).toBe(true); return owner === saved.project.ownerId && project === saved.project.id ? saved : null;
} }));
mock.module("@/lib/mediaGateway", () => ({ getMediaGatewayConfig: () => ({ bucket: "media" }), normalizeMediaPath: (value: string) => value,
  uploadFileToMediaGateway: async () => { throw new Error("No uploads in offline reuse tests"); } }));
mock.module("@/lib/session", () => ({ getSessionUser: async () => signedIn ? { id: "owner" } : null,
  unauthorizedResponse: () => Response.json({ success: false }, { status: 401 }) }));
const { prepareCreativeRebaseline } = await import("@/lib/creativeRebaselineServer");
const { sourceSha, storySha, validateSavedGenerationScope } = await import("@/lib/generationScopeServer");
const { reconcileProjectFinalExport } = await import("@/lib/projectExportValidation");
const { POST } = await import("@/app/api/studio/projects/source-confirmation/route");

function revise(forAnimatic = false) {
  const previous = saved.draft.musicVideoProject!, story = saved.draft.storyState;
  story.storyBeats = [{ ...story.storyBeats[0], prompt: "The empty club anticipates a new arrival." }];
  story.confirmedTreatmentSnapshot = { ...story.confirmedTreatmentSnapshot!, title: "Revised", logline: "The place anticipates an arrival." };
  if (forAnimatic) story.confirmedTreatmentSnapshot.anchors = [{ id: "club-wait", title: "Club waits", description: "The empty club waits.",
    purpose: "Establish the location", generationPrompt: "[Static] The empty Club.", songWindow: { start: 0, end: 4 },
    coverage: "missing", candidates: [], selectedCandidateId: null, resolution: "generate" }];
  story.storyContentSignature = buildStoryContentSignature(story.confirmedTreatmentSnapshot, story.storyBeats);
  const prepared = prepareStoryTabPlacements({ project: createMusicVideoProject({ id: "project", analysis: previous.song, duration: 4, storyDrafts: story.storyBeats }), videoSources: [],
    editSettings: story.editSettings }, story.confirmedSourceContextSignature, sourceSha(saved.draft), storySha(saved.draft));
  saved.draft.musicVideoProject = confirmStoryProjectRevision(previous, prepared, true);
  saved.revision = '"r2"';
}
async function rebaseline() {
  const candidate = await prepareCreativeRebaseline({ ownerId: "owner", saved, expectedRevision: saved.revision!, jobs });
  expect(candidate.expectedRevision).toBe(saved.revision!);
  saved = { ...saved, revision: '"r3"', draft: candidate.draft };
  return candidate;
}
function base() { return buildEditPlanPreviewSegments({ project: saved.draft.musicVideoProject, videoSources: [] }); }
function reviewedAnimaticBase() {
  const d = saved.draft, project = d.musicVideoProject!, story = d.storyState;
  if (!story.stillAnimaticPlan) {
    const context = { projectId: saved.project.id, project, treatment: story.confirmedTreatmentSnapshot!, storyBeats: story.storyBeats, references: d.referenceAssets! };
    const sceneProofPlan = prepareSceneProofPlan(context); story.sceneProofPlan = sceneProofPlan;
    const input = { ...context, sceneProofPlan };
    let plan = importStillAnimatic(input, { projectId: saved.project.id, fps: 24, masterDuration: 4, totalFrames: 96,
      slots: [0, 1, 2, 3].map(i => ({ id: `A00${i + 1}`, sceneId: sceneProofPlan.scenes[0].id, sceneTitle: "Club",
        timelineItemId: project.editPlan.timelineItems[0].id, startFrame: i * 24, endFrame: (i + 1) * 24,
        prompt: "[Static] The empty Club.", referenceAssetIds: ["club"] })) });
    for (const shot of plan.shots) {
      const binding = animaticShotBinding(plan, shot), jobId = `h3-still-${"b".repeat(64)}`;
      const request = parseH3StillRequest({ shot: stillAnimaticShotRequest(input, plan, shot), animaticShot: binding,
        creativePrompt: shot.prompt, seed: 42, requestIntentId: crypto.randomUUID(), attempt: 0 });
      shot.record = { version: 1, projectId: plan.projectId, context: binding.bindingSha256, request, jobId };
      const image = { bucket: "media", objectKey: `media-uploads/owner/${shot.id}.png`, sha256: "c".repeat(64), byteLength: 100, width: 2048, height: 1152 };
      shot.proof = { jobId, descriptorSha256: "d".repeat(64), result: { master: image, native: { ...image, width: 1344, height: 768 },
        artifactId: `h3-frame-${"e".repeat(64)}`, artifactSha256: "e".repeat(64) } };
    }
    const audioUrl = `/api/storage/media?${new URLSearchParams({ bucket: d.analysis!.storageBucket!, objectKey: d.analysis!.storagePath! })}`;
    plan = reviewAnimatic(plan, plan.contextSha256, audioUrl, animaticReviewBinding(plan, plan.contextSha256, audioUrl)!, "approved", "Synthetic review fixture");
    story.stillAnimaticPlan = plan;
  }
  const runtime = hydrateStudioProjectDraft({ draft: d });
  return buildStoryDraftSegments({ projectId: saved.project.id, project: runtime.musicVideoProject, videoSources: runtime.videoSources,
    referenceAssets: runtime.referenceAssets, storyState: runtime.storyState, audio: runtime.analysis });
}
function selectOrigin() {
  saved.draft.generatedDraft = selectReusedTakePlacement(saved.draft.generatedDraft!, saved.draft.musicVideoProject!, saved.draft.generatedAssets![0], base()[0]);
}
function newMissingTake() {
  const missing = planH3DraftWindows(applyDraftGeneratedAssets(base(), saved.draft.generatedAssets!, saved.draft.generatedDraft));
  expect(missing.length).toBe(1);
  const window = missing[0], origin = jobs[0], job = structuredClone(origin), asset = structuredClone(origin.result!.asset);
  job.id = `h3-${"e".repeat(64)}`;
  asset.id = "new-take"; asset.jobId = job.id; asset.trimStart = 0;
  asset.target = { planSignature: window.planSignature, timelineItemId: window.timelineItemId!, sectionId: window.sectionId, sectionLabel: "Verse",
    songStart: window.musicStart, songEnd: window.musicEnd };
  asset.fullStorage!.objectKey = asset.fullStorage!.storagePath = `media-uploads/projects/owner/generated/project/${job.id}/shot.mp4`;
  asset.identityVerification = { ...asset.identityVerification!, assetId: asset.id, jobId: job.id };
  job.target = structuredClone(asset.target);
  job.request = { ...job.request, ...asset.target, projectId: "project", requestIntentId: "fresh-destination-intent" };
  job.result = { asset: structuredClone(asset) };
  jobs.push(job); saved.draft.generatedAssets!.push(asset);
  saved.draft.generatedDraft = selectGeneratedDraftAsset({ draft: saved.draft.generatedDraft!, assets: saved.draft.generatedAssets!, asset, segments: base() });
}
function accept() {
  const review = captureGeneratedDraftReview(base(), saved.draft.generatedAssets!, saved.draft.generatedDraft);
  expect(review).not.toBeNull();
  const result = approveGeneratedDraft({ draft: saved.draft.generatedDraft!, assets: saved.draft.generatedAssets!, segments: base(), review: review! });
  expect(result.error).toBeNull();
  saved.draft.generatedAssets = result.assets; saved.draft.generatedDraft = result.draft;
}
function exportInput(segments = base()) {
  const project = saved.draft.musicVideoProject!, preview = applyAcceptedGeneratedDraft(segments, saved.draft.generatedAssets!, saved.draft.generatedDraft);
  const videos = preview.map(segment => { const asset = saved.draft.generatedAssets!.find(asset => asset.id === segment.generatedAssetId)!;
    return { bucket: "media", objectKey: asset.fullStorage!.objectKey!, fileName: "shot.mp4", mimeType: "video/mp4" }; });
  return { ownerId: "owner", context: { projectId: "project", planSignature: project.placementPlan!.inputSignature,
    placementRevision: project.placementPlan!.revision, draftRevision: saved.draft.generatedDraft!.revision },
    audio: { bucket: "media", objectKey: saved.draft.analysis!.storagePath!, fileName: "master.wav", mimeType: "audio/wav" }, videos,
    segments: preview.map((segment, sourceIndex) => ({ sourceIndex, startTime: segment.startTime, endTime: segment.endTime,
      musicStart: segment.musicStart, musicEnd: segment.musicEnd, useClipAudio: Boolean(segment.useClipAudio) })) };
}
beforeEach(() => {
  const fixture = revisedStoryReuseFixture(); saved = fixture.saved; jobs = [fixture.job]; bytesIntact = signedIn = true; writes = 0;
  receipts.clear(); baselines.clear(); receipts.set(fixture.baseline.id, fixture.baseline); baselines.set(baselineKey(fixture.baseline), fixture.baseline);
});

describe("same-project revised-story footage reuse", () => {
  test("reviewed animatic cuts reuse explicit verified source trims through acceptance and canonical export", async () => {
    revise(true); await rebaseline();
    const segments = reviewedAnimaticBase(), project = saved.draft.musicVideoProject!, assets = saved.draft.generatedAssets!, originBefore = JSON.stringify(assets[0]);
    for (const segment of segments) saved.draft.generatedDraft = selectReusedTakePlacement(saved.draft.generatedDraft!, project, assets[0], segment, 1.25);
    const pending = saved.draft.generatedDraft!;
    expect(await validateSavedGenerationScope("owner", saved)).toBe(effectiveGenerationScope(project)!);
    expect(applyDraftGeneratedAssets(segments, assets, pending).map(s => [s.musicStart, s.musicEnd, s.startTime, s.endTime]))
      .toEqual([[0, 1, 1.25, 2.25], [1, 2, 1.25, 2.25], [2, 3, 1.25, 2.25], [3, 4, 1.25, 2.25]]);
    expect(applyAcceptedGeneratedDraft(segments, assets, pending).every(s => s.kind === "gap")).toBe(true);
    const review = captureGeneratedDraftReview(segments, assets, pending)!;
    const accepted = approveGeneratedDraft({ draft: pending, assets, segments, review }); expect(accepted.error).toBeNull();
    saved.draft.generatedDraft = accepted.draft; saved.draft.generatedAssets = accepted.assets;
    const input = exportInput(segments);
    input.context.draftRevision = accepted.draft.revision;
    input.videos = segments.map(() => ({ bucket: "media", objectKey: assets[0].fullStorage!.objectKey!, fileName: "shot.mp4", mimeType: "video/mp4" }));
    input.segments = segments.map((segment, sourceIndex) => ({ sourceIndex, startTime: 1.25, endTime: 2.25,
      musicStart: segment.musicStart, musicEnd: segment.musicEnd, useClipAudio: false }));
    const result = await reconcileProjectFinalExport(input);
    expect(result.segments.map(s => [s.startTime, s.endTime])).toEqual(Array.from({ length: 4 }, () => [1.25, 2.25]));
    expect(result.videos).toHaveLength(1); expect(result.videos[0].expectedSha256).toBe(assets[0].mediaSha256!);
    expect(JSON.stringify(saved.draft.generatedAssets![0])).toBe(originBefore);
  });

  for (const mutation of ["image", "review", "target", "partial", "missing binding"] as const) test(`animatic reuse rejects stale or forged ${mutation}`, async () => {
    revise(true); await rebaseline(); const [segment] = reviewedAnimaticBase(), project = saved.draft.musicVideoProject!;
    const assets = saved.draft.generatedAssets!;
    if (mutation === "partial") {
      expect(() => selectReusedTakePlacement(saved.draft.generatedDraft!, project, assets[0], segment, 2.5)).toThrow("whole animatic shot"); return;
    }
    saved.draft.generatedDraft = selectReusedTakePlacement(saved.draft.generatedDraft!, project, assets[0], segment, 1.25);
    const row = saved.draft.generatedDraft.reusedTakePlacements![0];
    if (mutation === "image") row.target.animaticMotion!.imageSha256 = "f".repeat(64);
    if (mutation === "review") saved.draft.storyState.stillAnimaticPlan!.review!.status = "revise";
    if (mutation === "target") { row.target.songStart += 0.25; row.target.songEnd += 0.25; }
    if (mutation === "missing binding") delete row.target.animaticMotion;
    await expect(validateSavedGenerationScope("owner", saved)).rejects.toThrow("reused placement");
  });

  test("a failed project save recovers its issued current-story baseline after an origin is rejected", async () => {
    revise();
    const first = await prepareCreativeRebaseline({ ownerId: "owner", saved, expectedRevision: saved.revision!, jobs });
    // The response was issued, but its candidate was never saved to the project.
    expect(saved.draft.musicVideoProject!.generationScope).toBe(undefined);
    saved.draft.generatedAssets![0].reviewStatus = "rejected";
    saved.revision = '"rejection-after-failed-save"';
    const recovered = await prepareCreativeRebaseline({ ownerId: "owner", saved, expectedRevision: saved.revision, jobs });
    expect(recovered.receipt).toEqual(first.receipt);
    expect(baselines.get(baselineKey(first.receipt))).toEqual(first.receipt);
    saved.draft = recovered.draft;
    expect(await validateSavedGenerationScope("owner", saved)).toBe(first.receipt.body.scopeSignature);
    expect(() => selectOrigin()).toThrow("cannot cover");
    bytesIntact = false;
    saved.draft.musicVideoProject!.generationScope = undefined;
    await expect(prepareCreativeRebaseline({ ownerId: "owner", saved, expectedRevision: saved.revision!, jobs })).rejects.toThrow();
  });

  test("accepting visible reused footage never approves the native take hidden underneath", async () => {
    revise(); await rebaseline(); selectOrigin(); newMissingTake();
    const native = structuredClone(saved.draft.generatedAssets!.find(asset => asset.id === "new-take")!);
    native.id = "hidden-native"; native.jobId = `h3-${"f".repeat(64)}`;
    native.target = { ...native.target!, songStart: 0, songEnd: 2 };
    native.identityVerification = { ...native.identityVerification!, assetId: native.id, jobId: native.jobId };
    saved.draft.generatedAssets!.push(native);
    saved.draft.generatedDraft = selectGeneratedDraftAsset({ draft: saved.draft.generatedDraft!, assets: saved.draft.generatedAssets!, asset: native, segments: base() });
    selectOrigin();
    expect(saved.draft.generatedDraft!.assetIds).toContain(native.id);
    expect(applyDraftGeneratedAssets(base(), saved.draft.generatedAssets!, saved.draft.generatedDraft).some(segment => segment.generatedAssetId === native.id)).toBe(false);
    const partialAssets = structuredClone(saved.draft.generatedAssets!), partial = partialAssets.find(asset => asset.id === native.id)!;
    partial.target!.songEnd = 4; partial.durationSeconds = 4; partial.mediaFrameCount = 96;
    const partialReview = captureGeneratedDraftReview(base(), partialAssets, saved.draft.generatedDraft)!;
    expect(partialReview).not.toBeNull();
    expect(applyDraftGeneratedAssets(base(), partialAssets, saved.draft.generatedDraft).some(segment => segment.generatedAssetId === native.id)).toBe(true);
    expect(approveGeneratedDraft({ draft: saved.draft.generatedDraft!, assets: partialAssets, segments: base(), review: partialReview }).error).toContain("partly covered");
    expect(partial.reviewStatus).toBe("pending");
    accept();
    const untouched = saved.draft.generatedAssets!.find(asset => asset.id === native.id)!;
    expect(untouched.reviewStatus).toBe("pending"); expect(untouched.approvedAt).toBe(undefined);
    const rejected = rejectGeneratedDraftAsset({ draft: saved.draft.generatedDraft!, assets: saved.draft.generatedAssets!, assetId: saved.draft.generatedAssets![0].id });
    const after = applyAcceptedGeneratedDraft(base(), rejected.assets, rejected.draft);
    expect(after.some(segment => segment.generatedAssetId === native.id)).toBe(false);
    expect(after[0].kind).toBe("gap");
  });

  test("unchanged Story confirmation reuses the issued native baseline without adding carryover authority", async () => {
    const previous = saved.draft.musicVideoProject!, original = structuredClone(previous.generationScope!);
    // Native materialization enrolls a baseline without attaching a receipt to the project.
    previous.generationScope = undefined;
    const confirm = () => {
      const prior = saved.draft.musicVideoProject!, story = saved.draft.storyState;
      const prepared = prepareStoryTabPlacements({ project: createMusicVideoProject({ id: "project", analysis: prior.song,
        duration: 4, storyDrafts: story.storyBeats }), videoSources: [], editSettings: story.editSettings },
      story.confirmedSourceContextSignature, sourceSha(saved.draft), storySha(saved.draft));
      saved.draft.musicVideoProject = confirmStoryProjectRevision(prior, prepared, true);
    };
    confirm();
    expect(effectiveGenerationScope(saved.draft.musicVideoProject!)).toBe(original.body.scopeSignature);
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await rebaseline();
      expect(result.receipt).toEqual(original);
      expect(result.receipt.body.reuseOrigins).toBe(undefined);
      expect(baselines.get(baselineKey(original))).toEqual(original);
      expect(saved.draft.generatedDraft!.sourceReviewRequired).toBe(true);
      expect(await validateSavedGenerationScope("owner", saved)).toBe(original.body.scopeSignature);
      confirm();
    }
  });

  test("actual Story preparation retains original baseline; fresh placement, missing-only planning, consent and canonical export preserve origin bytes", async () => {
    const originalJob = structuredClone(jobs[0]), originalAsset = structuredClone(saved.draft.generatedAssets![0]);
    revise();
    expect(saved.draft.musicVideoProject!.generationScope).toBe(undefined);
    expect(Boolean(saved.draft.musicVideoProject!.reuseSourceBaselines?.[0].receiptId)).toBe(true);
    const candidate = await rebaseline();
    expect(candidate.receipt.body.reuseOrigins?.length).toBe(1);
    expect(await validateSavedGenerationScope("owner", saved)).toBe(effectiveGenerationScope(saved.draft.musicVideoProject!));
    selectOrigin();
    const planning = buildH3DraftPlanningInput("project", saved.draft.musicVideoProject!, saved.draft.referenceAssets!, {
      assets: saved.draft.generatedAssets, draft: saved.draft.generatedDraft, jobs, confirmedTreatment: saved.draft.storyState.confirmedTreatmentSnapshot });
    const json = JSON.stringify(planning);
    expect(json).toContain('"completion":"unverified"');
    expect(json).toContain(originalJob.request.prompt);
    expect(planH3DraftWindows(applyDraftGeneratedAssets(base(), saved.draft.generatedAssets!, saved.draft.generatedDraft)).map(window => [window.musicStart, window.musicEnd])).toEqual([[2, 4]]);
    newMissingTake(); accept();
    const result = await reconcileProjectFinalExport(exportInput());
    expect(result.segments.map(segment => [segment.startTime, segment.endTime, segment.musicStart, segment.musicEnd])).toEqual([[1, 3, 0, 2], [0, 2, 2, 4]]);
    expect(result.projectSnapshot?.h3.length).toBe(2);
    expect(jobs[0]).toEqual(originalJob);
    expect(saved.draft.generatedAssets![0]).toEqual(originalAsset);
  });

  test("prepareApprovedPlacements retains historical coordinates before dropping the active receipt", () => {
    const original = saved.draft.musicVideoProject!;
    const next = prepareApprovedPlacements({ project: original, videoSources: [], editSettings: { ...original.placementPlan!.settings, cutDensity: 0.99 } });
    expect(next.generationScope).toBe(undefined);
    expect(next.reuseSourceBaselines).toContainEqual({ scopeSignature: original.generationScope!.body.scopeSignature,
      semanticSha256: generationSemanticSha256(original), receiptId: original.generationScope!.id });
  });

  test("pending closing-source provenance survives revision without blocking missing-only planning or granting consent", async () => {
    const old = saved.draft.musicVideoProject!, receipt = structuredClone(old.generationScope!);
    receipt.body.reprise = { version: 1, status: "pending-review", placementIds: ["opening", "closing"], sourceClipId: 6,
      mediaContentSha256: "6".repeat(64), placementsSha256: generationScopeSha256(old.placementPlan!.placements), overlapSeconds: 2.026 };
    receipt.sha256 = generationScopeSha256(receipt.body); receipt.id = `generation-scope-${receipt.sha256}`;
    old.generationScope = receipt; receipts.set(receipt.id, structuredClone(receipt));
    saved.draft.generatedDraft!.sourceConfirmationSha256 = receipt.sha256; saved.draft.generatedDraft!.sourceReviewRequired = true;
    revise(); await rebaseline(); selectOrigin();
    expect(saved.draft.generatedDraft!.sourceReviewRequired).toBe(true);
    expect(receipts.get(receipt.id)!.body.reprise?.status).toBe("pending-review");
    expect(planH3DraftWindows(applyDraftGeneratedAssets(base(), saved.draft.generatedAssets!, saved.draft.generatedDraft)).map(window => [window.musicStart, window.musicEnd])).toEqual([[2, 4]]);
    const review = captureGeneratedDraftReview(base(), saved.draft.generatedAssets!, saved.draft.generatedDraft)!;
    expect(approveGeneratedDraft({ draft: saved.draft.generatedDraft!, assets: saved.draft.generatedAssets!, segments: base(), review }).error).toContain("Unfilled");
  });

  test("repeated Story confirmation preserves usable origins without inventing authority for unissued intermediate scopes", async () => {
    revise(); revise();
    expect(saved.draft.musicVideoProject!.reuseSourceBaselines!.length).toBe(2);
    const candidate = await rebaseline();
    expect(candidate.receipt.body.reuseOrigins?.length).toBe(1);
  });

  test("issued v2 baseline without inline receipt survives Story revision and requires explicit rebaseline before planning", async () => {
    const original = saved.draft.musicVideoProject!.generationScope!;
    saved.draft.musicVideoProject!.generationScope = undefined;
    revise();
    expect(saved.draft.musicVideoProject!.reuseSourceBaselines?.[0]).toEqual({ scopeSignature: original.body.scopeSignature, semanticSha256: original.body.semanticSha256 });
    await expect(validateSavedGenerationScope("owner", saved, { allowUnissuedBaseline: true })).rejects.toThrow("existing footage");
    expect(writes).toBe(0);
    expect((await rebaseline()).receipt.body.reuseOrigins?.length).toBe(1);
  });

  test("stale Bible binding rejects rebaseline even after story hashes are recomputed", async () => {
    revise();
    const treatment = saved.draft.storyState.confirmedTreatmentSnapshot!;
    treatment.storyBible = { version: 1, adapter: STORY_BIBLE_ADAPTER,
      binding: { ...buildStoryBibleBinding({ projectId: "project", treatment, referenceAssets: saved.draft.referenceAssets! }), storySignature: "old-story" },
      characters: [], facts: [], relationships: [] };
    saved.draft.storyState.storyContentSignature = buildStoryContentSignature(treatment, saved.draft.storyState.storyBeats);
    saved.draft.musicVideoProject!.generationStorySha256 = storySha(saved.draft);
    await expect(prepareCreativeRebaseline({ ownerId: "owner", saved, expectedRevision: saved.revision!, jobs })).rejects.toThrow("story bible");
    expect(writes).toBe(0);
  });

  test("persisted current draft restores the same reuse geometry, review gates and unchanged historical targets", async () => {
    revise(); await rebaseline(); selectOrigin(); newMissingTake();
    const before = applyDraftGeneratedAssets(base(), saved.draft.generatedAssets!, saved.draft.generatedDraft);
    const runtime = hydrateStudioProjectDraft({ draft: saved.draft });
    const persisted = createPersistableStudioProjectDraft(runtime), restored = hydrateStudioProjectDraft({ draft: JSON.parse(JSON.stringify(persisted)) });
    expect(restored.generatedDraft?.reusedTakePlacements).toEqual(saved.draft.generatedDraft!.reusedTakePlacements);
    expect(restored.generatedDraft?.sourceReviewRequired).toBe(true);
    const restoredBase = buildEditPlanPreviewSegments({ project: restored.musicVideoProject, videoSources: restored.videoSources });
    expect(applyDraftGeneratedAssets(restoredBase, restored.generatedAssets, restored.generatedDraft).map(segment => [segment.generatedAssetId, segment.startTime, segment.endTime, segment.musicStart, segment.musicEnd]))
      .toEqual(before.map(segment => [segment.generatedAssetId, segment.startTime, segment.endTime, segment.musicStart, segment.musicEnd]));
    expect(restored.generatedAssets[0].target).toEqual(jobs[0].target);
    accept();
    const accepted = hydrateStudioProjectDraft({ draft: JSON.parse(JSON.stringify(saved.draft)) });
    expect(applyAcceptedGeneratedDraft(restoredBase, accepted.generatedAssets, accepted.generatedDraft).every(segment => segment.kind === "source")).toBe(true);
  });

  test("actual reuse controls expose explicit confirmation and current selection without mounting another video", async () => {
    revise();
    const render = () => renderToStaticMarkup(createElement(ReusedFootagePanel, { project: saved.draft.musicVideoProject!, assets: saved.draft.generatedAssets!,
      segments: base(), draft: saved.draft.generatedDraft ?? null, onConfirm: async () => {}, onSelect: () => {} }));
    expect(render()).toContain("Confirm revised story for existing footage");
    await rebaseline(); selectOrigin();
    const markup = render();
    expect(markup).toContain("Reuse story window"); expect(markup).toContain("Reuse original take");
    expect(markup).toContain('aria-label="Reuse source in"'); expect(markup).toContain("Source 1.000");
    expect(markup).toContain("1 current reuse placements"); expect(markup).not.toContain("<video");
  });

  for (const mutation of ["oversized", "duplicate", "foreign target", "outside original trim", "stale creative scope"] as const) test(`rejects invalid saved reuse: ${mutation}`, async () => {
    revise(); await rebaseline(); selectOrigin();
    const row = saved.draft.generatedDraft!.reusedTakePlacements![0];
    if (mutation === "oversized") saved.draft.generatedDraft!.reusedTakePlacements = Array.from({ length: 129 }, (_, i) => ({ ...row, id: `row-${i}` }));
    if (mutation === "duplicate") saved.draft.generatedDraft!.reusedTakePlacements!.push(structuredClone(row));
    if (mutation === "foreign target") row.target.timelineItemId = "foreign-item";
    if (mutation === "outside original trim") { row.sourceStart = 0; row.sourceEnd = 2; }
    if (mutation === "stale creative scope") row.target.planSignature = jobs[0].target.planSignature;
    if (mutation === "outside original trim") {
      const applied = applyDraftGeneratedAssets(base(), saved.draft.generatedAssets!, saved.draft.generatedDraft);
      expect(applied.some(segment => segment.reusedTakePlacementId === row.id)).toBe(false);
      expect(captureGeneratedDraftReview(base(), saved.draft.generatedAssets!, saved.draft.generatedDraft)).toBe(null);
    } else await expect(validateSavedGenerationScope("owner", saved)).rejects.toThrow("reused placement");
  });

  test("revision conflict and anonymous/foreign project requests issue no baseline", async () => {
    revise();
    await expect(prepareCreativeRebaseline({ ownerId: "owner", saved, expectedRevision: '"stale"', jobs })).rejects.toThrow("changed");
    await expect(prepareCreativeRebaseline({ ownerId: "other", saved, expectedRevision: saved.revision!, jobs })).rejects.toThrow();
    const request = () => new Request("http://app.test/api/studio/projects/source-confirmation", { method: "POST", body: JSON.stringify({ projectId: "project", expectedRevision: '"stale"', mode: "creative-rebaseline" }) });
    expect((await POST(request())).status).toBe(409);
    signedIn = false; expect((await POST(request())).status).toBe(401);
    expect(writes).toBe(0);
  });

  test("explicit mode is idempotent for the same saved revision and does not save the project", async () => {
    revise(); const revision = saved.revision, before = generationScopeSha256(saved);
    const request = () => new Request("http://app.test/api/studio/projects/source-confirmation", { method: "POST", body: JSON.stringify({ projectId: "project", expectedRevision: revision, mode: "creative-rebaseline" }) });
    const one = await POST(request()), two = await POST(request());
    expect(one.status).toBe(200); expect(two.status).toBe(200);
    const a = await one.json(), b = await two.json(); expect(a.receipt).toEqual(b.receipt); expect(a.expectedRevision).toBe(revision);
    expect(generationScopeSha256(saved)).toBe(before);
  });

  for (const condition of ["missing baseline", "foreign job", "changed pixels", "changed references", "changed story", "rejected take", "altered asset"] as const) test(`rebaseline fails closed: ${condition}`, async () => {
    revise();
    if (condition === "missing baseline") receipts.clear();
    if (condition === "foreign job") jobs[0].projectId = "foreign";
    if (condition === "changed pixels") bytesIntact = false;
    if (condition === "changed references") saved.draft.referenceAssets![0].displayName = "Different Club";
    if (condition === "changed story") saved.draft.storyState.confirmedTreatmentSnapshot!.logline = "Unsaved edit";
    if (condition === "rejected take") saved.draft.generatedAssets![0].reviewStatus = "rejected";
    if (condition === "altered asset") saved.draft.generatedAssets![0].mediaSha256 = "0".repeat(64);
    await expect(prepareCreativeRebaseline({ ownerId: "owner", saved, expectedRevision: saved.revision!, jobs })).rejects.toThrow();
    expect(writes).toBe(0);
  });

  test("placement tamper, stale review and missing consent cannot enter accepted preview/export", async () => {
    revise(); await rebaseline(); selectOrigin(); newMissingTake();
    const assets = saved.draft.generatedAssets!, draft = saved.draft.generatedDraft!, review = captureGeneratedDraftReview(base(), assets, draft)!;
    const changed = structuredClone(draft); changed.reusedTakePlacements![0].sourceStart += 0.5;
    expect(approveGeneratedDraft({ draft: changed, assets, segments: base(), review }).error).not.toBeNull();
    expect(() => sanitizeReusedTakePlacements([{ ...draft.reusedTakePlacements![0], sourceEnd: NaN }])).toThrow();
    accept();
    const input = exportInput(); saved.draft.generatedDraft!.reusedTakePlacements![0].originSha256 = "f".repeat(64);
    await expect(reconcileProjectFinalExport(input)).rejects.toThrow("source confirmation changed");
  });

  test("accepted snapshot includes pending historical origins, and changed origin evidence invalidates review", async () => {
    revise(); await rebaseline(); selectOrigin(); newMissingTake(); accept();
    const hash = finalExportSnapshotSha256(saved.draft), original = reuseOriginAssetSha256(saved.draft.generatedAssets![0]);
    const input = exportInput(); saved.draft.generatedAssets![0].identityVerification!.verifier.version = "tampered";
    expect(reuseOriginAssetSha256(saved.draft.generatedAssets![0])).not.toBe(original);
    expect(finalExportSnapshotSha256(saved.draft)).not.toBe(hash);
    await expect(reconcileProjectFinalExport(input)).rejects.toThrow("Reused footage");
  });

  test("fresh canonical historical proof cannot silently replace the pinned saved origin proof", async () => {
    revise(); await rebaseline(); selectOrigin(); newMissingTake(); accept();
    const input = exportInput(), bankBefore = generationScopeSha256(saved.draft.generatedAssets![0]);
    jobs[0].result!.asset.identityVerification!.verifier.version = "changed-canonical-eligible-proof";
    await expect(reconcileProjectFinalExport(input)).rejects.toThrow("reused placement");
    expect(generationScopeSha256(saved.draft.generatedAssets![0])).toBe(bankBefore);
  });
});
