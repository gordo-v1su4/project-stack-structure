import { describe, expect, mock, test } from "bun:test";
import { generationScopeSha256, type GenerationScopeReceipt } from "@/components/studio/generationScope";
const objects = new Map<string, string>();
let puts = 0;
class GetObjectCommand { constructor(public input: Record<string, unknown>) {} }
class PutObjectCommand { constructor(public input: Record<string, unknown>) {} }
const failure = (code: number) => Object.assign(new Error("synthetic storage failure"), { $metadata: { httpStatusCode: code } });
class S3Client {
  destroy() {}
  async send(command: GetObjectCommand | PutObjectCommand) {
    const key = String(command.input.Key);
    if (command instanceof GetObjectCommand) {
      const value = objects.get(key); if (value === undefined) throw failure(404);
      return { Body: { transformToByteArray: async () => new TextEncoder().encode(value) }, ContentLength: Buffer.byteLength(value) };
    }
    expect(command.input.IfNoneMatch).toBe("*"); puts++;
    if (objects.has(key)) throw failure(412);
    objects.set(key, String(command.input.Body));
    return {};
  }
}
mock.module("@aws-sdk/client-s3", () => ({ S3Client, GetObjectCommand, PutObjectCommand }));
const actualMediaGateway = await import("@/lib/mediaGateway");
mock.module("@/lib/mediaGateway", () => ({ ...actualMediaGateway, getMediaGatewayConfig: () => ({ bucket: "studio" }) }));
const { readGenerationScopeReceipt, storeGenerationScopeReceipt, readGenerationScopeBaseline, storeGenerationScopeBaseline } = await import("@/lib/generationScopeStore");
process.env.RUSTFS_S3_ENDPOINT = "https://storage.test";
process.env.RUSTFS_ACCESS_KEY = "synthetic-access";
process.env.RUSTFS_SECRET_KEY = "synthetic-secret";
function fixture(kind: "baseline" | "additive-reference" = "additive-reference"): GenerationScopeReceipt {
  const body: GenerationScopeReceipt["body"] = { version: 1, kind, ownerId: "github-test", projectId: "project-1", baselineRevision: '"revision-one"',
    fromSourceContext: "old", toSourceContext: kind === "baseline" ? "old" : "new", fromInputSignature: "placements-v1-a",
    toInputSignature: kind === "baseline" ? "placements-v1-a" : "placements-v1-b", scopeSignature: "placements-v1-a", semanticSha256: "a".repeat(64),
    references: [], rawReferences: [], sourceMediaVersions: [], appendedReferenceIds: kind === "baseline" ? [] : ["new"], sourceInventorySha256: "b".repeat(64), storySha256: "c".repeat(64) };
  const sha256 = generationScopeSha256(body);
  return { version: 1, id: `generation-scope-${sha256}`, sha256, body };
}
describe("immutable strong generation scope storage", () => {
  test("conditional create, exact owner/project read and replay do not replace receipts", async () => {
    objects.clear(); puts = 0;
    const receipt = fixture();
    await storeGenerationScopeReceipt(receipt);
    await storeGenerationScopeReceipt(receipt);
    expect(puts).toBe(2);
    expect(objects.size).toBe(1);
    expect(await readGenerationScopeReceipt("github-test", "project-1", receipt.id)).toEqual(receipt);
    expect(await readGenerationScopeReceipt("another-user", "project-1", receipt.id)).toBe(null);
    expect(await readGenerationScopeReceipt("github-test", "another-project", receipt.id)).toBe(null);
    await expect(readGenerationScopeReceipt("github-test", "../escape", receipt.id)).rejects.toThrow();
  });
  test("changed or corrupt immutable bodies fail closed instead of overwriting an existing receipt", async () => {
    objects.clear();
    const receipt = fixture();
    await storeGenerationScopeReceipt(receipt);
    const key = [...objects.keys()][0];
    const corrupt = structuredClone(receipt); corrupt.body.scopeSignature = "placements-v1-forged";
    objects.set(key, JSON.stringify(corrupt));
    await expect(readGenerationScopeReceipt("github-test", "project-1", receipt.id)).rejects.toThrow("invalid");
    await expect(storeGenerationScopeReceipt(receipt)).rejects.toThrow();
    expect(objects.get(key)).toBe(JSON.stringify(corrupt));
  });
  test("baseline identity is stable over project save revisions but cannot accept changed source or story bindings", async () => {
    objects.clear();
    const receipt = fixture("baseline");
    await storeGenerationScopeBaseline(receipt);
    const later = structuredClone(receipt); later.body.baselineRevision = '"later-save"';
    later.sha256 = generationScopeSha256(later.body); later.id = `generation-scope-${later.sha256}`;
    await storeGenerationScopeBaseline(later);
    expect(await readGenerationScopeBaseline("github-test", "project-1", receipt.body.scopeSignature, receipt.body.semanticSha256)).toEqual(receipt);
    const changed = structuredClone(later); changed.body.storySha256 = "d".repeat(64);
    changed.sha256 = generationScopeSha256(changed.body); changed.id = `generation-scope-${changed.sha256}`;
    await expect(storeGenerationScopeBaseline(changed)).rejects.toThrow("re-enrolled");
  });
  test("bounded storage reads reject expanded receipts", async () => {
    objects.clear();
    const receipt = fixture();
    await storeGenerationScopeReceipt(receipt);
    objects.set([...objects.keys()][0], "x".repeat(128 * 1024 + 1));
    await expect(readGenerationScopeReceipt("github-test", "project-1", receipt.id)).rejects.toThrow("bound");
  });
  test("an issued baseline cannot be re-enrolled after its canonical record disappears", async () => {
    objects.clear(); const receipt = fixture("baseline");
    await storeGenerationScopeBaseline(receipt);
    const baseline = [...objects.keys()].find(key => !key.endsWith(".enrollment"))!;
    objects.delete(baseline);
    expect(objects.size).toBe(1);
    await expect(storeGenerationScopeBaseline(receipt)).rejects.toThrow("re-enrolled");
    expect(objects.has(baseline)).toBe(false);
  });
  test("first-enrollment races cannot accept a different source media version map", async () => {
    objects.clear(); const receipt = fixture("baseline");
    receipt.body.sourceMediaVersions = [{ id: "master", bucket: "studio", objectKey: "media-uploads/github-test/master.wav", etag: '"original"', byteLength: 10 }];
    receipt.sha256 = generationScopeSha256(receipt.body); receipt.id = `generation-scope-${receipt.sha256}`;
    await storeGenerationScopeBaseline(receipt);
    const changed = structuredClone(receipt); changed.body.sourceMediaVersions[0].etag = '"replacement"';
    changed.sha256 = generationScopeSha256(changed.body); changed.id = `generation-scope-${changed.sha256}`;
    await expect(storeGenerationScopeBaseline(changed)).rejects.toThrow();
    expect(await readGenerationScopeBaseline("github-test", "project-1", receipt.body.scopeSignature, receipt.body.semanticSha256)).toEqual(receipt);
  });
});
