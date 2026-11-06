/** Immutable project-local provisional filter; never a likeness certification. */
export const H3_DRAFT_SIMILARITY_POLICY_ID = "love-me-tonight-diego-frontal-draft-v1";
export const H3_DRAFT_SIMILARITY_POLICY_SHA256 = "f23f8186a59c3c893c043b0bba19a335d874dec9d140de54cfd98f6c824fe7d7";
export const H3_DRAFT_SIMILARITY_PROJECT_ID = "75101b25-fea6-42b1-b2c6-85a9d1deb8eb";
export const H3_DRAFT_SIMILARITY_RAW_IDENTITY_SHA256 = "47d772694e0c14397707f31b7802fe91d434da1e4b54be7bac3eb00037364381";
export const H3_DIEGO_V3_DRAFT_SIMILARITY_POLICY_ID = "love-me-tonight-diego-frontal-draft-v2";
export const H3_DIEGO_V3_DRAFT_SIMILARITY_POLICY_SHA256 = "f0250eadd801010db9885de4a6359c3c526fe6783e7dcd4a8128cbabbb3d9498";
export const H3_VALENTINA_V3_DRAFT_SIMILARITY_POLICY_ID = "love-me-tonight-valentina-frontal-draft-v1";
export const H3_VALENTINA_V3_DRAFT_SIMILARITY_POLICY_SHA256 = "589ee087db6829a53910659514b50bb1227c705ae6f7302fe2c977ccdb49d637";

const policy = Object.freeze({
  id: H3_DRAFT_SIMILARITY_POLICY_ID,
  sha256: H3_DRAFT_SIMILARITY_POLICY_SHA256,
  projectId: H3_DRAFT_SIMILARITY_PROJECT_ID,
  canonicalName: "Diego",
  gallerySha256: "6e3acaeea694c1a1d1df4fbd8f2a5365aa801cca8fd2a07faf8f6634af4dd9e7",
  identityReferenceSha256: H3_DRAFT_SIMILARITY_RAW_IDENTITY_SHA256,
  threshold: 0.8,
  minimumFrameCount: 3,
  generationModel: "h3-ref2va-int8-v2",
  verifierModel: "opencv-sface-2021dec-yunet-2023mar",
  modelSha256: "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
  verifierVersion: "sface-yunet-cpu-v1",
  preprocessVersion: "opencv412-aligncrop112-rgb-f32-nchw-unit-centroid-v1-gallery-v2-6e3acaeea694c1a1d1df4fbd8f2a5365aa801cca8fd2a07faf8f6634af4dd9e7",
});

// V3 compatibility has new IDs and canonical files; the original V2 policy is immutable.
const diegoV3Policy = Object.freeze({ ...policy,
  id: H3_DIEGO_V3_DRAFT_SIMILARITY_POLICY_ID, sha256: H3_DIEGO_V3_DRAFT_SIMILARITY_POLICY_SHA256,
  generationModel: "h3-ref2va-int8-v3",
});
const valentinaV3Policy = Object.freeze({ ...policy,
  id: H3_VALENTINA_V3_DRAFT_SIMILARITY_POLICY_ID, sha256: H3_VALENTINA_V3_DRAFT_SIMILARITY_POLICY_SHA256,
  canonicalName: "Valentina", identityReferenceSha256: "15a317d4bc85ab1b794f0bb0e9e25658b616c41a1b77bc23520ebbecc95ffc67",
  gallerySha256: "aabd690a6375029bfc793be8c2cd9b9efc034583aa5b0d0463c111c1c565b9c8",
  generationModel: "h3-ref2va-int8-v3",
  preprocessVersion: "opencv412-aligncrop112-rgb-f32-nchw-unit-centroid-v1-gallery-v2-aabd690a6375029bfc793be8c2cd9b9efc034583aa5b0d0463c111c1c565b9c8",
});
export const H3_DRAFT_SIMILARITY_POLICIES = Object.freeze([policy, diegoV3Policy, valentinaV3Policy]);
export const H3_JOINT_DRAFT_SIMILARITY_POLICY_ID = "love-me-tonight-diego-valentina-frontal-pair-draft-v1";
export const H3_JOINT_DRAFT_SIMILARITY_POLICY_SHA256 = "34e9171b83d5d5fa07d4f61ed72e38efd28a13aa357f9c0413da2beca5d33e00";
export const H3_JOINT_DRAFT_SIMILARITY_POLICY = Object.freeze({ ...diegoV3Policy,
  id: H3_JOINT_DRAFT_SIMILARITY_POLICY_ID, sha256: H3_JOINT_DRAFT_SIMILARITY_POLICY_SHA256,
  canonicalName: "Diego and Valentina", minimumAssignmentCosineMargin: .08,
  identityReferenceSha256s: Object.freeze([policy.identityReferenceSha256, valentinaV3Policy.identityReferenceSha256]),
  galleryBindings: Object.freeze([
    { identityReferenceHashes: [policy.identityReferenceSha256, valentinaV3Policy.identityReferenceSha256],
      gallerySha256: "eda1ff90b645bf21f79326784c2a24ba6791d17a24f6c8fbf20009238fe5cfb6" },
    { identityReferenceHashes: [valentinaV3Policy.identityReferenceSha256, policy.identityReferenceSha256],
      gallerySha256: "ba9a3feae540586076ead2b2f13e863223eae58d1e74d6586ff5e319602a5753" },
  ]),
});

export function resolveH3DraftSimilarityPolicy(id: string, sha256: string) {
  if (id === H3_JOINT_DRAFT_SIMILARITY_POLICY.id && sha256 === H3_JOINT_DRAFT_SIMILARITY_POLICY.sha256) return H3_JOINT_DRAFT_SIMILARITY_POLICY;
  return H3_DRAFT_SIMILARITY_POLICIES.find(policy => id === policy.id && sha256 === policy.sha256);
}

/** Worker selection pins the exact raw authorities, project and generation profile; unknown inputs abstain. */
export function resolveH3DraftSimilarityPolicyForInputs(input: {
  projectId: string; generationModel: string; identityReferenceHashes: readonly string[];
}) {
  if (input.identityReferenceHashes.length === 2 && input.projectId === H3_JOINT_DRAFT_SIMILARITY_POLICY.projectId
    && input.generationModel === H3_JOINT_DRAFT_SIMILARITY_POLICY.generationModel
    && H3_JOINT_DRAFT_SIMILARITY_POLICY.galleryBindings.some(binding => binding.identityReferenceHashes.every((hash, index) => hash === input.identityReferenceHashes[index]))) {
    return H3_JOINT_DRAFT_SIMILARITY_POLICY;
  }
  if (input.identityReferenceHashes.length !== 1) return undefined;
  return H3_DRAFT_SIMILARITY_POLICIES.find(policy => input.projectId === policy.projectId
    && input.generationModel === policy.generationModel && input.identityReferenceHashes[0] === policy.identityReferenceSha256);
}
