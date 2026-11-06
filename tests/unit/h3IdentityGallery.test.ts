import { expect, test } from "bun:test";
import { resolveH3IdentityGallery } from "@/lib/h3IdentityGallery";
import { DIEGO_CANONICAL_REFERENCE_SHA256, VALENTINA_CANONICAL_REFERENCE_SHA256 } from "@/lib/h3ReferenceConditioning";

test("only the exact raw Diego authority receives the benchmarked three-view verification gallery", () => {
  const reference = { rawSha256: DIEGO_CANONICAL_REFERENCE_SHA256, canonicalName: "Diego", role: "identity" as const };
  const gallery = resolveH3IdentityGallery(reference)!;
  expect(gallery).toEqual({ version: "diego-canonical-three-view-v1", faceRegions: [
    { name: "front", rect: [0, 0, .285, .55] },
    { name: "three-quarter", rect: [.285, 0, .25, .55] },
    { name: "upper-body", rect: [0, .55, .5, .365] },
  ] });
  gallery.faceRegions[0].rect[0] = .1;
  expect(resolveH3IdentityGallery(reference)!.faceRegions[0].rect[0]).toBe(0);
  for (const changed of [{ rawSha256: "a".repeat(64) }, { canonicalName: "DIEGO" }, { role: "environment" as const }]) {
    expect(resolveH3IdentityGallery({ ...reference, ...changed })).toBe(undefined);
  }
});

test("only exact raw Valentina authority receives its independently pinned frontal gallery", () => {
  const reference = { rawSha256: VALENTINA_CANONICAL_REFERENCE_SHA256, canonicalName: "Valentina", role: "identity" as const };
  const gallery = resolveH3IdentityGallery(reference)!;
  expect(gallery).toEqual({ version: "valentina-canonical-three-view-v1", faceRegions: [
    { name: "front", rect: [.267, 0, .241, .508] },
    { name: "three-quarter", rect: [.509, 0, .24, .508] },
    { name: "full-body", rect: [0, 0, .266, .938] },
  ] });
  gallery.faceRegions[0].rect[0] = .1;
  expect(resolveH3IdentityGallery(reference)!.faceRegions[0].rect[0]).toBe(.267);
  for (const changed of [{ rawSha256: DIEGO_CANONICAL_REFERENCE_SHA256 }, { canonicalName: "VALENTINA" }, { canonicalName: "Diego" }, { role: "environment" as const }]) {
    expect(resolveH3IdentityGallery({ ...reference, ...changed })).toBe(undefined);
  }
});
