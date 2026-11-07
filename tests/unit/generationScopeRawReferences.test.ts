import { afterEach, describe, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import type { H3ReferenceSnapshot } from "@/components/studio/h3Generation";
import { sourceReferenceManifest, type ScopeRawReference } from "@/components/studio/generationScope";
import type { ReferenceAsset } from "@/components/studio/referenceAssets";
let bytes = new Uint8Array([1, 2, 3]), etag = '"original"', returnedEtag = etag, mime = "image/png", reads = 0, pins = 0;
mock.module("@/lib/h3JobStore", () => ({
  pinH3ReferenceSnapshots: async (references: H3ReferenceSnapshot[]) => { pins++; return references.map(reference => ({ ...reference, etag })); },
  downloadH3ReferenceImage: async (reference: H3ReferenceSnapshot) => {
    reads++;
    if (reference.etag !== etag) throw Object.assign(new Error("Synthetic precondition failure"), { $metadata: { httpStatusCode: 412 } });
    return { bytes: bytes.buffer, mime, etag: returnedEtag };
  },
}));
const actualMediaGateway = await import("@/lib/mediaGateway");
mock.module("@/lib/mediaGateway", () => ({ ...actualMediaGateway, getMediaGatewayConfig: () => ({ bucket: "studio" }) }));
const { pinGenerationScopeRawReferences, verifyGenerationScopeRawReferences } = await import("@/lib/generationScopeRawReferences");
const references = () => sourceReferenceManifest([{ id: "lead", role: "character-1", kind: "character", displayName: "Lead", fileName: "lead.png", promptHint: "", createdAt: "fixed",
  storageBucket: "studio", storagePath: "media-uploads/github-test/references/lead.png", storageStatus: "uploaded", previewUrl: "" } as ReferenceAsset]);
const expected = (): ScopeRawReference[] => [{ assetId: "lead", bucket: "studio", objectKey: "media-uploads/github-test/references/lead.png", etag: '"original"',
  sha256: createHash("sha256").update(new Uint8Array([1, 2, 3])).digest("hex"), byteLength: 3 }];
afterEach(() => { bytes = new Uint8Array([1, 2, 3]); etag = returnedEtag = '"original"'; mime = "image/png"; reads = 0; pins = 0; });
describe("exact conditional scope raw-reference transport", () => {
  test("initial pin records actual ETag/hash/length; subsequent comparison never re-pins", async () => {
    expect(await pinGenerationScopeRawReferences("github-test", references())).toEqual(expected());
    expect(await verifyGenerationScopeRawReferences("github-test", references(), expected())).toEqual(expected());
    expect(pins).toBe(1); expect(reads).toBe(2);
  });
  test("same-path ETag412 fails without pinning or unconditional fallback", async () => {
    etag = '"replacement"';
    await expect(verifyGenerationScopeRawReferences("github-test", references(), expected())).rejects.toThrow();
    expect(reads).toBe(1); expect(pins).toBe(0);
  });
  for (const failure of ["same ETag different pixels", "different returned ETag", "wrong byte length", "wrong MIME", "foreign owner path", "wrong expected object key", "duplicate raw ID", "33 references"]) {
    test(`rejects ${failure}`, async () => {
      const manifest = references(), proof = expected();
      if (failure === "same ETag different pixels") bytes = new Uint8Array([9, 8, 7]);
      if (failure === "different returned ETag") returnedEtag = '"other"';
      if (failure === "wrong byte length") proof[0].byteLength = 4;
      if (failure === "wrong MIME") mime = "text/plain";
      if (failure === "foreign owner path") manifest[0].storagePath = "media-uploads/another-user/references/lead.png";
      if (failure === "wrong expected object key") proof[0].objectKey += ".changed";
      if (failure === "duplicate raw ID") proof.push(proof[0]);
      if (failure === "33 references") for (let index = 1; index < 33; index++) manifest.push({ ...manifest[0], id: `extra-${index}` });
      await expect(verifyGenerationScopeRawReferences("github-test", manifest, proof)).rejects.toThrow();
      expect(pins).toBe(0);
    });
  }
});
