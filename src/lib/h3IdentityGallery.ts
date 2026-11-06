import type { H3ReferenceSnapshot } from "@/components/studio/h3Generation";
import { DIEGO_CANONICAL_REFERENCE_SHA256, VALENTINA_CANONICAL_REFERENCE_SHA256 } from "./h3ReferenceConditioning";

export type H3IdentityFaceRegion = { name: string; rect: [number, number, number, number] };
export type H3IdentityGallery = { version: "diego-canonical-three-view-v1" | "valentina-canonical-three-view-v1"; faceRegions: H3IdentityFaceRegion[] };

/** Gallery is always cut from the raw authority, independently of H3 conditioning preparation. */
export function resolveH3IdentityGallery(reference: {
  rawSha256: string; canonicalName: string; role: H3ReferenceSnapshot["role"];
}): H3IdentityGallery | undefined {
  if (reference.role !== "identity") return undefined;
  if (reference.rawSha256 === VALENTINA_CANONICAL_REFERENCE_SHA256 && reference.canonicalName === "Valentina") {
    return { version: "valentina-canonical-three-view-v1", faceRegions: [
      { name: "front", rect: [0.267, 0, 0.241, 0.508] },
      { name: "three-quarter", rect: [0.509, 0, 0.24, 0.508] },
      { name: "full-body", rect: [0, 0, 0.266, 0.938] },
    ] };
  }
  if (reference.rawSha256 !== DIEGO_CANONICAL_REFERENCE_SHA256 || reference.canonicalName !== "Diego") return undefined;
  return { version: "diego-canonical-three-view-v1", faceRegions: [
    { name: "front", rect: [0, 0, 0.285, 0.55] },
    { name: "three-quarter", rect: [0.285, 0, 0.25, 0.55] },
    { name: "upper-body", rect: [0, 0.55, 0.5, 0.365] },
  ] };
}
