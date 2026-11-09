import { sourceReferenceManifest } from "./generationScope";
import { identityPolicySha256 } from "./issuedIdentityPolicy";
import type { ReferenceAsset } from "./referenceAssets";
import type { StoryBibleBinding } from "./storyBible";
import { storyBibleTreatmentSignature, type StoryTreatment } from "./storyTreatments";

/** Binds saved metadata, not observed pixels or a visual approval. Never rebind imports implicitly. */
export function buildStoryBibleBinding(input: { projectId: string; treatment: StoryTreatment; referenceAssets: ReferenceAsset[] }): StoryBibleBinding {
  if (!/^[a-zA-Z0-9_-]{1,96}$/.test(input.projectId)) throw new Error("Invalid story bible project.");
  const refs = input.referenceAssets;
  if (refs.length > 32 || new Set(refs.map(ref => ref.id)).size !== refs.length
    || refs.some(ref => !ref.id || !ref.displayName.trim() || ref.displayName !== ref.displayName.trim()
      || !["character-1", "character-2", "environment", "custom", "crowd"].includes(ref.role)
      || !["character", "environment", "crowd", "prop", "vehicle", "wardrobe", "custom"].includes(ref.kind)
      || ref.storageStatus !== "uploaded" || !ref.storageBucket || !ref.storagePath
      || /[\\\x00-\x1f]/.test(ref.storagePath) || ref.storagePath.split("/").some(part => !part || part === "." || part === ".."))) {
    throw new Error("Story bible references must be distinct, uploaded and named.");
  }
  return { projectId: input.projectId, storySignature: storyBibleTreatmentSignature(input.treatment),
    referenceSignature: `story-bible-references-v1-${identityPolicySha256(sourceReferenceManifest(refs))}` };
}
