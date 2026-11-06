import { buildH3IdentityAssessmentScope, identityAssessmentAsset, type H3IdentityAssessment } from "@/components/studio/h3IdentityAssessment";
import { identityPolicySha256 } from "@/components/studio/issuedIdentityPolicy";
import { issuedDraftAssetFixture } from "./issuedDraftAsset";
import { issuedProofFixture } from "./issuedIdentityPolicy";

/** Synthetic all-frame range contract only; never an identity assessment of real footage. */
export function h3IdentityAssessmentFixture(mediaSha256 = "b".repeat(64)) {
  const fixture = issuedDraftAssetFixture("foreground",2), { job,asset,policy } = fixture;
  job.request.songEnd = 1; job.target.songEnd = 1; asset.target!.songEnd = 1;
  asset.mediaSha256 = mediaSha256;
  asset.identityVerification = issuedProofFixture(job,asset,policy);
  const filter = asset.identityVerification.draftSimilarityFilter!;
  filter.status = "ineligible"; filter.eligibleFrameCount = 0; filter.outOfScopeFrameCount = 24;
  const scope = buildH3IdentityAssessmentScope(job,.5,"00000000-0000-4000-8000-000000000001");
  const proof = issuedProofFixture(job,{ ...asset,trimStart: .5 },policy);
  const record: H3IdentityAssessment = { version: 1, status: "ready", scope, assessedAt: "2026-11-06T01:00:00Z", proof, proofSha256: identityPolicySha256(proof) };
  return { ...fixture, scope, record, assessed: identityAssessmentAsset(record,job),
    gap: { ...fixture.gap, musicEnd: 1, endTime: 1 } };
}
