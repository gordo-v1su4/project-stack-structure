import { describe, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import { createMusicVideoProject, prepareApprovedPlacements } from "@/components/studio/musicVideoProject";
import { createPersistableStudioProjectDraft } from "@/components/studio/projectPersistence";
import { buildStudioSourceContextSignature } from "@/components/studio/studioSourceContext";
import { buildStoryContentSignature, type StoryTreatment } from "@/components/studio/storyTreatments";
import type { GeneratedAssetIdentityVerification, GeneratedStudioAsset } from "@/components/studio/generatedAssets";
import type { H3GenerationJob } from "@/components/studio/h3Generation";
import type { BeatJoinAnalysis } from "@/components/studio/types";
import type { ReferenceAsset } from "@/components/studio/referenceAssets";
import type { SavedStudioProject } from "@/lib/studioProjectStore";
import { H3_DRAFT_SIMILARITY_POLICY_ID, H3_DRAFT_SIMILARITY_POLICY_SHA256, H3_DRAFT_SIMILARITY_PROJECT_ID, resolveH3DraftSimilarityPolicy } from "@/components/studio/identityDraftPolicy";
import { currentIdentityEvidenceSha256, type H3IssuedDraftPolicy } from "@/components/studio/issuedIdentityPolicy";
import { issuedPolicyFixture, issuedProofFixture } from "../helpers/issuedIdentityPolicy";

let signedIn = true, dispatches: Array<Record<string, unknown>> = [], reads = 0;
let saved: SavedStudioProject, job: H3GenerationJob, projectId = "project-1";
let issuedPolicy: H3IssuedDraftPolicy | undefined;
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
  signedIn = true; dispatches = []; reads = 0; issuedPolicy = undefined;
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
  data.set("audioRef", JSON.stringify({ bucket: "studio", objectKey: saved.draft.analysis!.storagePath }));
  data.set("videoRefs", JSON.stringify([{ bucket: "studio", objectKey: key, expectedSha256: hash("f") }]));
  const duration = saved.draft.musicVideoProject!.duration;
  data.set("segments", JSON.stringify([{ sourceIndex: 0, startTime: 0, endTime: duration, musicStart: 0, musicEnd: duration }]));
  if (projectContext) for (const [name, value] of Object.entries({ projectId, planSignature: saved.draft.musicVideoProject!.placementPlan!.inputSignature,
    placementRevision: saved.draft.musicVideoProject!.placementPlan!.revision, draftRevision: 2 })) data.set(name, String(value));
  return data;
}
function post(data: FormData) { return POST(new Request("http://app.test/api/export/final", { method: "POST", body: data })); }

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
    reset(); const data = new FormData(); data.set("audio", new File(["audio"], "master.wav")); data.set("shaderCapture", new File(["video"], "capture.webm"));
    data.set("segments", JSON.stringify([{ startTime: 0, endTime: 1 }]));
    data.set("videoRefs", JSON.stringify([{ bucket: "studio", objectKey: "media-uploads/github-other/clip.mp4" }]));
    expect((await capture(new Request("http://app.test/api/export/shader-capture", { method: "POST", body: data }))).status).toBe(403);
    expect(dispatches).toHaveLength(0);
  });
});
