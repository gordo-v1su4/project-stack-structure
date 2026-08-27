import { promoteReservedMoment, rankMomentsForSection, reserveSectionMoments, type SemanticEditAssignment, type SemanticSectionInput, type SemanticVideoMomentInput } from "./semanticEditPlanner";
import type { SrtChunk } from "./srtUtils";
import type { BeatJoinAnalysis, BeatJoinSection, DetectedSceneSegment, SceneVisualAnalysis, SegmentPreview, UploadedVideoSource } from "./types";

export interface StorySectionDraft {
  id?: string;
  label: string;
  prompt?: string;
  start?: number;
  end?: number;
  timingSource?: "analysis" | "manual";
  detectedLabel?: string;
}

export type StoryPlanDraft = StorySectionDraft & {
  id: string;
  prompt: string;
};

export interface StorySection extends BeatJoinSection {
  id: string;
  prompt: string;
  source: "analysis" | "manual" | "missing-analysis";
  lyricChunkIds: string[];
  videoMomentIds: string[];
  semanticMatch?: SemanticClipMatch;
  candidateMatches?: SemanticClipMatch[];
}

export interface LyricChunk extends SrtChunk {
  id: string;
  text: string;
  start: number;
  end: number;
}

export interface VideoMoment {
  id: string;
  sourceClipId: number;
  label: string;
  start: number;
  end: number;
  duration: number;
  thumbnailUrl?: string;
  firstFrameUrl?: string;
  middleFrameUrl?: string;
  lastFrameUrl?: string;
  storyboardUrl?: string;
  sourceRefLabel?: string;
  caption?: string;
  captionMeta?: DetectedSceneSegment["captionMeta"];
  motionDescriptor?: SegmentPreview["motionDescriptor"];
  visualAnalysis?: SceneVisualAnalysis;
  contentHash?: string;
  keyframeTimestamps?: number[];
  splitKind?: DetectedSceneSegment["splitKind"];
}

export interface SemanticClipMatch {
  momentId: string;
  score: number;
  semanticScore: number;
  lyricCaptionScore: number;
  actionIntentScore: number;
  durationFitScore: number;
  motionContinuityScore: number;
  motionEnergyScore: number;
  colorContinuityScore?: number;
  repetitionPenalty: number;
  reasons: string[];
}

export interface EditPlanPreviewSegment {
  videoUrl: string;
  startTime: number;
  endTime: number;
  label: string;
  sectionId: string;
  musicStart: number;
  musicEnd: number;
  momentId?: string;
  sourceClipId?: number;
  sourceRefLabel?: string;
  thumbnailUrl?: string;
}

export interface TimelineItem {
  id: string;
  sectionId: string;
  lyricChunkIds: string[];
  videoMomentId: string | null;
  start: number;
  end: number;
  label: string;
  prompt: string;
  semanticMatch?: SemanticClipMatch;
}

interface MusicCueWindow {
  start: number;
  end: number;
  cue: "section" | "beat" | "onset";
}

export interface StoryEditSettings {
  cutDensity: number;
  preferOnsets: boolean;
}

export const DEFAULT_STORY_EDIT_SETTINGS: StoryEditSettings = {
  cutDensity: 0.65,
  preferOnsets: true,
};

const MAX_SECTION_CANDIDATE_MATCHES = 6;

export interface EditPlan {
  id: string;
  timelineItems: TimelineItem[];
  createdAt: string;
}

export type ReviewFindingSeverity = "info" | "warning" | "error";

export interface ReviewFinding {
  id: string;
  severity: ReviewFindingSeverity;
  code: string;
  message: string;
  sectionId?: string;
}

export interface MusicVideoProject {
  id: string;
  song: BeatJoinAnalysis | null;
  duration: number;
  lyricChunks: LyricChunk[];
  storySections: StorySection[];
  videoMoments: VideoMoment[];
  editPlan: EditPlan;
  reviewFindings: ReviewFinding[];
}

const DEFAULT_SECTION_DRAFTS: StoryPlanDraft[] = [
  { id: "intro", label: "Intro", prompt: "Opening visual / establishing image" },
  { id: "verse-1", label: "Verse 1", prompt: "Main character, setting, or first visual idea" },
  { id: "pre-chorus-1", label: "Pre-Chorus", prompt: "Build tension before the first chorus; remove if the song has no pre-chorus" },
  { id: "chorus-1", label: "Chorus", prompt: "Main repeatable image, hook, or performance motif" },
  { id: "verse-2", label: "Verse 2", prompt: "Second verse development or new visual variation" },
  { id: "pre-chorus-2", label: "Pre-Chorus 2", prompt: "Second build before the chorus; remove if unused" },
  { id: "chorus-2", label: "Chorus 2", prompt: "Return to the main hook with a bigger or altered visual" },
  { id: "bridge", label: "Bridge", prompt: "Contrast section, breakdown, twist, or emotional turn" },
  { id: "outro", label: "Final Chorus / Outro", prompt: "Final chorus, outro, last image, or emotional landing" },
];

export function getDefaultStorySectionDrafts(): StoryPlanDraft[] {
  return DEFAULT_SECTION_DRAFTS.map((draft) => ({ ...draft }));
}

export function normalizeLyricChunks(chunks: SrtChunk[] = []): LyricChunk[] {
  return chunks
    .map((chunk, index) => {
      const start = roundTime(Math.max(0, Number(chunk.start) || 0));
      const minimumEnd = start + 0.25;
      const end = roundTime(Math.max(minimumEnd, Number(chunk.end) || minimumEnd));
      const text = cleanText(chunk.text ?? chunk.lyrics ?? "");
      return {
        ...chunk,
        id: `lyric-${String(chunk.index ?? index + 1).padStart(3, "0")}-${start.toFixed(2)}`,
        index: chunk.index ?? index + 1,
        start,
        end,
        text: text || "[instrumental]",
      } satisfies LyricChunk;
    })
    .filter((chunk) => chunk.end > chunk.start)
    .sort((left, right) => left.start - right.start || left.id.localeCompare(right.id));
}

export function buildStorySections(params: {
  analysis: BeatJoinAnalysis | null;
  duration: number;
  drafts?: StorySectionDraft[];
}): StorySection[] {
  const drafts = params.drafts?.length ? params.drafts : DEFAULT_SECTION_DRAFTS;
  const duration = Math.max(0, Number(params.duration) || params.analysis?.duration || 0);
  const analysisSections = normalizeAnalysisSections(params.analysis?.sections ?? [], duration);

  const explicitlyTimedDrafts = drafts.filter(hasExplicitStoryTiming);
  if (explicitlyTimedDrafts.length === drafts.length) {
    return explicitlyTimedDrafts.map((draft, index) => buildStorySection({
      draft,
      index,
      start: draft.start,
      end: draft.end,
      energy: findOverlappingAnalysisSection(analysisSections, draft.start, draft.end)?.energy,
      source: draft.timingSource ?? "manual",
    }));
  }

  if (explicitlyTimedDrafts.length) {
    return distributeStoryDraftsAcrossDuration(drafts, duration, analysisSections);
  }

  if (analysisSections.length) {
    return mapDetectedSectionsToStoryDrafts(analysisSections, drafts);
  }

  return drafts.map((draft, index) => {
    return buildStorySection({ draft, index, start: 0, end: 0, source: "missing-analysis" });
  });
}

function distributeStoryDraftsAcrossDuration(
  drafts: StorySectionDraft[],
  duration: number,
  analysisSections: BeatJoinSection[],
) {
  const sectionDuration = drafts.length > 0 ? duration / drafts.length : 0;
  return drafts.map((draft, index) => {
    const start = roundTime(sectionDuration * index);
    const end = index === drafts.length - 1 ? roundTime(duration) : roundTime(sectionDuration * (index + 1));
    return buildStorySection({
      draft,
      index,
      start,
      end,
      energy: findOverlappingAnalysisSection(analysisSections, start, end)?.energy,
      source: "manual",
    });
  });
}

type SongSectionRole = "intro" | "verse" | "pre-chorus" | "chorus" | "bridge" | "outro";

function mapDetectedSectionsToStoryDrafts(analysisSections: BeatJoinSection[], drafts: StorySectionDraft[]) {
  const roleCounts = new Map<SongSectionRole, number>();
  for (const section of analysisSections) {
    const role = getSongSectionRole(section.label);
    if (role) roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
  }

  const roleOccurrences = new Map<SongSectionRole, number>();
  let ambiguousPartIndex = 0;

  return analysisSections.map((analysisSection, index) => {
    const role = getSongSectionRole(analysisSection.label);
    if (!role) {
      const partLabel = `Part ${alphabeticIndex(ambiguousPartIndex)}`;
      ambiguousPartIndex += 1;
      return buildStorySection({
        draft: {
          id: `part-${ambiguousPartIndex}`,
          label: partLabel,
          prompt: "Describe the visual idea for this detected song part",
          detectedLabel: analysisSection.label,
        },
        index,
        start: analysisSection.start,
        end: analysisSection.end,
        energy: analysisSection.energy,
        source: "analysis",
      });
    }

    const occurrence = (roleOccurrences.get(role) ?? 0) + 1;
    roleOccurrences.set(role, occurrence);
    const matchingDrafts = drafts.filter((draft) => getSongSectionRole(draft.label) === role);
    const exactDraft = matchingDrafts[occurrence - 1];
    const matchedDraft = exactDraft ?? matchingDrafts.at(-1) ?? matchingDrafts[0];
    const label = formatDetectedRoleLabel(role, occurrence, roleCounts.get(role) ?? 1);
    return buildStorySection({
      draft: {
        ...matchedDraft,
        // A song can contain more repeated roles than the starter palette.
        // Never reuse a fallback template id or React/edit selection will
        // treat separate Verse/Chorus rows as the same section.
        id: exactDraft?.id ?? `${role}-${occurrence}`,
        label,
        detectedLabel: analysisSection.label,
      },
      index,
      start: analysisSection.start,
      end: analysisSection.end,
      energy: analysisSection.energy,
      source: "analysis",
    });
  });
}

function buildStorySection(params: {
  draft: StorySectionDraft;
  index: number;
  start: number;
  end: number;
  energy?: number;
  source: StorySection["source"];
}) {
  return {
    id: params.draft.id || slugify(params.draft.label, params.index),
    label: params.draft.label || `Section ${params.index + 1}`,
    prompt: params.draft.prompt || "Describe the visual idea for this song section",
    start: roundTime(params.start),
    end: roundTime(params.end),
    energy: params.energy,
    source: params.source,
    lyricChunkIds: [],
    videoMomentIds: [],
    candidateMatches: [],
  } satisfies StorySection;
}

function hasExplicitStoryTiming(draft: StorySectionDraft): draft is StorySectionDraft & { start: number; end: number } {
  return Number.isFinite(draft.start) && Number.isFinite(draft.end) && (draft.end ?? 0) > (draft.start ?? 0);
}

function findOverlappingAnalysisSection(sections: BeatJoinSection[], start: number, end: number) {
  return sections.find((section) => overlaps(section.start, section.end, start, end));
}

function getSongSectionRole(label: string): SongSectionRole | null {
  const normalized = label.toLowerCase().replace(/[_–—-]+/g, " ").replace(/\s+/g, " ").trim();
  if (/\bpre chorus\b/.test(normalized)) return "pre-chorus";
  if (/\bintro(?:duction)?\b/.test(normalized)) return "intro";
  if (/\bverse\b/.test(normalized)) return "verse";
  if (/\boutro\b/.test(normalized)) return "outro";
  if (/\bchorus\b/.test(normalized)) return "chorus";
  if (/\bbridge\b/.test(normalized)) return "bridge";
  return null;
}

function formatDetectedRoleLabel(role: SongSectionRole, occurrence: number, count: number) {
  const baseLabels: Record<SongSectionRole, string> = {
    intro: "Intro",
    verse: "Verse",
    "pre-chorus": "Pre-Chorus",
    chorus: "Chorus",
    bridge: "Bridge",
    outro: "Outro",
  };
  return count > 1 ? `${baseLabels[role]} ${occurrence}` : baseLabels[role];
}

function alphabeticIndex(index: number) {
  return String.fromCharCode(65 + (index % 26));
}

export function buildVideoMomentsFromStudioSources(params: {
  videoSources: UploadedVideoSource[];
  segmentPreviews?: SegmentPreview[];
}): VideoMoment[] {
  const sceneMoments = params.videoSources.flatMap((source) =>
    (source.scenes ?? [])
      .filter((scene) => scene.duration > 0 && scene.end > scene.start)
      .map((scene) => ({
        id: `scene-moment-${source.id}-${scene.id}`,
        sourceClipId: source.id,
        label: scene.caption || scene.label || source.name,
        start: roundTime(scene.start),
        end: roundTime(scene.end),
        duration: roundTime(scene.end - scene.start),
        thumbnailUrl: scene.thumbnailUrl ?? source.thumbnailUrl,
        firstFrameUrl: scene.firstFrameUrl,
        middleFrameUrl: scene.middleFrameUrl,
        lastFrameUrl: scene.lastFrameUrl,
        storyboardUrl: scene.storyboardUrl,
        sourceRefLabel: `S${source.id + 1} · ${scene.label}`,
        caption: scene.captionMeta?.caption ?? extractCaptionText(scene.caption),
        captionMeta: scene.captionMeta,
        motionDescriptor: scene.motionDescriptor ?? scene.visualAnalysis?.motion ?? undefined,
        visualAnalysis: scene.visualAnalysis,
        contentHash: scene.contentHash ?? scene.visualAnalysis?.contentHash,
        keyframeTimestamps: scene.keyframeTimestamps ?? scene.visualAnalysis?.keyframeTimestamps,
        splitKind: scene.splitKind,
      } satisfies VideoMoment)),
  );

  if (sceneMoments.length) return sceneMoments;

  const segmentMoments = (params.segmentPreviews ?? [])
    .filter((segment) => segment.duration > 0)
    .map((segment) => ({
      id: `segment-moment-${segment.clipId}`,
      sourceClipId: segment.sourceClipIds[0] ?? segment.clipId,
      label: segment.label,
      start: roundTime(segment.sourceStart ?? 0),
      end: roundTime(segment.sourceEnd ?? segment.duration),
      duration: roundTime((segment.sourceEnd ?? segment.duration) - (segment.sourceStart ?? 0)),
      thumbnailUrl: segment.thumbnailUrl,
      sourceRefLabel: segment.sourceRefLabel,
      caption: segment.sourceRefLabel,
      motionDescriptor: segment.motionDescriptor,
    } satisfies VideoMoment));

  if (segmentMoments.length) return segmentMoments;

  return [];
}


function extractCaptionText(value: string | undefined) {
  if (!value) return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{")) return value;
  try {
    const parsed = JSON.parse(trimmed) as { caption?: unknown };
    return typeof parsed.caption === "string" && parsed.caption.trim() ? parsed.caption : value;
  } catch {
    return value;
  }
}

export function mapLyricsToStorySections(sections: StorySection[], lyricChunks: LyricChunk[]): StorySection[] {
  return sections.map((section) => ({
    ...section,
    lyricChunkIds: lyricChunks
      .filter((chunk) => overlaps(section.start, section.end, chunk.start, chunk.end))
      .map((chunk) => chunk.id),
  }));
}

export function mapVideoMomentsToStorySections(sections: StorySection[], moments: VideoMoment[], lyricChunks: LyricChunk[] = []): StorySection[] {
  const lyricsById = new Map(lyricChunks.map((chunk) => [chunk.id, chunk]));
  const semanticSections = sections.map((section) => ({
      id: section.id,
      label: section.label,
      prompt: section.prompt,
      start: section.start,
      end: section.end,
      energy: section.energy,
      lyricTexts: section.lyricChunkIds.map((id) => lyricsById.get(id)?.text ?? "").filter(Boolean),
    }) satisfies SemanticSectionInput);
  const semanticMoments = moments.map((moment) => ({
      id: moment.id,
      sourceClipId: moment.sourceClipId,
      label: moment.label,
      start: moment.start,
      end: moment.end,
      duration: moment.duration,
      caption: moment.caption,
      subjects: moment.captionMeta?.subjects,
      action: moment.captionMeta?.action,
      setting: moment.captionMeta?.setting,
      shotType: moment.captionMeta?.shotType,
      motionDescriptor: moment.motionDescriptor ?? null,
      entryColor: getMomentPaletteColor(moment, "entry"),
      exitColor: getMomentPaletteColor(moment, "exit"),
    }) satisfies SemanticVideoMomentInput);
  const rankedBySection = rankSectionsWithContinuity(semanticSections, semanticMoments);

  return sections.map((section) => {
    const ranked = rankedBySection.get(section.id) ?? [];
    const assigned = ranked[0];
    const overlapping = moments.filter((moment) => overlaps(section.start, section.end, moment.start, moment.end));
    const rankedMomentIds = pickDiverseSectionMomentIds(ranked, section.end - section.start);
    const candidateMatches = ranked.slice(0, MAX_SECTION_CANDIDATE_MATCHES).map(toSemanticClipMatch);
    return {
      ...section,
      videoMomentIds: rankedMomentIds.length ? rankedMomentIds : overlapping.map((moment) => moment.id),
      semanticMatch: assigned ? toSemanticClipMatch(assigned) : undefined,
      candidateMatches,
    };
  });
}

export function buildDraftEditPlan(params: {
  sections: StorySection[];
  videoMoments: VideoMoment[];
  createdAt?: string;
}): EditPlan {
  const createdAt = params.createdAt ?? new Date().toISOString();
  const timelineItems = params.sections.map((section) => {
    const videoMomentId = section.videoMomentIds[0] ?? null;
    return {
      id: `timeline-${section.id}`,
      sectionId: section.id,
      lyricChunkIds: section.lyricChunkIds,
      videoMomentId,
      start: section.start,
      end: section.end,
      label: section.label,
      prompt: section.prompt,
      semanticMatch: section.semanticMatch,
    } satisfies TimelineItem;
  });

  return {
    id: `edit-plan-${createdAt}`,
    createdAt,
    timelineItems,
  };
}

export function createMusicVideoProject(params: {
  id?: string;
  analysis: BeatJoinAnalysis | null;
  duration: number;
  lyricChunks?: SrtChunk[];
  storyDrafts?: StorySectionDraft[];
  videoSources?: UploadedVideoSource[];
  segmentPreviews?: SegmentPreview[];
  createdAt?: string;
}): MusicVideoProject {
  const duration = Math.max(0, params.duration || params.analysis?.duration || 0);
  const lyricChunks = normalizeLyricChunks(params.lyricChunks ?? []);
  const videoMoments = buildVideoMomentsFromStudioSources({
    videoSources: params.videoSources ?? [],
    segmentPreviews: params.segmentPreviews ?? [],
  });
  const sectionsWithLyrics = mapLyricsToStorySections(
    buildStorySections({ analysis: params.analysis, duration, drafts: params.storyDrafts }),
    lyricChunks,
  );
  const storySections = mapVideoMomentsToStorySections(sectionsWithLyrics, videoMoments, lyricChunks);
  const editPlan = buildDraftEditPlan({
    sections: storySections,
    videoMoments,
    createdAt: params.createdAt,
  });
  const project: MusicVideoProject = {
    id: params.id ?? "music-video-project-draft",
    song: params.analysis,
    duration,
    lyricChunks,
    storySections,
    videoMoments,
    editPlan,
    reviewFindings: [],
  };

  return {
    ...project,
    reviewFindings: validateMusicVideoProject(project),
  };
}


export function buildEditPlanPreviewSegments(params: {
  project: MusicVideoProject | null;
  videoSources: UploadedVideoSource[];
  editSettings?: Partial<StoryEditSettings>;
}): EditPlanPreviewSegment[] {
  if (!params.project) return [];

  const project = params.project;
  const editSettings = normalizeStoryEditSettings(params.editSettings);
  const momentsById = new Map(project.videoMoments.map((moment) => [moment.id, moment]));
  const sectionsById = new Map(project.storySections.map((section) => [section.id, section]));
  const continuity: PreviewSequenceContinuity = {
    momentUseCounts: new Map(),
    sourceUseCounts: new Map(),
    recentMomentIds: [],
    lastMomentId: null,
    lastSourceClipId: null,
  };
  const segments: EditPlanPreviewSegment[] = [];

  for (const item of project.editPlan.timelineItems) {
    const section = sectionsById.get(item.sectionId);
    const candidateIds = uniqueStrings([
      ...(section?.videoMomentIds ?? []),
      ...(item.videoMomentId ? [item.videoMomentId] : []),
    ]);
    const candidates = candidateIds
      .map((momentId) => {
        const moment = momentsById.get(momentId);
        if (!moment) return null;
        const source = params.videoSources.find((candidate) => candidate.id === moment.sourceClipId);
        if (!source?.videoUrl) return null;
        return { moment, source };
      })
      .filter((candidate): candidate is { moment: VideoMoment; source: UploadedVideoSource } => candidate !== null);

    segments.push(...expandMomentsToSectionPreviewSegments({
      item,
      candidates,
      continuity,
      cutWindows: buildMusicCueWindows({
        item,
        analysis: project.song,
        section: section ?? null,
        editSettings,
      }),
    }));
  }

  return segments;
}

export function validateMusicVideoProject(project: MusicVideoProject): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  if (project.duration <= 0) {
    findings.push(buildFinding("error", "missing-duration", "Project duration is unknown; run Essentia before building a music-video plan."));
  }

  if (!project.song) {
    findings.push(buildFinding("error", "missing-song-analysis", "Missing Essentia song analysis; music-video planning is blocked."));
  }

  if (!project.song?.sections?.length) {
    findings.push(buildFinding("error", "missing-analysis-sections", "Essentia returned no section windows; refusing to synthesize fallback timing."));
  }

  if (!project.videoMoments.length) {
    findings.push(buildFinding("error", "missing-source-moments", "No detected scenes or segment previews are available; refusing to use whole-source fallback clips."));
  }

  for (const section of project.storySections) {
    if (section.end <= section.start) {
      findings.push(buildFinding("error", "invalid-section-window", `Section ${section.label} has an invalid time window.`, section.id));
    }
    if (!section.lyricChunkIds.length && project.lyricChunks.length > 0) {
      findings.push(buildFinding("info", "section-has-no-lyrics", `Section ${section.label} has no overlapping lyric chunk.`, section.id));
    }
    if (section.source === "missing-analysis") {
      findings.push(buildFinding("error", "section-missing-analysis-window", `Section ${section.label} has no Essentia analysis time window.`, section.id));
    }
    if (!section.videoMomentIds.length) {
      findings.push(buildFinding("error", "section-has-no-video-moment", `Section ${section.label} has no assigned detected video moment.`, section.id));
    }
  }

  if (!project.editPlan.timelineItems.length) {
    findings.push(buildFinding("error", "empty-edit-plan", "Draft edit plan has no timeline items."));
  }

  return findings;
}

function normalizeAnalysisSections(sections: BeatJoinSection[], duration: number) {
  return sections
    .filter((section) => Number.isFinite(section.start) && Number.isFinite(section.end) && section.end > section.start)
    .map((section) => ({
      ...section,
      start: roundTime(Math.max(0, section.start)),
      end: roundTime(duration > 0 ? Math.min(duration, section.end) : section.end),
    }))
    .filter((section) => section.end > section.start)
    .sort((left, right) => left.start - right.start);
}

function buildFinding(severity: ReviewFindingSeverity, code: string, message: string, sectionId?: string): ReviewFinding {
  return {
    id: sectionId ? `${code}:${sectionId}` : code,
    severity,
    code,
    message,
    sectionId,
  };
}

function toSemanticClipMatch(assignment: SemanticEditAssignment): SemanticClipMatch {
  return {
    momentId: assignment.momentId,
    score: assignment.score,
    semanticScore: assignment.semanticScore,
    lyricCaptionScore: assignment.lyricCaptionScore,
    actionIntentScore: assignment.actionIntentScore,
    durationFitScore: assignment.durationFitScore,
    motionContinuityScore: assignment.motionContinuityScore,
    motionEnergyScore: assignment.motionEnergyScore,
    colorContinuityScore: assignment.colorContinuityScore,
    repetitionPenalty: assignment.repetitionPenalty,
    reasons: assignment.reasons,
  };
}

function overlaps(leftStart: number, leftEnd: number, rightStart: number, rightEnd: number) {
  return leftStart < rightEnd && leftEnd > rightStart;
}

function getMomentPaletteColor(moment: VideoMoment, edge: "entry" | "exit"): [number, number, number] | null {
  const color = moment.visualAnalysis?.color;
  const palette = edge === "entry"
    ? color?.firstPalette ?? color?.middlePalette ?? color?.palette
    : color?.lastPalette ?? color?.middlePalette ?? color?.palette;
  const swatch = palette?.filter((candidate) => candidate.weight > 0).sort((left, right) => right.weight - left.weight)[0];
  if (!swatch?.hex) return null;
  const match = swatch.hex.trim().match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!match) return null;
  return [
    Number.parseInt(match[1]!, 16) / 255,
    Number.parseInt(match[2]!, 16) / 255,
    Number.parseInt(match[3]!, 16) / 255,
  ];
}

function cleanText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function slugify(label: string, index: number) {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug || `section-${index + 1}`;
}

function roundTime(value: number) {
  return Math.round(value * 1000) / 1000;
}

function rankSectionsWithContinuity(sections: SemanticSectionInput[], moments: SemanticVideoMomentInput[]) {
  const rankedBySection = new Map<string, SemanticEditAssignment[]>();
  const useCounts = new Map<string, number>();
  const reservations = reserveSectionMoments({ sections, moments });
  let previous: SemanticVideoMomentInput | null = null;

  for (const section of sections) {
    const ranked = promoteReservedMoment(
      rankMomentsForSection({ section, moments, previous, useCounts }),
      reservations.get(section.id),
    );
    rankedBySection.set(section.id, ranked);

    const best = ranked[0];
    if (best) {
      useCounts.set(best.moment.id, (useCounts.get(best.moment.id) ?? 0) + 1);
      previous = best.moment;
    }
  }

  return rankedBySection;
}

function pickDiverseSectionMomentIds(ranked: SemanticEditAssignment[], sectionDuration: number) {
  if (!ranked.length) return [];

  const targetCount = Math.min(ranked.length, Math.max(1, Math.min(8, Math.ceil(Math.max(0.05, sectionDuration) / 3))));
  const selected: SemanticEditAssignment[] = [ranked[0]!];
  const selectedIds = new Set([ranked[0]!.momentId]);
  const sourceCounts = new Map<number, number>([[ranked[0]!.moment.sourceClipId, 1]]);

  for (const candidate of ranked.slice(1)) {
    if (selected.length >= targetCount) break;
    if (selectedIds.has(candidate.momentId)) continue;
    if ((sourceCounts.get(candidate.moment.sourceClipId) ?? 0) > 0 && hasUnusedSource(ranked, sourceCounts, selectedIds)) continue;
    selected.push(candidate);
    selectedIds.add(candidate.momentId);
    sourceCounts.set(candidate.moment.sourceClipId, (sourceCounts.get(candidate.moment.sourceClipId) ?? 0) + 1);
  }

  for (const candidate of ranked.slice(1)) {
    if (selected.length >= targetCount) break;
    if (selectedIds.has(candidate.momentId)) continue;
    selected.push(candidate);
    selectedIds.add(candidate.momentId);
  }

  return selected.map((candidate) => candidate.momentId);
}

function hasUnusedSource(ranked: SemanticEditAssignment[], sourceCounts: Map<number, number>, selectedIds: Set<string>) {
  return ranked.some((candidate) => !selectedIds.has(candidate.momentId) && (sourceCounts.get(candidate.moment.sourceClipId) ?? 0) === 0);
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function buildMusicCueWindows(params: {
  item: TimelineItem;
  analysis: BeatJoinAnalysis | null;
  section: StorySection | null;
  editSettings: StoryEditSettings;
}): MusicCueWindow[] {
  const { item, analysis, section, editSettings } = params;
  const start = roundTime(Math.max(0, item.start));
  const end = roundTime(Math.max(start, item.end));
  const duration = roundTime(end - start);
  if (duration <= 0.05) return [];

  if (!analysis) return [];

  const energy = clamp01(section?.energy ?? sampleSeries(analysis.energy, analysis.duration, start + duration / 2) ?? 0.5);
  const beatInterval = medianInterval(uniqueSortedTimes(analysis.beats, Math.max(analysis.duration, end))) ?? Math.max(0.35, duration / 8);
  const density = clamp01(editSettings.cutDensity);
  const densityTargetDuration = lerp(4.2, 0.85, density);
  const energyMultiplier = lerp(1.2, 0.72, energy);
  const targetDuration = roundTime(Math.max(beatInterval, densityTargetDuration * energyMultiplier));
  const minDuration = roundTime(Math.max(0.42, Math.min(beatInterval * 0.9, targetDuration * 0.52)));
  const maxDuration = roundTime(Math.max(targetDuration * 1.45, minDuration + 0.25));

  const onsets = uniqueSortedTimes(analysis.onsets, Math.max(analysis.duration, end))
    .filter((time) => time > start + minDuration && time < end - minDuration);
  const beats = uniqueSortedTimes(analysis.beats, Math.max(analysis.duration, end))
    .filter((time) => time > start + minDuration && time < end - minDuration);
  const cueSource = editSettings.preferOnsets && onsets.length >= Math.max(2, Math.floor(duration / Math.max(targetDuration, 0.5)) - 1) ? onsets : beats;
  const cueKind: MusicCueWindow["cue"] = cueSource === onsets && onsets.length ? "onset" : cueSource.length ? "beat" : "section";

  if (!cueSource.length) return [{ start, end, cue: "section" }];

  const cutTimes = [start];
  let cursor = start;

  for (const cueTime of cueSource) {
    const elapsed = cueTime - cursor;
    if (elapsed < minDuration) continue;
    if (elapsed >= targetDuration || elapsed >= maxDuration) {
      cutTimes.push(roundTime(cueTime));
      cursor = cueTime;
    }
  }

  if (end - cursor < minDuration && cutTimes.length > 1) {
    cutTimes.pop();
  }
  cutTimes.push(end);

  return cutTimes
    .map((time, index, all) => {
      if (index === 0) return null;
      const previous = all[index - 1] ?? start;
      if (time - previous <= 0.05) return null;
      return { start: roundTime(previous), end: roundTime(time), cue: cueKind } satisfies MusicCueWindow;
    })
    .filter((window): window is MusicCueWindow => window !== null);
}

export function normalizeStoryEditSettings(settings?: Partial<StoryEditSettings>): StoryEditSettings {
  return {
    cutDensity: clamp01(Number.isFinite(settings?.cutDensity) ? Number(settings?.cutDensity) : DEFAULT_STORY_EDIT_SETTINGS.cutDensity),
    preferOnsets: settings?.preferOnsets ?? DEFAULT_STORY_EDIT_SETTINGS.preferOnsets,
  };
}

function expandMomentsToSectionPreviewSegments(params: {
  item: TimelineItem;
  candidates: Array<{ moment: VideoMoment; source: UploadedVideoSource }>;
  continuity: PreviewSequenceContinuity;
  cutWindows?: MusicCueWindow[];
}): EditPlanPreviewSegment[] {
  const { item } = params;
  const sectionDuration = Math.max(0, item.end - item.start);
  if (sectionDuration <= 0.05) return [];

  const candidates = params.candidates
    .map(({ moment, source }) => {
      const sourceDuration = Math.max(0, Number(source.duration) || 0);
      const momentStart = roundTime(Math.max(0, Math.min(sourceDuration, moment.start)));
      const momentEnd = roundTime(Math.max(momentStart, Math.min(sourceDuration, moment.end || momentStart + moment.duration)));
      const momentDuration = roundTime(momentEnd - momentStart);
      if (!source.videoUrl || momentDuration <= 0.05) return null;
      return { moment, source, momentStart, momentEnd, momentDuration };
    })
    .filter((candidate): candidate is {
      moment: VideoMoment;
      source: UploadedVideoSource;
      momentStart: number;
      momentEnd: number;
      momentDuration: number;
    } => candidate !== null);

  if (!candidates.length) return [];

  const segments: EditPlanPreviewSegment[] = [];

  const cutWindows = params.cutWindows?.length
    ? params.cutWindows
    : [{ start: item.start, end: item.end, cue: "section" } satisfies MusicCueWindow];
  const minCandidateDuration = Math.max(0.05, Math.min(...candidates.map((candidate) => candidate.momentDuration)));
  const maxSegmentsPerWindow = Math.max(1, Math.ceil(Math.max(...cutWindows.map((window) => window.end - window.start)) / minCandidateDuration) + candidates.length + 1);

  for (const window of cutWindows) {
    let musicCursor = window.start;
    let localLoopCount = 0;

    while (musicCursor < window.end - 0.025 && localLoopCount < maxSegmentsPerWindow) {
      const remaining = window.end - musicCursor;
      const candidate = pickPreviewCandidate({ candidates, remaining, continuity: params.continuity });
      const sliceDuration = roundTime(Math.min(candidate.momentDuration, remaining));
      const startTime = candidate.momentStart;
      const endTime = roundTime(Math.min(candidate.momentEnd, startTime + sliceDuration));
      if (endTime <= startTime) break;

      const musicStart = roundTime(musicCursor);
      const musicEnd = roundTime(Math.min(window.end, musicStart + (endTime - startTime)));
      if (musicEnd <= musicStart) break;

      const useCount = (params.continuity.momentUseCounts.get(candidate.moment.id) ?? 0) + 1;
      params.continuity.momentUseCounts.set(candidate.moment.id, useCount);
      params.continuity.sourceUseCounts.set(
        candidate.moment.sourceClipId,
        (params.continuity.sourceUseCounts.get(candidate.moment.sourceClipId) ?? 0) + 1,
      );
      params.continuity.recentMomentIds = [
        candidate.moment.id,
        ...params.continuity.recentMomentIds.filter((momentId) => momentId !== candidate.moment.id),
      ].slice(0, 4);
      params.continuity.lastMomentId = candidate.moment.id;
      params.continuity.lastSourceClipId = candidate.moment.sourceClipId;

      segments.push({
        videoUrl: candidate.source.videoUrl,
        startTime,
        endTime,
        sectionId: item.sectionId,
        musicStart,
        musicEnd,
        momentId: candidate.moment.id,
        sourceClipId: candidate.moment.sourceClipId,
        sourceRefLabel: candidate.moment.sourceRefLabel ?? `S${candidate.moment.sourceClipId + 1} · ${candidate.moment.label}`,
        thumbnailUrl: candidate.moment.firstFrameUrl ?? candidate.moment.thumbnailUrl ?? candidate.source.thumbnailUrl,
        label: buildPreviewSegmentLabel({
          sectionLabel: item.label,
          momentLabel: candidate.moment.label,
          cue: window.cue,
          useCount,
        }),
      });

      musicCursor = roundTime(musicEnd);
      localLoopCount += 1;
    }
  }

  return segments;
}

interface PreparedPreviewCandidate {
  moment: VideoMoment;
  source: UploadedVideoSource;
  momentStart: number;
  momentEnd: number;
  momentDuration: number;
}

interface PreviewSequenceContinuity {
  momentUseCounts: Map<string, number>;
  sourceUseCounts: Map<number, number>;
  recentMomentIds: string[];
  lastMomentId: string | null;
  lastSourceClipId: number | null;
}

/**
 * Picks the source moment for the next music window slice. A slice shorter
 * than the remaining window forces an extra cut at a non-musical position, so
 * moments that cover the window win first; among those, semantic rank (the
 * candidates array is already ranked) decides. Variety is tracked across the
 * complete edit, not reset per Story section, so a new verse cannot silently
 * restart the same shot cycle. Semantic candidates are already the top-ranked
 * matches for the section; within that set we prefer least-used moments and
 * sources while avoiding the shot that just played.
 */
function pickPreviewCandidate(params: {
  candidates: PreparedPreviewCandidate[];
  remaining: number;
  continuity: PreviewSequenceContinuity;
}): PreparedPreviewCandidate {
  const { candidates, remaining, continuity } = params;
  const pool = continuity.lastMomentId && candidates.length > 1
    ? candidates.filter((candidate) => candidate.moment.id !== continuity.lastMomentId)
    : candidates;

  const scored = pool.map((candidate) => ({
    candidate,
    rank: candidates.indexOf(candidate),
    covers: candidate.momentDuration >= remaining - 0.025,
    useCount: continuity.momentUseCounts.get(candidate.moment.id) ?? 0,
    sourceUseCount: continuity.sourceUseCounts.get(candidate.moment.sourceClipId) ?? 0,
    recentIndex: continuity.recentMomentIds.indexOf(candidate.moment.id),
    repeatsSource: continuity.lastSourceClipId === candidate.moment.sourceClipId,
  }));

  scored.sort((left, right) => {
    if (left.covers !== right.covers) return left.covers ? -1 : 1;
    if (!left.covers && left.candidate.momentDuration !== right.candidate.momentDuration) {
      // Nothing covers the window: the longest moment forces the fewest off-cue cuts.
      return right.candidate.momentDuration - left.candidate.momentDuration;
    }
    if (left.useCount !== right.useCount) return left.useCount - right.useCount;
    const leftRecent = left.recentIndex < 0 ? 0 : 4 - left.recentIndex;
    const rightRecent = right.recentIndex < 0 ? 0 : 4 - right.recentIndex;
    if (leftRecent !== rightRecent) return leftRecent - rightRecent;
    if (left.repeatsSource !== right.repeatsSource) return left.repeatsSource ? 1 : -1;
    if (left.sourceUseCount !== right.sourceUseCount) return left.sourceUseCount - right.sourceUseCount;
    return left.rank - right.rank;
  });

  return scored[0]!.candidate;
}

function buildPreviewSegmentLabel(params: {
  sectionLabel: string;
  momentLabel: string;
  cue: MusicCueWindow["cue"];
  useCount: number;
}) {
  const cueLabel = params.cue === "section" ? "" : ` · ${params.cue}`;
  const loopLabel = params.useCount === 1 ? "" : ` · loop ${params.useCount}`;
  return `${params.sectionLabel} · ${params.momentLabel}${cueLabel}${loopLabel}`;
}

function uniqueSortedTimes(values: number[] = [], duration: number) {
  return values
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= duration)
    .sort((left, right) => left - right)
    .filter((time, index, all) => index === 0 || Math.abs(time - all[index - 1]) > 0.015);
}

function medianInterval(values: number[]) {
  if (values.length < 2) return null;
  const intervals = values
    .slice(1)
    .map((time, index) => time - values[index])
    .filter((interval) => interval > 0.02);
  if (!intervals.length) return null;
  const sorted = [...intervals].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}

function sampleSeries(values: number[], duration: number, time: number) {
  if (!values.length || duration <= 0) return 0.5;
  const index = Math.min(values.length - 1, Math.max(0, Math.floor((time / duration) * (values.length - 1))));
  return clamp01(values[index] ?? 0.5);
}

function lerp(start: number, end: number, amount: number) {
  return start + (end - start) * amount;
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
