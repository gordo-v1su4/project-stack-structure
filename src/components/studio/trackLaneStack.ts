import type { MusicVideoProject, SemanticClipMatch, StorySection, TimelineItem, VideoMoment } from "./musicVideoProject";

export type FootageLaneRole = "performance" | "camera-a" | "camera-b" | "b-roll" | "generated" | "effects" | "unsorted";

export interface TrackLaneDefinition {
  role: FootageLaneRole;
  label: string;
  shortLabel: string;
  description: string;
  color: string;
  mutedColor: string;
  priority: number;
}

export interface FootageLaneInference {
  role: FootageLaneRole;
  confidence: number;
  reasons: string[];
}

export interface TrackLaneSection {
  id: string;
  label: string;
  start: number;
  end: number;
  selectedMomentId: string | null;
  lyricCount: number;
}

export interface TrackLaneBlock {
  id: string;
  role: FootageLaneRole;
  sectionId: string;
  sectionLabel: string;
  momentId: string;
  selected: boolean;
  rank: number;
  score: number;
  laneConfidence: number;
  laneReasons: string[];
  matchReasons: string[];
  start: number;
  end: number;
  sourceStart: number;
  sourceEnd: number;
  sourceClipId: number;
  sourceLabel: string;
  caption: string;
  title: string;
  thumbnailUrl?: string;
  headHandle: string;
  tailHandle: string;
  shuffleHint: string;
}

export interface TrackLaneRow {
  definition: TrackLaneDefinition;
  blocks: TrackLaneBlock[];
  selectedCount: number;
  backupCount: number;
  muted?: boolean;
  soloed?: boolean;
  collapsed?: boolean;
  hidden?: boolean;
}

export interface TrackLaneSummary {
  sectionCount: number;
  blockCount: number;
  selectedCount: number;
  backupCount: number;
  lowConfidenceCount: number;
  activeLaneCount: number;
}

export interface TrackLaneStack {
  sections: TrackLaneSection[];
  rows: TrackLaneRow[];
  summary: TrackLaneSummary;
  guidance: string;
}

export const TRACK_LANE_DEFINITIONS: TrackLaneDefinition[] = [
  {
    role: "performance",
    label: "Performance / lip-sync",
    shortLabel: "PERF",
    description: "Singer, performer, vocal, and lyric-facing takes. Favored when lyrics are active.",
    color: "#2f8a47",
    mutedColor: "#16351f",
    priority: 10,
  },
  {
    role: "camera-a",
    label: "Camera A / primary",
    shortLabel: "CAM A",
    description: "Main continuity angle for the section when the source reads like the primary take.",
    color: "#246b8f",
    mutedColor: "#123040",
    priority: 20,
  },
  {
    role: "camera-b",
    label: "Camera B / alt angle",
    shortLabel: "CAM B",
    description: "Alternate angle or backup take for repeated hooks, cutaways, and visual variation.",
    color: "#4e65b8",
    mutedColor: "#202a4e",
    priority: 30,
  },
  {
    role: "b-roll",
    label: "B-roll / cover",
    shortLabel: "B-ROLL",
    description: "Context, atmosphere, inserts, city motion, hands, crowds, and non-vocal cover footage.",
    color: "#9b6b22",
    mutedColor: "#3d2a10",
    priority: 40,
  },
  {
    role: "generated",
    label: "Generated fill",
    shortLabel: "GEN",
    description: "AI gap-fill, extensions, and proposed alternates that must be approved before Join.",
    color: "#7a3aa0",
    mutedColor: "#311740",
    priority: 50,
  },
  {
    role: "effects",
    label: "Effects / texture",
    shortLabel: "FX",
    description: "Glitch, abstract, light leaks, shader texture, and high-energy transition material.",
    color: "#b14d2c",
    mutedColor: "#431d12",
    priority: 60,
  },
  {
    role: "unsorted",
    label: "Unsorted review",
    shortLabel: "SORT",
    description: "Searchable fallback when the app cannot confidently understand the clip role yet.",
    color: "#626262",
    mutedColor: "#242424",
    priority: 70,
  },
];

const ROLE_BY_ID = new Map(TRACK_LANE_DEFINITIONS.map((definition) => [definition.role, definition]));

export function buildTrackLaneStack(params: {
  project: MusicVideoProject | null;
  sourceNameByClipId?: Map<number, string>;
}): TrackLaneStack {
  const { project, sourceNameByClipId = new Map<number, string>() } = params;
  const emptyRows = TRACK_LANE_DEFINITIONS.map((definition) => ({ definition, blocks: [], selectedCount: 0, backupCount: 0 }));
  if (!project) {
    return {
      sections: [],
      rows: emptyRows,
      summary: { sectionCount: 0, blockCount: 0, selectedCount: 0, backupCount: 0, lowConfidenceCount: 0, activeLaneCount: 0 },
      guidance: "Upload a song, create story sections, and caption clips to unlock the lane stack.",
    };
  }

  const momentsById = new Map(project.videoMoments.map((moment) => [moment.id, moment]));
  const sectionsById = new Map(project.storySections.map((section) => [section.id, section]));
  const rowsByRole = new Map<FootageLaneRole, TrackLaneRow>(
    TRACK_LANE_DEFINITIONS.map((definition) => [definition.role, { definition, blocks: [], selectedCount: 0, backupCount: 0 }]),
  );
  const sections = project.editPlan.timelineItems.map((item) => {
    const section = sectionsById.get(item.sectionId);
    return {
      id: item.sectionId,
      label: item.label,
      start: item.start,
      end: item.end,
      selectedMomentId: item.videoMomentId,
      lyricCount: section?.lyricChunkIds.length ?? item.lyricChunkIds.length,
    } satisfies TrackLaneSection;
  });

  for (const item of project.editPlan.timelineItems) {
    const section = sectionsById.get(item.sectionId);
    const candidates = getCandidateMatches(section, item);
    candidates.forEach((match, index) => {
      const moment = momentsById.get(match.momentId);
      if (!moment) return;
      const sourceName = sourceNameByClipId.get(moment.sourceClipId);
      const inference = inferFootageLane({ moment, sourceName, section, match });
      const selected = item.videoMomentId ? match.momentId === item.videoMomentId : match.momentId === section?.semanticMatch?.momentId;
      const block = buildLaneBlock({ item, section, moment, sourceName, match, rank: index + 1, selected, inference });
      const row = rowsByRole.get(block.role);
      if (!row) return;
      row.blocks.push(block);
      if (block.selected) row.selectedCount += 1;
      else row.backupCount += 1;
    });
  }

  const rows = TRACK_LANE_DEFINITIONS.map((definition) => {
    const row = rowsByRole.get(definition.role) ?? { definition, blocks: [], selectedCount: 0, backupCount: 0 };
    return {
      ...row,
      blocks: [...row.blocks].sort((left, right) => left.start - right.start || left.rank - right.rank),
    };
  });
  const blocks = rows.flatMap((row) => row.blocks);
  const activeLaneCount = rows.filter((row) => row.blocks.length > 0).length;

  return {
    sections,
    rows,
    summary: {
      sectionCount: sections.length,
      blockCount: blocks.length,
      selectedCount: blocks.filter((block) => block.selected).length,
      backupCount: blocks.filter((block) => !block.selected).length,
      lowConfidenceCount: blocks.filter((block) => block.laneConfidence < 0.55).length,
      activeLaneCount,
    },
    guidance: activeLaneCount
      ? "Use solo/mute to audition a role, then click a block to make that candidate the live Match choice for Join/export."
      : "Story slots exist, but no ranked video candidates are available yet. Caption clips first.",
  };
}

export function deriveVisibleTrackLaneRows(params: {
  rows: TrackLaneRow[];
  mutedRoles?: Set<FootageLaneRole>;
  soloRole?: FootageLaneRole | null;
  collapsedRoles?: Set<FootageLaneRole>;
}): TrackLaneRow[] {
  const { rows, mutedRoles = new Set<FootageLaneRole>(), soloRole = null, collapsedRoles = new Set<FootageLaneRole>() } = params;
  return rows.map((row) => {
    const soloed = soloRole === row.definition.role;
    const muted = Boolean(soloRole && !soloed) || (!soloRole && mutedRoles.has(row.definition.role));
    const collapsed = collapsedRoles.has(row.definition.role);
    return {
      ...row,
      muted,
      soloed,
      collapsed,
      hidden: false,
      blocks: collapsed ? collapseRowBlocks(row.blocks) : row.blocks,
    };
  });
}


function collapseRowBlocks(blocks: TrackLaneBlock[]) {
  const selected = blocks.filter((block) => block.selected);
  if (selected.length) return selected;
  return blocks.slice(0, 1);
}

export function inferFootageLane(input: {
  moment: VideoMoment;
  sourceName?: string;
  section?: StorySection;
  match?: SemanticClipMatch;
}): FootageLaneInference {
  const text = normalize([
    input.sourceName,
    input.moment.sourceRefLabel,
    input.moment.label,
    input.moment.caption,
    input.moment.captionMeta?.shotType,
    input.moment.captionMeta?.action,
    input.moment.captionMeta?.setting,
    ...(input.moment.captionMeta?.subjects ?? []),
  ].filter(Boolean).join(" "));
  const sectionText = normalize([input.section?.label, input.section?.prompt].filter(Boolean).join(" "));
  const scores = new Map<FootageLaneRole, { score: number; reasons: string[] }>(TRACK_LANE_DEFINITIONS.map((definition) => [definition.role, { score: 0.2, reasons: [] }]));

  addIf(scores, "generated", text, /\b(generated|ai|gen_|swarm|higgsfield|nano|synthetic|extension|extend)\b/, 0.62, "generated source language");
  addIf(scores, "effects", text, /\b(glitch|shader|effect|fx|texture|abstract|light leak|strobe|warp|distort|particles?)\b/, 0.62, "effects or texture language");
  addIf(scores, "performance", text, /\b(singer|singing|lip|lipsync|lip-sync|vocal|performer|performance|artist|rapper|frontman|microphone|close-up of a singer)\b/, 0.74, "performance or vocal subject");
  addIf(scores, "camera-a", text, /\b(camera a|cam a|a cam|a-cam|angle a|main cam|primary|hero take|master shot)\b/, 0.56, "primary camera label");
  addIf(scores, "camera-b", text, /\b(camera b|cam b|b cam|b-cam|angle b|alt angle|alternate|side angle|second angle|cutaway)\b/, 1, "alternate camera label");
  addIf(scores, "b-roll", text, /\b(b-roll|broll|insert|detail|establishing|street|city|crowd|hands|object|room|landscape|rain|lights|neon|alley|motion|dancers?)\b/, 0.5, "cover or atmosphere language");

  if (/\b(chorus|hook|verse|lyric|vocal|sing)\b/.test(sectionText)) {
    boost(scores, "performance", 0.12, "lyric section prefers performance");
  }
  if ((input.match?.score ?? 1) < 0.45) {
    boost(scores, "b-roll", 0.08, "weak match can be covered with B-roll");
    boost(scores, "generated", 0.05, "weak match may need generated fill");
  }
  if (!text.trim()) {
    boost(scores, "unsorted", 0.4, "missing caption/source text");
  }

  const ranked = [...scores.entries()].sort((left, right) => right[1].score - left[1].score || (ROLE_BY_ID.get(left[0])?.priority ?? 99) - (ROLE_BY_ID.get(right[0])?.priority ?? 99));
  const [role, result] = ranked[0] ?? ["unsorted", { score: 0.3, reasons: ["fallback"] }];
  const hasStrongReason = result.reasons.length > 0;
  return {
    role: hasStrongReason ? role : "unsorted",
    confidence: roundScore(hasStrongReason ? Math.min(0.98, result.score) : 0.34),
    reasons: hasStrongReason ? result.reasons.slice(0, 3) : ["verify role"],
  };
}

function getCandidateMatches(section: StorySection | undefined, item: TimelineItem): SemanticClipMatch[] {
  const candidates = section?.candidateMatches?.length ? section.candidateMatches : item.semanticMatch ? [item.semanticMatch] : [];
  if (!item.semanticMatch || candidates.some((candidate) => candidate.momentId === item.semanticMatch?.momentId)) return candidates;
  return [item.semanticMatch, ...candidates];
}

function buildLaneBlock(params: {
  item: TimelineItem;
  section?: StorySection;
  moment: VideoMoment;
  sourceName?: string;
  match: SemanticClipMatch;
  rank: number;
  selected: boolean;
  inference: FootageLaneInference;
}): TrackLaneBlock {
  const { item, section, moment, sourceName, match, rank, selected, inference } = params;
  const caption = moment.caption ?? moment.captionMeta?.action ?? moment.label;
  const sourceLabel = [moment.sourceRefLabel ?? `S${moment.sourceClipId + 1}`, sourceName].filter(Boolean).join(" · ");
  return {
    id: `${item.sectionId}-${moment.id}`,
    role: inference.role,
    sectionId: item.sectionId,
    sectionLabel: item.label,
    momentId: moment.id,
    selected,
    rank,
    score: match.score,
    laneConfidence: inference.confidence,
    laneReasons: inference.reasons,
    matchReasons: match.reasons,
    start: item.start,
    end: item.end,
    sourceStart: moment.start,
    sourceEnd: moment.end,
    sourceClipId: moment.sourceClipId,
    sourceLabel,
    caption,
    title: `${item.label} · ${caption}`,
    thumbnailUrl: moment.middleFrameUrl ?? moment.thumbnailUrl ?? moment.firstFrameUrl,
    headHandle: `${formatTime(moment.start)} ${moment.firstFrameUrl ? "head frame" : "head"}`,
    tailHandle: `${formatTime(moment.end)} ${moment.lastFrameUrl ? "tail frame" : "tail"}`,
    shuffleHint: buildShuffleHint({ role: inference.role, selected, rank, score: match.score, section, item }),
  };
}

function buildShuffleHint(params: { role: FootageLaneRole; selected: boolean; rank: number; score: number; section?: StorySection; item: TimelineItem }) {
  const lyricHeavy = (params.section?.lyricChunkIds.length ?? params.item.lyricChunkIds.length) > 0;
  const weak = params.score < 0.45;
  if (params.role === "performance") return lyricHeavy ? "Use for lip-sync/vocal focus; keep this lane visible on lyric-heavy sections." : "Performance take can anchor the section, then cut away to cover lanes.";
  if (params.role === "camera-a") return "Primary real angle: good continuity anchor before shuffling alternates under it.";
  if (params.role === "camera-b") return params.rank > 1 ? "Alt angle: shuffle in for repeated hooks or when Camera A repeats." : "Alternate angle is strong enough to become the live section choice.";
  if (params.role === "b-roll") return weak ? "Cover weak semantic moments or transition gaps without breaking the song grid." : "Use as visual cover between performance beats or for non-vocal phrases.";
  if (params.role === "generated") return "Generate/approve before Join; useful for missing, short, or weak real footage.";
  if (params.role === "effects") return "Texture lane: audition over cuts, drops, and transition tails rather than as the main shot.";
  return "Unsorted fallback: searchable, but verify the role before relying on this in the edit.";
}

function addIf(scores: Map<FootageLaneRole, { score: number; reasons: string[] }>, role: FootageLaneRole, text: string, pattern: RegExp, amount: number, reason: string) {
  if (!pattern.test(text)) return;
  boost(scores, role, amount, reason);
}

function boost(scores: Map<FootageLaneRole, { score: number; reasons: string[] }>, role: FootageLaneRole, amount: number, reason: string) {
  const current = scores.get(role);
  if (!current) return;
  current.score += amount;
  if (!current.reasons.includes(reason)) current.reasons.push(reason);
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[_-]/g, " ").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

function formatTime(value: number) {
  return `${value.toFixed(1)}s`;
}

function roundScore(value: number) {
  return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;
}
