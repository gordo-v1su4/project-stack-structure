import { beforeEach, afterEach, expect, mock, test } from "bun:test";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { currentReferenceIdentityFixture } from "../helpers/currentReferenceIdentity";
import { withCurrentReferenceIdentity } from "@/components/studio/currentReferenceIdentity";
import { nativeFirstFrameSelection, assertNativeFirstFrameReceipt } from "@/components/studio/nativeFirstFrame";
import { h3FirstFrameDigest } from "@/components/studio/h3FirstFrame";
const objects = new Map<string, Buffer>(); let reads = 0, writes = 0, declared: number | undefined, hideNextIndexRead = false;
let fixture = currentReferenceIdentityFixture(), corruptCanonical = false;
class GetObjectCommand { constructor(public input: Record<string, unknown>) {} }
class PutObjectCommand { constructor(public input: Record<string, unknown>) {} }
class ListObjectsV2Command { constructor(public input: Record<string, unknown>) {} }
const status = (code: number) => Object.assign(new Error("private-storage-test-error"), { $metadata: { httpStatusCode: code } });
const client = { async send(command: GetObjectCommand | PutObjectCommand) {
  const key = String(command.input.Key);
  if (command instanceof GetObjectCommand) {
    if (key.includes("/by-job/") && hideNextIndexRead) { hideNextIndexRead = false; throw status(404); }
    reads++; const bytes = objects.get(key); if (!bytes) throw status(404);
    return { ContentLength: declared ?? bytes.length, Body: { async *[Symbol.asyncIterator]() { yield bytes; }, transformToByteArray: async () => bytes, destroy() {} } };
  }
  writes++; expect(command.input.IfNoneMatch).toBe("*"); if (objects.has(key)) throw status(412);
  objects.set(key, Buffer.from(command.input.Body as string)); return {};
} };
class S3Client { destroy() {} send = client.send; }
mock.module("@aws-sdk/client-s3", () => ({ GetObjectCommand, PutObjectCommand, ListObjectsV2Command, S3Client }));
mock.module("@/lib/generationScopeStore", () => ({ sourceConfirmationStorage: () => ({ client, bucket: "studio" }) }));
mock.module("@/lib/generationScopeServer", () => ({ assertMaterializationGenerationScope: () => "plan" }));
mock.module("@/lib/mediaGateway", () => ({ getMediaGatewayConfig: () => ({ bucket: "studio" }), normalizeMediaPath: (v: string) => v }));
mock.module("@/lib/h3JobStore", () => ({ readH3Job: async (owner: string, project: string, id: string) => owner === fixture.job.ownerId && project === fixture.job.projectId && id === fixture.job.id ? fixture.job : null }));
mock.module("@/lib/h3IdentityAssessmentStore", () => ({ readH3IdentityAssessment: async () => null }));
mock.module("@/lib/currentIdentityStore", () => ({ readCurrentIdentityAssessment: async () => corruptCanonical ? { ...fixture.assessment, assessedAt: "2026-11-08T00:00:00Z" } : fixture.assessment, readCurrentIdentityPolicy: async () => fixture.currentPolicy }));
const { registerNativeFirstFrame, canonicalNativeFirstFrameSource, nativePngFrameSha256, readNativeFirstFrameReceipt, readNativeFirstFrameReceiptForJob } = await import("@/lib/nativeFirstFrameSource");
const names = ["RUSTFS_S3_ENDPOINT", "RUSTFS_ACCESS_KEY", "RUSTFS_SECRET_KEY"] as const, previous = names.map(name => process.env[name]);
beforeEach(() => { objects.clear(); reads = writes = 0; declared = undefined; hideNextIndexRead = false; corruptCanonical = false; process.env.RUSTFS_S3_ENDPOINT = "https://storage.test"; process.env.RUSTFS_ACCESS_KEY = "test-only"; process.env.RUSTFS_SECRET_KEY = "test-only"; });
afterEach(() => names.forEach((name, index) => { if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index]; }));
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function setup() {
  const bytes = await sharp({ create: { width: 1344, height: 768, channels: 3, background: { r: 11, g: 53, b: 89 } } }).png().toBuffer();
  fixture = currentReferenceIdentityFixture(await nativePngFrameSha256(bytes, hash(bytes)));
  Object.assign(fixture.asset, { width: 1344, height: 768 });
  const source = nativeFirstFrameSelection(withCurrentReferenceIdentity([fixture.asset], fixture.context)[0], 12);
  const target = { ...fixture.job, id: `h3-${"8".repeat(64)}`, request: { ...fixture.job.request, songStart: 5, songEnd: 7 }, target: { ...fixture.job.target, songStart: 5, songEnd: 7 } };
  const upload = { bucket: "studio", objectKey: `media-uploads/${fixture.job.ownerId}/h3-first-frames/native.png` }; objects.set(upload.objectKey, bytes);
  return { ownerId: fixture.job.ownerId, saved: fixture.saved, target, shot: target.request, source, upload, bytes,
    expectedSha256: hash(bytes), baselineSha256: "b".repeat(64), isCurrent: async () => true };
}
test("exact owned old/current pixels create a distinct immutable receipt without changing project, job or artifact schema", async () => {
  const input = await setup(), before = JSON.stringify(fixture);
  const first = await registerNativeFirstFrame(input), replay = await registerNativeFirstFrame(input);
  expect(first).toEqual(replay); expect(JSON.stringify(fixture)).toBe(before);
  expect(first.sourceReceipt.body.source.frameIndex).toBe(12); expect(first.sourceReceipt.body.source.current!.assessmentId).toBe(fixture.assessment.scope.id);
  expect(Object.prototype.hasOwnProperty.call(first.artifact.body, "source")).toBe(false);
  expect(first.sourceReceipt.body.requestSha256).toBe(h3FirstFrameDigest(input.shot));
  expect(await readNativeFirstFrameReceipt(input.ownerId, input.saved.project.id, first.sourceReceipt.id)).toEqual(first.sourceReceipt);
  expect(await readNativeFirstFrameReceiptForJob(input.ownerId, input.saved.project.id, first.sourceReceipt.body.targetJobId)).toEqual(first.sourceReceipt);
  expect(() => assertNativeFirstFrameReceipt(first.sourceReceipt, input.source, first.artifact, input.shot)).not.toThrow();
  expect(objects.size).toBe(5);
});

test("a fresh revision-only retry recovers the original immutable source receipt", async () => {
  const input = await setup(), first = await registerNativeFirstFrame(input), count = objects.size;
  const retry = await registerNativeFirstFrame({ ...input, saved: { ...input.saved, revision: "new-project-revision" }, baselineSha256: "c".repeat(64) });
  expect(retry).toEqual(first);
  expect(objects.size).toBe(count);
  expect(retry.sourceReceipt.body.projectRevision).toBe(input.saved.revision);
  expect(retry.sourceReceipt.body.baselineSha256).toBe(input.baselineSha256);
});

test("recovery still rejects authority drift before and after reading the existing receipt", async () => {
  const input = await setup(), first = await registerNativeFirstFrame(input), count = objects.size;
  for (const failAt of [1, 3]) {
    let checks = 0;
    await expect(registerNativeFirstFrame({ ...input, isCurrent: async () => ++checks !== failAt })).rejects.toThrow("saved project changed");
  }
  expect(objects.size).toBe(count);
  expect(await readNativeFirstFrameReceiptForJob(input.ownerId, input.saved.project.id, first.sourceReceipt.body.targetJobId)).toEqual(first.sourceReceipt);
});

test("equal pixels from another exact native frame cannot reuse the same target origin", async () => {
  const input = await setup(), first = await registerNativeFirstFrame(input), count = objects.size;
  const otherFrame = nativeFirstFrameSelection(withCurrentReferenceIdentity([fixture.asset], fixture.context)[0], 13);
  expect(otherFrame.frameSha256).toBe(input.source.frameSha256);
  await expect(registerNativeFirstFrame({ ...input, source: otherFrame })).rejects.toThrow("different native source");
  expect(objects.size).toBe(count);
  expect(await readNativeFirstFrameReceiptForJob(input.ownerId, input.saved.project.id, first.sourceReceipt.body.targetJobId)).toEqual(first.sourceReceipt);
});

test("recovery compares every origin field including range, proofs, current references and request", async () => {
  const input = await setup(), first = await registerNativeFirstFrame(input);
  const receiptKey = [...objects.keys()].find(key => key.endsWith(`/${first.sourceReceipt.id}.json`))!;
  const indexKey = [...objects.keys()].find(key => key.includes("/by-job/"))!;
  for (const alter of [
    (body: typeof first.sourceReceipt.body) => { body.source.trimStart = .25; },
    (body: typeof first.sourceReceipt.body) => { body.source.originalProofSha256 = "a".repeat(64); },
    (body: typeof first.sourceReceipt.body) => { body.source.current!.contextSha256 = "a".repeat(64); },
    (body: typeof first.sourceReceipt.body) => { body.source.current!.proofSha256 = "a".repeat(64); },
    (body: typeof first.sourceReceipt.body) => { body.requestSha256 = "a".repeat(64); },
    (body: typeof first.sourceReceipt.body) => { body.descriptorSha256 = "a".repeat(64); },
    (body: typeof first.sourceReceipt.body) => { body.pngSha256 = "a".repeat(64); },
  ]) {
    const changed = structuredClone(first.sourceReceipt); alter(changed.body);
    changed.sha256 = h3FirstFrameDigest(changed.body); changed.id = `h3-native-source-${changed.sha256}`;
    objects.set(receiptKey.replace(first.sourceReceipt.id, changed.id), Buffer.from(JSON.stringify(changed)));
    objects.set(indexKey, Buffer.from(JSON.stringify({ receiptId: changed.id })));
    await expect(registerNativeFirstFrame(input)).rejects.toThrow("different native source");
  }
});

test("a concurrent equivalent enrollment returns the immutable index winner despite another revision", async () => {
  const input = await setup(), first = await registerNativeFirstFrame(input);
  hideNextIndexRead = true; // Winner becomes visible only when the conditional index PUT loses.
  const result = await registerNativeFirstFrame({ ...input, saved: { ...input.saved, revision: "concurrent-revision" }, baselineSha256: "c".repeat(64) });
  expect(result).toEqual(first);
  expect(await readNativeFirstFrameReceiptForJob(input.ownerId, input.saved.project.id, first.sourceReceipt.body.targetJobId)).toEqual(first.sourceReceipt);
});

test("a concurrent different native-frame origin cannot replace the immutable index winner", async () => {
  const input = await setup(), first = await registerNativeFirstFrame(input);
  hideNextIndexRead = true;
  const source = nativeFirstFrameSelection(withCurrentReferenceIdentity([fixture.asset], fixture.context)[0], 13);
  await expect(registerNativeFirstFrame({ ...input, source })).rejects.toThrow("different native source");
  expect(await readNativeFirstFrameReceiptForJob(input.ownerId, input.saved.project.id, first.sourceReceipt.body.targetJobId)).toEqual(first.sourceReceipt);
});
test("one changed pixel cannot be enrolled under the claimed exact frame, even with a correct encoded upload SHA", async () => {
  const input = await setup(); const changed = await sharp({ create: { width: 1344, height: 768, channels: 3, background: { r: 12, g: 53, b: 89 } } }).png().toBuffer();
  objects.set(input.upload.objectKey, changed);
  await expect(registerNativeFirstFrame({ ...input, expectedSha256: hash(changed) })).rejects.toThrow("pixels do not exactly match"); expect(writes).toBe(0);
});
test("foreign upload paths and buckets are rejected before media reads or writes", async () => {
  const input = await setup();
  for (const upload of [{ bucket: "foreign", objectKey: input.upload.objectKey }, { bucket: "studio", objectKey: "media-uploads/other/frame.png" },
    { bucket: "studio", objectKey: `media-uploads/${input.ownerId}/../frame.png` }]) await expect(registerNativeFirstFrame({ ...input, upload })).rejects.toThrow();
  expect(reads).toBe(0); expect(writes).toBe(0);
});
test("short, overrun and oversized PNG streams never enroll artifacts or source receipts", async () => {
  const input = await setup();
  for (const length of [input.bytes.length + 1, input.bytes.length - 1, 32 * 1024 * 1024 + 1]) {
    declared = length; await expect(registerNativeFirstFrame(input)).rejects.toThrow();
  } expect(writes).toBe(0);
});
test("stale baseline before artifact registration performs no writes", async () => {
  const input = await setup(); await expect(registerNativeFirstFrame({ ...input, isCurrent: async () => false })).rejects.toThrow("saved project changed"); expect(writes).toBe(0);
});
test("late baseline drift may retain the frozen PNG but never enrolls a source receipt or dispatches", async () => {
  const input = await setup(); let checks = 0;
  await expect(registerNativeFirstFrame({ ...input, isCurrent: async () => ++checks === 1 })).rejects.toThrow("before native-source enrollment");
  expect([...objects.keys()].some(key => key.includes("native-first-frame-sources"))).toBe(false);
});
test("changed source trim, foreign job, mismatched authorities and future source targets fail closed", async () => {
  const input = await setup();
  await expect(canonicalNativeFirstFrameSource(input.ownerId, input.saved, input.target, { ...input.source, trimStart: .25 })).rejects.toThrow();
  await expect(canonicalNativeFirstFrameSource("other", input.saved, input.target, input.source)).rejects.toThrow();
  await expect(canonicalNativeFirstFrameSource(input.ownerId, input.saved, { ...input.target, references: input.target.references.filter(ref => ref.role !== "identity") }, input.source)).rejects.toThrow("same named");
  await expect(canonicalNativeFirstFrameSource(input.ownerId, input.saved, { ...input.target, target: { ...input.target.target, songStart: 0 } }, input.source)).rejects.toThrow();
  expect(writes).toBe(0);
});
test("changed current canonical record and lost active evidence cannot authorize a source", async () => {
  const input = await setup(); corruptCanonical = true;
  await expect(registerNativeFirstFrame(input)).rejects.toThrow("differs from its project binding");
  corruptCanonical = false; delete fixture.context.activeAssessments[fixture.asset.id];
  await expect(registerNativeFirstFrame(input)).rejects.toThrow(); expect(writes).toBe(0);
});
test("receipt retrieval rejects altered stored metadata and other owners", async () => {
  const input = await setup(), result = await registerNativeFirstFrame(input);
  expect(await readNativeFirstFrameReceipt("other", input.saved.project.id, result.sourceReceipt.id)).toBeNull();
  const key = [...objects.keys()].find(key => key.includes("native-first-frame-sources"))!;
  const altered = JSON.parse(objects.get(key)!.toString()); altered.body.source.frameIndex++; objects.set(key, Buffer.from(JSON.stringify(altered)));
  await expect(readNativeFirstFrameReceipt(input.ownerId, input.saved.project.id, result.sourceReceipt.id)).rejects.toThrow();
});
test("a forged job index cannot attach another receipt to an unrelated target", async () => {
  const input = await setup(), result = await registerNativeFirstFrame(input), otherJob = `h3-${"9".repeat(64)}`;
  const key = [...objects.keys()].find(key => key.includes("/by-job/"))!;
  objects.set(key.replace(result.sourceReceipt.body.targetJobId, otherJob), objects.get(key)!);
  await expect(readNativeFirstFrameReceiptForJob(input.ownerId, input.saved.project.id, otherJob)).rejects.toThrow("canonical target job");
});
