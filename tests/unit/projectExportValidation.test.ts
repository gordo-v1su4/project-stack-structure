import { describe, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import { createMusicVideoProject, placementInputSignature, prepareApprovedPlacements } from "@/components/studio/musicVideoProject";
import { createPersistableStudioProjectDraft } from "@/components/studio/projectPersistence";
import { buildStudioSourceContextSignature, studioSourceContextInput } from "@/components/studio/studioSourceContext";
import { generationScopeSha256, generationSemanticSha256, sourceReferenceManifest, type GenerationScopeReceipt } from "@/components/studio/generationScope";
import { buildStoryContentSignature, type StoryTreatment } from "@/components/studio/storyTreatments";
import type { GeneratedAssetIdentityVerification, GeneratedStudioAsset } from "@/components/studio/generatedAssets";
import { generatedAssetDraftIdentityBlockReason } from "@/components/studio/generatedAssets";
import type { H3GenerationJob } from "@/components/studio/h3Generation";
import type { BeatJoinAnalysis } from "@/components/studio/types";
import type { ReferenceAsset } from "@/components/studio/referenceAssets";
import type { SavedStudioProject } from "@/lib/studioProjectStore";
import { H3_DRAFT_SIMILARITY_POLICY_ID, H3_DRAFT_SIMILARITY_POLICY_SHA256, H3_DRAFT_SIMILARITY_PROJECT_ID, resolveH3DraftSimilarityPolicy } from "@/components/studio/identityDraftPolicy";
import { currentIdentityEvidenceSha256, type H3IssuedDraftPolicy } from "@/components/studio/issuedIdentityPolicy";
import { issuedPolicyFixture, issuedProofFixture } from "../helpers/issuedIdentityPolicy";
import { buildH3IdentityAssessmentScope, identityAssessmentAsset, type H3IdentityAssessment } from "@/components/studio/h3IdentityAssessment";
import { identityPolicySha256 } from "@/components/studio/issuedIdentityPolicy";
import { H3_FIRST_FRAME_PROFILE, H3_FIRST_FRAME_PREPARATION, h3FirstFrameBinding } from "@/components/studio/h3FirstFrame";
import { firstFrameArtifactFixture, firstFrameAssessmentFixture } from "../helpers/h3FirstFrame";
import {CURRENT_IDENTITY_PURPOSE,buildCurrentIdentityScope,currentIdentityOrigin,currentIdentityProofOrigin,currentIdentityReviewSha256,currentReferenceIdentityApprovalSha256,withCurrentReferenceIdentity,type CurrentIdentityAssessment,type CurrentIdentityPolicy,type CurrentIdentityProof} from "@/components/studio/currentReferenceIdentity";
import {issuedGalleryProfileSha256} from "@/components/studio/issuedIdentityPolicy";
import { reuseOriginAssetSha256, reusedTakeReviewSha256, type ReusedTakePlacement } from "@/components/studio/reusedTakePlacements";
import { applyDraftGeneratedAssets, captureGeneratedDraftReview, approveGeneratedDraft } from "@/components/studio/generatedDraft";
import { buildEditPlanPreviewSegments } from "@/components/studio/musicVideoProject";
import { buildStoryDraftSegments } from "@/components/studio/animaticDraft";
import { prepareSceneProofPlan } from "@/components/studio/sceneProofs";
import { animaticShotBinding, importStillAnimatic, stillAnimaticShotRequest } from "@/components/studio/stillAnimatic";
import { animaticReviewBinding, reviewAnimatic } from "@/components/studio/animaticReview";
import { parseH3StillRequest } from "@/lib/h3StillRequest";

let signedIn = true, dispatches: Array<Record<string, unknown>> = [], reads = 0;
let saved: SavedStudioProject, job: H3GenerationJob, projectId = "project-1";
let issuedPolicy: H3IssuedDraftPolicy | undefined;
let rangeRecord:H3IdentityAssessment|undefined;
let currentRecord:CurrentIdentityAssessment|undefined,currentPolicy:CurrentIdentityPolicy|undefined,currentRecordMissing=false;
mock.module("@/lib/currentIdentityStore",()=>({readCurrentIdentityAssessment:async()=>currentRecordMissing?null:currentRecord??null,readCurrentIdentityPolicy:async()=>currentPolicy??null}));
let firstFrameBytesIntact=true,firstFrameAvailable=true,firstFrameScreenAvailable=true,firstFrameReads=0;
const sourceReceipts = new Map<string, GenerationScopeReceipt>();
mock.module("@/lib/generationScopeMedia", () => ({ verifyGenerationScopeMedia: async (_owner: string, _draft: unknown, expected: unknown) => expected,
  pinGenerationScopeMedia: async () => { throw new Error("Unexpected media pin in export"); }, bootstrapR31SourceMedia: async () => { throw new Error("Unexpected bootstrap in export"); } }));
mock.module("@/lib/generationScopeRawReferences", () => ({ verifyGenerationScopeRawReferences: async (_owner: string, _references: unknown, expected: unknown) => expected,
  pinGenerationScopeRawReferences: async () => { throw new Error("Unexpected reference pin in export"); } }));
mock.module("@/lib/generationScopeStore", () => ({ readGenerationScopeReceipt: async (_owner: string, _project: string, id: string) => sourceReceipts.get(id) ?? null,
  readGenerationScopeBaseline: async () => null, storeGenerationScopeBaseline: async () => { throw new Error("Unexpected baseline issuance in export"); },
  storeGenerationScopeReceipt: async () => { throw new Error("Unexpected source confirmation in export"); } }));
const {assertH3FirstFrameMatchesJob}=await import("@/lib/h3FirstFrameStore");
mock.module("@/lib/h3FirstFrameStore",()=>({assertH3FirstFrameMatchesJob,
  readH3FirstFrame:async()=>firstFrameAvailable?job.firstFrame:null,
  readH3FirstFrameAssessment:async()=>firstFrameScreenAvailable?job.firstFrameAssessment:null,
  downloadH3FirstFrame:async()=>{firstFrameReads++;if(!firstFrameBytesIntact)throw new Error("Canonical image SHA differs");return new Uint8Array([1,2,3]);}}));
mock.module("@/lib/h3IdentityAssessmentStore",()=>({readH3IdentityAssessment:async(owner:string,project:string,jobId:string,id:string)=>
  rangeRecord&&owner===rangeRecord.scope.ownerId&&project===rangeRecord.scope.projectId&&jobId===rangeRecord.scope.jobId&&id===rangeRecord.scope.id?rangeRecord:null}));
const { assertIssuedH3DraftPolicyMatchesJob } = await import("@/lib/h3DraftPolicyStore");
mock.module("@/lib/h3DraftPolicyStore", () => ({ assertIssuedH3DraftPolicyMatchesJob,
  readIssuedH3DraftPolicy: async (owner: string, project: string, binding: { id: string }) => {
    expect(owner).toBe("github-test"); expect(project).toBe(projectId);
    return issuedPolicy?.id === binding.id ? issuedPolicy : null;
  } }));
mock.module("@/lib/session", () => ({ getSessionUser: async () => signedIn ? { id: "github-test" } : null,
  unauthorizedResponse: () => Response.json({ success: false }, { status: 401 }) }));
mock.module("@/lib/mediaGateway", () => ({ getMediaGatewayConfig: () => ({ bucket: "studio" }), normalizeMediaPath: (value: string) => value,
  uploadFileToMediaGateway: async () => { throw new Error("Unexpected upload in durable-ref test"); } }));
mock.module("@/lib/studioProjectStore", () => ({ readStudioProject: async (owner: string, id: string, options: { fresh?: boolean }) => {
  reads++; expect(options.fresh).toBe(true); return owner === "github-test" && id === projectId ? saved : null;
} }));
mock.module("@/lib/h3JobStore", () => ({ readH3Job: async (owner: string, id: string, jobId: string) => {
  expect(owner).toBe("github-test"); expect(id).toBe(projectId); return jobId === job.id ? job : null;
} }));
mock.module("@/lib/triggerOrchestration", () => ({ triggerFinalExport: async (payload: Record<string, unknown>) => { dispatches.push(payload); return { id: "export-run" }; },
  triggerShaderCaptureExport: async (payload: Record<string, unknown>) => { dispatches.push(payload); return { id: "capture-run" }; } }));
const { POST } = await import("@/app/api/export/final/route");
const { POST: capture } = await import("@/app/api/export/shader-capture/route");
const id = `h3-${"a".repeat(64)}`;
let key = `media-uploads/projects/github-test/generated/project-1/${id}/shot.mp4`;
const hash = (byte: string) => byte.repeat(64);
const mediaHash = createHash("sha256").update(new Uint8Array([1, 2, 3])).digest("hex");

function reset(idForProject = "project-1", duration = 3) {
  sourceReceipts.clear();
  signedIn = true; dispatches = []; reads = 0; issuedPolicy = undefined;rangeRecord=undefined;
  currentRecord=undefined;currentPolicy=undefined;currentRecordMissing=false;
  firstFrameBytesIntact=firstFrameAvailable=firstFrameScreenAvailable=true;firstFrameReads=0;
  projectId = idForProject; key = `media-uploads/projects/github-test/generated/${projectId}/${id}/shot.mp4`;
  const analysis: BeatJoinAnalysis = { sourceLabel: "master.wav", audioUrl: "", duration, waveform: [], energy: [], beats: [], onsets: [], sections: [],
    storageBucket: "studio", storagePath: "media-uploads/github-test/source-audio/master.wav", storageUrl: "https://media.test/master.wav" };
  const refs: ReferenceAsset[] = [{ id: "diego", role: "character-1", kind: "character", displayName: "Diego", fileName: "diego.png",
    previewUrl: "", promptHint: "", storageStatus: "uploaded", storageBucket: "studio", storagePath: "media-uploads/github-test/refs/diego.png", storageUrl: "https://media.test/diego.png", createdAt: "2026-11-06T00:00:00Z" },
  { id: "club", role: "environment", kind: "environment", displayName: "Club", fileName: "club.png", previewUrl: "", promptHint: "", storageStatus: "uploaded",
    storageBucket: "studio", storagePath: "media-uploads/github-test/refs/club.png", storageUrl: "https://media.test/club.png", createdAt: "2026-11-06T00:00:00Z" }];
  const beats = [{ id: "verse", label: "Verse", start: 0, end: duration, prompt: "Diego reacts." }];
  const treatment: StoryTreatment = { id: "story", kind: "faithful", title: "Test story", logline: "Diego reacts.", synopsis: "A controlled reaction.",
    visualThesis: "Stable identity.", endingHook: "Diego reacts.", expectedReusePercent: 0, expectedGenerationPercent: 100,
    anchors: [{ id: "reaction", title: "Reaction", description: "Diego reacts.", purpose: "Reaction", generationPrompt: "Diego reacts.", coverage: "missing", candidates: [], selectedCandidateId: null, resolution: "generate" }] };
  const sourceContext = buildStudioSourceContextSignature({ analysis, videoSources: [], referenceAssets: refs });
  const project = prepareApprovedPlacements({ project: { ...createMusicVideoProject({ analysis, duration, storyDrafts: beats }), sourceContextSignature: sourceContext }, videoSources: [] });
  const item = project.editPlan.timelineItems[0];
  const target = { planSignature: project.placementPlan!.inputSignature, timelineItemId: item.id, sectionId: item.sectionId, sectionLabel: "Verse", songStart: 0, songEnd: duration };
  const proof: GeneratedAssetIdentityVerification = { version: 1, status: "passed", assetId: id, jobId: id, generationModel: "h3-ref2va-int8-v2",
    mediaSha256: mediaHash, durationSeconds: 124 / 24, frameCount: 124, frameRate: 24, verifiedStartFrame: 0, verifiedEndFrameExclusive: 72,
    examinedFrameCount: 72, unverifiableFrameCount: 0, ambiguousFrameCount: 0, referenceHashes: [hash("b"), hash("c")], identityReferenceHashes: [hash("b")],
    assessedAt: "2026-11-06T00:00:00Z", verifier: { method: "face-embedding-cosine", model: "synthetic-fixture-only", modelSha256: hash("d"), version: "1",
      preprocessVersion: "fixture", calibrationId: "synthetic-contract-not-production" }, threshold: 0.8, coverage: "complete",
    samples: [0, 1, 2].map((timeSeconds, index) => ({ timeSeconds, frameSha256: hash(String(index + 1)), scores: [{ referenceHash: hash("b"), trackId: "lead", score: 0.9 }] })) };
  const asset: GeneratedStudioAsset = { id, jobId: id, provider: "swarmui", model: "h3-ref2va-int8-v2", prompt: "Diego reacts.", createdAt: "2026-11-06T00:00:00Z",
    status: "completed", mediaKind: "video", durationSeconds: 124 / 24, reviewStatus: "pending", mediaSha256: mediaHash, mediaFrameCount: 124, mediaFrameRate: 24,
    generationReferenceHashes: [hash("b"), hash("c")], identityReferenceHashes: [hash("b")], identityVerification: proof,
    fullStorage: { bucket: "studio", objectKey: key, storagePath: key, publicUrl: "https://media.test/take.mp4", mime: "video/mp4" }, target, trimStart: 0 };
  const storyState = { vocalStemName: "", transcriptSummary: null, activeBeatId: "verse", storyBeats: beats, storyGenerated: true,
    treatments: [treatment], confirmedTreatmentSnapshot: treatment, confirmedTreatmentId: "story", confirmedSourceContextSignature: sourceContext,
    storyContentSignature: buildStoryContentSignature(treatment, beats) };
  const draft = createPersistableStudioProjectDraft({ analysis, videoSources: [], referenceAssets: refs, storyState, musicVideoProject: project,
    generatedAssets: [{ ...asset, reviewStatus: "approved" }], generatedDraft: { planSignature: target.planSignature!, revision: 2, assetIds: [] } });
  saved = { version: 1, project: { id: projectId, ownerId: "github-test", name: "Test" } as SavedStudioProject["project"], draft };
  job = { version: 1, id, ownerId: "github-test", projectId, profile: "h3-ref2va-int8-v2", conditioningPreparationVersion: "canonical-front-crop-v1",
    state: "ready", createdAt: asset.createdAt, updatedAt: asset.createdAt, target, frames: 124,
    request: { projectId, planSignature: target.planSignature!, sectionId: item.sectionId, timelineItemId: item.id, songStart: 0, songEnd: 3,
      prompt: "Diego reacts.", referenceAssetIds: ["diego", "club"], requestIntentId: "eacaa976-4fca-4cab-9160-0164107b8440" },
    references: refs.map((ref, index) => ({ assetId: ref.id, canonicalName: ref.displayName, role: index ? "environment" : "identity", bucket: "studio", objectKey: ref.storagePath!, version: "fixture" })),
    referenceHashes: [hash("b"), hash("c")], result: { asset } };
  job.request.songEnd = duration;
}
function form(projectContext = true) {
  const data = new FormData();
  data.set("requestKey", "final-export-owned-v1-canonical-validation");
  data.set("audioRef", JSON.stringify({ bucket: "studio", objectKey: saved.draft.analysis!.storagePath }));
  data.set("videoRefs", JSON.stringify([{ bucket: "studio", objectKey: key, expectedSha256: hash("f") }]));
  const duration = saved.draft.musicVideoProject!.duration;
  data.set("segments", JSON.stringify([{ sourceIndex: 0, startTime: 0, endTime: duration, musicStart: 0, musicEnd: duration }]));
  if (projectContext) for (const [name, value] of Object.entries({ projectId, planSignature: saved.draft.musicVideoProject!.placementPlan!.inputSignature,
    placementRevision: saved.draft.musicVideoProject!.placementPlan!.revision, draftRevision: 2 })) data.set(name, String(value));
  return data;
}
function post(data: FormData) { return POST(new Request("http://app.test/api/export/final", { method: "POST", body: data })); }

test("export reconstructs the reviewed animatic target instead of the legacy edit window", async () => {
  reset();
  const d = saved.draft, project = d.musicVideoProject!, story = d.storyState;
  const context = { projectId, project, treatment: story.confirmedTreatmentSnapshot!, storyBeats: story.storyBeats, references: d.referenceAssets! };
  const sceneProofPlan = prepareSceneProofPlan(context); story.sceneProofPlan = sceneProofPlan;
  const input = { ...context, sceneProofPlan };
  let plan = importStillAnimatic(input, { projectId, fps: 24, masterDuration: 3, totalFrames: 72, slots: [{ id: "A001",
    sceneId: sceneProofPlan.scenes[0].id, sceneTitle: "Club", timelineItemId: project.editPlan.timelineItems[0].id,
    startFrame: 0, endFrame: 72, prompt: "[Static] Medium shot. Diego waits inside dark Club.", referenceAssetIds: ["diego", "club"] }] });
  const shot = plan.shots[0], binding = animaticShotBinding(plan, shot), stillId = `h3-still-${hash("b")}`;
  const request = parseH3StillRequest({ shot: stillAnimaticShotRequest(input, plan, shot), creativePrompt: shot.prompt,
    animaticShot: binding, seed: 42, requestIntentId: crypto.randomUUID(), attempt: 0 });
  shot.record = { version: 1, projectId, context: binding.bindingSha256, request, jobId: stillId };
  const image = { bucket: "studio", objectKey: `media-uploads/projects/github-test/still-results/${projectId}/${stillId}/master.png`,
    sha256: hash("c"), byteLength: 100, width: 2048, height: 1152 };
  shot.proof = { jobId: stillId, descriptorSha256: hash("d"), result: { master: image, native: { ...image, width: 1344, height: 768 },
    artifactId: `h3-frame-${hash("e")}`, artifactSha256: hash("e") } };
  const audioUrl = `/api/storage/media?${new URLSearchParams({ bucket: d.analysis!.storageBucket!, objectKey: d.analysis!.storagePath! })}`;
  plan = reviewAnimatic(plan, plan.contextSha256, audioUrl, animaticReviewBinding(plan, plan.contextSha256, audioUrl)!, "approved", "Reviewed");
  story.stillAnimaticPlan = plan;
  const [segment] = buildStoryDraftSegments({ projectId, project, storyState: story, videoSources: [], referenceAssets: d.referenceAssets!, audio: d.analysis });
  expect(segment.timelineItemId).toBe("animatic:A001");
  job.target = { ...job.target, timelineItemId: segment.timelineItemId!, animaticMotion: segment.animaticMotion };
  job.request = { ...job.request, timelineItemId: segment.timelineItemId, animaticMotion: segment.animaticMotion };
  job.result!.asset.target = structuredClone(job.target);
  d.generatedAssets![0].target = structuredClone(job.target);
  const result = await post(form()); expect(result.status).toBe(202); expect(dispatches).toHaveLength(1);
  dispatches = [];
  // Same time and shot number do not authorize another reviewed image.
  d.generatedAssets![0].target!.animaticMotion!.imageSha256 = hash("f");
  expect((await post(form())).status).toBe(409); expect(dispatches).toHaveLength(0);
});

function confirmFixtureSourceAppend() {
  const draft = saved.draft, project = draft.musicVideoProject!, story = draft.storyState;
  const oldInput = project.placementPlan!.inputSignature, oldContext = project.sourceContextSignature!;
  draft.referenceAssets!.push({ id: "supplemental", role: "crowd", kind: "crowd", displayName: "Supplemental extras", fileName: "extras.png", previewUrl: "", promptHint: "",
    storageStatus: "uploaded", storageBucket: "studio", storagePath: "media-uploads/github-test/references/supplemental/extras.png", createdAt: "2026-11-07T00:00:00Z" });
  const input = { analysis: draft.analysis ? { ...draft.analysis, audioUrl: draft.analysis.storageUrl ?? "" } : null,
    videoSources: draft.videoSources.map(source => ({ ...source, videoUrl: source.storageUrl ?? "" })), referenceAssets: draft.referenceAssets };
  project.sourceContextSignature = buildStudioSourceContextSignature(input);
  project.placementPlan!.inputSignature = placementInputSignature(project);
  story.confirmedSourceContextSignature = project.sourceContextSignature;
  const body: GenerationScopeReceipt["body"] = { version: 1, kind: "additive-reference", ownerId: "github-test", projectId,
    baselineRevision: '"fixture-revision"', fromSourceContext: oldContext, toSourceContext: project.sourceContextSignature,
    fromInputSignature: oldInput, toInputSignature: project.placementPlan!.inputSignature, scopeSignature: oldInput,
    semanticSha256: generationSemanticSha256(project), references: sourceReferenceManifest(draft.referenceAssets!), appendedReferenceIds: ["supplemental"],
    rawReferences: draft.referenceAssets!.map(reference => ({ assetId: reference.id, bucket: reference.storageBucket!, objectKey: reference.storagePath!, etag: '"fixed"', sha256: "a".repeat(64), byteLength: 10 })),
    sourceMediaVersions: [],
    sourceInventorySha256: generationScopeSha256(studioSourceContextInput(input)), storySha256: generationScopeSha256({ storyBeats: story.storyBeats,
      confirmedTreatmentSnapshot: story.confirmedTreatmentSnapshot, storyContentSignature: story.storyContentSignature, editSettings: story.editSettings }) };
  const sha256 = generationScopeSha256(body), receipt: GenerationScopeReceipt = { version: 1, id: `generation-scope-${sha256}`, sha256, body };
  project.generationScope = receipt;
  draft.generatedDraft = { ...draft.generatedDraft!, sourceConfirmationSha256: sha256, sourceReviewRequired: false };
  sourceReceipts.set(receipt.id, structuredClone(receipt));
  return receipt;
}

describe("final export after strong source equivalence", () => {
  test("retains exact canonical job targets while binding the fresh input and canonical equivalence receipt into export", async () => {
    reset(); const target = JSON.stringify(job.target), receipt = confirmFixtureSourceAppend();
    const response = await post(form());
    expect(response.status).toBe(202); expect(dispatches.length).toBe(1);
    const snapshot = dispatches[0].projectSnapshot as { planSignature: string; generationScope: { signature: string; receiptSha256: string } };
    expect(snapshot.planSignature).toBe(saved.draft.musicVideoProject!.placementPlan!.inputSignature);
    expect(snapshot.generationScope).toEqual({ signature: job.target.planSignature!, receiptSha256: receipt.sha256 });
    expect(JSON.stringify(job.target)).toBe(target);
  });
  for (const failure of ["pending fresh review", "missing review binding", "missing canonical receipt", "forged receipt", "changed source library", "changed source range"]) {
    test(`rejects ${failure} before export dispatch`, async () => {
      reset(); const receipt = confirmFixtureSourceAppend();
      if (failure === "pending fresh review") saved.draft.generatedDraft!.sourceReviewRequired = true;
      if (failure === "missing review binding") delete saved.draft.generatedDraft!.sourceConfirmationSha256;
      if (failure === "missing canonical receipt") sourceReceipts.clear();
      if (failure === "forged receipt") receipt.body.scopeSignature = "placements-v1-forged";
      if (failure === "changed source library") saved.draft.referenceAssets!.at(-1)!.displayName = "Changed";
      if (failure === "changed source range") saved.draft.musicVideoProject!.placementPlan!.placements[0].songEnd -= .1;
      expect((await post(form())).status).toBe(409); expect(dispatches.length).toBe(0);
    });
  }
});

function provisionalProof(): GeneratedAssetIdentityVerification {
  const policy = resolveH3DraftSimilarityPolicy(H3_DRAFT_SIMILARITY_POLICY_ID, H3_DRAFT_SIMILARITY_POLICY_SHA256)!;
  const proof = structuredClone(job.result!.asset.identityVerification!);
  proof.status = "unverifiable"; proof.coverage = "incomplete"; proof.threshold = undefined;
  proof.identityReferenceHashes = [policy.identityReferenceSha256]; proof.referenceHashes = [policy.identityReferenceSha256, hash("c")];
  proof.verifier = { method: "face-embedding-cosine", model: policy.verifierModel, modelSha256: policy.modelSha256,
    version: policy.verifierVersion, preprocessVersion: policy.preprocessVersion, calibrationId: "not-calibrated" };
  proof.samples = Array.from({ length: 72 }, (_, index) => ({ timeSeconds: index / 24, frameSha256: createHash("sha256").update(`frame-${index}`).digest("hex"),
    scores: [{ referenceHash: policy.identityReferenceSha256, trackId: "lead", score: 0.9 }] }));
  proof.draftSimilarityFilter = { version: 1, policyId: policy.id, policySha256: policy.sha256, status: "eligible", threshold: policy.threshold,
    examinedFrameCount: 72, eligibleFrameCount: 72, outOfScopeFrameCount: 0, ambiguousFrameCount: 0, samples: structuredClone(proof.samples), warnings: [] };
  return proof;
}

describe("final export canonical identity and ownership boundary", () => {
  test("replaying the same cut retains its canonical snapshot across autosaves and export ACK persistence", async () => {
    reset();
    expect((await post(form())).status).toBe(202);
    const first = dispatches[0].projectSnapshot;
    saved.draft.savedAt = "2026-11-07T02:30:00Z";
    saved.draft.workflowUiSettings = { ...saved.draft.workflowUiSettings, activeTab: "compose", isPreviewExpanded: true,
      finalExportIntent: { version: 1, projectId, requestKey: "final-export-replayed", snapshotSha256: "a".repeat(64), createdAt: "2026-11-07T02:00:00Z", state: "running", runId: "run_existing" } };
    expect((await post(form())).status).toBe(202);
    expect(dispatches[1].projectSnapshot).toEqual(first);
  });
  function lateEnvironmentSetup() {
    reset("project-1", 1.59);
    job.references = job.references.filter(reference => reference.role === "environment");
    job.request.referenceAssetIds = ["club"]; job.referenceHashes = [hash("c")];
    const canonical = job.result!.asset, proof = canonical.identityVerification!;
    canonical.generationReferenceHashes = [...job.referenceHashes]; canonical.identityReferenceHashes = [];
    proof.status = "not_required"; proof.coverage = "not_required"; proof.samples = []; proof.examinedFrameCount = 0;
    proof.referenceHashes = [...job.referenceHashes]; proof.identityReferenceHashes = [];
    proof.verifiedStartFrame = 0; proof.verifiedEndFrameExclusive = 39;
    saved.draft.generatedAssets![0] = { ...structuredClone(canonical), reviewStatus: "approved", trimStart: 3.267 };
    const data = form(); data.set("segments", JSON.stringify([{ sourceIndex: 0, startTime: 3.267, endTime: 4.857, musicStart: 0, musicEnd: 1.59 }]));
    return data;
  }
  test("a canonical environment-only late trim uses native frame bounds without rewriting its original proof", async () => {
    const data = lateEnvironmentSetup();
    expect((await post(data)).status).toBe(202);
    expect((dispatches[0] as { segments: Array<{ sourceFrameWindow: unknown }> }).segments[0].sourceFrameWindow)
      .toEqual({ startFrame: 78, endFrameExclusive: 117, frameRate: 24, totalFrames: 124 });
    expect(job.result!.asset.identityVerification!.verifiedEndFrameExclusive).toBe(39);
  });
  test("a forged environment exemption cannot widen an identity-conditioned take", async () => {
    const data = lateEnvironmentSetup();
    job.references[0].role = "identity";
    expect((await post(data)).status).toBe(409); expect(dispatches).toHaveLength(0);
  });
  test("a browser-only not-required claim cannot widen canonical assessed identity frames", async () => {
    const data = lateEnvironmentSetup();
    const canonical = job.result!.asset, proof = canonical.identityVerification!;
    job.references[0].role = "identity"; canonical.identityReferenceHashes = [...job.referenceHashes!];
    proof.status = "passed"; proof.coverage = "complete"; proof.identityReferenceHashes = [...job.referenceHashes!];
    proof.examinedFrameCount = 39; proof.samples = [0, .5, 1].map((timeSeconds, index) => ({ timeSeconds, frameSha256: hash(String(index + 1)),
      scores: [{ referenceHash: job.referenceHashes![0], trackId: "lead", score: .9 }] }));
    expect((await post(data)).status).toBe(409); expect(dispatches).toHaveLength(0);
  });
  function issuedSetup(familyVersion: 1 | 2 = 1) {
    reset(); job.profile = "h3-ref2va-int8-v3"; job.conditioningPreparationVersion = "canonical-front-crops-v2";
    job.request.identityPolicyFamily = `sface-yunet-foreground-frontal-v${familyVersion}`;
    job.references.forEach((ref, index) => { ref.etag = `etag-${index}`; });
    issuedPolicy = issuedPolicyFixture(job, job.referenceHashes).policy;
    const { body: _body, issuedAt: _issuedAt, ...binding } = issuedPolicy; void _body; void _issuedAt; job.identityPolicy = binding;
    const asset = job.result!.asset; asset.model = job.profile;
    asset.identityVerification = issuedProofFixture(job, asset, issuedPolicy);
    saved.draft.generatedAssets![0] = { ...structuredClone(asset), reviewStatus: "approved", approvedIdentityEvidenceSha256: currentIdentityEvidenceSha256(asset) };
  }
  function currentReferenceSetup(){
    issuedSetup(2);const receipt=confirmFixtureSourceAppend(),project=saved.draft.musicVideoProject!,original=job.result!.asset,oldHash=job.referenceHashes![0],newHash=hash("e");
    const galleries=issuedPolicy!.body.galleries.map(gallery=>({...gallery,rawSha256:gallery.rawSha256===oldHash?newHash:gallery.rawSha256}));
    const galleryProfileSha256=issuedGalleryProfileSha256(galleries);
    const body:CurrentIdentityPolicy["body"]={...issuedPolicy!.body,purpose:CURRENT_IDENTITY_PURPOSE,
      originalPolicy:{kind:"issued",id:issuedPolicy!.id,sha256:issuedPolicy!.sha256},
      references:issuedPolicy!.body.references.map(reference=>({...reference,rawSha256:reference.rawSha256===oldHash?newHash:reference.rawSha256})),identityReferenceHashes:[newHash],galleries,galleryProfileSha256,
      preprocessVersion:`opencv412-aligncrop112-rgb-f32-nchw-unit-centroid-v1-gallery-v2-${galleryProfileSha256}`};
    const sha=identityPolicySha256(body);currentPolicy={version:1,id:`h3-current-policy-${sha}`,sha256:sha,body};
    receipt.body.kind="reference-version-migration";receipt.body.referenceMigration={version:1,authority:"r31-approved-diego-e71-v1",contextSha256:hash("f"),baselineSha256:hash("b"),adoptionSha256:hash("a"),
      replacements:[{assetId:job.references[0].assetId,fromSha256:oldHash,toSha256:newHash}],historicalReferences:[],origins:[{jobId:job.id,...currentIdentityOrigin(job)}]};
    receipt.sha256=generationScopeSha256(receipt.body);receipt.id=`generation-scope-${receipt.sha256}`;sourceReceipts.set(receipt.id,structuredClone(receipt));
    const context={migrationSha256:receipt.sha256,contextSha256:hash("f"),replacements:receipt.body.referenceMigration.replacements,assessments:{} as Record<string,CurrentIdentityAssessment>,activeAssessments:{} as Record<string,string>};
    const scope=buildCurrentIdentityScope(job,original,context,currentPolicy,"00000000-0000-4000-8000-000000000008");
    const {referenceHashes:_refs,issuedPolicy:_issued,...source}=structuredClone(original.identityVerification!);void _refs;void _issued;
    const proof:CurrentIdentityProof={...source,purpose:CURRENT_IDENTITY_PURPOSE,evaluationReferenceHashes:body.references.map(reference=>reference.rawSha256),identityReferenceHashes:[newHash],evaluationPolicy:currentPolicy,origin:currentIdentityProofOrigin(scope)};
    proof.verifier.preprocessVersion=body.preprocessVersion;proof.draftSimilarityFilter!.policyId=currentPolicy.id;proof.draftSimilarityFilter!.policySha256=currentPolicy.sha256;
    for(const sample of [...proof.samples,...proof.draftSimilarityFilter!.samples])for(const score of [...sample.scores,...(sample.candidateScores??[])])if(score.referenceHash===oldHash)score.referenceHash=newHash;
    currentRecord={version:1,scope,status:"ready",assessedAt:"2026-11-07",proof,proofSha256:identityPolicySha256(proof)};context.assessments[scope.id]=currentRecord;context.activeAssessments[original.id]=scope.id;
    project.currentIdentity=context;saved.draft.generatedDraft!.sourceConfirmationSha256=receipt.sha256;saved.draft.generatedDraft!.currentIdentityApprovalSha256=currentIdentityReviewSha256(context);
    saved.draft.generatedAssets![0].approvedCurrentReferenceEvidenceSha256=currentReferenceIdentityApprovalSha256(withCurrentReferenceIdentity([saved.draft.generatedAssets![0]],context)[0]);
  }
  test("exports distinct canonical current-reference receipts while preserving original generation hashes",async()=>{
    currentReferenceSetup();const before=JSON.stringify(job);const response=await post(form());if(response.status!==202)throw new Error(String((await response.json()).error));expect(response.status).toBe(202);expect(dispatches).toHaveLength(1);expect(JSON.stringify(job)).toBe(before);
    const snapshot=(dispatches[0] as {projectSnapshot:{currentIdentityContextSha256:string;h3:Array<{currentIdentityAssessmentId:string}>}}).projectSnapshot;
    expect(snapshot.currentIdentityContextSha256).toBe(hash("f"));expect(snapshot.h3[0].currentIdentityAssessmentId).toBe(currentRecord!.scope.id);
  });
  test("reused consent binds per-take current-reference evidence; unchanged migration/context and media need fresh cut review", async () => {
    currentReferenceSetup();
    const project = saved.draft.musicVideoProject!, oldReceipt = project.generationScope!, bankAsset = saved.draft.generatedAssets![0];
    const immutableJob = JSON.stringify(job), immutableAsset = JSON.stringify(bankAsset), oldContext = project.currentIdentity!;
    project.editPlan.timelineItems[0].prompt += " A revised narrative placement.";
    project.placementPlan!.inputSignature = placementInputSignature(project);
    const scope = `generation-v2-${generationScopeSha256(["revised-story", project.placementPlan!.inputSignature])}`;
    const { referenceMigration: _migration, ...historicalBody } = oldReceipt.body; void _migration;
    const body: GenerationScopeReceipt["body"] = { ...historicalBody, kind: "baseline", appendedReferenceIds: [],
      fromSourceContext: project.sourceContextSignature!, toSourceContext: project.sourceContextSignature!,
      fromInputSignature: project.placementPlan!.inputSignature, toInputSignature: project.placementPlan!.inputSignature,
      scopeSignature: scope, semanticSha256: generationSemanticSha256(project), currentIdentityMigrationSha256: oldReceipt.sha256,
      reuseOrigins: [{ assetId: bankAsset.id, jobId: job.id, scopeSignature: job.target.planSignature!, assetSha256: reuseOriginAssetSha256(bankAsset) }] };
    const sha256 = generationScopeSha256(body), receipt: GenerationScopeReceipt = { version: 1, id: `generation-scope-${sha256}`, sha256, body };
    project.generationScope = receipt; sourceReceipts.set(receipt.id, structuredClone(receipt));
    const item = project.editPlan.timelineItems[0];
    const row: ReusedTakePlacement = { version: 1, id: "current-reuse", assetId: bankAsset.id, jobId: job.id, originSha256: reuseOriginAssetSha256(bankAsset),
      target: { ...bankAsset.target!, planSignature: scope, timelineItemId: item.id, sectionId: item.sectionId,
        requirementId: item.requirementId, narrativeMomentId: item.narrativeMomentId }, sourceStart: 0, sourceEnd: 3 };
    const projected = withCurrentReferenceIdentity([bankAsset], oldContext)[0];
    row.approvedReviewSha256 = reusedTakeReviewSha256(row, projected);
    saved.draft.generatedDraft = { ...saved.draft.generatedDraft!, planSignature: scope, sourceConfirmationSha256: receipt.sha256, reusedTakePlacements: [row] };
    expect((await post(form())).status).toBe(202); dispatches = [];
    const sameContextBinding = JSON.stringify({ migration: oldContext.migrationSha256, context: oldContext.contextSha256, media: bankAsset.mediaSha256, placement: row });
    // A new eligible assessment for the same context/range/media is a distinct per-take receipt.
    currentRecord = structuredClone(currentRecord!);
    if (currentRecord.status !== "ready") throw new Error("Expected ready synthetic current-reference assessment");
    currentRecord.proof.draftSimilarityFilter!.samples[0].scores[0].score = .95;
    currentRecord.proof.draftSimilarityFilter!.samples[0].foreground!.detections[0].score = .95;
    currentRecord.proofSha256 = identityPolicySha256(currentRecord.proof);
    const changedProjection = { ...projected, currentReferenceIdentity: { ...projected.currentReferenceIdentity!, assessment: currentRecord } };
    expect(generatedAssetDraftIdentityBlockReason(changedProjection)).toBe(null);
    expect(reusedTakeReviewSha256(row, changedProjection)).not.toBe(row.approvedReviewSha256);
    expect(JSON.stringify({ migration: oldContext.migrationSha256, context: oldContext.contextSha256, media: bankAsset.mediaSha256, placement: row })).toBe(sameContextBinding);
    oldContext.assessments[currentRecord.scope.id] = currentRecord;
    saved.draft.generatedDraft.currentIdentityApprovalSha256 = currentIdentityReviewSha256(oldContext);
    const stale = await post(form()); expect(stale.status).toBe(409); expect(dispatches).toHaveLength(0);
    const assets = withCurrentReferenceIdentity(saved.draft.generatedAssets!, oldContext), base = buildEditPlanPreviewSegments({ project, videoSources: [] });
    const review = captureGeneratedDraftReview(base, assets, saved.draft.generatedDraft);
    expect(Boolean(review)).toBe(true);
    const accepted = approveGeneratedDraft({ draft: saved.draft.generatedDraft, assets, segments: base, review: review! });
    expect(accepted.error).toBe(null); saved.draft.generatedDraft = accepted.draft;
    expect(applyDraftGeneratedAssets(base, assets, accepted.draft)[0].reusedTakePlacementId).toBe(row.id);
    const fresh = form(); fresh.set("draftRevision", String(accepted.draft.revision));
    const response = await post(fresh); if (response.status !== 202) throw new Error(String((await response.json()).error));
    expect(response.status).toBe(202); expect(dispatches).toHaveLength(1);
    expect(JSON.stringify(job)).toBe(immutableJob); expect(JSON.stringify(bankAsset)).toBe(immutableAsset);
  });
  for(const failure of ["missing current record","current filter failed","stale current consent"])test(`refuses ${failure} before export dispatch`,async()=>{
    currentReferenceSetup();if(failure==="missing current record")currentRecordMissing=true;
    if(failure==="stale current consent")saved.draft.generatedDraft!.currentIdentityApprovalSha256=hash("0");
    if(failure==="current filter failed"&&currentRecord!.status==="ready"){
      currentRecord!.proof.draftSimilarityFilter!.status="ineligible";currentRecord!.proofSha256=identityPolicySha256(currentRecord!.proof);
      saved.draft.generatedDraft!.currentIdentityApprovalSha256=currentIdentityReviewSha256(saved.draft.musicVideoProject!.currentIdentity!);
      saved.draft.generatedAssets![0].approvedCurrentReferenceEvidenceSha256=currentReferenceIdentityApprovalSha256(withCurrentReferenceIdentity([saved.draft.generatedAssets![0]],saved.draft.musicVideoProject!.currentIdentity)[0]);
    }
    expect((await post(form())).status).toBe(409);expect(dispatches).toHaveLength(0);
  });
  test("superseded approved history stays intact without blocking the actual migrated cut",async()=>{
    currentReferenceSetup();const winner=saved.draft.generatedAssets![0];winner.approvedAt="2026-11-07T00:00:00Z";
    const old=structuredClone(winner);old.id=old.jobId=`h3-${"9".repeat(64)}`;old.approvedAt="2026-11-06T00:00:00Z";
    old.identityVerification!.assetId=old.id;old.identityVerification!.jobId=old.jobId;
    old.fullStorage={...old.fullStorage!,objectKey:`media-uploads/projects/github-test/generated/${projectId}/${old.id}/shot.mp4`};
    old.approvedIdentityEvidenceSha256=currentIdentityEvidenceSha256(old);delete old.approvedCurrentReferenceEvidenceSha256;
    saved.draft.generatedAssets!.unshift(old);const before=JSON.stringify(old);
    const response=await post(form());if(response.status!==202)throw new Error(String((await response.json()).error));expect(response.status).toBe(202);expect(dispatches).toHaveLength(1);expect(JSON.stringify(old)).toBe(before);
  });
  function firstFrameSetup(){
    issuedSetup(2);const artifact=firstFrameArtifactFixture(job);job.firstFrame=artifact;job.profile=H3_FIRST_FRAME_PROFILE;job.conditioningPreparationVersion=H3_FIRST_FRAME_PREPARATION;
    job.conditioningReferenceHashes=[artifact.body.pngSha256];
    job.request.conditioning={kind:"first-frame",artifactId:artifact.id,expectedSha256:artifact.body.pngSha256};
    issuedPolicy!.body.generationModel=job.profile;issuedPolicy!.body.firstFrame=h3FirstFrameBinding(artifact);issuedPolicy!.sha256=identityPolicySha256(issuedPolicy!.body);issuedPolicy!.id=`h3-policy-${issuedPolicy!.sha256}`;
    job.identityPolicy={version:1,id:issuedPolicy!.id,sha256:issuedPolicy!.sha256,familyId:issuedPolicy!.familyId,familySha256:issuedPolicy!.familySha256};
    const asset=job.result!.asset;asset.model=job.profile;asset.identityVerification=issuedProofFixture(job,asset,issuedPolicy!);
    job.firstFrameAssessment=firstFrameAssessmentFixture(artifact,issuedPolicy!);asset.firstFrame={artifact,assessment:job.firstFrameAssessment};
    saved.draft.generatedAssets![0]={...structuredClone(asset),reviewStatus:"approved",approvedIdentityEvidenceSha256:currentIdentityEvidenceSha256(asset)};
  }
  test("first-frame export requires both canonical still evidence and every intended video frame",async()=>{
    firstFrameSetup();expect((await post(form())).status).toBe(202);expect(firstFrameReads).toBe(1);expect(dispatches).toHaveLength(1);
    firstFrameSetup();job.result!.asset.identityVerification!.draftSimilarityFilter!.status="ineligible";expect((await post(form())).status).toBe(409);expect(dispatches).toHaveLength(0);
  });
  for(const failure of ["changed PNG bytes","missing artifact","missing still screen","changed browser receipt"]){
    test(`first-frame canonical export rejects ${failure}`,async()=>{firstFrameSetup();if(failure==="changed PNG bytes")firstFrameBytesIntact=false;else if(failure==="missing artifact")firstFrameAvailable=false;else if(failure==="missing still screen")firstFrameScreenAvailable=false;
      else{saved.draft.generatedAssets![0].firstFrame!.assessment.decodedPixelSha256="f".repeat(64);saved.draft.generatedAssets![0].approvedIdentityEvidenceSha256=currentIdentityEvidenceSha256(saved.draft.generatedAssets![0]);}
      expect((await post(form())).status).toBe(409);expect(dispatches).toHaveLength(0);});
  }
  function rangeSetup() {
    issuedSetup(2);const original=job.result!.asset;
    original.identityVerification!.draftSimilarityFilter!.status="ineligible";
    original.identityVerification!.draftSimilarityFilter!.eligibleFrameCount=0;
    original.identityVerification!.draftSimilarityFilter!.outOfScopeFrameCount=72;
    const scope=buildH3IdentityAssessmentScope(job,.5,"00000000-0000-4000-8000-000000000001");
    const proof=issuedProofFixture(job,{...original,trimStart:.5},issuedPolicy!);
    rangeRecord={version:1,status:"ready",scope,proof,proofSha256:identityPolicySha256(proof),assessedAt:"2026-11-06T03:00:00Z"};
    const asset=identityAssessmentAsset(rangeRecord,job);
    saved.draft.generatedAssets![0]={...asset,reviewStatus:"approved",approvedIdentityEvidenceSha256:currentIdentityEvidenceSha256(asset)};
    const data=form();data.set("segments",JSON.stringify([{sourceIndex:0,startTime:.5,endTime:3.5,musicStart:0,musicEnd:3}]));return data;
  }
  test("exports only the canonical approved range assessment while preserving the original failed proof",async()=>{
    const data=rangeSetup(),before=JSON.stringify(job.result!.asset.identityVerification);
    const response=await post(data);expect(response.status).toBe(202);expect(dispatches).toHaveLength(1);
    expect((dispatches[0].projectSnapshot as {h3:Array<{identityAssessmentId:string}>}).h3[0].identityAssessmentId).toBe(rangeRecord!.scope.id);
    expect(JSON.stringify(job.result!.asset.identityVerification)).toBe(before);
  });
  for(const failure of ["missing record","foreign owner","changed media","changed policy","forged browser proof","changed trim","missing consent","missing used frame"]) {
    test(`range export rejects ${failure}`,async()=>{
      const data=rangeSetup(),asset=saved.draft.generatedAssets![0];
      if(failure==="missing record")rangeRecord=undefined;
      else if(failure==="foreign owner")rangeRecord!.scope.ownerId="foreign";
      else if(failure==="changed media")rangeRecord!.scope.mediaSha256=hash("e");
      else if(failure==="changed policy")rangeRecord!.scope.policySha256=hash("e");
      else if(failure==="changed trim")asset.trimStart=.75;
      else if(failure==="missing consent")delete asset.approvedIdentityEvidenceSha256;
      else if(failure==="forged browser proof"){
        asset.identityVerification!.draftSimilarityFilter!.samples[0].scores[0].score=.99;
        asset.approvedIdentityEvidenceSha256=currentIdentityEvidenceSha256(asset);
      }else if(rangeRecord!.status==="ready"){
        rangeRecord!.proof.draftSimilarityFilter!.samples.pop();rangeRecord!.proofSha256=identityPolicySha256(rangeRecord!.proof);
      }
      expect((await post(data)).status).toBe(409);expect(dispatches).toHaveLength(0);
    });
  }
  test("exports a new project's server-issued numerical screen only after exact owner consent", async () => {
    issuedSetup();
    const response = await post(form());
    expect(response.status).toBe(202); expect(dispatches).toHaveLength(1);
    expect(job.result!.asset.identityVerification!.status).toBe("unverifiable");
  });
  test("exports canonical v2 .934 detection evidence only with exact consent, keeping v1 blocked", async () => {
    for (const version of [1, 2] as const) {
      issuedSetup(version);
      const asset = job.result!.asset;
      for (const sample of asset.identityVerification!.draftSimilarityFilter!.samples) sample.foreground!.detections[0].quality.detectionScore = .934;
      saved.draft.generatedAssets![0] = { ...structuredClone(asset), reviewStatus: "approved", approvedIdentityEvidenceSha256: currentIdentityEvidenceSha256(asset) };
      const response = await post(form());
      expect(response.status).toBe(version === 2 ? 202 : 409);
      expect(dispatches).toHaveLength(version === 2 ? 1 : 0);
      expect(asset.identityVerification!.status).toBe("unverifiable");
    }
  });
  for (const failure of ["missing receipt", "changed canonical evidence", "changed approval trim", "missing consent", "foreign policy", "changed gallery"]) {
    test(`issued export refuses ${failure}`, async () => {
      issuedSetup();
      if (failure === "missing receipt") issuedPolicy = undefined;
      if (failure === "changed canonical evidence") job.result!.asset.identityVerification!.draftSimilarityFilter!.warnings.push("CPU reassessment changed evidence");
      if (failure === "changed approval trim") saved.draft.generatedAssets![0].trimStart = .1;
      if (failure === "missing consent") delete saved.draft.generatedAssets![0].approvedIdentityEvidenceSha256;
      if (failure === "foreign policy") issuedPolicy!.body.ownerId = "other-owner";
      if (failure === "changed gallery") issuedPolicy!.body.galleries[0].faceRegions[0].rect[0] = .2;
      const response = await post(form());
      expect(response.status).toBeGreaterThanOrEqual(400); expect(dispatches).toHaveLength(0);
    });
  }
  test("uses canonical server evidence/media rather than client proof or hash claims", async () => {
    reset();
    saved.draft.generatedAssets![0].identityVerification!.samples[0].scores[0].score = 1;
    saved.draft.generatedAssets![0].mediaSha256 = hash("f");
    const response = await post(form());
    expect(response.status).toBe(202); expect(dispatches).toHaveLength(1); expect(reads).toBe(1);
    const result = dispatches[0] as { videos: Array<{ expectedSha256: string }>; projectSnapshot: { ownerId: string; h3: unknown[] } };
    expect(result.videos[0].expectedSha256).toBe(mediaHash);
    expect(result.projectSnapshot.ownerId).toBe("github-test"); expect(result.projectSnapshot.h3).toHaveLength(1);
  });
  test("reconstructs decoded H3 frame bounds on the server and ignores forged browser frame context", async () => {
    reset(); const data = form();
    data.set("segments", JSON.stringify([{ sourceIndex: 0, startTime: 0, endTime: 3, musicStart: 0, musicEnd: 3,
      sourceFrameWindow: { startFrame: 99, endFrameExclusive: 100, frameRate: 60, totalFrames: 999 } }]));
    expect((await post(data)).status).toBe(202);
    expect((dispatches[0] as { segments: Array<{ sourceFrameWindow: unknown }> }).segments[0].sourceFrameWindow)
      .toEqual({ startFrame: 0, endFrameExclusive: 72, frameRate: 24, totalFrames: 124 });
  });
  test("a rounded frame-step trim binds the actual exported interval inside canonical proof", async () => {
    reset(); saved.draft.generatedAssets![0].trimStart = .042;
    const proof = job.result!.asset.identityVerification!;
    proof.verifiedStartFrame = 1; proof.verifiedEndFrameExclusive = 74; proof.examinedFrameCount = 73;
    proof.samples.forEach((sample, index) => { sample.timeSeconds = (1 + index * 24) / 24; });
    const data = form(); data.set("segments", JSON.stringify([{ sourceIndex: 0, startTime: .042, endTime: 3.042, musicStart: 0, musicEnd: 3 }]));
    expect((await post(data)).status).toBe(202);
    expect((dispatches[0] as { segments: Array<{ sourceFrameWindow: unknown }> }).segments[0].sourceFrameWindow)
      .toEqual({ startFrame: 1, endFrameExclusive: 74, frameRate: 24, totalFrames: 124 });
  });
  for (const failure of ["unverifiable", "missing proof", "canonical rejection", "changed media ref", "changed trim", "changed selected trim", "changed reference hash", "stale revision", "pending selection", "false exemption"]) {
    test(`refuses ${failure} before Trigger dispatch`, async () => {
      reset(); const data = form();
      if (failure === "unverifiable") job.result!.asset.identityVerification!.status = "unverifiable";
      if (failure === "missing proof") delete job.result!.asset.identityVerification;
      if (failure === "canonical rejection") job.result!.asset.reviewStatus = "rejected";
      if (failure === "changed media ref") data.set("videoRefs", JSON.stringify([{ bucket: "studio", objectKey: "media-uploads/github-test/forged.mp4" }]));
      if (failure === "changed trim") data.set("segments", JSON.stringify([{ sourceIndex: 0, startTime: 0.1, endTime: 3.1, musicStart: 0, musicEnd: 3 }]));
      if (failure === "changed selected trim") { saved.draft.generatedAssets![0].trimStart = 0.25; data.set("segments", JSON.stringify([{ sourceIndex: 0, startTime: 0.25, endTime: 3.25, musicStart: 0, musicEnd: 3 }])); }
      if (failure === "changed reference hash") job.referenceHashes![0] = hash("e");
      if (failure === "stale revision") data.set("placementRevision", "99");
      if (failure === "pending selection") saved.draft.generatedDraft!.assetIds = [id];
      if (failure === "false exemption") { job.result!.asset.identityReferenceHashes = []; job.result!.asset.identityVerification!.identityReferenceHashes = []; job.result!.asset.identityVerification!.status = "not_required"; }
      expect((await post(data)).status).toBe(409); expect(dispatches).toHaveLength(0);
    });
  }
  test("a fabricated saved positive cannot replace a canonical unverifiable report", async () => {
    reset(); job.result!.asset.identityVerification!.status = "unverifiable";
    expect(saved.draft.generatedAssets![0].identityVerification!.status).toBe("passed");
    const response = await post(form());
    expect(response.status).toBe(409); expect(dispatches).toHaveLength(0);
    expect((await response.json()).error).toContain("could not be verified");
  });
  test("owner-approved canonical provisional eligibility exports without certifying identity", async () => {
    reset(H3_DRAFT_SIMILARITY_PROJECT_ID);
    const proof = provisionalProof(); const canonical = job.result!.asset;
    canonical.identityVerification = proof; canonical.generationReferenceHashes = [...proof.referenceHashes]; canonical.identityReferenceHashes = [...proof.identityReferenceHashes];
    job.referenceHashes = [...proof.referenceHashes];
    expect((await post(form())).status).toBe(202);
    expect(canonical.identityVerification.status).toBe("unverifiable"); expect(dispatches).toHaveLength(1);
  });
  test("approved history from an old plan cannot block or overlay the current accepted cut", async () => {
    reset(); saved.draft.generatedAssets!.push({ ...structuredClone(saved.draft.generatedAssets![0]), id: "historical-take",
      target: { ...saved.draft.generatedAssets![0].target!, planSignature: "old-plan" }, identityVerification: undefined });
    expect((await post(form())).status).toBe(202); expect(dispatches).toHaveLength(1);
  });
  test("a saved eligible provisional filter cannot substitute for missing canonical filter evidence", async () => {
    reset(H3_DRAFT_SIMILARITY_PROJECT_ID);
    const proof = provisionalProof(); saved.draft.generatedAssets![0].identityVerification = proof;
    job.result!.asset.identityVerification!.status = "unverifiable";
    expect((await post(form())).status).toBe(409); expect(dispatches).toHaveLength(0);
  });
  test("recognizes the generated namespace when browser tags are stripped or relabeled", async () => {
    reset();
    expect((await post(form(false))).status).toBe(409);
    saved.draft.generatedAssets = [];
    expect((await post(form())).status).toBe(409); expect(dispatches).toHaveLength(0);
  });
  test("cannot hide a canonical H3 output inside an ordinary source chunk manifest", async () => {
    reset(); const data = form();
    data.set("videoRefs", JSON.stringify([{ bucket: "studio", objectKey: "media-uploads/github-test/manual.mp4", chunks: [{ bucket: "studio", objectKey: key }] }]));
    const response = await post(data);
    expect(response.status).toBe(409); expect((await response.json()).error).toContain("ordinary source chunk"); expect(dispatches).toHaveLength(0);
  });
  for (const foreign of ["audio", "video", "chunk"]) test(`rejects foreign ${foreign} keys even inside the configured bucket`, async () => {
    reset(); const data = form(false);
    if (foreign === "audio") data.set("audioRef", JSON.stringify({ bucket: "studio", objectKey: "media-uploads/github-other/audio.wav" }));
    else data.set("videoRefs", JSON.stringify([{ bucket: "studio", objectKey: foreign === "video" ? "media-uploads/projects/github-other/generated/clip.mp4" : "media-uploads/github-test/chunked.mp4",
      ...(foreign === "chunk" ? { chunks: [{ bucket: "studio", objectKey: "media-uploads/source-audio/chunks/github-other/part0" }] } : {}) }]));
    expect((await post(data)).status).toBe(403); expect(dispatches).toHaveLength(0); expect(reads).toBe(0);
  });
  test("preserves legitimate owner-key layouts for ordinary manual exports", async () => {
    reset(); const data = form(false);
    data.set("audioRef", JSON.stringify({ bucket: "studio", objectKey: "media-uploads/source-audio/chunks/github-test/master.wav" }));
    data.set("videoRefs", JSON.stringify([{ bucket: "studio", objectKey: "media-uploads/projects/github-test/source/clip.mp4" }]));
    expect((await post(data)).status).toBe(202); expect(reads).toBe(0);
  });
  test("anonymous requests never read projects, jobs or request bodies", async () => {
    reset(); signedIn = false;
    const request = new Request("http://app.test/api/export/final", { method: "POST" });
    Object.defineProperty(request, "formData", { value: async () => { throw new Error("Anonymous body read"); } });
    expect((await POST(request)).status).toBe(401); expect(reads).toBe(0); expect(dispatches).toHaveLength(0);
  });
  test("shader capture rejects foreign clip-audio references without claiming pixel attestation", async () => {
    reset(); const data = new FormData(); data.set("requestKey", "final-export-webgpu-owned-v1-canonical-validation"); data.set("audio", new File(["audio"], "master.wav")); data.set("shaderCapture", new File(["video"], "capture.webm"));
    data.set("segments", JSON.stringify([{ startTime: 0, endTime: 1 }]));
    data.set("videoRefs", JSON.stringify([{ bucket: "studio", objectKey: "media-uploads/github-other/clip.mp4" }]));
    expect((await capture(new Request("http://app.test/api/export/shader-capture", { method: "POST", body: data }))).status).toBe(403);
    expect(dispatches).toHaveLength(0);
  });
});
