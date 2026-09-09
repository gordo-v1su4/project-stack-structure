import { reviewedEvidence, focalSubject } from "../helpers/storyEvidence";
import { describe, expect, test } from "bun:test";
import type { MusicVideoProject, VideoMoment } from "@/components/studio/musicVideoProject";
import { proposeBestEffortCoverage, selectStorySectionCandidate } from "@/components/studio/musicVideoProjectSelection";
import { rankMomentsForSection } from "@/components/studio/semanticEditPlanner";

function fixture(): MusicVideoProject {
  const moments: VideoMoment[] = [
    { id: "a", sourceClipId: 0, label: "Solo A", start: 0, end: 5, duration: 5, mediaEvidence: reviewedEvidence({ subjects: [focalSubject("Diego")], focalSubjectCount: 1, actions: ["dancing"], location: "club" }, 0, 5), caption: "Diego dancing alone in the club." },
    { id: "b", sourceClipId: 1, label: "Solo B", start: 0, end: 5, duration: 5, mediaEvidence: reviewedEvidence({ subjects: [focalSubject("Diego")], focalSubjectCount: 1, actions: ["dancing"], location: "club" }, 0, 5), caption: "Diego dancing alone under red club lights." },
    { id: "pair", sourceClipId: 2, label: "Pair", start: 0, end: 5, duration: 5, mediaEvidence: reviewedEvidence({ subjects: [focalSubject("Diego"), focalSubject("Valentina")], focalSubjectCount: 2, actions: ["dancing"], location: "club" }, 0, 5), caption: "Diego and Valentina dancing together in the club." },
  ];
  const section = { id: "chorus", label: "Chorus", start: 0, end: 15, prompt: "Diego dancing alone in the club" };
  const candidates = rankMomentsForSection({ section, moments, includeIneligible: true });
  return { id: "project", song: null, duration: 15, lyricChunks: [], videoMoments: moments, reviewFindings: [],
    storySections: [{ ...section, source: "manual", lyricChunkIds: [], videoMomentIds: ["a", "b"], candidateMatches: candidates, semanticMatch: candidates.find((match) => match.momentId === "a") }],
    editPlan: { id: "edit", createdAt: "2026-09-06", timelineItems: [{ ...section, id: "requirement-a", sectionId: section.id, requirementId: "solo", lyricChunkIds: [], videoMomentId: "a", eligibleMomentIds: ["a", "b"], candidateMatches: candidates }] } };
}

describe("requirement-level source selection", () => {
  test("selects a supported alternate and preserves eligible variety", () => {
    const project = fixture();
    const next = selectStorySectionCandidate(project, { sectionId: "chorus", timelineItemId: "requirement-a", momentId: "b" });
    expect(next).not.toBe(project);
    expect(next.editPlan.timelineItems[0]?.videoMomentId).toBe("b");
    expect(next.editPlan.timelineItems[0]?.eligibleMomentIds).toEqual(["b", "a"]);
    expect(next.editPlan.timelineItems[0]?.semanticMatch?.assessment?.eligibility).toBe("eligible");
    expect(project.editPlan.timelineItems[0]?.videoMomentId).toBe("a");
  });

  test("explicit selection allows low story fit while preserving the factual warning", () => {
    const project = fixture();
    const selected = selectStorySectionCandidate(project, { sectionId: "chorus", timelineItemId: "requirement-a", momentId: "pair" });
    expect(selected.editPlan.timelineItems[0]?.videoMomentId).toBe("pair");
    expect(selected.editPlan.timelineItems[0]?.semanticMatch?.assessment?.eligibility).toBe("ineligible");
    expect(project.editPlan.timelineItems[0]?.videoMomentId).toBe("a");
    expect(selectStorySectionCandidate(project, { sectionId: "chorus", timelineItemId: "requirement-a", momentId: "missing" })).toBe(project);
  });

  test("selecting one requirement leaves another in the same music section unchanged", () => {
    const project = fixture();
    const second = { ...project.editPlan.timelineItems[0]!, id: "requirement-b", requirementId: "pair", prompt: "Diego and Valentina dancing together", videoMomentId: "pair", eligibleMomentIds: ["pair"], start: 5 };
    project.editPlan.timelineItems[0]!.end = 5;
    project.editPlan.timelineItems.push(second);
    const next = selectStorySectionCandidate(project, { sectionId: "chorus", timelineItemId: "requirement-a", momentId: "b" });
    expect(next.editPlan.timelineItems[1]).toBe(second);
    expect(next.storySections).toEqual(project.storySections);
    expect(selectStorySectionCandidate(project, { sectionId: "chorus", momentId: "b" })).toBe(project);
  });

  test("best-effort proposal is pure and reports repetition without omitting story moments", () => {
    const project = fixture();
    const before = JSON.stringify(project);
    const proposal = proposeBestEffortCoverage(project, project.videoMoments.map((moment) => ({ id: moment.sourceClipId, name: moment.label, videoUrl: `blob:${moment.id}`, thumbnailUrl: "", duration: moment.duration, size: 10 })));
    expect(JSON.stringify(project)).toBe(before);
    expect(proposal.omittedMoments).toBe(0);
    expect(proposal.proposed.placementPlan?.policy).toBe("best-effort");
    expect(proposal.faithful.placementPlan?.policy).toBe("faithful");
    expect(proposal.remainingGapSeconds).toBeLessThanOrEqual(proposal.faithfulGapSeconds);
    expect(proposal.repeatedSeconds).toBeGreaterThan(0);
    expect(proposal.proposed.placementPlan?.placements.filter((placement) => placement.kind === "source").every((placement) => placement.momentId !== "pair")).toBe(true);
  });
});

test("a low-fit selection with authorized reuse survives saved placements and preview coverage", async () => {
  const { prepareApprovedPlacements, buildEditPlanPreviewSegments } = await import("@/components/studio/musicVideoProject");
  const { buildCoverageSlots, summarizeCoverage } = await import("@/components/studio/editPlanCoverage");
  const selected = selectStorySectionCandidate(fixture(), { sectionId: "chorus", timelineItemId: "requirement-a", momentId: "pair" });
  selected.editPlan.timelineItems[0]!.eligibleMomentIds = ["pair"];
  const sources = selected.videoMoments.map(moment => ({ id: moment.sourceClipId, name: moment.label, videoUrl: `blob:${moment.id}`, thumbnailUrl: "", duration: moment.duration, size: 10 }));
  const prepared = prepareApprovedPlacements({ project: selected, videoSources: sources, policy: "best-effort" });
  const restored: MusicVideoProject = JSON.parse(JSON.stringify(prepared));
  const preview = buildEditPlanPreviewSegments({ project: restored, videoSources: sources });
  expect(preview.every(cut => cut.kind === "source" && cut.momentId === "pair")).toBe(true);
  expect(preview.reduce((sum, cut) => sum + cut.musicEnd - cut.musicStart, 0)).toBe(15);
  expect(summarizeCoverage(buildCoverageSlots(restored, []))).toMatchObject({ blockingGapCount: 0, assignedDuration: 15, reviewCount: 1 });
  expect(restored.editPlan.timelineItems[0]?.semanticMatch?.assessment?.eligibility).toBe("ineligible");
  expect(buildEditPlanPreviewSegments({ project: restored, videoSources: [] }).every(cut => cut.kind === "gap")).toBe(true);
});

test("approved placement construction uses movement continuity before candidate order", async () => {
  const { prepareApprovedPlacements, buildEditPlanPreviewSegments } = await import("@/components/studio/musicVideoProject");
  const { makeMotionDescriptor } = await import("../helpers/studioFixtures");
  const project = fixture();
  project.duration = 10;
  project.storySections[0]!.end = 10;
  project.videoMoments.forEach((moment, index) => {
    moment.motionDescriptor = makeMotionDescriptor({ dominantAngleDeg: index === 1 ? 180 : 0 });
  });
  const first = project.editPlan.timelineItems[0]!;
  first.end = 5;
  first.eligibleMomentIds = ["a"];
  project.editPlan.timelineItems.push({ ...first, id: "next", start: 5, end: 10, videoMomentId: "b", eligibleMomentIds: ["b", "pair"] });
  const sources = project.videoMoments.map(moment => ({ id: moment.sourceClipId, name: moment.label, videoUrl: `blob:${moment.id}`, thumbnailUrl: "", duration: moment.duration, size: 10 }));
  const prepared = prepareApprovedPlacements({ project, videoSources: sources });
  expect(buildEditPlanPreviewSegments({ project: prepared, videoSources: sources }).map(cut => cut.momentId)).toEqual(["a", "pair"]);
  expect(project.editPlan.timelineItems[1]!.videoMomentId).toBe("b");
});
