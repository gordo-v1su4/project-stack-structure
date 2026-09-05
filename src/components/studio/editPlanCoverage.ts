import { resolveFitPolicy } from "./fitPolicy";
import type { MusicVideoProject, TimelineItem, VideoMoment } from "./musicVideoProject";

export const COVERAGE_WEAK_SCORE_THRESHOLD = 0.45;
export const COVERAGE_SHORT_DURATION_EPSILON = 0.5;

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
  /** True holes (missing primary match) — blocks Join */
  blockingGapCount: number;
  /** Purple short-source slots — optional review */
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
  moment: VideoMoment | undefined;
  requiredDuration: number;
  assignedDuration: number;
  availableDuration: number;
  score: number;
}): SlotStatus {
  const { moment, requiredDuration, assignedDuration, availableDuration, score } = params;
  if (!moment) return "missing";

  const missingDuration = Math.max(0, requiredDuration - assignedDuration);
  if (missingDuration <= COVERAGE_SHORT_DURATION_EPSILON) {
    return score < COVERAGE_WEAK_SCORE_THRESHOLD ? "weak" : "filled";
  }

  const fit = resolveFitPolicy({
    sourceDuration: availableDuration,
    targetDuration: requiredDuration,
    allowOverlap: false,
  });

  if (availableDuration < requiredDuration - COVERAGE_SHORT_DURATION_EPSILON && fit.decision === "reject") {
    return "short";
  }

  return score < COVERAGE_WEAK_SCORE_THRESHOLD ? "weak" : "filled";
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

export function buildCoverageSlots(project: MusicVideoProject | null, chunks: CoverageChunk[]): CoverageSlot[] {
  if (!project) return [];

  const momentsById = new Map(project.videoMoments.map((moment) => [moment.id, moment]));
  const itemsBySection = new Map(project.editPlan.timelineItems.map((item) => [item.sectionId, item]));
  const sourceItems = chunks.length
    ? chunks.map((chunk, index) => {
        const base = itemsBySection.get(chunk.sectionId)
          ?? project.editPlan.timelineItems.find((item) => item.start <= chunk.start && item.end >= chunk.end)
          ?? project.editPlan.timelineItems[0];
        return {
          ...(base ?? {
            id: `chunk-${chunk.id}`,
            sectionId: chunk.sectionId,
            lyricChunkIds: [],
            videoMomentId: null,
            start: chunk.start,
            end: chunk.end,
            label: chunk.sectionLabel,
            prompt: "No story prompt is attached to this adaptive chunk.",
          }),
          id: `chunk-${chunk.id}`,
          sectionId: chunk.sectionId,
          start: chunk.start,
          end: chunk.end,
          label: `${chunk.sectionLabel} · C${String(index + 1).padStart(2, "0")}`,
        } satisfies TimelineItem;
      })
    : project.editPlan.timelineItems;

  return sourceItems.map((item) => {
    const moment = item.videoMomentId ? momentsById.get(item.videoMomentId) : undefined;
    const requiredDuration = Math.max(0, item.end - item.start);
    const score = item.semanticMatch?.score ?? 0;
    const availableDuration = moment?.duration ?? 0;
    const assignedDuration = moment ? Math.min(requiredDuration, availableDuration) : 0;
    const missingDuration = Math.max(0, requiredDuration - assignedDuration);
    const status = classifySlotStatus({ moment, requiredDuration, assignedDuration, availableDuration, score });
    const needs = deriveGenerationNeeds(status, requiredDuration, availableDuration);

    return { item, moment, requiredDuration, assignedDuration, missingDuration, score, status, needs };
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
  const blockingGapCount = slots.filter((slot) => slot.status === "missing").length;
  const shortReviewCount = slots.filter((slot) => slot.status === "short").length;
  const reviewCount = slots.filter((slot) => slot.status === "weak").length;
  const reviewSectionCount = new Set(slots.filter((slot) => slot.status === "weak").map((slot) => slot.item.sectionId)).size;

  return {
    requiredDuration,
    assignedDuration,
    trueGapDuration,
    strongMatchDuration,
    weakMatchDuration,
    coveragePct,
    strongMatchPct,
    duration,
    blockingGapCount,
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
    return `No source scene is assigned from ${formatCoverageTime(issue.start)} to ${formatCoverageTime(issue.end)}. This is a true gap and must be filled before Join.`;
  }
  if (issue.status === "short") {
    return `The assigned source covers ${formatCoverageTime(issue.assignedDuration)} of ${formatCoverageTime(issue.requiredDuration)}, leaving ${formatCoverageTime(issue.missingDuration)} uncovered. Inspect the resolved edit and, if needed, regenerate the whole shot with handles.`;
  }
  return `This Story section's selected match scores ${Math.round(issue.score * 100)}%, below the 45% review threshold. All ${issue.slots.length} chunks contain real footage, so generation is optional.`;
}

export function analyzeEditPlanCoverage(project: MusicVideoProject | null, chunks: CoverageChunk[] = []): EditPlanCoverageAnalysis {
  const slots = buildCoverageSlots(project, chunks);
  const summary = summarizeCoverage(slots, chunks[chunks.length - 1]?.end ?? 0);
  const timelineItems = project?.editPlan.timelineItems ?? [];

  return {
    slots,
    summary,
    trueGapCount: summary.blockingGapCount,
    shortReviewCount: summary.shortReviewCount,
    weakReviewCount: summary.reviewCount,
    matchedSlotCount: timelineItems.filter((item) => item.videoMomentId).length,
    editSlotCount: timelineItems.length,
  };
}

function formatCoverageTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}
