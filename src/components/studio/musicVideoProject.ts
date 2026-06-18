import type { SrtChunk } from "./srtUtils";
import type { BeatJoinAnalysis, BeatJoinSection, SegmentPreview, UploadedVideoSource } from "./types";

export interface StorySectionDraft {
  id?: string;
  label: string;
  prompt?: string;
}

export interface StorySection extends BeatJoinSection {
  id: string;
  prompt: string;
  source: "analysis" | "fallback";
  lyricChunkIds: string[];
  videoMomentIds: string[];
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
  sourceRefLabel?: string;
}

export interface EditPlanPreviewSegment {
  videoUrl: string;
  startTime: number;
  endTime: number;
  label: string;
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
}

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

const DEFAULT_SECTION_DRAFTS: StorySectionDraft[] = [
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

export function getDefaultStorySectionDrafts(): StorySectionDraft[] {
  return DEFAULT_SECTION_DRAFTS.map((draft) => ({ ...draft }));
}

export function normalizeLyricChunks(chunks: SrtChunk[] = []): LyricChunk[] {
  return chunks
    .map((chunk, index) => {
      const start = roundTime(Math.max(0, Number(chunk.start) || 0));
      const fallbackEnd = start + 0.25;
      const end = roundTime(Math.max(fallbackEnd, Number(chunk.end) || fallbackEnd));
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

  return drafts.map((draft, index) => {
    const analysisSection = analysisSections[index];
    const fallback = fallbackSectionWindow(index, drafts.length, duration);
    const start = analysisSection?.start ?? fallback.start;
    const end = analysisSection?.end ?? fallback.end;

    return {
      id: draft.id || slugify(draft.label, index),
      label: draft.label || analysisSection?.label || `Section ${index + 1}`,
      prompt: draft.prompt || "Describe the visual idea for this song section",
      start,
      end,
      energy: analysisSection?.energy,
      source: analysisSection ? "analysis" : "fallback",
      lyricChunkIds: [],
      videoMomentIds: [],
    } satisfies StorySection;
  });
}

export function buildVideoMomentsFromStudioSources(params: {
  videoSources: UploadedVideoSource[];
  segmentPreviews?: SegmentPreview[];
}): VideoMoment[] {
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
    } satisfies VideoMoment));

  if (segmentMoments.length) return segmentMoments;

  return params.videoSources
    .filter((source) => source.duration > 0)
    .map((source) => ({
      id: `source-moment-${source.id}`,
      sourceClipId: source.id,
      label: source.name,
      start: 0,
      end: roundTime(source.duration),
      duration: roundTime(source.duration),
      thumbnailUrl: source.thumbnailUrl,
      sourceRefLabel: `S${source.id + 1}`,
    } satisfies VideoMoment));
}

export function mapLyricsToStorySections(sections: StorySection[], lyricChunks: LyricChunk[]): StorySection[] {
  return sections.map((section) => ({
    ...section,
    lyricChunkIds: lyricChunks
      .filter((chunk) => overlaps(section.start, section.end, chunk.start, chunk.end))
      .map((chunk) => chunk.id),
  }));
}

export function mapVideoMomentsToStorySections(sections: StorySection[], moments: VideoMoment[]): StorySection[] {
  return sections.map((section, index) => {
    const overlapping = moments.filter((moment) => overlaps(section.start, section.end, moment.start, moment.end));
    const fallback = moments.length ? [moments[index % moments.length]!.id] : [];
    return {
      ...section,
      videoMomentIds: overlapping.length ? overlapping.map((moment) => moment.id) : fallback,
    };
  });
}

export function buildDraftEditPlan(params: {
  sections: StorySection[];
  videoMoments: VideoMoment[];
  createdAt?: string;
}): EditPlan {
  const createdAt = params.createdAt ?? new Date().toISOString();
  const timelineItems = params.sections.map((section, index) => {
    const videoMomentId = section.videoMomentIds[0] ?? params.videoMoments[index % Math.max(1, params.videoMoments.length)]?.id ?? null;
    return {
      id: `timeline-${section.id}`,
      sectionId: section.id,
      lyricChunkIds: section.lyricChunkIds,
      videoMomentId,
      start: section.start,
      end: section.end,
      label: section.label,
      prompt: section.prompt,
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
  const storySections = mapVideoMomentsToStorySections(sectionsWithLyrics, videoMoments);
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
}): EditPlanPreviewSegment[] {
  if (!params.project) return [];

  const momentsById = new Map(params.project.videoMoments.map((moment) => [moment.id, moment]));

  return params.project.editPlan.timelineItems
    .map((item) => {
      const moment = item.videoMomentId ? momentsById.get(item.videoMomentId) : null;
      if (!moment) return null;

      const source = params.videoSources.find((candidate) => candidate.id === moment.sourceClipId);
      if (!source?.videoUrl) return null;

      const startTime = roundTime(Math.max(0, Math.min(source.duration, moment.start)));
      const fallbackEnd = startTime + Math.max(0.1, Math.min(item.end - item.start, moment.duration));
      const endTime = roundTime(Math.max(startTime + 0.05, Math.min(source.duration, moment.end || fallbackEnd)));
      if (endTime <= startTime) return null;

      return {
        videoUrl: source.videoUrl,
        startTime,
        endTime,
        label: `${item.label} · ${moment.label}`,
      } satisfies EditPlanPreviewSegment;
    })
    .filter((segment): segment is EditPlanPreviewSegment => segment !== null);
}

export function validateMusicVideoProject(project: MusicVideoProject): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  if (project.duration <= 0) {
    findings.push(buildFinding("warning", "missing-duration", "Project duration is unknown; section timing is provisional."));
  }

  for (const section of project.storySections) {
    if (section.end <= section.start) {
      findings.push(buildFinding("error", "invalid-section-window", `Section ${section.label} has an invalid time window.`, section.id));
    }
    if (!section.lyricChunkIds.length && project.lyricChunks.length > 0) {
      findings.push(buildFinding("info", "section-has-no-lyrics", `Section ${section.label} has no overlapping lyric chunk.`, section.id));
    }
    if (!section.videoMomentIds.length && project.videoMoments.length > 0) {
      findings.push(buildFinding("warning", "section-has-no-video-moment", `Section ${section.label} has no assigned video moment.`, section.id));
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

function fallbackSectionWindow(index: number, count: number, duration: number) {
  if (duration <= 0) return { start: 0, end: 0 };
  const safeCount = Math.max(1, count);
  const start = roundTime((duration / safeCount) * index);
  const end = roundTime(index === safeCount - 1 ? duration : (duration / safeCount) * (index + 1));
  return { start, end: Math.max(start + 0.25, end) };
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

function overlaps(leftStart: number, leftEnd: number, rightStart: number, rightEnd: number) {
  return leftStart < rightEnd && leftEnd > rightStart;
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
