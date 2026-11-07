import { expect, test } from "bun:test";
import { nativeFirstFrameSelection } from "@/components/studio/nativeFirstFrame";
import { withCurrentReferenceIdentity } from "@/components/studio/currentReferenceIdentity";
import { identityPolicySha256 } from "@/components/studio/issuedIdentityPolicy";
import { currentReferenceIdentityFixture } from "../helpers/currentReferenceIdentity";

function fixture() {
  const value = currentReferenceIdentityFixture();
  const asset = withCurrentReferenceIdentity([{ ...value.asset, width: 1344, height: 768 }], value.context)[0];
  return { ...value, asset };
}
test("choosing an interior frame preserves the whole take trim, target, old proof and current assessment", () => {
  const { asset } = fixture(), before = JSON.stringify(asset), choice = nativeFirstFrameSelection(asset, 12);
  expect(choice.frameIndex).toBe(12); expect(choice.trimStart).toBe(0); expect(choice.firstFrame).toBe(0); expect(choice.endFrameExclusive).toBe(37);
  expect(choice.frameSha256).toBe(asset.identityVerification!.samples[12].frameSha256);
  expect(choice.current!.proofSha256).toBe(asset.currentReferenceIdentity!.assessment!.status === "ready" ? asset.currentReferenceIdentity!.assessment!.proofSha256 : "missing");
  expect(JSON.stringify(asset)).toBe(before);
});
test("native indices cannot escape the eligible range or use fractional frames", () => {
  const { asset } = fixture();
  for (const index of [-1, 37, 54, 1.5, NaN, Infinity]) expect(() => nativeFirstFrameSelection(asset, index)).toThrow();
});
test("pending, failed, changed-trim and rejected evidence cannot supply a source frame", () => {
  const { asset, context, assessment } = fixture();
  expect(() => nativeFirstFrameSelection({ ...asset, trimStart: .25 }, 12)).toThrow();
  expect(() => nativeFirstFrameSelection({ ...asset, reviewStatus: "rejected" }, 12)).toThrow();
  delete context.activeAssessments[asset.id];
  expect(() => nativeFirstFrameSelection(withCurrentReferenceIdentity([asset], context)[0], 12)).toThrow();
  context.assessments[assessment.scope.id] = { version: 1, scope: assessment.scope, status: "failed", assessedAt: assessment.assessedAt, errorCode: "assessment-failed" };
  context.activeAssessments[asset.id] = assessment.scope.id;
  expect(() => nativeFirstFrameSelection(withCurrentReferenceIdentity([asset], context)[0], 12)).toThrow();
});
test("a passing new numerical report cannot substitute different frame pixels for source lineage", () => {
  const { asset, assessment } = fixture();
  assessment.proof.samples[12].frameSha256 = "f".repeat(64); assessment.proof.draftSimilarityFilter!.samples[12].frameSha256 = "f".repeat(64);
  assessment.proofSha256 = identityPolicySha256(assessment.proof);
  expect(() => nativeFirstFrameSelection(asset, 12)).toThrow("pixels disagree");
});
