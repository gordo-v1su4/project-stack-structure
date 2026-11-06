import { describe, expect, test } from "bun:test";
import { preserveReviewedStoryArrangement } from "@/components/studio/reconfirmStoryProject";
import { buildEditPlanPreviewSegments, isPlacementPlanCurrent, placementInputSignature, type MusicVideoProject } from "@/components/studio/musicVideoProject";
import type { UploadedVideoSource } from "@/components/studio/types";

function fixture() {
  const project: MusicVideoProject = {
    id: "existing-film", sourceContextSignature: "reviewed-eleven-sources", duration: 30, song: null,
    storySections: [], lyricChunks: [], reviewFindings: [],
    videoMoments: Array.from({ length: 13 }, (_, index) => ({ id: `moment-${index}`, sourceClipId: 1,
      label: "Accepted scene", start: index * 2, end: index * 2 + 2, duration: 2, contentHash: `unchanged-scene-${index}` })),
    editPlan: { id: "existing-edit", createdAt: "fixed", timelineItems: Array.from({ length: 14 }, (_, index) => ({
      id: `item-${index}`, sectionId: "story", start: index * 2, end: index === 13 ? 30 : index * 2 + 2,
      label: "Existing story action", prompt: "Preserve the accepted story.", lyricChunkIds: [],
      videoMomentId: index === 13 ? null : `moment-${index}`,
    })) },
  };
  project.placementPlan = { version: 1, revision: 3, policy: "faithful", settings: { cutDensity: 0.65, preferOnsets: true },
    inputSignature: placementInputSignature(project), placements: project.editPlan.timelineItems.map((item, index) => ({
      id: `accepted-${index}`, timelineItemId: item.id, sectionId: "story", momentId: item.videoMomentId,
      sourceStart: index === 13 ? 0 : index * 2, sourceEnd: index === 13 ? 4 : index * 2 + 2,
      songStart: item.start, songEnd: item.end, label: "Exact accepted label", kind: index === 13 ? "gap" : "source",
      origin: "manual-match", reason: index === 13 ? "User explicitly left this gap" : undefined,
    })) };
  const next = structuredClone(project);
  next.sourceContextSignature = "reviewed-twenty-one-sources";
  next.videoMoments.push({ id: "newly-discovered", sourceClipId: 2, start: 0, end: 30, duration: 30, label: "New footage", contentHash: "new-hash" });
  next.placementPlan!.placements = next.placementPlan!.placements.map(placement => ({ ...placement, kind: "gap", momentId: null }));
  next.placementPlan!.inputSignature = placementInputSignature(next);
  return { project, next };
}

describe("explicit source inventory reconfirmation", () => {
  test("retains all thirteen accepted placements and deliberate gaps while binding fresh inventory", () => {
    const { project, next } = fixture();
    const snapshot = JSON.stringify(project);
    const result = preserveReviewedStoryArrangement(project, next);
    expect(result.placementPlan!.placements).toEqual(project.placementPlan!.placements);
    expect(result.placementPlan!.placements.filter(placement => placement.kind === "source")).toHaveLength(13);
    expect(result.placementPlan!.placements[0]).toBe(project.placementPlan!.placements[0]);
    expect(result.videoMoments).toHaveLength(14);
    expect(result.sourceContextSignature).toBe(next.sourceContextSignature);
    expect(result.placementPlan!.inputSignature === project.placementPlan!.inputSignature).toBe(false);
    expect(result.placementPlan!.revision).toBe(4);
    expect(isPlacementPlanCurrent(result)).toBe(true);
    expect(result.faithfulPlacementPlan).toBe(result.placementPlan);
    expect(JSON.stringify(project)).toBe(snapshot);
    const sources = [{ id: 1, videoUrl: "https://media.example/accepted.mp4" }, { id: 2, videoUrl: "https://media.example/new.mp4" }] as UploadedVideoSource[];
    expect(buildEditPlanPreviewSegments({ project: result, videoSources: sources }).filter(segment => segment.kind === "source")).toHaveLength(13);
  });

  test("an explicitly reviewed stale signature is not permission to skip physical range validation", () => {
    const { project, next } = fixture();
    project.placementPlan!.inputSignature = "stale-source:new-inventory";
    expect(isPlacementPlanCurrent(project)).toBe(false);
    const result = preserveReviewedStoryArrangement(project, next);
    expect(isPlacementPlanCurrent(result)).toBe(true);
    expect(result.placementPlan!.placements).toEqual(project.placementPlan!.placements);
    next.videoMoments[0].contentHash = "different-bytes";
    expect(() => preserveReviewedStoryArrangement(project, next)).toThrow("accepted source range changed");
  });

  for (const change of ["missing moment", "different source", "shortened moment", "missing hash", "different story", "overlapping song", "different master"]) {
    test(`rejects ${change} without replacing accepted work`, () => {
      const { project, next } = fixture();
      const snapshot = JSON.stringify(project);
      if (change === "missing moment") next.videoMoments.shift();
      if (change === "different source") next.videoMoments[0].sourceClipId = 99;
      if (change === "shortened moment") next.videoMoments[0].end = 1;
      if (change === "missing hash") delete next.videoMoments[0].contentHash;
      if (change === "different story") next.editPlan.timelineItems[0].prompt = "A different action.";
      if (change === "overlapping song") project.placementPlan!.placements[1].songStart = 1;
      if (change === "different master") next.song = { sourceLabel: "replacement.wav", audioUrl: "", duration: 30, waveform: [], energy: [], beats: [], onsets: [], sections: [] };
      expect(() => preserveReviewedStoryArrangement(project, next)).toThrow();
      if (change !== "overlapping song") expect(JSON.stringify(project)).toBe(snapshot);
    });
  }

  test("initial confirmation without existing editorial choices uses the prepared new story", () => {
    const { next } = fixture();
    expect(preserveReviewedStoryArrangement(null, next)).toBe(next);
  });
});
