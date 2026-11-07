import { expect, test } from "bun:test";
import { assetsForCurrentReferenceCheck, assetsForCurrentReferenceReview, currentReferenceBankCheckBlockReason } from "@/components/studio/currentReferenceReview";
import { createGeneratedDraftSelection } from "@/components/studio/generatedDraft";
import type { GeneratedStudioAsset } from "@/components/studio/generatedAssets";
import type { EditPlanPreviewSegment } from "@/components/studio/musicVideoProject";
import { currentReferenceIdentityFixture } from "../helpers/currentReferenceIdentity";
import { withCurrentReferenceIdentity } from "@/components/studio/currentReferenceIdentity";
import { generatedAssetDraftIdentityBlockReason } from "@/components/studio/generatedAssetIdentity";

const base: EditPlanPreviewSegment[] = [{ kind: "gap", videoUrl: "", startTime: 0, endTime: 2, musicStart: 0, musicEnd: 2,
  label: "Shot", sectionId: "verse", timelineItemId: "slot", planSignature: "plan" }];
const asset = (id: string, reviewStatus: GeneratedStudioAsset["reviewStatus"] = "approved"): GeneratedStudioAsset => ({
  id, provider: "swarmui", model: "historical-model", prompt: "Historical take", createdAt: "2026-11-06T00:00:00Z",
  status: "completed", mediaKind: "video", durationSeconds: 2, resultUrl: `https://example.test/${id}.mp4`, reviewStatus,
  target: { planSignature: "plan", timelineItemId: "slot", sectionId: "verse", sectionLabel: "Verse", songStart: 0, songEnd: 2 },
});

test("approved cuts stay in the reference-review inventory after explicit selection IDs were cleared", () => {
  const take = asset("approved"), draft = createGeneratedDraftSelection("plan");
  expect(assetsForCurrentReferenceReview([take], draft, base).map(value => value.id)).toEqual(["approved"]);
});

test("the inventory exposes intended approved cuts even when their identity evidence blocks playback", () => {
  const take = asset("blocked");
  // No identity proof is present: this helper inventories intent, never authorizes playback.
  expect(assetsForCurrentReferenceReview([take], null, base)).toEqual([take]);
});

test("superseded approved bank takes and unrelated pending bank deliveries do not inflate the inventory", () => {
  const old = asset("old"), visible = asset("visible"), unused = asset("unused", "pending");
  expect(assetsForCurrentReferenceReview([old, visible, unused], null, base).map(value => value.id)).toEqual(["visible"]);
});

test("approved-only review follows approval chronology when the bank is newest first", () => {
  const old = { ...asset("old"), approvedAt: "2026-11-06T01:00:00Z" };
  const latest = { ...asset("latest"), approvedAt: "2026-11-06T02:00:00Z" };
  expect(assetsForCurrentReferenceReview([latest, old], null, base).map(value => value.id)).toEqual(["latest"]);
});

test("selected pending takes stay visible and supersede the earlier approved take at that target", () => {
  const approved = asset("approved"), selected = asset("selected", "pending"), draft = createGeneratedDraftSelection("plan");
  draft.assetIds = [selected.id];
  expect(assetsForCurrentReferenceReview([approved, selected], draft, base).map(value => value.id)).toEqual(["selected"]);
});

function bankFixture() {
  const fixture = currentReferenceIdentityFixture();
  fixture.context.assessments = {}; fixture.context.activeAssessments = {};
  const candidate = withCurrentReferenceIdentity([{ ...fixture.asset, reviewStatus: "pending" as const }], fixture.context)[0];
  const target = candidate.target!;
  const segments: EditPlanPreviewSegment[] = [{ kind: "gap", videoUrl: "", startTime: 0, endTime: target.songEnd - target.songStart,
    musicStart: target.songStart, musicEnd: target.songEnd, label: "Candidate", sectionId: target.sectionId,
    timelineItemId: target.timelineItemId, requirementId: target.requirementId, planSignature: target.planSignature }];
  const draft = createGeneratedDraftSelection(target.planSignature!);
  return { ...fixture, candidate, segments, draft };
}

test("an unselected pending bank take can be checked while selection remains blocked", () => {
  const { candidate, segments, draft } = bankFixture();
  const before = JSON.stringify({ candidate, draft });
  expect(generatedAssetDraftIdentityBlockReason(candidate)).not.toBeNull();
  expect(assetsForCurrentReferenceCheck([candidate], draft, segments)).toEqual([]);
  const checked = assetsForCurrentReferenceCheck([candidate], draft, segments, candidate.id);
  expect(checked).toEqual([candidate]); expect(checked[0]).toBe(candidate);
  expect(currentReferenceBankCheckBlockReason(candidate, segments)).toBeNull();
  expect(JSON.stringify({ candidate, draft })).toBe(before);
});

test("an explicit bank check preserves the exact historical assessment alias and trim", () => {
  const { candidate, segments, draft } = bankFixture();
  const exact = { ...candidate, identityAssessmentId: `h3-assessment-${"a".repeat(64)}`, identityAssessmentTrimStart: candidate.trimStart ?? 0 };
  const chosen = assetsForCurrentReferenceCheck([exact], draft, segments, exact.id)[0];
  expect(chosen.identityAssessmentId).toBe(exact.identityAssessmentId);
  expect(chosen.trimStart ?? 0).toBe(exact.trimStart ?? 0);
  expect(draft.assetIds).toEqual([]);
});

test("failed current evidence can be checked again without choosing another take or erasing history", () => {
  const { candidate, segments, draft, context, assessment } = bankFixture();
  const failure = { version: 1 as const, scope: assessment.scope, status: "failed" as const, assessedAt: assessment.assessedAt, errorCode: "assessment-failed" as const };
  context.assessments[failure.scope.id] = failure; context.activeAssessments[candidate.id] = failure.scope.id;
  const failed = withCurrentReferenceIdentity([candidate], context)[0];
  expect(assetsForCurrentReferenceCheck([failed], draft, segments, failed.id)).toEqual([failed]);
  expect(context.assessments[failure.scope.id]).toBe(failure); expect(draft.assetIds).toEqual([]);
});

test("an explicit check never falls back to selected takes for an unavailable bank ID", () => {
  const { candidate, segments, draft } = bankFixture(); draft.assetIds = [candidate.id];
  expect(() => assetsForCurrentReferenceCheck([candidate], draft, segments, "missing")).toThrow("no longer available");
  expect(assetsForCurrentReferenceCheck([candidate], draft, segments)).toEqual([candidate]);
});

test("old proof failure, changed exact trim, rejected and noncanonical takes cannot start a current check", () => {
  const { candidate, segments, draft } = bankFixture();
  for (const altered of [{ ...candidate, identityVerification: undefined }, { ...candidate, trimStart: 0.25 },
    { ...candidate, reviewStatus: "rejected" as const }, { ...candidate, jobId: "external" }]) {
    expect(currentReferenceBankCheckBlockReason(altered, segments)).not.toBeNull();
    expect(() => assetsForCurrentReferenceCheck([altered], draft, segments, altered.id)).toThrow();
  }
});

test("a bank check cannot use a retired target or an unaffected context", () => {
  const { candidate, segments, draft } = bankFixture();
  const retired = { ...candidate, target: { ...candidate.target!, planSignature: "retired" } };
  expect(() => assetsForCurrentReferenceCheck([retired], draft, segments, retired.id)).toThrow("current story window");
  const unaffected = { ...candidate, currentReferenceIdentity: { ...candidate.currentReferenceIdentity!, required: false } };
  expect(() => assetsForCurrentReferenceCheck([unaffected], draft, segments, unaffected.id)).toThrow("does not require");
});
