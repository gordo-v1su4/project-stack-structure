import { isPlacementPlanCurrent, type ApprovedPlacement, type MusicVideoProject } from "./musicVideoProject";
import { assessStoryMatch, isUsableStoryMatch } from "./storyMatchAssessment";

const EPSILON = 0.001;
type PlacementPlan = NonNullable<MusicVideoProject["placementPlan"]>;

export interface RoughCutTrim {
  momentId: string;
  fromPlacementId: string;
  toPlacementId: string;
  /** Original source seconds omitted from this rough cut, available in the source library. */
  sourceStart: number;
  sourceEnd: number;
}

export interface RoughCutSwapProposal {
  projectId: string;
  projectDuration: number;
  inputSignature: string;
  revision: number;
  /** Includes placement contents: revision alone cannot detect a restored or edited draft. */
  planSnapshot: string;
  firstPlacementId: string;
  secondPlacementId: string;
  /** Set for replacing one placement from the source library instead of swapping. */
  replacementMomentId?: string;
  before: ApprovedPlacement[];
  after: ApprovedPlacement[];
  trims: RoughCutTrim[];
  residualGaps: ApprovedPlacement[];
  summary: string;
}

export interface RoughCutSwapResult {
  proposal?: RoughCutSwapProposal;
  reason?: string;
  summary: string;
}

const rejected = (reason: string): RoughCutSwapResult => ({ reason, summary: reason });
const seconds = (value: number) => `${Number(value.toFixed(3))}s`;

function validatePlacements(project: MusicVideoProject, plan: PlacementPlan): string | undefined {
  const ids = new Set<string>();
  const sorted = [...plan.placements].sort((a, b) => a.songStart - b.songStart);
  for (const [index, placement] of sorted.entries()) {
    if (ids.has(placement.id)) return "The rough cut has duplicate placement IDs. Prepare it again before editing.";
    ids.add(placement.id);
    const item = project.editPlan.timelineItems.find((candidate) => candidate.id === placement.timelineItemId);
    if (!item || item.sectionId !== placement.sectionId) return "A placement no longer belongs to its story window. Prepare the rough cut again.";
    if (![placement.songStart, placement.songEnd, placement.sourceStart, placement.sourceEnd].every(Number.isFinite)
      || placement.songEnd <= placement.songStart || placement.songStart < 0 || placement.songEnd > project.duration + EPSILON
      || placement.songStart < item.start - EPSILON || placement.songEnd > item.end + EPSILON) {
      return "A placement has invalid song timing. Prepare the rough cut again.";
    }
    if (index > 0 && sorted[index - 1]!.songEnd > placement.songStart + EPSILON) return "Song windows overlap. Prepare the rough cut again before editing.";
    if (placement.kind === "gap") continue;
    const moment = project.videoMoments.find((candidate) => candidate.id === placement.momentId);
    if (!moment || !Number.isFinite(moment.start) || !Number.isFinite(moment.end)
      || placement.sourceStart < moment.start - EPSILON || placement.sourceEnd > moment.end + EPSILON
      || placement.sourceEnd <= placement.sourceStart) return "A clip extends outside its available source moment. Prepare the rough cut again.";
    if (Math.abs((placement.sourceEnd - placement.sourceStart) - (placement.songEnd - placement.songStart)) > EPSILON) {
      return "A clip does not play at its original duration. Prepare the rough cut again before editing.";
    }
    if (plan.policy === "faithful") {
      const reused = sorted.slice(0, index).some((other) => {
        if (other.kind !== "source") return false;
        const otherMoment = project.videoMoments.find((candidate) => candidate.id === other.momentId);
        return otherMoment?.sourceClipId === moment.sourceClipId
          && Math.min(other.sourceEnd, placement.sourceEnd) - Math.max(other.sourceStart, placement.sourceStart) > EPSILON;
      });
      if (reused) return "The faithful cut reuses overlapping source footage. Resolve that overlap before swapping clips.";
    }
  }
}

/** Preview a content swap; all master-song windows and destination story identities stay fixed. */
export function proposeRoughCutSwap(project: MusicVideoProject, firstPlacementId: string, secondPlacementId: string): RoughCutSwapResult {
  return proposeArrangement(project, firstPlacementId, secondPlacementId);
}

/** Review one library source in a fixed song window, including any trim or remaining gap. */
export function proposeRoughCutReplacement(project: MusicVideoProject, placementId: string, momentId: string): RoughCutSwapResult {
  return proposeArrangement(project, placementId, placementId, momentId);
}

function proposeArrangement(project: MusicVideoProject, firstPlacementId: string, secondPlacementId: string, replacementMomentId?: string): RoughCutSwapResult {
  const plan = project.placementPlan;
  if (!plan || !isPlacementPlanCurrent(project)) return rejected("The rough cut is stale. Prepare it again before moving clips.");
  if (replacementMomentId === undefined && firstPlacementId === secondPlacementId) return rejected("Choose two different placements to swap.");
  const invalid = validatePlacements(project, plan);
  if (invalid) return rejected(invalid);
  const first = plan.placements.find((placement) => placement.id === firstPlacementId);
  const replacementMoment = replacementMomentId === undefined ? undefined : project.videoMoments.find((moment) => moment.id === replacementMomentId);
  if (replacementMomentId !== undefined && !replacementMoment) return rejected("That source moment is no longer available. Select another source.");
  const second = replacementMoment && first
    ? { ...first, kind: "source" as const, momentId: replacementMoment.id, sourceStart: replacementMoment.start, sourceEnd: replacementMoment.end }
    : plan.placements.find((placement) => placement.id === secondPlacementId);
  if (!first || !second) return rejected("One of these placements is no longer in the rough cut. Select it again.");
  if (first.kind === "gap" && second.kind === "gap") return rejected("Choose at least one source clip; swapping two gaps does not change the cut.");

  const moves = replacementMoment ? [[second, first]] as const : [[first, second], [second, first]] as const;
  for (const [source, target] of moves) {
    if (source.kind === "gap") continue;
    const item = project.editPlan.timelineItems.find((candidate) => candidate.id === target.timelineItemId)!;
    const moment = project.videoMoments.find((candidate) => candidate.id === source.momentId)!;
    const assessment = assessStoryMatch({ requirementId: item.requirementId ?? item.id, requirementText: item.prompt,
      constraints: item.requirements,
      moment: { ...moment, subjects: moment.captionMeta?.subjects, action: moment.captionMeta?.action, setting: moment.captionMeta?.setting } });
    if (!isUsableStoryMatch(assessment)) {
      return rejected(`${moment.label} cannot move to ${target.label}: ${[...assessment.contradicted, ...assessment.unknown].join(" ")}`);
    }
  }

  const nextRevision = plan.revision + 1;
  const trims: RoughCutTrim[] = [];
  const residualGaps: ApprovedPlacement[] = [];
  const descriptions: string[] = [];
  const reservedIds = new Set(plan.placements.map((placement) => placement.id));
  function move(source: ApprovedPlacement, target: ApprovedPlacement): ApprovedPlacement[] {
    const duration = target.songEnd - target.songStart;
    const window = `${seconds(target.songStart)}–${seconds(target.songEnd)}`;
    if (source.kind === "gap") {
      descriptions.push(`${target.label} (${window}) becomes a ${seconds(duration)} gap.`);
      return [{ ...target, kind: "gap", momentId: null, sourceStart: 0, sourceEnd: duration,
        reason: "Clip moved to another song window", origin: "manual-match" }];
    }
    const sourceDuration = source.sourceEnd - source.sourceStart;
    const usedDuration = Math.min(sourceDuration, duration);
    const songEnd = Math.abs(sourceDuration - duration) < 1e-9 ? target.songEnd : Math.min(target.songEnd, target.songStart + usedDuration);
    const sourceEnd = Math.min(source.sourceEnd, source.sourceStart + usedDuration);
    const momentLabel = project.videoMoments.find((moment) => moment.id === source.momentId)!.label;
    descriptions.push(`${momentLabel} moves to ${target.label} (${window}).`);
    const replacement: ApprovedPlacement = { ...target, kind: "source", momentId: source.momentId,
      sourceStart: source.sourceStart, sourceEnd, songEnd, origin: "manual-match", reason: undefined };
    if (sourceEnd < source.sourceEnd - 1e-9) {
      trims.push({ momentId: source.momentId!, fromPlacementId: source.id, toPlacementId: target.id, sourceStart: sourceEnd, sourceEnd: source.sourceEnd });
      descriptions.push(`Trim ${seconds(source.sourceEnd - sourceEnd)} from its end; source ${seconds(sourceEnd)}–${seconds(source.sourceEnd)} stays in the library and will not play in this cut.`);
    }
    if (songEnd < target.songEnd) {
      const baseId = `${target.id}:swap-gap:${nextRevision}`;
      let id = baseId;
      for (let suffix = 1; reservedIds.has(id); suffix++) id = `${baseId}:${suffix}`;
      reservedIds.add(id);
      const gap: ApprovedPlacement = { ...target, id, kind: "gap", momentId: null,
        songStart: songEnd, sourceStart: 0, sourceEnd: target.songEnd - songEnd,
        origin: "manual-match", reason: "Moved clip is shorter than this song window" };
      residualGaps.push(gap);
      descriptions.push(`Leave an explicit ${seconds(target.songEnd - songEnd)} gap at ${seconds(songEnd)}–${seconds(target.songEnd)}.`);
      return [replacement, gap];
    }
    return [replacement];
  }
  const firstReplacements = move(second, first);
  const secondReplacements = replacementMoment ? [] : move(first, second);
  const placements = plan.placements.flatMap((placement) => placement.id === first.id ? firstReplacements : placement.id === second.id ? secondReplacements : [placement]);
  const afterInvalid = validatePlacements(project, { ...plan, placements });
  if (afterInvalid) return rejected(afterInvalid);
  const summary = `${descriptions.join(" ")} Song timing stays fixed.`;
  return { summary, proposal: {
    projectId: project.id, projectDuration: project.duration, inputSignature: plan.inputSignature, revision: plan.revision,
    planSnapshot: JSON.stringify(plan), firstPlacementId, secondPlacementId, replacementMomentId,
    before: structuredClone(replacementMoment ? [first] : [first, second]),
    after: structuredClone([...firstReplacements, ...secondReplacements]), trims, residualGaps: structuredClone(residualGaps), summary,
  } };
}

/** Apply only the reviewed proposal against precisely the same cut and story evidence. */
export function applyRoughCutSwap(project: MusicVideoProject, proposal: RoughCutSwapProposal): { project?: MusicVideoProject; reason?: string; summary: string } {
  const plan = project.placementPlan;
  if (!plan || project.id !== proposal.projectId || project.duration !== proposal.projectDuration
    || !isPlacementPlanCurrent(project) || plan.inputSignature !== proposal.inputSignature
    || plan.revision !== proposal.revision || JSON.stringify(plan) !== proposal.planSnapshot) {
    return rejected("The rough cut changed after this swap was proposed. Review a new swap before applying it.");
  }
  const checked = proposal.replacementMomentId === undefined
    ? proposeRoughCutSwap(project, proposal.firstPlacementId, proposal.secondPlacementId)
    : proposeRoughCutReplacement(project, proposal.firstPlacementId, proposal.replacementMomentId);
  if (!checked.proposal) return rejected(checked.reason ?? "This swap is no longer available.");
  if (JSON.stringify(checked.proposal) !== JSON.stringify(proposal)) return rejected("The swap proposal changed. Review a new proposal before applying it.");
  const placements = plan.placements.flatMap((placement) => {
    if (placement.id === proposal.firstPlacementId || placement.id === proposal.secondPlacementId) {
      return checked.proposal!.after.filter((replacement) => replacement.songStart >= placement.songStart && replacement.songEnd <= placement.songEnd);
    }
    return [placement];
  });
  const faithfulPlacementPlan = project.faithfulPlacementPlan?.inputSignature === plan.inputSignature
    ? project.faithfulPlacementPlan : plan.policy === "faithful" ? plan : undefined;
  return { summary: proposal.summary, project: { ...project, faithfulPlacementPlan,
    placementPlan: { ...plan, revision: plan.revision + 1, placements } } };
}
