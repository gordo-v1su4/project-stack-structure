import { afterEach, describe, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { generatedAssetIdentityBlockReason, mergeGeneratedAssetDelivery, type GeneratedStudioAsset } from "@/components/studio/generatedAssets";
import type { GeneratedAssetIdentityVerification } from "@/components/studio/generatedAssetIdentity";
import type { H3GenerationJob } from "@/components/studio/h3Generation";
import { materializeH3Job } from "@/lib/h3GenerationServer";
import { h3ProjectFixture } from "../helpers/h3Project";

const referenceBytes = new Uint8Array([1, 2, 3]);
const referenceHash = createHash("sha256").update(referenceBytes).digest("hex");
mock.module("@/lib/h3JobStore", () => ({ downloadH3ReferenceImage: async () => ({ bytes: referenceBytes.buffer, mime: "image/png" }) }));
const { assessH3Identity } = await import("@/lib/h3IdentityVerification");
const folders: string[] = [];
afterEach(async () => { for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }); });

async function setup() {
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
