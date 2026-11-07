import { expect, test } from "bun:test";
import { assetsForCurrentReferenceReview } from "@/components/studio/currentReferenceReview";
import { createGeneratedDraftSelection } from "@/components/studio/generatedDraft";
import type { GeneratedStudioAsset } from "@/components/studio/generatedAssets";
import type { EditPlanPreviewSegment } from "@/components/studio/musicVideoProject";

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
