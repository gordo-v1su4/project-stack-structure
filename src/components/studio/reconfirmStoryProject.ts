import { placementInputSignature, type MusicVideoProject } from "./musicVideoProject";
import { generationScopeSha256, repriseCoversOverlap, type ExistingSourceReprise } from "./generationScope";

const EPSILON = 0.001;
const hashOf = (moment: MusicVideoProject["videoMoments"][number]) => moment.contentHash || moment.visualAnalysis?.contentHash;
const storyWindows = (project: MusicVideoProject) => project.editPlan.timelineItems.map(item => ({
  id: item.id, sectionId: item.sectionId, start: item.start, end: item.end, prompt: item.prompt,
  narrativeMomentId: item.narrativeMomentId, requirementId: item.requirementId, requirements: item.requirements,
}));
const songIdentity = (project: MusicVideoProject) => project.song && ({
  label: project.song.sourceLabel, duration: project.song.duration, bucket: project.song.storageBucket,
  path: project.song.storagePath,
  url: project.song.storagePath ? undefined : project.song.storageUrl || project.song.audioUrl,
});

/** Explicit inventory review may rebind unchanged edits; it never silently reselects clips. */
export function preserveReviewedStoryArrangement(previous: MusicVideoProject | null | undefined, next: MusicVideoProject,
  reprise?: ExistingSourceReprise): MusicVideoProject {
  const prior = previous?.placementPlan;
  if (!previous || !prior || !prior.placements.some(placement => placement.kind === "source" || placement.origin === "manual-match")) return next;
  if (!next.sourceContextSignature || !next.placementPlan) throw new Error("Review the current source inventory before confirming the story.");
  if (JSON.stringify(songIdentity(previous)) !== JSON.stringify(songIdentity(next))
    || JSON.stringify(storyWindows(previous)) !== JSON.stringify(storyWindows(next))) {
    throw new Error("The song or story windows changed. Existing accepted cuts were preserved; review their timing before replacing this arrangement.");
  }
  const ids = new Set<string>();
  const sorted = [...prior.placements].sort((a, b) => a.songStart - b.songStart);
  for (const [index, placement] of sorted.entries()) {
    const item = next.editPlan.timelineItems.find(candidate => candidate.id === placement.timelineItemId);
    if (ids.has(placement.id) || !item || item.sectionId !== placement.sectionId
      || ![placement.songStart, placement.songEnd, placement.sourceStart, placement.sourceEnd].every(Number.isFinite)
      || placement.songEnd <= placement.songStart || placement.songStart < 0 || placement.songEnd > next.duration + EPSILON
      || placement.songStart < item.start - EPSILON || placement.songEnd > item.end + EPSILON
      || (index > 0 && sorted[index - 1].songEnd > placement.songStart + EPSILON)) {
      throw new Error("An accepted cut no longer fits its story window. The previous arrangement was preserved.");
    }
    ids.add(placement.id);
    if (placement.kind === "gap") continue;
    const before = previous.videoMoments.find(moment => moment.id === placement.momentId);
    const after = next.videoMoments.find(moment => moment.id === placement.momentId);
    const contentHash = before && hashOf(before);
    if (!before || !after || !contentHash || contentHash !== hashOf(after) || before.sourceClipId !== after.sourceClipId
      || placement.sourceStart < after.start - EPSILON || placement.sourceEnd > after.end + EPSILON
      || placement.sourceEnd <= placement.sourceStart
      || Math.abs(placement.sourceEnd - placement.sourceStart - (placement.songEnd - placement.songStart)) > EPSILON) {
      throw new Error("An accepted source range changed or lacks matching media evidence. The previous arrangement was preserved.");
    }
    if (prior.policy === "faithful" && sorted.slice(0, index).some(other => {
      const otherMoment = next.videoMoments.find(moment => moment.id === other.momentId);
      return other.kind === "source" && otherMoment?.sourceClipId === after.sourceClipId
        && Math.min(other.sourceEnd, placement.sourceEnd) - Math.max(other.sourceStart, placement.sourceStart) > EPSILON
        && !(reprise?.placementsSha256 === generationScopeSha256(prior.placements) && repriseCoversOverlap(reprise, other, placement));
    })) throw new Error("The existing faithful arrangement repeats source frames. Review that overlap before confirming it.");
  }
  const plan = { ...prior, settings: next.placementPlan.settings, revision: prior.revision + 1,
    inputSignature: placementInputSignature(next, next.placementPlan.settings), placements: [...prior.placements] };
  return { ...next, generationScope: undefined, id: previous.id, placementPlan: plan, faithfulPlacementPlan: plan.policy === "faithful" ? plan : undefined };
}
