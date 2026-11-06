import { afterEach, describe, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { materializeH3Job } from "@/lib/h3GenerationServer";
import { h3ProjectFixture } from "../helpers/h3Project";
import { issuedPolicyFixture } from "../helpers/issuedIdentityPolicy";

const objects = new Map<string, string>();
let puts = 0;
class GetObjectCommand { constructor(public input: Record<string, unknown>) {} }
class PutObjectCommand { constructor(public input: Record<string, unknown>) {} }
const failure = (code: number) => Object.assign(new Error("S3 test failure"), { $metadata: { httpStatusCode: code } });
class S3Client {
  destroy() {}
  async send(command: GetObjectCommand | PutObjectCommand) {
    const key = String(command.input.Key);
    if (command instanceof GetObjectCommand) {
      const body = objects.get(key); if (body === undefined) throw failure(404);
      return { Body: { transformToString: async () => body }, ContentLength: Buffer.byteLength(body) };
    }
    expect(command.input.IfNoneMatch).toBe("*"); puts++;
    if (objects.has(key)) throw failure(412);
    objects.set(key, String(command.input.Body)); return {};
  }
}
mock.module("@aws-sdk/client-s3", () => ({ S3Client, GetObjectCommand, PutObjectCommand }));
mock.module("@/lib/mediaGateway", () => ({ getMediaGatewayConfig: () => ({ bucket: "studio" }) }));
const smallPng = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/h1sAAAAASUVORK5CYII=", "base64"));
let rawBytes = smallPng;
mock.module("@/lib/h3JobStore", () => ({ downloadH3ReferenceImage: async () => ({ bytes: rawBytes.buffer, mime: "image/png" }) }));
const { issueH3DraftPolicy, readIssuedH3DraftPolicy, assertIssuedH3DraftPolicyMatchesJob } = await import("@/lib/h3DraftPolicyStore");
const { prepareH3IdentityPolicy } = await import("@/lib/h3DraftPolicyPreparation");
const names = ["RUSTFS_S3_ENDPOINT", "RUSTFS_ACCESS_KEY", "RUSTFS_SECRET_KEY"] as const;
const previous = names.map(name => process.env[name]);
const folders: string[] = [];
afterEach(async () => {
  names.forEach((name, index) => { if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index]; });
  await Promise.all(folders.splice(0).map(folder => rm(folder, { recursive: true, force: true })));
});
function setup() {
  objects.clear(); puts = 0; rawBytes = smallPng;
  process.env.RUSTFS_S3_ENDPOINT = "https://storage.test";
  process.env.RUSTFS_ACCESS_KEY = "test-only"; process.env.RUSTFS_SECRET_KEY = "test-only";
  const { saved, request } = h3ProjectFixture();
  const job = materializeH3Job("github-test", saved, { ...request, identityPolicyFamily: "sface-yunet-foreground-frontal-v1" }, "studio");
  job.references.forEach((ref, index) => { ref.etag = `etag-${index}`; });
  return job;
}
describe("server-issued fixed-family reference policy", () => {
  test("rejects real compressed oversized images from their headers before the Python decoder or policy issuance", async () => {
    const job = setup(); job.references = job.references.slice(0, 1);
    const folder = await mkdtemp(path.join(tmpdir(), "h3-policy-header-test-")); folders.push(folder);
    let decoderCalls = 0;
    for (const [width, height] of [[8193, 1], [8192, 4097]]) {
      rawBytes = new Uint8Array(await sharp({ create: { width, height, channels: 3, background: "black" } }).png().toBuffer());
      // Both are genuine compressed PNGs; the pixel-bound fixture encodes >32MP
      // in well under 1MiB, so a compressed-byte limit cannot catch it.
      expect(rawBytes.byteLength).toBeLessThan(1024 * 1024);
      const header = await sharp(rawBytes, { limitInputPixels: false }).metadata();
      expect(header.width).toBe(width); expect(header.height).toBe(height);
      await expect(prepareH3IdentityPolicy(job, folder, { runPreflight: async () => { decoderCalls++; throw new Error("must not decode"); } }))
        .rejects.toThrow("Identity reference headers");
    }
    expect(decoderCalls).toBe(0); expect(puts).toBe(0);
  });
  test("stores immutable owner/project evidence and safely reuses identical issuance", async () => {
    const job = setup(), fixture = issuedPolicyFixture(job);
    const first = await issueH3DraftPolicy({ job, rawReferences: fixture.references, preflight: fixture.preflight });
    const second = await issueH3DraftPolicy({ job, rawReferences: fixture.references, preflight: fixture.preflight });
    expect(first).toEqual(second); expect(puts).toBe(2); expect(objects.size).toBe(1);
    expect(await readIssuedH3DraftPolicy(job.ownerId, job.projectId, first)).toEqual(first);
    expect(await readIssuedH3DraftPolicy("other-owner", job.projectId, first)).toBeNull();
    expect(await readIssuedH3DraftPolicy(job.ownerId, "other-project", first)).toBeNull();
    expect([...objects.keys()][0]).toContain(`/github-test/identity-policies/${job.projectId}/`);
  });
  test("does not issue for mismatched CPU inputs, model pins, family, or unusable galleries", async () => {
    const job = setup(), fixture = issuedPolicyFixture(job);
    for (const change of [{ bindingSha256: "a".repeat(64) }, { status: "unverifiable" }, { version: 2 },
      { model: { ...fixture.preflight.model, recognitionSha256: "b".repeat(64) } }, { galleries: [] }]) {
      await expect(issueH3DraftPolicy({ job, rawReferences: fixture.references,
        preflight: { ...fixture.preflight, ...change } as typeof fixture.preflight })).rejects.toThrow();
    }
    expect(puts).toBe(0);
  });
  test("reference metadata, hashes, owner, model and stored unknown changes cannot inherit authority", async () => {
    const job = setup(), fixture = issuedPolicyFixture(job);
    const policy = await issueH3DraftPolicy({ job, rawReferences: fixture.references, preflight: fixture.preflight });
    for (const change of [{ ownerId: "other" }, { profile: "h3-ref2va-int8-v2" as const },
      { references: job.references.map(ref => ({ ...ref, etag: "overwritten" })) }]) {
      expect(() => assertIssuedH3DraftPolicyMatchesJob(policy, { ...job, ...change }, fixture.references.map(ref => ref.rawSha256))).toThrow();
    }
    expect(() => assertIssuedH3DraftPolicyMatchesJob(policy, job, ["a".repeat(64), "b".repeat(64)])).toThrow();
    const key = [...objects.keys()][0], corrupt = JSON.parse(objects.get(key)!); corrupt.body.clientExtra = true;
    objects.set(key, JSON.stringify(corrupt));
    await expect(readIssuedH3DraftPolicy(job.ownerId, job.projectId, policy)).rejects.toThrow("corrupt");
  });
  test("CPU preflight failure stops before issuance, and overwritten raw bytes stop before CPU", async () => {
    const job = setup(); job.references = job.references.slice(0, 1);
    const folder = await mkdtemp(path.join(tmpdir(), "h3-policy-test-")); folders.push(folder);
    let calls = 0;
    const runPreflight = async (inputPath: string, outputPath: string) => {
      calls++; const input = JSON.parse(await readFile(inputPath, "utf8"));
      expect(input.references[0].rawSha256).toBe(createHash("sha256").update(rawBytes).digest("hex"));
      await writeFile(outputPath, JSON.stringify({ status: "unverifiable", reason: "no-frontal-anchor" }));
    };
    await expect(prepareH3IdentityPolicy(job, folder, { runPreflight })).rejects.toThrow("no GPU render was submitted");
    expect(calls).toBe(1); expect(puts).toBe(0);
    job.referenceHashes = ["b".repeat(64)];
    await expect(prepareH3IdentityPolicy(job, folder, { runPreflight })).rejects.toThrow("Raw reference bytes changed");
    expect(calls).toBe(1);
  });
  test("successful preparation binds actual downloaded bytes and resumes the canonical receipt without repeating CPU", async () => {
    const job = setup(); job.references = job.references.slice(0, 1);
    const folder = await mkdtemp(path.join(tmpdir(), "h3-policy-test-")); folders.push(folder);
    const hashes = [createHash("sha256").update(rawBytes).digest("hex")], fixture = issuedPolicyFixture(job, hashes);
    let calls = 0;
    const result = await prepareH3IdentityPolicy(job, folder, { runPreflight: async (_input, output) => {
      calls++; await writeFile(output, JSON.stringify(fixture.preflight));
    } });
    job.identityPolicy = { version: 1, id: result.policy.id, sha256: result.policy.sha256, familyId: result.policy.familyId, familySha256: result.policy.familySha256 };
    const resumed = await prepareH3IdentityPolicy(job, folder, { runPreflight: async () => { throw new Error("must not rerun"); } });
    expect(calls).toBe(1); expect(resumed.policy).toEqual(result.policy); expect(resumed.references[0].bytes).toEqual(rawBytes);
  });
});
