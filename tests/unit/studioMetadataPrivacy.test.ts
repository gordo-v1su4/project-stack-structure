import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import contract from "../../config/studio-metadata-privacy.json";
import { isCanonicalStudioMetadata, isSafeStudioObjectKey } from "@/lib/studioMetadataPrivacy";

describe("canonical studio metadata contract (V1S-450)", () => {
  test("matches the pinned Media API contract and all metadata/public vectors", () => {
    expect(createHash("sha256").update(readFileSync(new URL("../../config/studio-metadata-privacy.json", import.meta.url))).digest("hex"))
      .toBe("0e4a2240717d48448f1a45589cec20c0f4158f2993c60580bb56c923d5950b86");
    for (const key of contract.protectedExamples) {
      expect(isCanonicalStudioMetadata("stack-structure", key)).toBe(true);
      expect(isCanonicalStudioMetadata("pindeck", key)).toBe(false);
    }
    for (const key of contract.publicExamples) expect(isCanonicalStudioMetadata("stack-structure", key)).toBe(false);
    expect(isCanonicalStudioMetadata("stack-structure-other", contract.protectedExamples[0])).toBe(false);
    // A dot in the pattern is literal; S3 glob * spans nested paths.
    expect(isCanonicalStudioMetadata("stack-structure", "media-uploads/projects/u/id/projectXjson")).toBe(false);
    expect(isCanonicalStudioMetadata("stack-structure", "media-uploads/projects/u/generation-scopes/a/b.json.enrollment")).toBe(true);
  });

  test("rejects URL path-normalization escape attempts", () => {
    for (const key of ["media-uploads/u/../projects/other/id/project.json", "media-uploads/u/./ref.png",
      "media-uploads/u/..\\projects/other/id/project.json", "media-uploads/u/ref\u0000.json"]) {
      expect(isSafeStudioObjectKey(key)).toBe(false);
    }
    expect(isSafeStudioObjectKey("media-uploads/u/reference.png")).toBe(true);
  });
});
