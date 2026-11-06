/** Immutable project-local provisional filter; never a likeness certification. */
export const H3_DRAFT_SIMILARITY_POLICY_ID = "love-me-tonight-diego-frontal-draft-v1";
export const H3_DRAFT_SIMILARITY_POLICY_SHA256 = "f23f8186a59c3c893c043b0bba19a335d874dec9d140de54cfd98f6c824fe7d7";
export const H3_DRAFT_SIMILARITY_PROJECT_ID = "75101b25-fea6-42b1-b2c6-85a9d1deb8eb";
export const H3_DRAFT_SIMILARITY_RAW_IDENTITY_SHA256 = "47d772694e0c14397707f31b7802fe91d434da1e4b54be7bac3eb00037364381";

const policy = Object.freeze({
  id: H3_DRAFT_SIMILARITY_POLICY_ID,
  sha256: H3_DRAFT_SIMILARITY_POLICY_SHA256,
  projectId: H3_DRAFT_SIMILARITY_PROJECT_ID,
  identityReferenceSha256: H3_DRAFT_SIMILARITY_RAW_IDENTITY_SHA256,
  threshold: 0.8,
  minimumFrameCount: 3,
  generationModel: "h3-ref2va-int8-v2",
  verifierModel: "opencv-sface-2021dec-yunet-2023mar",
  modelSha256: "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
  verifierVersion: "sface-yunet-cpu-v1",
  preprocessVersion: "opencv412-aligncrop112-rgb-f32-nchw-unit-centroid-v1-gallery-v2-6e3acaeea694c1a1d1df4fbd8f2a5365aa801cca8fd2a07faf8f6634af4dd9e7",
});

export function resolveH3DraftSimilarityPolicy(id: string, sha256: string) {
  return id === policy.id && sha256 === policy.sha256 ? policy : undefined;
}
