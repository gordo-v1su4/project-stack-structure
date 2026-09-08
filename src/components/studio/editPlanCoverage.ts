import { assessStoryMatch, isUsableStoryMatch, type MatchAssessment } from "./storyMatchAssessment";
import type { GeneratedStudioAsset } from "./generatedAssets";
import { generatedAssetWindow, listApprovedGeneratedVideoAssets } from "./generatedAssets";
import { isPlacementPlanCurrent, type MusicVideoProject, type TimelineItem, type VideoMoment } from "./musicVideoProject";

export const COVERAGE_WEAK_SCORE_THRESHOLD = 0.45;
export const COVERAGE_SHORT_DURATION_EPSILON = 0.05;

export type SlotStatus = "filled" | "weak" | "short" | "missing";
export type GenerationNeed = "b-roll" | "alt-angle" | "extend-start" | "extend-end" | "bridge" | "reroll-match";

export type CoverageChunk = {
  id: string;
  sectionId: string;
  sectionLabel: string;
  start: number;
  end: number;
  strength: number;
  cueCount: number;
};

export type CoverageSlot = {
  item: TimelineItem;
  moment?: VideoMoment;
  requiredDuration: number;
  assignedDuration: number;
  missingDuration: number;
  score: number;
  status: SlotStatus;
  needs: GenerationNeed[];
  semanticStatus?: "supported" | "uncertain" | "missing";
  gapKind?: "semantic" | "duration";
  assessment?: MatchAssessment;
};

export type CoverageIssueGroup = {
  id: string;
  status: Exclude<SlotStatus, "filled">;
  sectionId: string;
  sectionLabel: string;
  slots: CoverageSlot[];
  start: number;
  end: number;
  requiredDuration: number;
  assignedDuration: number;
  missingDuration: number;
  score: number;
  moment?: VideoMoment;
  needs: GenerationNeed[];
};

export type CoverageSummary = {
  requiredDuration: number;
  assignedDuration: number;
  trueGapDuration: number;
  strongMatchDuration: number;
  weakMatchDuration: number;
  coveragePct: number;
  strongMatchPct: number;
  duration: number;
  semanticGapDuration: number;
  durationGapDuration: number;
  /** Uncovered media duration — blocks final readiness; semantic fit is advisory */
  blockingGapCount: number;
  /** All uncovered required duration */
  blockingGapDuration: number;
  /** Insufficient usable source duration */
  shortReviewCount: number;
  /** @deprecated Use blockingGapCount — kept for gradual UI migration */
  requiredNeedCount: number;
  reviewCount: number;
  reviewSectionCount: number;
};

export type EditPlanCoverageAnalysis = {
  slots: CoverageSlot[];
  summary: CoverageSummary;
  trueGapCount: number;
  shortReviewCount: number;
  weakReviewCount: number;
  matchedSlotCount: number;
  editSlotCount: number;
};

function classifySlotStatus(params: {
  supported: boolean; requiredDuration: number; assignedDuration: number; score: number;
}): SlotStatus {
  if (!params.supported) return "missing";
  if (params.requiredDuration - params.assignedDuration > COVERAGE_SHORT_DURATION_EPSILON) return "short";
  return params.score < COVERAGE_WEAK_SCORE_THRESHOLD ? "weak" : "filled";
}

function deriveGenerationNeeds(status: SlotStatus, requiredDuration: number, availableDuration: number): GenerationNeed[] {
  if (status === "missing") return ["b-roll", "alt-angle"];
  if (status === "weak") return ["reroll-match", "alt-angle"];
  if (status === "short") {
    const needs: GenerationNeed[] = ["extend-end"];
    if (requiredDuration - availableDuration > 4) needs.push("extend-start", "bridge");
    return needs;
  }
  if (requiredDuration > 8) return ["alt-angle"];
  return [];
}

export function buildCoverageSlots(
  project: MusicVideoProject | null,
  chunks: CoverageChunk[],
  approvedReplacements: GeneratedStudioAsset[] = [],
): CoverageSlot[] {
  if (!project) return [];

  const approvedVideos = listApprovedGeneratedVideoAssets(approvedReplacements);

  const momentsById = new Map(project.videoMoments.map((moment) => [moment.id, moment]));
  const originalItemIds = new Map<string, string>();
  const sourceItems = chunks.length
    ? chunks.flatMap((chunk, index) => {
      const overlaps = project.editPlan.timelineItems.filter((item) => item.sectionId === chunk.sectionId && item.start < chunk.end && item.end > chunk.start);
      if (!overlaps.length) return [{ id: `chunk-${chunk.id}`, sectionId: chunk.sectionId, lyricChunkIds: [], videoMomentId: null,
        start: chunk.start, end: chunk.end, label: chunk.sectionLabel, prompt: "No story requirement is attached to this music window." } satisfies TimelineItem];
      return overlaps.map((base) => {
        const id = `chunk-${chunk.id}:${base.id}`;
        originalItemIds.set(id, base.id);
        return { ...base, id,
        start: Math.max(chunk.start, base.start), end: Math.min(chunk.end, base.end),
        label: `${base.label} · C${String(index + 1).padStart(2, "0")}` } satisfies TimelineItem; });
    })
    : project.editPlan.timelineItems;

  const consumed = new Map<string, number>();
  return sourceItems.map((item) => {
    const moment = item.videoMomentId ? momentsById.get(item.videoMomentId) : undefined;
    const requiredDuration = Math.max(0, item.end - item.start);
    const assess = (source: VideoMoment) => assessStoryMatch({
      requirementId: item.requirementId ?? item.id, requirementText: item.prompt, constraints: item.requirements,
      moment: { ...source, subjects: source.captionMeta?.subjects, action: source.captionMeta?.action,
        setting: source.captionMeta?.setting, shotType: source.captionMeta?.shotType },
    });
    let assessment = moment ? assess(moment) : undefined;
    let score = item.semanticMatch?.score ?? 0;
    const stalePlacements = project.placementPlan && !isPlacementPlanCurrent(project);
    const placements = stalePlacements ? [] : project.placementPlan?.placements.filter((placement) =>
      placement.timelineItemId === (originalItemIds.get(item.id) ?? item.id) && placement.sectionId === item.sectionId && placement.songStart < item.end && placement.songEnd > item.start);
    let supported = !stalePlacements && isUsableStoryMatch(assessment);
    let assignedDuration = 0;
    const intervals: Array<[number, number]> = [];
    if (placements) {
      const placedAssessments: MatchAssessment[] = [];
      for (const placement of placements) {
        if (placement.kind !== "source" || !placement.momentId) continue;
        const source = momentsById.get(placement.momentId);
        const placedAssessment = source ? assess(source) : undefined;
        if (!source || !isUsableStoryMatch(placedAssessment)) continue;
        placedAssessments.push(placedAssessment!);
        supported = true;
        intervals.push([Math.max(item.start, placement.songStart), Math.min(item.end, placement.songEnd)]);
      }
      assessment = placedAssessments.find(value => value.eligibility === "ineligible")
        ?? placedAssessments.find(value => value.eligibility === "uncertain") ?? placedAssessments[0] ?? assessment;
    } else if (moment && supported) {
      const available = Math.max(0, moment.duration - (consumed.get(moment.id) ?? 0));
      assignedDuration = Math.min(requiredDuration, available);
      consumed.set(moment.id, (consumed.get(moment.id) ?? 0) + assignedDuration);
      intervals.push([item.start, item.start + assignedDuration]);
    }
    const planSignature = project.placementPlan && !stalePlacements ? project.placementPlan.inputSignature : undefined;
    for (const asset of approvedVideos) {
      const window = generatedAssetWindow(asset, { planSignature, requirementId: item.requirementId,
        timelineItemId: originalItemIds.get(item.id) ?? item.id, sectionId: item.sectionId,
        songStart: item.start, songEnd: item.end });
      if (!window) continue;
      intervals.push([window.songStart, window.songEnd]);
      supported = true;
      score = Math.max(score, 1);
    }
    // Source and generated windows can overlap; coverage counts each song second once.
    assignedDuration = 0;
    let coveredEnd = item.start;
    for (const [start, end] of intervals.sort((a, b) => a[0] - b[0])) {
      assignedDuration += Math.max(0, end - Math.max(start, coveredEnd));
      coveredEnd = Math.max(coveredEnd, end);
    }
    const missingDuration = Math.max(0, requiredDuration - assignedDuration);
    const status = classifySlotStatus({ supported, requiredDuration, assignedDuration, score: assessment && assessment.eligibility !== "eligible" ? Math.min(score, COVERAGE_WEAK_SCORE_THRESHOLD - 0.01) : score });
    const needs = deriveGenerationNeeds(status, requiredDuration, assignedDuration);
    return { item, moment, requiredDuration, assignedDuration, missingDuration, score, status, needs, assessment,
      semanticStatus: assessment?.eligibility === "eligible" ? "supported" as const : assessment ? "uncertain" as const : "missing" as const,
      gapKind: status === "missing" ? "semantic" as const : status === "short" ? "duration" as const : undefined };
  });
}

export function summarizeCoverage(slots: CoverageSlot[], cueDuration = 0): CoverageSummary {
  const requiredDuration = slots.reduce((total, slot) => total + slot.requiredDuration, 0);
  const assignedDuration = slots.reduce((total, slot) => total + slot.assignedDuration, 0);
  const trueGapDuration = slots.reduce((total, slot) => total + slot.missingDuration, 0);
  const strongMatchDuration = slots.reduce((total, slot) => total + (slot.status === "filled" ? slot.assignedDuration : 0), 0);
  const weakMatchDuration = slots.reduce((total, slot) => total + (slot.status === "weak" ? slot.assignedDuration : 0), 0);
  const coveragePct = requiredDuration > 0 ? Math.round((assignedDuration / requiredDuration) * 100) : 0;
  const strongMatchPct = requiredDuration > 0 ? Math.round((strongMatchDuration / requiredDuration) * 100) : 0;
  const duration = Math.max(cueDuration, slots[slots.length - 1]?.item.end ?? 0, requiredDuration, 1);
  const blockingGapCount = slots.filter((slot) => slot.status === "missing" || slot.status === "short").length;
  const blockingGapDuration = slots
    .filter((slot) => slot.status === "missing" || slot.status === "short")
    .reduce((total, slot) => total + slot.missingDuration, 0);
  const shortReviewCount = slots.filter((slot) => slot.status === "short").length;
  const reviewCount = slots.filter((slot) => slot.status === "weak").length;
  const reviewSectionCount = new Set(slots.filter((slot) => slot.status === "weak").map((slot) => slot.item.sectionId)).size;

  return {
    requiredDuration,
    assignedDuration,
    semanticGapDuration: slots.filter((slot) => slot.status === "missing").reduce((total, slot) => total + slot.missingDuration, 0),
    durationGapDuration: slots.filter((slot) => slot.status === "short").reduce((total, slot) => total + slot.missingDuration, 0),
    trueGapDuration,
    strongMatchDuration,
    weakMatchDuration,
    coveragePct,
    strongMatchPct,
    duration,
    blockingGapCount,
    blockingGapDuration,
    shortReviewCount,
    requiredNeedCount: blockingGapCount,
    reviewCount,
    reviewSectionCount,
  };
}

export function buildCoverageIssueGroups(slots: CoverageSlot[]): CoverageIssueGroup[] {
  const issueSlots = slots
    .filter((slot): slot is CoverageSlot & { status: Exclude<SlotStatus, "filled"> } => slot.status !== "filled")
    .sort((left, right) => left.item.start - right.item.start || left.item.end - right.item.end);
  const groups: CoverageIssueGroup[] = [];

  for (const slot of issueSlots) {
    const previous = groups[groups.length - 1];
    const canMerge = Boolean(
      previous
      && previous.status === slot.status
      && previous.sectionId === slot.item.sectionId
      && previous.moment?.id === slot.moment?.id
      && Math.abs(previous.end - slot.item.start) <= 0.05,
    );

    if (previous && canMerge) {
      previous.slots.push(slot);
      previous.end = slot.item.end;
      previous.requiredDuration += slot.requiredDuration;
      previous.assignedDuration += slot.assignedDuration;
      previous.missingDuration += slot.missingDuration;
      previous.needs = [...new Set([...previous.needs, ...slot.needs])];
      continue;
    }

    groups.push({
      id: `coverage-issue-${slot.item.id}`,
      status: slot.status,
      sectionId: slot.item.sectionId,
      sectionLabel: slot.item.label.replace(/\s*·\s*C\d+$/i, ""),
      slots: [slot],
      start: slot.item.start,
      end: slot.item.end,
      requiredDuration: slot.requiredDuration,
      assignedDuration: slot.assignedDuration,
      missingDuration: slot.missingDuration,
      score: slot.score,
      moment: slot.moment,
      needs: [...slot.needs],
    });
  }

  return groups;
}

export function describeCoverageIssue(issue: CoverageIssueGroup) {
  if (issue.status === "missing") {
    return `No supported source scene covers ${formatCoverageTime(issue.start)} to ${formatCoverageTime(issue.end)}. Review the required visual and its evidence, or plan generation. This gap remains in the draft.`;
  }
  if (issue.status === "short") {
    return `The assigned source covers ${formatCoverageTime(issue.assignedDuration)} of ${formatCoverageTime(issue.requiredDuration)}, leaving ${formatCoverageTime(issue.missingDuration)} uncovered. The faithful draft retains this duration gap. Add eligible footage or explicitly review reuse before final export.`;
  }
  return `The required visual is supported, but this match is weaker in editorial ranking. Review the evidence and composition; the score is a ranking signal, not a calibrated probability.`;
}

export function analyzeEditPlanCoverage(
  project: MusicVideoProject | null,
  chunks: CoverageChunk[] = [],
  approvedReplacements: GeneratedStudioAsset[] = [],
): EditPlanCoverageAnalysis {
  const slots = buildCoverageSlots(project, chunks, approvedReplacements);
  const summary = summarizeCoverage(slots, chunks[chunks.length - 1]?.end ?? 0);
  const timelineItems = project?.editPlan.timelineItems ?? [];
  return {
    slots,
    summary,
    trueGapCount: summary.blockingGapCount,
    shortReviewCount: summary.shortReviewCount,
    weakReviewCount: summary.reviewCount,
    matchedSlotCount: slots.filter((slot) => slot.semanticStatus === "supported").length,
    editSlotCount: timelineItems.length,
  };
}

function formatCoverageTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}
