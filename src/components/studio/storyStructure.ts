import type { StoryPlanDraft, StorySection } from "./musicVideoProject";

const STORY_ROLE_ORDER = [
  "intro",
  "verse-1",
  "pre-chorus-1",
  "chorus-1",
  "verse-2",
  "pre-chorus-2",
  "chorus-2",
  "bridge",
  "outro",
] as const;

export function toTimedStoryDrafts(sections: StorySection[]): StoryPlanDraft[] {
  return sections.map((section) => ({
    id: section.id,
    label: section.label,
    prompt: section.prompt,
    start: section.start,
    end: section.end,
    timingSource: section.source === "manual" ? "manual" : "analysis",
  }));
}

export function splitStorySectionWithTemplate(params: {
  drafts: StoryPlanDraft[];
  activeId: string;
  template: StoryPlanDraft;
  cueTimes: number[];
}): StoryPlanDraft[] {
  const activeIndex = params.drafts.findIndex((draft) => draft.id === params.activeId);
  const active = params.drafts[activeIndex];
  if (!active || !hasTiming(active) || params.drafts.some((draft) => draft.id === params.template.id)) return params.drafts;

  const splitTime = findSplitTime(active.start, active.end, params.cueTimes);
  if (splitTime === null) return params.drafts;
  const current = { ...active, end: splitTime, timingSource: "manual" as const };
  const inserted = {
    ...params.template,
    start: splitTime,
    end: active.end,
    timingSource: "manual" as const,
  };

  return [
    ...params.drafts.slice(0, activeIndex),
    current,
    inserted,
    ...params.drafts.slice(activeIndex + 1),
  ];
}

export function insertStoryTemplateInSongOrder(params: {
  drafts: StoryPlanDraft[];
  template: StoryPlanDraft;
  cueTimes: number[];
}): StoryPlanDraft[] {
  const templateOrder = STORY_ROLE_ORDER.indexOf(params.template.id as (typeof STORY_ROLE_ORDER)[number]);
  if (templateOrder < 0 || params.drafts.some((draft) => draft.id === params.template.id)) return params.drafts;

  const knownRoles = params.drafts
    .map((draft, index) => ({ index, order: getStoryRoleOrder(draft.id) }))
    .filter((entry) => entry.order >= 0);
  const nextRole = knownRoles.find((entry) => entry.order > templateOrder);
  const previousRole = knownRoles.findLast((entry) => entry.order < templateOrder);

  if (!knownRoles.length) {
    const targetIndex = templateOrder === 0
      ? 0
      : Math.min(params.drafts.length - 1, Math.floor((templateOrder / (STORY_ROLE_ORDER.length - 1)) * params.drafts.length));
    if (templateOrder === 0) {
      return splitStorySectionBeforeTemplate({ ...params, activeIndex: targetIndex });
    }
    const target = params.drafts[targetIndex];
    return target
      ? splitStorySectionWithTemplate({ ...params, activeId: target.id })
      : params.drafts;
  }

  if (!previousRole && nextRole) {
    return splitStorySectionBeforeTemplate({ ...params, activeIndex: 0 });
  }

  if (!nextRole) {
    const last = params.drafts.at(-1);
    return last
      ? splitStorySectionWithTemplate({ ...params, activeId: last.id })
      : params.drafts;
  }

  const anchor = previousRole ? params.drafts[previousRole.index] : undefined;

  if (anchor) {
    const inserted = splitStorySectionWithTemplate({
      drafts: params.drafts,
      activeId: anchor.id,
      template: params.template,
      cueTimes: params.cueTimes,
    });
    if (inserted !== params.drafts) return inserted;
  }

  const next = params.drafts[nextRole.index];
  if (!next || !hasTiming(next)) return params.drafts;
  return splitStorySectionBeforeTemplate({
    drafts: params.drafts,
    activeIndex: nextRole.index,
    template: params.template,
    cueTimes: params.cueTimes,
  });
}

function getStoryRoleOrder(id: string) {
  return STORY_ROLE_ORDER.indexOf(id as (typeof STORY_ROLE_ORDER)[number]);
}

export function moveStorySectionBoundary(params: {
  drafts: StoryPlanDraft[];
  boundaryIndex: number;
  time: number;
}): StoryPlanDraft[] {
  const left = params.drafts[params.boundaryIndex];
  const right = params.drafts[params.boundaryIndex + 1];
  if (!left || !right || !hasTiming(left) || !hasTiming(right)) return params.drafts;

  const minimumDuration = Math.min(1, (right.end - left.start) / 3);
  const boundary = roundTime(Math.min(right.end - minimumDuration, Math.max(left.start + minimumDuration, params.time)));
  return params.drafts.map((draft, index) => {
    if (index === params.boundaryIndex) return { ...draft, end: boundary, timingSource: "manual" };
    if (index === params.boundaryIndex + 1) return { ...draft, start: boundary, timingSource: "manual" };
    return draft;
  });
}

export function removeTimedStorySection(drafts: StoryPlanDraft[], id: string): StoryPlanDraft[] {
  const removedIndex = drafts.findIndex((draft) => draft.id === id);
  const removed = drafts[removedIndex];
  if (!removed || !hasTiming(removed) || drafts.length <= 1) return drafts;

  return drafts.flatMap((draft, index) => {
    if (index === removedIndex) return [];
    if (removedIndex > 0 && index === removedIndex - 1) {
      return [{ ...draft, end: removed.end, timingSource: "manual" as const }];
    }
    if (removedIndex === 0 && index === 1) {
      return [{ ...draft, start: removed.start, timingSource: "manual" as const }];
    }
    return [draft];
  });
}

function hasTiming(draft: StoryPlanDraft): draft is StoryPlanDraft & { start: number; end: number } {
  return Number.isFinite(draft.start) && Number.isFinite(draft.end) && (draft.end ?? 0) > (draft.start ?? 0);
}

function splitStorySectionBeforeTemplate(params: {
  drafts: StoryPlanDraft[];
  activeIndex: number;
  template: StoryPlanDraft;
  cueTimes: number[];
}): StoryPlanDraft[] {
  const active = params.drafts[params.activeIndex];
  if (!active || !hasTiming(active)) return params.drafts;

  const splitTime = findSplitTime(active.start, active.end, params.cueTimes);
  if (splitTime === null) return params.drafts;
  const inserted = { ...params.template, start: active.start, end: splitTime, timingSource: "manual" as const };
  const current = { ...active, start: splitTime, timingSource: "manual" as const };
  return [
    ...params.drafts.slice(0, params.activeIndex),
    inserted,
    current,
    ...params.drafts.slice(params.activeIndex + 1),
  ];
}

function findSplitTime(start: number, end: number, cueTimes: number[]) {
  const minimumDuration = Math.min(1, (end - start) / 3);
  const earliestSplit = start + minimumDuration;
  const latestSplit = end - minimumDuration;
  if (latestSplit <= earliestSplit) return null;

  const midpoint = start + (end - start) / 2;
  const nearestCue = cueTimes
    .filter((time) => time >= earliestSplit && time <= latestSplit)
    .sort((left, right) => Math.abs(left - midpoint) - Math.abs(right - midpoint))[0];
  return roundTime(nearestCue ?? midpoint);
}

function roundTime(value: number) {
  return Math.round(value * 100) / 100;
}
