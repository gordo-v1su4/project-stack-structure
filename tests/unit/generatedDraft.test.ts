import { describe, expect, test } from "bun:test";
import {
  applyDraftGeneratedAssets,
  approveGeneratedDraft,
  captureGeneratedDraftReview,
  createGeneratedDraftSelection,
  rejectGeneratedDraftAsset,
  sanitizeGeneratedDraftSelection,
  selectGeneratedDraftAsset,
} from "@/components/studio/generatedDraft";
import { applyApprovedGeneratedAssets, type GeneratedStudioAsset } from "@/components/studio/generatedAssets";
import type { EditPlanPreviewSegment } from "@/components/studio/musicVideoProject";

const gap: EditPlanPreviewSegment = {
  planSignature: "plan-1", requirementId: "arrival", timelineItemId: "intro-arrival", sectionId: "intro",
  label: "Arrival", kind: "gap", videoUrl: "", startTime: 0, endTime: 10, musicStart: 0, musicEnd: 10,
};

function candidate(id = "a", overrides: Partial<GeneratedStudioAsset> = {}): GeneratedStudioAsset {
  return {
    id, provider: "swarmui", model: "MiniMax H3", prompt: "Milo arrives at the station.",
    createdAt: "2026-11-05T00:00:00.000Z", status: "completed", mediaKind: "video", durationSeconds: 12,
    reviewStatus: "pending", resultUrl: `https://media.example/${id}.mp4`,
    target: { planSignature: "plan-1", requirementId: "arrival", timelineItemId: "intro-arrival", sectionId: "intro", sectionLabel: "Intro", songStart: 0, songEnd: 10 },
    ...overrides,
  };
}

function selected(assets: GeneratedStudioAsset[]) {
  return selectGeneratedDraftAsset({ draft: createGeneratedDraftSelection("plan-1"), assets, asset: assets[0], segments: [gap] });
}

describe("generated draft selection and acceptance", () => {
  test("assembles selected pending media while export and original assets remain unchanged", () => {
    const assets = [candidate()];
    const draft = selected(assets);
    expect(applyDraftGeneratedAssets([gap], assets, draft)[0]).toMatchObject({ kind: "source", videoUrl: assets[0].resultUrl, musicStart: 0, musicEnd: 10 });
    expect(applyApprovedGeneratedAssets([gap], assets)).toEqual([gap]);
    expect(assets[0].reviewStatus).toBe("pending");
  });

  test("accepts exactly the viewed draft in one batch and reproduces it in approved playback", () => {
    const secondGap = { ...gap, requirementId: "departure", timelineItemId: "intro-departure", musicStart: 10, musicEnd: 20 };
    const a = candidate();
    const b = candidate("b", { target: { ...a.target!, requirementId: "departure", timelineItemId: "intro-departure", songStart: 10, songEnd: 20 } });
    const unseen = candidate("unseen");
    const assets = [a, b, unseen];
    const first = selectGeneratedDraftAsset({ draft: createGeneratedDraftSelection("plan-1"), assets, asset: a, segments: [gap, secondGap] });
    const draft = selectGeneratedDraftAsset({ draft: first, assets, asset: b, segments: [gap, secondGap] });
    const review = captureGeneratedDraftReview([gap, secondGap], assets, draft)!;
    const viewed = applyDraftGeneratedAssets([gap, secondGap], assets, draft);
    const result = approveGeneratedDraft({ draft, assets, segments: [gap, secondGap], review, approvedAt: "2026-11-06T00:00:00.000Z" });
    expect(result.error).toBeNull();
    expect(result.assets.map(asset => asset.reviewStatus)).toEqual(["approved", "approved", "pending"]);
    expect(result.draft).toEqual({ planSignature: "plan-1", revision: draft.revision + 1, assetIds: [] });
    expect(applyApprovedGeneratedAssets([gap, secondGap], result.assets)).toEqual(viewed);
    expect(assets.every(asset => asset.reviewStatus === "pending")).toBe(true);
  });

  test("choosing an older take over an approved newer take survives acceptance", () => {
    const older = candidate("older", { createdAt: "2026-11-01T00:00:00.000Z" });
    const newer = candidate("newer", { reviewStatus: "approved", createdAt: "2026-11-05T00:00:00.000Z" });
    const assets = [older, newer];
    const draft = selected(assets);
    const result = approveGeneratedDraft({ draft, assets, segments: [gap], review: captureGeneratedDraftReview([gap], assets, draft)!, approvedAt: "2026-11-06T00:00:00.000Z" });
    expect(result.error).toBeNull();
    expect(applyApprovedGeneratedAssets([gap], result.assets)[0].videoUrl).toBe(older.resultUrl!);
  });

  test("overlapping selected takes retain audition order rather than generation time on acceptance", () => {
    const a = candidate();
    const b = candidate("b", { createdAt: "2026-11-01T00:00:00.000Z", target: { ...a.target!, songStart: 4 } });
    const assets = [a, b];
    const draft = selectGeneratedDraftAsset({ draft: selected(assets), assets, asset: b, segments: [gap] });
    const viewed = applyDraftGeneratedAssets([gap], assets, draft);
    const result = approveGeneratedDraft({ draft, assets, segments: [gap], review: captureGeneratedDraftReview([gap], assets, draft)! });
    expect(result.error).toBeNull();
    expect(viewed.map(segment => [segment.musicStart, segment.musicEnd, segment.videoUrl])).toEqual([[0, 4, a.resultUrl!], [4, 10, b.resultUrl!]]);
    expect(applyApprovedGeneratedAssets([gap], result.assets)).toEqual(viewed);
  });

  test("changed trims, source duration, or playback media invalidate a viewed token without a selection revision", () => {
    const a = candidate();
    const draft = selected([a]);
    const review = captureGeneratedDraftReview([gap], [a], draft)!;
    for (const changed of [{ ...a, trimStart: 1 }, { ...a, durationSeconds: 11 }, { ...a, resultUrl: "https://media.example/changed.mp4" }]) {
      const result = approveGeneratedDraft({ draft, assets: [changed], segments: [gap], review });
      expect(result.error).toContain("draft changed");
      expect(result.assets[0].reviewStatus).toBe("pending");
    }
  });

  test("late completions cannot replace a newer selected revision", () => {
    const assets = [candidate(), candidate("late")];
    const draft = selected(assets);
    expect(selectGeneratedDraftAsset({ draft, assets, asset: assets[1], segments: [gap], expectedRevision: 0 })).toBe(draft);
    expect(selectGeneratedDraftAsset({ draft, assets, asset: assets[1], segments: [gap], expectedRevision: draft.revision }).assetIds).toEqual(["late"]);
  });

  test("rejecting the replacement does not silently revive an earlier pending candidate", () => {
    const assets = [candidate(), candidate("b")];
    const draft = selectGeneratedDraftAsset({ draft: selected(assets), assets, asset: assets[1], segments: [gap] });
    expect(draft.assetIds).toEqual(["b"]);
    const rejected = rejectGeneratedDraftAsset({ draft, assets, assetId: "b" });
    expect(rejected.draft.assetIds).toEqual([]);
    expect(rejected.assets[1].reviewStatus).toBe("rejected");
    expect(applyDraftGeneratedAssets([gap], rejected.assets, rejected.draft)).toEqual([gap]);
    expect(rejected.assets[0].reviewStatus).toBe("pending");
  });

  test("a rejected reroll retains the existing approved edit", () => {
    const assets = [candidate(), candidate("approved", { reviewStatus: "approved" })];
    const result = rejectGeneratedDraftAsset({ draft: selected(assets), assets, assetId: "a" });
    expect(applyDraftGeneratedAssets([gap], result.assets, result.draft)[0].videoUrl).toBe(assets[1].resultUrl!);
  });

  test("stale rejection and acceptance leave current selections untouched", () => {
    const assets = [candidate(), candidate("b")];
    const draft = selected(assets);
    const review = captureGeneratedDraftReview([gap], assets, draft)!;
    const revised = selectGeneratedDraftAsset({ draft, assets, asset: assets[1], segments: [gap] });
    expect(rejectGeneratedDraftAsset({ draft: revised, assets, assetId: "b", expectedRevision: draft.revision })).toEqual({ draft: revised, assets });
    expect(approveGeneratedDraft({ draft: revised, assets, segments: [gap], review }).error).toContain("draft changed");
  });

  test("changed plans and legacy targets never apply or approve the old draft", () => {
    const assets = [candidate()];
    const draft = selected(assets);
    const review = captureGeneratedDraftReview([gap], assets, draft)!;
    const changed = { ...gap, planSignature: "plan-2" };
    expect(applyDraftGeneratedAssets([changed], assets, draft)).toEqual([changed]);
    expect(captureGeneratedDraftReview([changed], assets, draft)).toBeNull();
    expect(approveGeneratedDraft({ draft, assets, segments: [changed], review }).error).toContain("draft changed");
    const legacy = candidate("legacy", { target: { ...assets[0].target!, planSignature: undefined } });
    expect(selectGeneratedDraftAsset({ draft, assets: [legacy], asset: legacy, segments: [gap] })).toBe(draft);
  });

  test("short outputs remain partial and cannot approve an incomplete assembled draft", () => {
    const assets = [candidate("short", { durationSeconds: 3 })];
    const draft = selected(assets);
    const preview = applyDraftGeneratedAssets([gap], assets, draft);
    expect(preview.map(segment => [segment.kind, segment.musicStart, segment.musicEnd])).toEqual([["source", 0, 3], ["gap", 3, 10]]);
    const result = approveGeneratedDraft({ draft, assets, segments: [gap], review: captureGeneratedDraftReview([gap], assets, draft)! });
    expect(result.error).toContain("Unfilled song windows");
    expect(result.assets[0].reviewStatus).toBe("pending");
  });

  test("missing, failed, queued, and rejected selected outputs cannot yield an acceptance token", () => {
    const a = candidate();
    const draft = selected([a]);
    expect(captureGeneratedDraftReview([gap], [], draft)).toBeNull();
    for (const changed of [{ ...a, status: "failed" as const }, { ...a, status: "queued" as const }, { ...a, reviewStatus: "rejected" as const }]) {
      expect(captureGeneratedDraftReview([gap], [changed], draft)).toBeNull();
      expect(applyDraftGeneratedAssets([gap], [changed], draft)).toEqual([gap]);
    }
  });

  test("normalizes persisted selection safely without selecting arbitrary asset-bank candidates", () => {
    expect(sanitizeGeneratedDraftSelection(undefined)).toBeNull();
    expect(sanitizeGeneratedDraftSelection({ planSignature: "p", revision: -1, assetIds: [] })).toBeNull();
    expect(sanitizeGeneratedDraftSelection({ planSignature: "p", revision: 2, assetIds: ["a", 1] })).toBeNull();
    expect(sanitizeGeneratedDraftSelection({ planSignature: "p", revision: 2, assetIds: ["a", "a", "b"] })).toEqual({ planSignature: "p", revision: 2, assetIds: ["a", "b"] });
    expect(applyDraftGeneratedAssets([gap], [candidate()], null)).toEqual([gap]);
  });
});
