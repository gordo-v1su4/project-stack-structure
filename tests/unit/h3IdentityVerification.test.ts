import { afterEach, describe, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { generatedAssetIdentityBlockReason, generatedAssetDraftIdentityBlockReason, mergeGeneratedAssetDelivery, type GeneratedStudioAsset } from "@/components/studio/generatedAssets";
import type { H3IssuedDraftPolicy } from "@/components/studio/issuedIdentityPolicy";
import { issuedPolicyFixture, issuedProofFixture } from "../helpers/issuedIdentityPolicy";
import type { GeneratedAssetIdentityVerification } from "@/components/studio/generatedAssetIdentity";
import type { H3GenerationJob } from "@/components/studio/h3Generation";
import { materializeH3Job } from "@/lib/h3GenerationServer";
import { h3ProjectFixture } from "../helpers/h3Project";

const referenceBytes = new Uint8Array([1, 2, 3]);
const referenceHash = createHash("sha256").update(referenceBytes).digest("hex");
mock.module("@/lib/h3JobStore", () => ({ downloadH3ReferenceImage: async () => ({ bytes: referenceBytes.buffer, mime: "image/png" }) }));
let canonicalPolicy: H3IssuedDraftPolicy | undefined;
const { assertIssuedH3DraftPolicyMatchesJob } = await import("@/lib/h3DraftPolicyStore");
mock.module("@/lib/h3DraftPolicyStore", () => ({ assertIssuedH3DraftPolicyMatchesJob,
  readIssuedH3DraftPolicy: async (owner: string, project: string, binding: { id: string }) => {
    expect(owner).toBe(canonicalPolicy?.body.ownerId ?? "github-test");
    expect(project).toBe(canonicalPolicy?.body.projectId ?? "project-1");
    return canonicalPolicy?.id === binding.id ? canonicalPolicy : null;
  } }));
const { assessH3Identity } = await import("@/lib/h3IdentityVerification");
const folders: string[] = [];
afterEach(async () => { for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }); });

async function setup() {
  canonicalPolicy = undefined;
  const fixture = h3ProjectFixture();
  const job: H3GenerationJob = materializeH3Job("github-test", fixture.saved, fixture.request, "studio");
  // One authority avoids duplicate byte hashes in this intentionally tiny fixture.
  job.references = job.references.slice(0, 1);
  job.frames = 124;
  job.referenceHashes = [referenceHash];
  job.request.songEnd = job.request.songStart + 2.5;
  const folder = await mkdtemp(path.join(tmpdir(), "h3-identity-test-"));
  folders.push(folder);
  const outputPath = path.join(folder, "shot.mp4");
  await writeFile(outputPath, new Uint8Array([4, 5, 6]));
  const asset: GeneratedStudioAsset = { id: job.id, jobId: job.id, provider: "swarmui", model: job.profile,
    prompt: "fixture", createdAt: new Date().toISOString(), status: "completed", mediaKind: "video", durationSeconds: 124 / 24,
    target: { ...job.target, songEnd: job.target.songStart + 2.5 }, trimStart: 0, reviewStatus: "pending" };
  return { job, asset, outputPath, tempFolder: folder };
}

async function report(inputPath: string, outputPath: string, mutate?: (proof: GeneratedAssetIdentityVerification) => void) {
  const input = JSON.parse(await readFile(inputPath, "utf8"));
  expect(input.verifiedStartFrame).toBe(0);
  expect(input.verifiedEndFrameExclusive).toBe(60);
  const proof: GeneratedAssetIdentityVerification = { version: 1, status: "passed", assetId: input.assetId, jobId: input.jobId,
    generationModel: input.generationModel, mediaSha256: input.mediaSha256, frameCount: input.frameCount, frameRate: input.fps, durationSeconds: input.durationSeconds,
    verifiedStartFrame: 0, verifiedEndFrameExclusive: 60, examinedFrameCount: 60, unverifiableFrameCount: 0, ambiguousFrameCount: 0,
    referenceHashes: input.generationReferenceHashes, identityReferenceHashes: input.identityReferenceHashes, assessedAt: new Date().toISOString(),
    verifier: { method: "face-embedding-cosine", model: "test-only-fixed-model", modelSha256: "a".repeat(64), version: "1",
      preprocessVersion: "fixture", calibrationId: "test-fixture-not-a-production-calibration" },
    threshold: 0.8, coverage: "complete", samples: [0, 0.5, 1].map((timeSeconds, index) => ({ timeSeconds,
      frameSha256: String(index + 1).repeat(64), scores: [{ referenceHash, trackId: "lead", score: 0.9 }] })) };
  mutate?.(proof);
  await writeFile(outputPath, JSON.stringify(proof));
}

describe("H3 deterministic identity boundary", () => {
  async function issuedSetup() {
    const input = await setup(), { job, asset } = input;
    job.profile = "h3-ref2va-int8-v3"; job.request.identityPolicyFamily = "sface-yunet-foreground-frontal-v1";
    job.references[0].etag = "pinned-etag"; job.target = asset.target!;
    asset.model = job.profile;
    const objectKey = `media-uploads/projects/${job.ownerId}/generated/${job.projectId}/${job.id}/shot.mp4`;
    asset.fullStorage = { bucket: "studio", objectKey, storagePath: objectKey, publicUrl: "https://media.test/shot.mp4", mime: "video/mp4" };
    canonicalPolicy = issuedPolicyFixture(job, job.referenceHashes).policy;
    const { body: _body, issuedAt: _issuedAt, ...binding } = canonicalPolicy; void _body; void _issuedAt;
    job.identityPolicy = binding;
    return input;
  }
  test("passes canonical issued gallery and owner context to CPU without declaring verified identity", async () => {
    const input = await issuedSetup();
    const result = await assessH3Identity({ ...input, runVerifier: async (inputPath, outputPath) => {
      const wire = JSON.parse(await readFile(inputPath, "utf8"));
      expect(wire.ownerId).toBe(input.job.ownerId); expect(wire.issuedPolicy.id).toBe(canonicalPolicy!.id);
      expect(wire.references[0].faceRegions).toEqual(canonicalPolicy!.body.galleries[0].faceRegions);
      const proof = issuedProofFixture(input.job, { ...input.asset, mediaSha256: wire.mediaSha256 }, canonicalPolicy!);
      await writeFile(outputPath, JSON.stringify(proof));
    } });
    expect(result.identityVerification?.status).toBe("unverifiable"); expect(result.reviewStatus).toBe("pending");
    expect(generatedAssetDraftIdentityBlockReason(result)).toBeNull();
  });
  test("missing canonical issuance stops CPU, and an issued report cannot claim a calibrated pass", async () => {
    const input = await issuedSetup(); let calls = 0;
    const savedPolicy = canonicalPolicy; canonicalPolicy = undefined;
    const missing = await assessH3Identity({ ...input, runVerifier: async () => { calls++; } });
    expect(calls).toBe(0); expect(missing.identityVerification).toBe(undefined);
    canonicalPolicy = savedPolicy;
    const forged = await assessH3Identity({ ...input, runVerifier: async (inputPath, outputPath) => {
      const wire = JSON.parse(await readFile(inputPath, "utf8"));
      const proof = issuedProofFixture(input.job, { ...input.asset, mediaSha256: wire.mediaSha256 }, canonicalPolicy!);
      proof.status = "passed"; await writeFile(outputPath, JSON.stringify(proof));
    } });
    expect(forged.identityVerification).toBe(undefined); expect(forged.reviewStatus).toBe("pending");
  });
  test("binds the actual media and reference bytes to the selected trim rather than unused handles", async () => {
    const input = await setup();
    const asset = await assessH3Identity({ ...input, runVerifier: report });
    expect(asset.mediaSha256).toBe(createHash("sha256").update(new Uint8Array([4, 5, 6])).digest("hex"));
    expect(generatedAssetIdentityBlockReason(asset)).toBeNull();
    expect(generatedAssetIdentityBlockReason({ ...asset, trimStart: 2 })).toBe("Identity check does not cover this trim");
  });

  test("an unavailable verifier banks a pending take without granting draft eligibility", async () => {
    const input = await setup();
    const asset = await assessH3Identity({ ...input, runVerifier: async () => { throw new Error("runtime unavailable"); } });
    expect(asset.reviewStatus).toBe("pending");
    expect(asset.identityVerification).toBe(undefined);
    expect(generatedAssetIdentityBlockReason(asset)).toBe("Needs identity check");
  });

  test("reference overwrite or a forged output binding never inherits a pass", async () => {
    const input = await setup();
    let calls = 0;
    input.job.referenceHashes = ["b".repeat(64)];
    const changed = await assessH3Identity({ ...input, runVerifier: async () => { calls++; } });
    expect(calls).toBe(0);
    expect(changed.identityVerification).toBe(undefined);
    input.job.referenceHashes = [referenceHash];
    const forged = await assessH3Identity({ ...input, runVerifier: (a, b) => report(a, b, proof => { proof.mediaSha256 = "c".repeat(64); }) });
    expect(forged.identityVerification).toBe(undefined);
    expect(generatedAssetIdentityBlockReason(forged)).toBe("Needs identity check");
  });

  test("a model rejection is retained, and a later pass cannot undo an explicit user rejection", async () => {
    const input = await setup();
    const rejected = await assessH3Identity({ ...input, runVerifier: (a, b) => report(a, b, proof => { proof.status = "rejected"; proof.reason = "Below calibrated similarity threshold"; }) });
    expect(rejected.reviewStatus).toBe("rejected");
    expect(generatedAssetIdentityBlockReason(rejected)).toBe("Rejected");
    const userRejected = await assessH3Identity({ ...input, asset: { ...input.asset, reviewStatus: "rejected" }, runVerifier: report });
    expect(userRejected.reviewStatus).toBe("rejected");
    expect(generatedAssetIdentityBlockReason(userRejected)).toBe("Rejected");
    const late = mergeGeneratedAssetDelivery(rejected, { ...input.asset, reviewStatus: "approved" });
    expect(late.reviewStatus).toBe("rejected");
    expect(late.identityVerification?.status).toBe("rejected");
  });

  test("a report for a different trim or frame rate cannot reject or accept this take", async () => {
    const input = await setup();
    for (const change of [(proof: GeneratedAssetIdentityVerification) => { proof.verifiedEndFrameExclusive = 61; },
      (proof: GeneratedAssetIdentityVerification) => { proof.frameRate = 30; }]) {
      const asset = await assessH3Identity({ ...input, runVerifier: (a, b) => report(a, b, proof => { proof.status = "rejected"; change(proof); }) });
      expect(asset.reviewStatus).toBe("pending");
      expect(asset.identityVerification).toBe(undefined);
    }
  });
});
