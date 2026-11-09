import { describe, expect, test } from "bun:test";
import { buildEditPlanPreviewSegments, createMusicVideoProject, isPlacementPlanCurrent, prepareApprovedPlacements } from "@/components/studio/musicVideoProject";
import { planH3DraftWindows } from "@/components/studio/h3DraftPlan";
import { applyGeneratedAssetOverlays, type GeneratedStudioAsset } from "@/components/studio/generatedAssets";
import { materializeH3Job } from "@/lib/h3GenerationServer";
import { h3ProjectFixture } from "../helpers/h3Project";
import { reviewedEvidence } from "../helpers/storyEvidence";
import type { UploadedVideoSource } from "@/components/studio/types";

const duration = 29.0037;
const analysis = {
  duration, sourceLabel: "master.wav", audioUrl: "", waveform: [], energy: [1],
  beats: Array.from({ length: 59 }, (_, index) => index * 0.5),
  onsets: Array.from({ length: 58 }, (_, index) => index * 0.5 + 0.1),
  sections: [{ label: "Chorus", start: 0, end: duration, energy: 1 }],
};

function prepare(cutDensity: number) {
  const editSettings = { cutDensity, preferOnsets: true };
  const draft = createMusicVideoProject({ analysis, duration, videoSources: [], storyDrafts: [
    { id: "chorus", label: "Chorus", start: 0, end: duration, prompt: "Diego crosses CLUB_MAIN." },
  ] });
  // Saved mapped story windows can retain sub-millisecond song endpoints even
  // though the ordinary authoring controls display rounded milliseconds.
  draft.editPlan.timelineItems[0].end = duration;
  draft.storySections[0].end = duration;
  const project = prepareApprovedPlacements({
    project: draft, videoSources: [], editSettings,
  });
  return { project, editSettings, segments: buildEditPlanPreviewSegments({ project, videoSources: [], editSettings }) };
}

describe("zero-footage musical edit scaffolding", () => {
  test("pace changes the empty-library cut map while exact full-song coverage and story bindings survive", () => {
    const slow = prepare(0);
    const fast = prepare(1);
    expect(fast.segments.length).toBeGreaterThan(slow.segments.length);
    expect(fast.segments.length).toBeGreaterThan(10);
    for (const { project, segments } of [slow, fast]) {
      expect(isPlacementPlanCurrent(project)).toBe(true);
      expect(project.videoMoments).toEqual([]);
      expect(segments[0].musicStart).toBe(0);
      expect(segments.at(-1)!.musicEnd).toBe(duration);
      expect(new Set(segments.map(segment => segment.placementId)).size).toBe(segments.length);
      for (const [index, segment] of segments.entries()) {
        expect(segment.kind).toBe("gap");
        expect(segment.timelineItemId).toBe(project.editPlan.timelineItems[0].id);
        expect(segment.sectionId).toBe(project.storySections[0].id);
        expect(segment.storyDirection).toBe("Diego crosses CLUB_MAIN.");
        if (index) expect(segment.musicStart).toBe(segments[index - 1].musicEnd);
      }
    }
    const cues = [...analysis.beats, ...analysis.onsets];
    expect(fast.segments.every(segment => segment.musicEnd - segment.musicStart <= 3.001)).toBe(true);
    expect(fast.segments.slice(0, -1).every(segment => cues.some(cue => Math.abs(cue - segment.musicEnd) < 0.001))).toBe(true);
  });

  test("H3 requests preserve musical placements instead of replacing them with equal provider-length subdivisions", () => {
    const { project, segments } = prepare(1);
    const windows = planH3DraftWindows(segments);
    expect(windows.map(window => [window.musicStart, window.musicEnd])).toEqual(segments.map(segment => [segment.musicStart, segment.musicEnd]));
    const { saved, request } = h3ProjectFixture();
    saved.draft.musicVideoProject = project;
    for (const window of windows) {
      const job = materializeH3Job(saved.project.ownerId, saved, { ...request,
        planSignature: window.planSignature!, timelineItemId: window.timelineItemId, requirementId: window.requirementId,
        sectionId: window.sectionId, songStart: window.musicStart, songEnd: window.musicEnd,
      }, "studio");
      expect(job.target.songStart).toBe(window.musicStart);
      expect(job.target.songEnd).toBe(window.musicEnd);
    }
  });

  test("candidate assembly retains every editorial boundary and rejects an earlier plan target", () => {
    const { segments } = prepare(1);
    const assets: GeneratedStudioAsset[] = segments.map((segment, index) => ({
      id: `candidate-${index}`, provider: "swarmui", model: "MiniMax H3", prompt: "Diego crosses CLUB_MAIN.",
      createdAt: "2026-11-09T00:00:00Z", mediaKind: "video", status: "completed", reviewStatus: "pending",
      durationSeconds: segment.musicEnd - segment.musicStart, resultUrl: `https://media.example/${index}.mp4`,
      target: { planSignature: segment.planSignature!, timelineItemId: segment.timelineItemId!, sectionId: segment.sectionId,
        sectionLabel: "Chorus", songStart: segment.musicStart, songEnd: segment.musicEnd },
    }));
    // Exercise low-level assembly only: similarity and human approval remain
    // separate gates; this fixture does not claim either one passed.
    const assembled = applyGeneratedAssetOverlays(segments, assets);
    expect(assembled.every(segment => segment.kind === "source")).toBe(true);
    expect(assembled.map(segment => [segment.musicStart, segment.musicEnd, segment.placementId]))
      .toEqual(segments.map(segment => [segment.musicStart, segment.musicEnd, segment.placementId]));
    expect(applyGeneratedAssetOverlays(segments, assets.map(asset => ({ ...asset,
      target: { ...asset.target!, planSignature: "placements-v1-earlier" },
    })))).toEqual(segments);
  });

  test("reading an already current saved arrangement never retroactively replans its cuts", () => {
    const { project, editSettings } = prepare(1);
    const original = structuredClone(project);
    expect(prepareApprovedPlacements({ project, videoSources: [], editSettings })).toBe(project);
    expect(project).toEqual(original);
  });

  test("a manual hole beside real source trims keeps source windows and avoids cue-induced flashes", () => {
    const { project, editSettings } = prepare(1);
    const sources = [{ id: 0, name: "Diego", duration, videoUrl: "https://media.example/source.mp4" }] as UploadedVideoSource[];
    const moment = { id: "diego", sourceClipId: 0, label: "Diego crosses CLUB_MAIN.", caption: "Diego crosses CLUB_MAIN.",
      start: 0, end: duration, duration, mediaEvidence: reviewedEvidence({ actions: ["walking"], focalSubjectCount: 1 }) };
    project.videoMoments = [moment];
    project.editPlan.timelineItems[0].videoMomentId = moment.id;
    const original = prepareApprovedPlacements({ project, videoSources: sources, editSettings });
    const item = original.editPlan.timelineItems[0];
    // Author an explicit hole between musical cuts. Reuse preparation must
    // retain the user's exclusion and must not split its 0.4s leading fragment.
    const manual = { id: "manual-hole", timelineItemId: item.id, sectionId: item.sectionId, momentId: null,
      sourceStart: 0, sourceEnd: 4.5, songStart: 4.2, songEnd: 8.7, label: item.label,
      kind: "gap" as const, reason: "User requested replacement", origin: "manual-match" as const };
    const edited = { ...original, placementPlan: { ...original.placementPlan!, placements: [...original.placementPlan!.placements, manual] } };
    const prepared = prepareApprovedPlacements({ project: edited, videoSources: sources, editSettings, policy: "best-effort" });
    const cuts = prepared.placementPlan!.placements;
    const gaps = cuts.filter(cut => cut.kind === "gap");
    expect(cuts.some(cut => cut.kind === "source")).toBe(true);
    expect(gaps.some(gap => gap.songStart <= 4.2 && gap.songEnd > 4.2)).toBe(true);
    expect(gaps.every(gap => gap.songEnd - gap.songStart >= 0.999)).toBe(true);
    expect(cuts.some(cut => cut.kind === "source" && cut.songStart < 8.7 && cut.songEnd > 4.2)).toBe(false);
    const firstSource = cuts.find(cut => cut.kind === "source")!;
    expect(firstSource).toEqual(original.placementPlan!.placements[0]);
    expect(cuts[0].songStart).toBe(0);
    expect(cuts.at(-1)!.songEnd).toBe(original.placementPlan!.placements.at(-1)!.songEnd);
    for (let index = 1; index < cuts.length; index++) expect(cuts[index].songStart).toBe(cuts[index - 1].songEnd);
  });
});
