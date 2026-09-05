"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { fmt } from "../math";
import {
  buildGenerationReferenceInputs,
  getOrderedSelectedReferenceIds,
  MAX_CROWD_REFERENCE_SELECTIONS,
  normalizeCrowdReferenceIds,
  type GenerationReferenceSelection,
  type ReferenceAsset,
} from "../referenceAssets";
import type { BeatJoinAnalysis, ColorPaletteSwatch, MotionDescriptor } from "../types";
import { buildGeneratedAssetContextPreview, resolveGeneratedAssetTrimFrameControl, resolveGeneratedAssetTrimWindow, type GeneratedStudioAsset } from "../generatedAssets";
import { uploadGeneratedClipToRustFs } from "../generatedClipUpload";
import { buildSeedanceContinuationPacket, serializeSeedanceContinuationPacket, type SeedanceVideoModel } from "../seedanceContinuation";
import { buildSeedanceAudioPlacementKey } from "../seedanceAudioReference";
import { buildAdaptiveCueMap } from "../adaptiveCueMap";
import type { EditPlanPreviewSegment, MusicVideoProject, VideoMoment } from "../musicVideoProject";
import { selectPreviewCutRange, selectPreviewSectionRange, type PreviewCutRange } from "../resolvedPreviewSelection";
import { waitForTriggerRunOutput } from "@/lib/clientTriggerRuns";
import { resolveRangePointerRatio } from "../rangePointer";
import { StoryboardPlanner } from "./StoryboardPlanner";
import {
  buildCoverageIssueGroups,
  buildCoverageSlots,
  describeCoverageIssue,
  summarizeCoverage,
  type CoverageIssueGroup,
  type CoverageSlot,
  type GenerationNeed,
  type SlotStatus,
} from "../editPlanCoverage";
import { countStoryboardFramesForSegment, getReplacementWorkflowState } from "../wholeShotReplacement";

export type { CoverageIssueGroup, CoverageSlot, GenerationNeed, SlotStatus } from "../editPlanCoverage";
export { buildCoverageIssueGroups, buildCoverageSlots, describeCoverageIssue, summarizeCoverage } from "../editPlanCoverage";

type GenerateTabProps = {
  project: MusicVideoProject | null;
  analysis: BeatJoinAnalysis | null;
  storyGenerated: boolean;
  onSelectMatch: () => void;
  onSelectJoin: () => void;
  onsetDensity: number;
  lyricCueBlend: number;
  lyricMergeWindow: number;
  previewSegments: EditPlanPreviewSegment[];
  referenceAssets: ReferenceAsset[];
  persistedGeneratedAssets: GeneratedStudioAsset[];
  masterAudioRef: SeedanceMasterAudioRef | null;
  onEnsureOwnedMasterAudio: () => Promise<SeedanceMasterAudioRef>;
  onGeneratedAsset: (asset: GeneratedStudioAsset) => void;
  selectedPreviewRange: PreviewCutRange | null;
  onSelectedPreviewRange: (range: PreviewCutRange | null) => void;
  onAuditionPreviewRange: (range: PreviewCutRange) => void;
  onAuditionGeneratedAsset: (asset: GeneratedStudioAsset, contextRadius: number) => void;
};

export type SeedanceMasterAudioRef = {
  bucket: string;
  objectKey: string;
  fileName: string;
  mimeType?: string;
  duration: number;
};

type PreparedSeedanceAudioReference = {
  placementKey: string;
  requestKey: string;
  videoUrl: string;
  clipStart: number;
  clipEnd: number;
  handleBefore: number;
  handleAfter: number;
  sectionStartOffset: number;
  sectionEndOffset: number;
};


type TimelineZoomMode = "fit" | "section" | "selected";
type GeneratedLocalAsset = { provider: "swarmui" | "comfyui"; kind: "image" | "video"; url: string; filename?: string; path?: string };


type LocalSwarmPreset = {
  title: string;
  label: string;
  description: string;
  model?: string;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  swarmParams?: Record<string, string | number | boolean | Array<string | number | boolean>>;
};

const LOCAL_SWARM_PRESETS: LocalSwarmPreset[] = [
  {
    title: "SwarmUI default 16:9",
    label: "Default 16:9",
    description: "Uses the currently selected/default SwarmUI model with 1280x720 framing.",
    width: 1280,
    height: 720,
    steps: 24,
    cfg: 6,
  },
  {
    title: "Krea2 Turbo Realism - 260625",
    label: "Krea2 Turbo",
    description: "Safe cinematic realism preset mirrored from hermes_presets.json.",
    model: "krea2_turbo_fp8_scaled",
    width: 1280,
    height: 720,
    steps: 12,
    cfg: 1,
    swarmParams: { sampler: "euler", scheduler: "simple", preferreddtype: "default" },
  },
  {
    title: "Z Image Turbo Quality 2",
    label: "ZIT Quality 2",
    description: "Fast Z-Image Turbo preset with the IMAX 1570 Z-Image LoRA from /models/loras/zimage. Use trigger words like CINEMATIC FILM STYLE, IMAX70MM STYLE, FILMSTRIP STYLE, 65MM FILM STYLE, or POLAROID in the prompt.",
    model: "Z_Image_Turbo_BF16",
    width: 1280,
    height: 720,
    steps: 12,
    cfg: 1,
    swarmParams: { sampler: "euler", scheduler: "beta", sigmashift: "7", preferreddtype: "default", loras: ["zimage/IMAX 1570 Film stlyle v1.2.safetensors"], loraweights: [1] },
  },
  {
    title: "FLUX 2 Klein Distilled 8 Steps - 260422",
    label: "Flux Klein 9B",
    description: "Flux 2 Klein distilled 9B turbo preset from hermes_presets.json.",
    model: "FLUX-2-Klein-Distilled-9b-Quant-FP8-Scaled",
    width: 1280,
    height: 720,
    steps: 8,
    cfg: 1,
    swarmParams: { sampler: "seeds_2", scheduler: "bong_tangent", preferreddtype: "default" },
  },
];

const STATUS_LABELS: Record<SlotStatus, string> = {
  filled: "filled",
  weak: "weak match",
  short: "review whole-shot replacement",
  missing: "missing",
};

const STATUS_STYLES: Record<SlotStatus, { border: string; bg: string; text: string; fill: string }> = {
  filled: { border: "border-[#245c2c]", bg: "bg-[#071107]", text: "text-[#78c878]", fill: "#255f34" },
  weak: { border: "border-[#695019]", bg: "bg-[#120e04]", text: "text-[#d3a236]", fill: "#b38422" },
  short: { border: "border-[#5b356f]", bg: "bg-[#100817]", text: "text-[#c37bea]", fill: "#7a3aa0" },
  missing: { border: "border-[#743029]", bg: "bg-[#120706]", text: "text-[#dc6257]", fill: "#8e332a" },
};

const NEED_LABELS: Record<GenerationNeed, string> = {
  "b-roll": "Generate B-roll",
  "alt-angle": "Generate Alt Angle / Camera B",
  "extend-start": "Use opening composition",
  "extend-end": "Replace whole shot + handles",
  bridge: "Bridge A→B",
  "reroll-match": "Reroll Match",
};

export function GenerateTab({ project, analysis, storyGenerated, onSelectMatch, onSelectJoin, onsetDensity, lyricCueBlend, lyricMergeWindow, previewSegments, referenceAssets, persistedGeneratedAssets, masterAudioRef, onEnsureOwnedMasterAudio, onGeneratedAsset, selectedPreviewRange, onSelectedPreviewRange, onAuditionPreviewRange, onAuditionGeneratedAsset }: GenerateTabProps) {
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [timelineZoomMode, setTimelineZoomMode] = useState<TimelineZoomMode>("fit");
  const [referenceSelection, setReferenceSelection] = useState<GenerationReferenceSelection>({});
  const [generationStatus, setGenerationStatus] = useState("Local generator not checked yet.");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedAssets, setGeneratedAssets] = useState<GeneratedLocalAsset[]>([]);
  const [selectedPresetTitle, setSelectedPresetTitle] = useState(LOCAL_SWARM_PRESETS[0].title);
  const [generatedImportStatus, setGeneratedImportStatus] = useState("Select exactly one resolved cut below, then import its completed Seedance candidates.");
  const [isImportingGenerated, setIsImportingGenerated] = useState(false);
  const cueMap = useMemo(() => buildAdaptiveCueMap({
    analysis,
    project,
    density: onsetDensity / 100,
    lyricBlend: lyricCueBlend / 100,
    lyricMergeWindowSeconds: lyricMergeWindow,
  }), [analysis, lyricCueBlend, lyricMergeWindow, onsetDensity, project]);
  const slots = useMemo(() => buildCoverageSlots(project, cueMap.chunks), [cueMap.chunks, project]);
  const coverage = useMemo(() => summarizeCoverage(slots, cueMap.duration), [cueMap.duration, slots]);
  const issueGroups = useMemo(() => buildCoverageIssueGroups(slots), [slots]);
  const requiredIssues = issueGroups.filter((issue) => issue.status === "missing");
  const shortIssues = issueGroups.filter((issue) => issue.status === "short");
  const reviewIssues = issueGroups.filter((issue) => issue.status === "weak");
  const focusSlot = slots.find((slot) => slot.item.id === selectedSlotId) ?? slots.find((slot) => slot.status !== "filled") ?? slots[0];
  const selectedReturnSegment = selectedPreviewRange && selectedPreviewRange.startIndex === selectedPreviewRange.endIndex
    ? previewSegments[selectedPreviewRange.startIndex]
    : undefined;
  const selectedReturnSlot = selectedReturnSegment ? findCoverageSlotForSegment(slots, selectedReturnSegment) : undefined;
  const selectedPreset = LOCAL_SWARM_PRESETS.find((preset) => preset.title === selectedPresetTitle) ?? LOCAL_SWARM_PRESETS[0];
  const frameMoment = resolveGenerationFrameMoment({
    videoMoments: project?.videoMoments ?? [],
    focusSlot,
    selectedSegment: selectedReturnSegment,
  });
  const effectiveReferenceSelection = useMemo(() => fillDefaultReferenceSelection(referenceSelection, referenceAssets), [referenceAssets, referenceSelection]);
  const hasRequiredInputs = storyGenerated && Boolean(project?.editPlan.timelineItems.length);
  const storyboardFrameCount = useMemo(
    () => countStoryboardFramesForSegment(persistedGeneratedAssets, selectedReturnSegment),
    [persistedGeneratedAssets, selectedReturnSegment],
  );
  const importedForSegmentCount = useMemo(
    () => persistedGeneratedAssets.filter((asset) =>
      asset.mediaKind === "video"
      && asset.target?.sectionId === selectedReturnSegment?.sectionId
      && asset.reviewStatus !== "rejected",
    ).length,
    [persistedGeneratedAssets, selectedReturnSegment],
  );
  const approvedForJoin = useMemo(
    () => persistedGeneratedAssets.some((asset) =>
      asset.mediaKind === "video"
      && asset.reviewStatus === "approved"
      && asset.target?.sectionId === selectedReturnSegment?.sectionId,
    ),
    [persistedGeneratedAssets, selectedReturnSegment],
  );
  const checkLocalGenerator = async () => {
    setGenerationStatus("Checking SwarmUI gateway...");
    try {
      const response = await fetch("/api/generate/local");
      const payload = await response.json() as { providers?: Array<{ provider: string; reachable: boolean; baseUrl: string; message: string }> };
      const status = payload.providers?.find((providerStatus) => providerStatus.provider === "swarmui") ?? payload.providers?.[0];
      setGenerationStatus(status ? `${status.reachable ? "Ready" : "Offline"}: ${status.message} (${status.baseUrl})` : "No SwarmUI status returned.");
    } catch (error) {
      setGenerationStatus(error instanceof Error ? error.message : "Provider check failed.");
    }
  };

  const importGeneratedClips = async (files: File[]) => {
    if (!selectedReturnSegment || !files.length) {
      setGeneratedImportStatus("Select exactly one resolved cut below before importing its generated replacement.");
      return;
    }
    const videos = files.filter((file) => file.type.startsWith("video/") || /\.(mp4|mov|webm)$/i.test(file.name));
    if (!videos.length) {
      setGeneratedImportStatus("Choose at least one MP4, MOV, or WebM generated clip.");
      return;
    }
    setIsImportingGenerated(true);
    setGeneratedImportStatus(`Uploading ${videos.length} generated clip${videos.length === 1 ? "" : "s"} to RustFS...`);
    try {
      for (const file of videos) {
        const durationSeconds = await readVideoDuration(file);
        const payload = await uploadGeneratedClipToRustFs({
          file,
          folder: `media-uploads/generated/higgsfield/seedance/${project?.id ?? "draft"}/${selectedReturnSlot?.item.id ?? `cut-${selectedPreviewRange!.startIndex + 1}`}`,
          onPartUploaded: (uploaded, total) => {
            setGeneratedImportStatus(`Uploading ${file.name}: part ${uploaded}/${total} to RustFS...`);
          },
        });
        const resultUrl = payload.mediaUrl ?? payload.publicUrl;
        const model = inferSeedanceModel(file.name);
        onGeneratedAsset({
          id: `seedance:${crypto.randomUUID()}`,
          provider: "higgsfield",
          model,
          title: file.name.replace(/\.[^.]+$/, ""),
          prompt: "Imported completed Seedance continuation for explicit review.",
          createdAt: new Date().toISOString(),
          status: "completed",
          resultUrl,
          fullStorage: payload,
          mediaKind: "video",
          durationSeconds,
          trimStart: 0,
          reviewStatus: "pending",
          target: {
            timelineItemId: selectedReturnSlot?.item.id ?? `resolved-cut-${selectedPreviewRange!.startIndex + 1}`,
            sectionId: selectedReturnSegment.sectionId,
            sectionLabel: selectedReturnSlot?.item.label ?? selectedReturnSegment.label,
            parentMomentId: selectedReturnSegment.momentId,
            songStart: selectedReturnSegment.musicStart,
            songEnd: selectedReturnSegment.musicEnd,
          },
        });
      }
      setGeneratedImportStatus(`Returned ${videos.length} generated clip${videos.length === 1 ? "" : "s"} to cut ${selectedPreviewRange!.startIndex + 1} at ${fmtCutTime(selectedReturnSegment.musicStart)}–${fmtCutTime(selectedReturnSegment.musicEnd)}. Review before Join.`);
    } catch (error) {
      setGeneratedImportStatus(error instanceof Error ? error.message : "Generated clip import failed.");
    } finally {
      setIsImportingGenerated(false);
    }
  };



  const runLocalGeneration = async (kind: "image" | "video") => {
    if (!focusSlot) return;
    const selectedCharacterNames = getSelectedCharacterNames(referenceAssets, effectiveReferenceSelection);
    const prompt = buildSuggestedPrompt(focusSlot, frameMoment, buildGenerationReferenceInputs({
      anchorUrl: frameMoment?.firstFrameUrl ?? frameMoment?.thumbnailUrl,
      anchorLabel: focusSlot.item.label,
      assets: referenceAssets,
      selection: effectiveReferenceSelection,
    }).instructions, selectedCharacterNames);
    setIsGenerating(true);
    setGenerationStatus(`Sending ${kind} request to SwarmUI...`);
    try {
      const response = await fetch("/api/generate/local", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "swarmui",
          kind,
          prompt,
          action: focusSlot.needs[0] ?? "alt-angle",
          model: selectedPreset.model,
          width: selectedPreset.width,
          height: selectedPreset.height,
          steps: kind === "video" ? Math.max(selectedPreset.steps, 28) : selectedPreset.steps,
          cfg: selectedPreset.cfg,
          swarmParams: selectedPreset.swarmParams,
          batchSize: 1,
        }),
      });
      const payload = await response.json() as { success?: boolean; error?: string; runId?: string; job?: { status?: string; message?: string; promptId?: string; assets?: GeneratedLocalAsset[] } };
      if (!response.ok || payload.error) throw new Error(payload.error ?? payload.job?.message ?? `Generation failed with HTTP ${response.status}`);
      if (!payload.runId) throw new Error("Trigger.dev did not return a local-generation run ID.");
      setGenerationStatus(`Generation queued through Trigger.dev (${payload.runId}). Waiting for ${kind} output...`);
      const output = await waitForTriggerRunOutput(payload.runId, { timeoutMs: 30 * 60 * 1_000, pollIntervalMs: 2_000 }) as {
        assets?: Array<{ provider?: "swarmui" | "comfyui"; kind?: "image" | "video"; filename?: string; storage?: { publicUrl?: string; mediaUrl?: string; objectKey?: string } }>;
      };
      const assets = (output.assets ?? []).flatMap((asset) => {
        const url = asset.storage?.mediaUrl ?? asset.storage?.publicUrl;
        if (!url || !asset.kind) return [];
        return [{
          provider: asset.provider ?? "swarmui",
          kind: asset.kind,
          url,
          filename: asset.filename,
          path: asset.storage?.objectKey,
        } satisfies GeneratedLocalAsset];
      });
      if (!assets.length) throw new Error("Local generation completed without durable output assets.");
      setGeneratedAssets((current) => [...assets, ...current]);
      setGenerationStatus(`Completed ${assets.length} ${kind} asset${assets.length === 1 ? "" : "s"}; persisted to RustFS.`);
    } catch (error) {
      setGenerationStatus(error instanceof Error ? error.message : "Generation request failed.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-3">
      <section className="rounded-[2px] border border-[#1a1a1a] bg-[#0b0b0b] p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-[#e05c00]">Plan replacement footage</div>
            <div className="mt-1 max-w-5xl text-[11px] leading-5 text-[#6d6d6d]">
              This page sits between Match and Join. Match exposes holes and weak candidates; Generate plans complete replacement takes, B-roll and deliberate alternate shots; Join only assembles approved real/generated shots.
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onSelectMatch} className="rounded-[2px] border border-[#242424] px-3 py-2 text-[9px] uppercase tracking-[0.14em] text-[#9a9a9a] hover:border-[#e05c00] hover:text-[#e05c00]">Back to Match</button>
            <button type="button" onClick={onSelectJoin} className="rounded-[2px] border border-[#242424] px-3 py-2 text-[9px] uppercase tracking-[0.14em] text-[#9a9a9a] hover:border-[#e05c00] hover:text-[#e05c00]">Join Approved</button>
          </div>
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-3 xl:grid-cols-6">
          <MetricCard label="Required" value={coverage.requiredDuration > 0 ? fmt(coverage.requiredDuration) : "Waiting"} ready={coverage.requiredDuration > 0} />
          <MetricCard label="Real assigned" value={fmt(coverage.assignedDuration)} ready={coverage.coveragePct >= 99} />
          <MetricCard label="Primary-match shortage (estimate)" value={fmt(coverage.trueGapDuration)} ready={coverage.trueGapDuration === 0 && coverage.requiredDuration > 0} alert={coverage.trueGapDuration > 0} />
          <MetricCard label="Strong match" value={`${coverage.strongMatchPct}%`} ready={coverage.strongMatchPct >= 70} />
          <MetricCard label="True gaps (blocks Join)" value={`${coverage.blockingGapCount} chunk${coverage.blockingGapCount === 1 ? "" : "s"}`} ready={coverage.blockingGapCount === 0 && slots.length > 0} alert={coverage.blockingGapCount > 0} />
          <MetricCard label="Short source review" value={`${coverage.shortReviewCount} optional`} ready={coverage.shortReviewCount === 0 && slots.length > 0} />
          <MetricCard label="Weak match review" value={`${coverage.reviewCount} chunks · ${coverage.reviewSectionCount} sections`} ready={coverage.reviewCount === 0 && slots.length > 0} />
        </div>
      </section>

      <StoryboardPlanner key={project?.id ?? "draft"} projectId={project?.id ?? "draft"} segments={previewSegments}
        references={referenceAssets.filter((asset) => getOrderedSelectedReferenceIds(effectiveReferenceSelection).includes(asset.id))}
        assets={persistedGeneratedAssets} onAsset={onGeneratedAsset} locked={!hasRequiredInputs}
        sourceFrames={Object.fromEntries((project?.videoMoments ?? []).map((moment) => [moment.id, moment.firstFrameUrl ?? moment.thumbnailUrl]))}
        sectionLabels={Object.fromEntries((project?.storySections ?? []).map((section) => [section.id, section.label]))}
        onInspect={(startIndex, endIndex) => onAuditionPreviewRange({ startIndex, endIndex })} />

      {!hasRequiredInputs ? (
        <section className="rounded-[2px] border border-dashed border-[#252525] bg-[#080808] p-6 text-center">
          <div className="text-[10px] uppercase tracking-[0.18em] text-[#d24b3f]">Generate is locked</div>
          <div className="mx-auto mt-3 max-w-3xl text-[11px] leading-5 text-[#777]">
            Generate needs Story edit slots and Match assignments first. It will not invent fallback shots here; missing inputs stay visible as errors/locked states until the upstream pages return real data.
          </div>
        </section>
      ) : null}

      <section className="rounded-[2px] border border-[#1a1a1a] bg-[#0b0b0b] p-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-[#e05c00]">Coverage timeline + generation lanes</div>
            <div className="mt-1 text-[11px] text-[#6d6d6d]">Primary-match diagnostics only: inspect the resolved edit before deciding whether any generation is necessary. Replacement jobs cover complete actions plus handles.</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-[2px] border border-[#202020] bg-[#070707] p-1">
              {(["fit", "section", "selected"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setTimelineZoomMode(mode)}
                  className={`px-2 py-1 text-[8px] uppercase tracking-[0.12em] ${timelineZoomMode === mode ? "bg-[#e05c00] text-white" : "text-[#666] hover:text-[#d0d0d0]"}`}
                >
                  {mode === "fit" ? "Fit song" : mode === "section" ? "Section zoom" : "Chunk zoom"}
                </button>
              ))}
            </div>
            <div className="font-mono text-[10px] text-[#777]">{slots.length} adaptive chunks · {cueMap.activeCount} active cues · {analysis?.sourceLabel ?? "no song"}</div>
          </div>
        </div>
        <CoverageTimeline slots={slots} duration={coverage.duration} selectedSlotId={focusSlot?.item.id ?? null} zoomMode={timelineZoomMode} onSelectSlot={setSelectedSlotId} />
      </section>

      <section className="rounded-[2px] border border-[#1a1a1a] bg-[#0b0b0b] p-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-[#e05c00]">Resolved preview clips</div>
            <div className="mt-1 text-[11px] text-[#6d6d6d]">Every card is an actual preview cut. Its thumbnail, source ID, scene, source time, and song time now come from the resolved edit—not the section&apos;s repeated primary Match image.</div>
          </div>
          <div className="font-mono text-[10px] text-[#777]">{previewSegments.length} resolved cuts · {describePreviewSelection(previewSegments, selectedPreviewRange)}</div>
        </div>
        <ResolvedClipQueue
          project={project}
          segments={previewSegments}
          slots={slots}
          selectedSlotId={focusSlot?.item.id ?? null}
          selectedPreviewRange={selectedPreviewRange}
          onSelectSlot={setSelectedSlotId}
          onSelectedPreviewRange={onSelectedPreviewRange}
          onAuditionPreviewRange={onAuditionPreviewRange}
        />
      </section>

      <div className="grid gap-3 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-[2px] border border-[#1a1a1a] bg-[#0b0b0b] p-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-[#e05c00]">Coverage issues by song range</div>
              <div className="mt-1 text-[11px] text-[#6d6d6d]">Adjacent chunks with the same issue are grouped so you can see exactly where the problem starts, ends, and why it was flagged.</div>
            </div>
            <div className="font-mono text-[10px] text-[#777]">{requiredIssues.length} true gaps · {shortIssues.length} short · {reviewIssues.length} weak</div>
          </div>
          {slots.length ? (
            <div className="space-y-4">
              <IssueGroupSection
                title="Required gaps (blocks Join)"
                detail="Red means no primary source is assigned. Fill these in Match or approve a generated import before Join."
                emptyLabel="No true gaps"
                emptyDetail={`Every one of the ${slots.length} adaptive chunks has a primary match assigned. Join is not blocked by missing footage.`}
                issues={requiredIssues}
                selectedSlotId={focusSlot?.item.id ?? null}
                onSelectSlot={setSelectedSlotId}
              />
              <IssueGroupSection
                title="Short source — optional whole-shot replacement"
                detail="Purple means the primary source is shorter than the slot. Review the resolved cut; you may continue to Join without generating."
                emptyLabel="No short-source ranges"
                emptyDetail="No purple short-source diagnostics for this timeline."
                issues={shortIssues}
                selectedSlotId={focusSlot?.item.id ?? null}
                onSelectSlot={setSelectedSlotId}
              />
              <IssueGroupSection
                title="Optional weak-match review"
                detail="Yellow ranges already contain real footage. Listed because the match score is below 45%, not because video is missing."
                emptyLabel="No weak matches"
                emptyDetail="Every assigned section is at or above the 45% review threshold."
                issues={reviewIssues}
                selectedSlotId={focusSlot?.item.id ?? null}
                onSelectSlot={setSelectedSlotId}
              />
            </div>
          ) : (
            <EmptyState label="No edit slots" detail="Generate Story and run Match to populate this board." />
          )}
        </section>

        <section className="rounded-[2px] border border-[#1a1a1a] bg-[#0b0b0b] p-3 xl:sticky xl:top-3 xl:max-h-[calc(100vh-190px)] xl:self-start xl:overflow-y-auto">
          <ReplacementWorkflowChecklist
            selectedSegment={selectedReturnSegment}
            slot={focusSlot}
            storyboardFrameCount={storyboardFrameCount}
            importedAssetCount={importedForSegmentCount}
            approvedForJoin={approvedForJoin}
          />
          <div className="mb-3 mt-4">
            <div className="text-[10px] uppercase tracking-[0.18em] text-[#e05c00]">Whole-shot replacement lab</div>
            <div className="mt-1 text-[11px] text-[#6d6d6d]">Generate the complete action plus edit handles. Source frames guide composition; canonical character sheets control identity. No stitched continuation of the same movement.</div>
          </div>
          <FrameExtensionPanel
            projectId={project?.id ?? "music-video-project-draft"}
            slot={focusSlot}
            moment={frameMoment}
            selectedSegment={selectedReturnSegment}
            referenceAssets={referenceAssets}
            referenceSelection={effectiveReferenceSelection}
            onReferenceSelection={setReferenceSelection}
            persistedGeneratedAssets={persistedGeneratedAssets}
            masterAudioRef={masterAudioRef}
            onEnsureOwnedMasterAudio={onEnsureOwnedMasterAudio}
            providerStatus={generationStatus}
            isGenerating={isGenerating}
            generatedAssets={generatedAssets}
            presets={LOCAL_SWARM_PRESETS}
            selectedPresetTitle={selectedPreset.title}
            onPresetChange={setSelectedPresetTitle}
            onCheckProvider={checkLocalGenerator}
            onGenerateImage={() => runLocalGeneration("image")}
          />
        </section>
      </div>

      <section className="rounded-[2px] border border-[#1a1a1a] bg-[#0b0b0b] p-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-[#e05c00]">Generated shot bank / approval queue</div>
            <div className="mt-1 text-[11px] text-[#6d6d6d]">Select one resolved cut, return its completed Seedance candidates, then approve exactly what enters Join. Rejected clips remain attached as review history and never replace the edit.</div>
          </div>
          <label className={`rounded-[2px] border border-[#6e3425] bg-[#160905] px-3 py-2 text-[8px] uppercase tracking-[0.12em] text-[#d26c42] ${isImportingGenerated || !selectedReturnSegment ? "cursor-not-allowed opacity-45" : "cursor-pointer hover:border-[#e05c00]"}`}>
            {isImportingGenerated ? "Importing..." : "Import generated clips"}
            <input
              type="file"
              accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
              multiple
              disabled={isImportingGenerated || !selectedReturnSegment}
              className="sr-only"
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                event.target.value = "";
                void importGeneratedClips(files);
              }}
            />
          </label>
        </div>
        <div className="mb-3 rounded-[2px] border border-[#171717] bg-[#050505] px-2 py-1.5 font-mono text-[8px] leading-4 text-[#777]">{generatedImportStatus}</div>
        <GeneratedShotBank
          assets={persistedGeneratedAssets}
          previewSegments={previewSegments}
          onUpdate={onGeneratedAsset}
          onAudition={onAuditionGeneratedAsset}
        />
      </section>

      <section className="rounded-[2px] border border-[#1a1a1a] bg-[#0b0b0b] p-3">
        <div className="mb-3">
          <div className="text-[10px] uppercase tracking-[0.18em] text-[#e05c00]">Track lanes for live intercut target</div>
          <div className="mt-1 text-[11px] text-[#6d6d6d]">Long-term target: Track A real matched footage, Track B generated B-roll/alt angles, Track C extensions/bridges, Track D GLSL/effects. These lanes show where clips would shift when shuffle/match modes change.</div>
        </div>
        <TrackLaneBoard slots={slots} duration={coverage.duration} />
      </section>
    </div>
  );
}

function ReplacementWorkflowChecklist({
  selectedSegment,
  slot,
  storyboardFrameCount,
  importedAssetCount,
  approvedForJoin,
  audioReferenceReady = false,
  packetErrorCount = 0,
}: {
  selectedSegment?: EditPlanPreviewSegment;
  slot?: CoverageSlot;
  storyboardFrameCount: number;
  importedAssetCount: number;
  approvedForJoin: boolean;
  audioReferenceReady?: boolean;
  packetErrorCount?: number;
}) {
  const workflow = getReplacementWorkflowState({
    selectedSegment,
    slot,
    storyboardFrameCount,
    audioReferenceReady,
    packetErrorCount,
    importedAssetCount,
    approvedForJoin,
  });

  return (
    <div className="rounded-[2px] border border-[#1a2a3d] bg-[#05080f] p-3">
      <div className="text-[10px] uppercase tracking-[0.18em] text-[#6ca6d2]">Seedance operator checklist</div>
      <ol className="mt-3 space-y-2">
        {workflow.steps.map((step) => (
          <li
            key={step.id}
            className={`rounded-[2px] border px-2 py-1.5 text-[10px] ${
              step.complete
                ? "border-[#245c2c] bg-[#081108] text-[#79c779]"
                : step.active
                  ? "border-[#24476f] bg-[#07111e] text-[#9fb4c5]"
                  : "border-[#252525] bg-[#080808] text-[#666]"
            }`}
          >
            <div className="font-mono uppercase tracking-[0.12em]">{step.label}</div>
            <div className="mt-1 text-[9px] leading-4">{step.detail}</div>
          </li>
        ))}
      </ol>
      {workflow.blockers.length ? (
        <div className="mt-3 text-[9px] leading-4 text-[#d3a236]">{workflow.blockers.join(" ")}</div>
      ) : null}
    </div>
  );
}

function MetricCard({ label, value, ready, alert = false }: { label: string; value: string; ready: boolean; alert?: boolean }) {
  return (
    <div className={`rounded-[2px] border px-3 py-2 ${ready ? "border-[#245c2c] bg-[#081108]" : alert ? "border-[#743029] bg-[#120706]" : "border-[#252525] bg-[#080808]"}`}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[8px] uppercase tracking-[0.16em] text-[#5c5c5c]">{label}</span>
        <span className={`h-2 w-2 rounded-full ${ready ? "bg-[#3a8a3a]" : alert ? "bg-[#d24b3f]" : "bg-[#454545]"}`} />
      </div>
      <div className={`font-mono text-[10px] ${ready ? "text-[#79c779]" : alert ? "text-[#d24b3f]" : "text-[#777]"}`}>{value}</div>
    </div>
  );
}

function CoverageTimeline({
  slots,
  duration,
  selectedSlotId,
  zoomMode,
  onSelectSlot,
}: {
  slots: CoverageSlot[];
  duration: number;
  selectedSlotId: string | null;
  zoomMode: TimelineZoomMode;
  onSelectSlot: (id: string) => void;
}) {
  if (!slots.length) return <EmptyState label="No timeline" detail="Story and Match slots will appear here." />;
  const selectedSlot = slots.find((slot) => slot.item.id === selectedSlotId) ?? slots[0];
  const view = getCoverageTimelineView({ slots, duration, selectedSlot, zoomMode });
  const viewDuration = Math.max(0.001, view.end - view.start);
  const visibleSlots = slots.filter((slot) => slot.item.end > view.start && slot.item.start < view.end);

  return (
    <div className="rounded-[2px] border border-[#151515] bg-[#060606] p-2">
      <div className="mb-2 flex items-center justify-between gap-2 font-mono text-[9px] uppercase tracking-[0.12em] text-[#555]">
        <span>{view.label}</span>
        <span>{visibleSlots.length}/{slots.length} chunks visible</span>
      </div>
      <div className="relative h-32 overflow-hidden border border-[#101010] bg-[#040404]">
        {visibleSlots.map((slot) => {
          const clippedStart = Math.max(view.start, slot.item.start);
          const clippedEnd = Math.min(view.end, slot.item.end);
          const left = clamp01((clippedStart - view.start) / viewDuration) * 100;
          const width = Math.max(0.7, clamp01((clippedEnd - clippedStart) / viewDuration) * 100);
          const style = STATUS_STYLES[slot.status];
          return (
            <button
              type="button"
              key={slot.item.id}
              onClick={() => onSelectSlot(slot.item.id)}
              className={`absolute inset-y-0 border-r text-left transition-colors ${selectedSlotId === slot.item.id ? "border-[#e05c00] bg-[#e05c0018]" : "border-[#181818] bg-[#ffffff05] hover:bg-[#ffffff0a]"}`}
              style={{ left: `${left}%`, width: `${width}%` }}
              title={`${slot.item.label} · ${STATUS_LABELS[slot.status]} · ${fmt(slot.item.start)}–${fmt(slot.item.end)}`}
            >
              <div className="absolute left-1 top-1 max-w-[130px] truncate text-[8px] uppercase tracking-[0.12em] text-[#8a4b20]">{slot.item.label}</div>
              <div className="absolute bottom-2 left-1 right-1 h-16 rounded-[1px] border border-[#111] bg-[#0a0a0a]">
                <div className="h-full rounded-[1px]" style={{ width: `${Math.max(5, (slot.assignedDuration / Math.max(slot.requiredDuration, 0.01)) * 100)}%`, background: style.fill, opacity: slot.status === "missing" ? 0.24 : 0.82 }} />
                {slot.missingDuration > 0.01 ? (
                  <div
                    className={`absolute inset-y-0 right-0 min-w-[10px] ${slot.status === "short" ? "bg-[#7a3aa055]" : "bg-[#d24b3f55]"}`}
                    style={{ width: `${Math.max(12, (slot.missingDuration / Math.max(slot.requiredDuration, 0.01)) * 100)}%` }}
                  />
                ) : null}
              </div>
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between font-mono text-[9px] text-[#555]">
        <span>{fmt(view.start)}</span>
        <span>green usable · yellow weak · purple short source · red unassigned</span>
        <span>{fmt(view.end)}</span>
      </div>
    </div>
  );
}

function getCoverageTimelineView({
  slots,
  duration,
  selectedSlot,
  zoomMode,
}: {
  slots: CoverageSlot[];
  duration: number;
  selectedSlot?: CoverageSlot;
  zoomMode: TimelineZoomMode;
}) {
  const fullDuration = Math.max(0.001, duration);
  if (!selectedSlot || zoomMode === "fit") {
    return { start: 0, end: fullDuration, label: "Fit song" };
  }

  if (zoomMode === "section") {
    const sectionSlots = slots.filter((slot) => slot.item.sectionId === selectedSlot.item.sectionId);
    const start = Math.min(...sectionSlots.map((slot) => slot.item.start));
    const end = Math.max(...sectionSlots.map((slot) => slot.item.end));
    const pad = Math.max(0.5, (end - start) * 0.08);
    return {
      start: clamp(start - pad, 0, fullDuration),
      end: clamp(end + pad, 0.001, fullDuration),
      label: `${selectedSlot.item.label.split(" · ")[0]} section zoom`,
    };
  }

  const center = (selectedSlot.item.start + selectedSlot.item.end) / 2;
  const selectedDuration = Math.max(0.25, selectedSlot.requiredDuration);
  const span = Math.max(8, selectedDuration * 8);
  const start = clamp(center - span / 2, 0, fullDuration);
  const end = clamp(start + span, 0.001, fullDuration);
  const adjustedStart = end >= fullDuration ? clamp(fullDuration - span, 0, fullDuration) : start;
  return {
    start: adjustedStart,
    end,
    label: `${selectedSlot.item.label} chunk zoom`,
  };
}

function ResolvedClipQueue({
  project,
  segments,
  slots,
  selectedSlotId,
  selectedPreviewRange,
  onSelectSlot,
  onSelectedPreviewRange,
  onAuditionPreviewRange,
}: {
  project: MusicVideoProject | null;
  segments: EditPlanPreviewSegment[];
  slots: CoverageSlot[];
  selectedSlotId: string | null;
  selectedPreviewRange: PreviewCutRange | null;
  onSelectSlot: (id: string) => void;
  onSelectedPreviewRange: (range: PreviewCutRange | null) => void;
  onAuditionPreviewRange: (range: PreviewCutRange) => void;
}) {
  if (!segments.length) return <EmptyState label="No resolved preview cuts" detail="Generate Story and finish Match so the actual source sequence can be resolved." />;
  const duration = Math.max(segments[segments.length - 1]?.musicEnd ?? 0, 0.001);
  const momentsById = new Map(project?.videoMoments.map((moment) => [moment.id, moment]) ?? []);
  const cards = segments.map((segment, index) => {
    const slot = findCoverageSlotForSegment(slots, segment);
    const moment = segment.momentId ? momentsById.get(segment.momentId) : undefined;
    const sourceLabel = segment.sourceRefLabel
      ?? moment?.sourceRefLabel
      ?? (segment.sourceClipId !== undefined ? `S${segment.sourceClipId + 1}` : "Unknown source");
    return { segment, slot, moment, sourceLabel, index };
  });
  const selectedSectionRange = selectPreviewSectionRange(segments, selectedPreviewRange);
  const selectedCount = selectedPreviewRange ? selectedPreviewRange.endIndex - selectedPreviewRange.startIndex + 1 : 0;
  const handleCutSelection = (index: number, extend: boolean) => {
    const nextRange = selectPreviewCutRange({ current: selectedPreviewRange, index, segmentCount: segments.length, extend });
    onSelectedPreviewRange(nextRange);
    const slot = cards[index]?.slot;
    if (slot) onSelectSlot(slot.item.id);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 rounded-[2px] border border-[#171717] bg-[#070707] px-2 py-2">
        <span className="mr-auto text-[9px] leading-4 text-[#777]">
          Click one cut; Shift-click another to select a contiguous edit range. Audition plays only that range against the master song.
        </span>
        <button
          type="button"
          disabled={!selectedSectionRange}
          onClick={() => selectedSectionRange && onSelectedPreviewRange(selectedSectionRange)}
          className="rounded-[2px] border border-[#2a2a2a] px-2 py-1 text-[8px] uppercase tracking-[0.12em] text-[#888] hover:border-[#e05c00] hover:text-[#e05c00] disabled:cursor-not-allowed disabled:opacity-35"
        >
          Select section
        </button>
        <button
          type="button"
          disabled={!selectedPreviewRange}
          onClick={() => selectedPreviewRange && onAuditionPreviewRange(selectedPreviewRange)}
          className="rounded-[2px] border border-[#e05c00] bg-[#120b06] px-2 py-1 text-[8px] uppercase tracking-[0.12em] text-[#e05c00] hover:bg-[#211006] disabled:cursor-not-allowed disabled:border-[#2a2a2a] disabled:bg-transparent disabled:text-[#555]"
        >
          Audition {selectedCount || ""} cut{selectedCount === 1 ? "" : "s"}
        </button>
        <button
          type="button"
          disabled={!selectedPreviewRange}
          onClick={() => onSelectedPreviewRange(null)}
          className="rounded-[2px] border border-[#2a2a2a] px-2 py-1 text-[8px] uppercase tracking-[0.12em] text-[#666] hover:border-[#555] hover:text-[#999] disabled:cursor-not-allowed disabled:opacity-35"
        >
          Show full edit
        </button>
      </div>
      <div className="relative h-12 overflow-hidden rounded-[2px] border border-[#151515] bg-[#050505]">
        {cards.map(({ segment, slot, index }) => {
          const left = clamp01(segment.musicStart / duration) * 100;
          const width = Math.max(0.35, clamp01((segment.musicEnd - segment.musicStart) / duration) * 100);
          const style = STATUS_STYLES[slot?.status ?? "filled"];
          return (
            <button
              key={`mini-${segment.sectionId}-${segment.musicStart}-${index}`}
              type="button"
              onClick={(event) => handleCutSelection(index, event.shiftKey)}
              aria-pressed={isCutInRange(index, selectedPreviewRange)}
              className={`absolute inset-y-1 rounded-[1px] border transition-colors ${isCutInRange(index, selectedPreviewRange) ? "border-[#ff8a2a] brightness-125" : slot && selectedSlotId === slot.item.id ? "border-[#8a4a20]" : "border-[#050505] hover:border-[#e05c00]"}`}
              style={{ left: `${left}%`, width: `${width}%`, background: style.fill, opacity: 0.82 }}
              title={`${segment.sourceRefLabel ?? segment.label} · song ${fmtCutTime(segment.musicStart)}-${fmtCutTime(segment.musicEnd)} · source ${fmtCutTime(segment.startTime)}-${fmtCutTime(segment.endTime)}`}
            />
          );
        })}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-6">
        {cards.map(({ segment, slot, moment, sourceLabel, index }) => {
          const status = slot?.status ?? "filled";
          const style = STATUS_STYLES[status];
          const thumb = segment.thumbnailUrl ?? moment?.firstFrameUrl ?? moment?.thumbnailUrl;
          const selected = isCutInRange(index, selectedPreviewRange);
          const cutDuration = Math.max(0, segment.musicEnd - segment.musicStart);
          return (
            <button
              key={`${segment.sectionId}-${segment.musicStart}-${segment.startTime}-${index}`}
              type="button"
              onClick={(event) => handleCutSelection(index, event.shiftKey)}
              aria-pressed={selected}
              className={`group overflow-hidden rounded-[2px] border bg-[#070707] text-left transition-colors ${selected ? "border-[#e05c00]" : "border-[#202020] hover:border-[#6a3218]"}`}
            >
              <div className="relative aspect-video bg-[#030303]">
                {thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumb} alt={`${sourceLabel} resolved cut`} className="h-full w-full object-cover opacity-75 group-hover:opacity-100" loading="lazy" decoding="async" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[8px] uppercase tracking-[0.12em] text-[#444]">No frame</div>
                )}
                <div className="absolute left-1 top-1 rounded-[1px] bg-[#000000c0] px-1.5 py-0.5 font-mono text-[7px] text-[#ddd]">{sourceLabel}</div>
                <div className={`absolute right-1 top-1 rounded-[1px] border px-1.5 py-0.5 font-mono text-[7px] uppercase ${style.border} ${style.text}`}>{STATUS_LABELS[status]}</div>
                <div className="absolute bottom-1 left-1 rounded-[1px] bg-[#000000c0] px-1.5 py-0.5 font-mono text-[7px] text-[#aaa]">SRC {fmtCutTime(segment.startTime)}–{fmtCutTime(segment.endTime)}</div>
                <div className="absolute bottom-1 right-1 rounded-[1px] bg-[#000000c0] px-1.5 py-0.5 font-mono text-[7px] text-[#aaa]">{cutDuration.toFixed(1)}s</div>
                {status !== "filled" ? <div className="absolute inset-0 flex items-center justify-center bg-[#00000055] text-[9px] uppercase tracking-[0.16em] text-[#b96c43]">{status === "weak" ? "review match" : "needs work"}</div> : null}
              </div>
              <div className="border-t border-[#151515] px-2 py-1.5">
                <div className="truncate font-mono text-[8px] uppercase tracking-[0.1em] text-[#8a8a8a]">CUT {String(index + 1).padStart(3, "0")} · {segment.label}</div>
                <div className="mt-1 flex justify-between font-mono text-[7px] text-[#555]">
                  <span>SONG {fmtCutTime(segment.musicStart)}–{fmtCutTime(segment.musicEnd)}</span>
                  <span>{slot ? `${Math.round(slot.score * 100)}%` : "resolved"}</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function isCutInRange(index: number, range: PreviewCutRange | null) {
  return Boolean(range && index >= range.startIndex && index <= range.endIndex);
}

function describePreviewSelection(segments: EditPlanPreviewSegment[], range: PreviewCutRange | null) {
  if (!range) return "full edit in player";
  const selected = segments.slice(range.startIndex, range.endIndex + 1);
  const first = selected[0];
  const last = selected[selected.length - 1];
  if (!first || !last) return "no cut selected";
  return `${selected.length} selected · song ${fmtCutTime(first.musicStart)}–${fmtCutTime(last.musicEnd)}`;
}

function findCoverageSlotForSegment(slots: CoverageSlot[], segment: EditPlanPreviewSegment) {
  const sameSection = slots.filter((slot) => slot.item.sectionId === segment.sectionId);
  const pool = sameSection.length ? sameSection : slots;
  return pool
    .map((slot) => ({
      slot,
      overlap: Math.max(0, Math.min(slot.item.end, segment.musicEnd) - Math.max(slot.item.start, segment.musicStart)),
    }))
    .sort((left, right) => right.overlap - left.overlap)[0]?.slot;
}

export function resolveGenerationFrameMoment(args: {
  videoMoments: VideoMoment[];
  focusSlot?: CoverageSlot;
  selectedSegment?: EditPlanPreviewSegment;
}) {
  if (args.selectedSegment?.momentId) {
    const selectedMoment = args.videoMoments.find((moment) => moment.id === args.selectedSegment?.momentId);
    if (selectedMoment) return selectedMoment;
  }

  return args.focusSlot?.moment
    ?? args.videoMoments.find((moment) => moment.firstFrameUrl || moment.thumbnailUrl);
}

function IssueGroupSection({
  title,
  detail,
  emptyLabel,
  emptyDetail,
  issues,
  selectedSlotId,
  onSelectSlot,
}: {
  title: string;
  detail: string;
  emptyLabel: string;
  emptyDetail: string;
  issues: CoverageIssueGroup[];
  selectedSlotId: string | null;
  onSelectSlot: (slotId: string) => void;
}) {
  return (
    <section>
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2 border-b border-[#171717] pb-2">
        <div>
          <div className="text-[9px] uppercase tracking-[0.16em] text-[#b0b0b0]">{title}</div>
          <div className="mt-1 text-[10px] leading-4 text-[#606060]">{detail}</div>
        </div>
        <span className="font-mono text-[9px] text-[#666]">{issues.length} range{issues.length === 1 ? "" : "s"}</span>
      </div>
      {issues.length ? (
        <div className="space-y-2">
          {issues.map((issue) => (
            <CoverageIssueCard
              key={issue.id}
              issue={issue}
              selected={issue.slots.some((slot) => slot.item.id === selectedSlotId)}
              onSelect={() => onSelectSlot(issue.slots[0]!.item.id)}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-[2px] border border-[#245c2c] bg-[#071107] px-3 py-3">
          <div className="text-[9px] uppercase tracking-[0.16em] text-[#79c779]">{emptyLabel}</div>
          <div className="mt-1 text-[10px] leading-5 text-[#668066]">{emptyDetail}</div>
        </div>
      )}
    </section>
  );
}

function CoverageIssueCard({ issue, selected, onSelect }: { issue: CoverageIssueGroup; selected: boolean; onSelect: () => void }) {
  const style = STATUS_STYLES[issue.status];
  const palette = getPalette(issue.moment);
  const motion = describeMotion(issue.moment?.motionDescriptor ?? issue.moment?.visualAnalysis?.motion);
  const sourceLabel = issue.moment
    ? issue.moment.sourceRefLabel ?? `S${issue.moment.sourceClipId + 1} · ${issue.moment.label}`
    : "No source assigned";
  const sourceRange = issue.moment ? `${fmt(issue.moment.start)}–${fmt(issue.moment.end)} in source` : "No source time range";
  const optional = issue.status === "weak";
  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      className={`block w-full cursor-pointer rounded-[2px] border text-left transition-colors ${selected ? "border-[#e05c00]" : style.border} ${style.bg} p-2 hover:border-[#e05c00]`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#d0d0d0]">{issue.sectionLabel}</div>
          <div className="mt-1 text-[10px] text-[#777]">Song {fmt(issue.start)}–{fmt(issue.end)} · {issue.slots.length} chunk{issue.slots.length === 1 ? "" : "s"} · {fmt(issue.requiredDuration)} total</div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span className={`rounded-[2px] border ${optional ? "border-[#695019] text-[#d3a236]" : "border-[#743029] text-[#dc6257]"} px-2 py-1 font-mono text-[8px] uppercase tracking-[0.12em]`}>{optional ? "optional review" : "required"}</span>
          <span className={`rounded-[2px] border ${style.border} px-2 py-1 font-mono text-[8px] uppercase tracking-[0.12em] ${style.text}`}>{STATUS_LABELS[issue.status]}</span>
        </div>
      </div>
      <div className="mt-2 grid gap-2 lg:grid-cols-[120px_1fr]">
        <FrameThumb moment={issue.moment} label={sourceLabel} />
        <div className="space-y-2">
          <div className={`rounded-[2px] border ${style.border} ${style.bg} p-2 text-[10px] leading-5 ${style.text}`}>
            <span className="font-mono uppercase tracking-[0.1em]">Why:</span> {describeCoverageIssue(issue)}
          </div>
          <div className="rounded-[2px] border border-[#181818] bg-[#070707] p-2 text-[10px] leading-5 text-[#9a9a9a]">
            <span className="text-[#e05c00]">Primary Match anchor:</span> {sourceLabel} · {sourceRange}
            <br />
            <span className="text-[#e05c00]">Caption:</span> {getMomentCaption(issue.moment) ?? "No captioned source assigned."}
            <br />
            <span className="text-[#666]">The resolved preview queue above shows the actual source used for each cut.</span>
          </div>
          <div className="rounded-[2px] border border-[#181818] bg-[#070707] p-2 text-[10px] leading-5 text-[#777]">
            <span className="text-[#e05c00]">Story intent:</span> {issue.slots[0]?.item.prompt ?? "No story prompt attached."}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <span className={`mr-1 font-mono text-[8px] uppercase tracking-[0.12em] ${optional ? "text-[#d3a236]" : "text-[#dc6257]"}`}>{optional ? "Optional actions" : "Required actions"}</span>
            {issue.needs.map((need) => <NeedPill key={need} need={need} optional={optional} />)}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[9px] uppercase tracking-[0.12em] text-[#555]">
            <span>score <span className={style.text}>{Math.round(issue.score * 100)}%</span> / 45% threshold</span>
            <span>motion <span className="text-[#888]">{motion}</span></span>
            <div className="flex h-3 min-w-[90px] overflow-hidden rounded-[1px] border border-[#111]">
              {palette.map((color, index) => <span key={`${issue.id}-${color}-${index}`} className="flex-1" style={{ background: color }} />)}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

function NeedPill({ need, optional = false }: { need: GenerationNeed; optional?: boolean }) {
  return (
    <button
      type="button"
      disabled
      title="Generation endpoint is not connected in this UI slice yet."
      className={`cursor-not-allowed rounded-[2px] border bg-[#0b0b0b] px-2 py-1 text-[8px] uppercase tracking-[0.12em] opacity-80 ${optional ? "border-[#4a3916] text-[#a9822f]" : "border-[#4a2420] text-[#b45c53]"}`}
    >
      {NEED_LABELS[need]}
    </button>
  );
}

function FrameExtensionPanel({
  projectId,
  slot,
  moment,
  selectedSegment,
  referenceAssets,
  referenceSelection,
  onReferenceSelection,
  persistedGeneratedAssets,
  masterAudioRef,
  onEnsureOwnedMasterAudio,
  providerStatus,
  isGenerating,
  generatedAssets,
  presets,
  selectedPresetTitle,
  onPresetChange,
  onCheckProvider,
  onGenerateImage,
}: {
  projectId: string;
  slot?: CoverageSlot;
  moment?: VideoMoment;
  selectedSegment?: EditPlanPreviewSegment;
  referenceAssets: ReferenceAsset[];
  referenceSelection: GenerationReferenceSelection;
  onReferenceSelection: (selection: GenerationReferenceSelection) => void;
  persistedGeneratedAssets: GeneratedStudioAsset[];
  masterAudioRef: SeedanceMasterAudioRef | null;
  onEnsureOwnedMasterAudio: () => Promise<SeedanceMasterAudioRef>;
  providerStatus: string;
  isGenerating: boolean;
  generatedAssets: GeneratedLocalAsset[];
  presets: LocalSwarmPreset[];
  selectedPresetTitle: string;
  onPresetChange: (title: string) => void;
  onCheckProvider: () => void;
  onGenerateImage: () => void;
}) {
  const frames = [
    { label: "Opening composition", url: moment?.firstFrameUrl ?? moment?.thumbnailUrl, action: "Composition reference only" },
    { label: "Middle / context", url: moment?.middleFrameUrl ?? moment?.storyboardUrl ?? moment?.thumbnailUrl, action: "Generate Alt Angle" },
    { label: "Last / context only", url: moment?.lastFrameUrl ?? moment?.thumbnailUrl, action: "Do not append matching action" },
  ];
  const anchorUrl = moment?.firstFrameUrl ?? moment?.thumbnailUrl;
  const referencePlan = buildGenerationReferenceInputs({
    anchorUrl,
    anchorLabel: selectedSegment?.sourceRefLabel ?? slot?.item.label ?? moment?.sourceRefLabel ?? "source frame",
    assets: referenceAssets,
    selection: referenceSelection,
  });
  const selectedPreset = presets.find((preset) => preset.title === selectedPresetTitle) ?? presets[0];
  const [seedanceModel, setSeedanceModel] = useState<SeedanceVideoModel>("Seedance 2.0");
  const [seedanceResolution, setSeedanceResolution] = useState<"480p" | "720p">("480p");
  const [handleSeconds, setHandleSeconds] = useState(1);
  const songStart = selectedSegment?.musicStart ?? slot?.item.start ?? 0;
  const songEnd = selectedSegment?.musicEnd ?? slot?.item.end ?? 0;
  const placementKey = masterAudioRef && songEnd > songStart
    ? buildSeedanceAudioPlacementKey({
        audioObjectKey: masterAudioRef.objectKey,
        songStart,
        songEnd,
        songDuration: masterAudioRef.duration,
        handleSeconds,
      })
    : "";
  const [preparedAudioReference, setPreparedAudioReference] = useState<PreparedSeedanceAudioReference | null>(null);
  const [isPreparingAudioReference, setIsPreparingAudioReference] = useState(false);
  const [seedanceAudioStatus, setSeedanceAudioStatus] = useState("Video_1 is rendered only when this exact placement is ready to submit.");
  const activeAudioReference = preparedAudioReference?.placementKey === placementKey ? preparedAudioReference : null;
  const visibleAudioStatus = preparedAudioReference && !activeAudioReference
    ? "This cut moved or another cut was selected. The previous Video_1 is stale; prepare a new timing reference for this placement."
    : seedanceAudioStatus;
  const seedancePacket = buildSeedanceContinuationPacket({
    projectId,
    sectionId: selectedSegment?.sectionId ?? slot?.item.sectionId ?? "unassigned-section",
    sectionLabel: slot?.item.label ?? "Current section",
    storyIntent: slot?.item.prompt ?? "advance the current music-video section",
    songStart,
    songEnd,
    moment,
    referenceAssets,
    referenceSelection,
    approvedFrames: persistedGeneratedAssets,
    model: seedanceModel,
    resolution: seedanceResolution,
    handleSeconds,
    audioVideoReference: activeAudioReference ? {
      tag: "@Video_1",
      role: "section-audio-timing",
      label: `${slot?.item.label ?? "selected section"} master-audio timing reference`,
      url: activeAudioReference.videoUrl,
      instruction: "@Video_1 controls song audio, rhythm, lyric timing, and lip-sync timing only. Ignore its black picture and do not transfer visual identity, composition, camera, environment, lighting, or action from it.",
      clipRange: { start: activeAudioReference.clipStart, end: activeAudioReference.clipEnd },
      sectionRange: { start: songStart, end: songEnd },
      sectionOffset: { start: activeAudioReference.sectionStartOffset, end: activeAudioReference.sectionEndOffset },
      handleSeconds: { before: activeAudioReference.handleBefore, after: activeAudioReference.handleAfter },
      placementKey: activeAudioReference.placementKey,
    } : undefined,
  });
  const [seedanceCopyStatus, setSeedanceCopyStatus] = useState("Ready to copy the operator packet.");
  const prepareSeedanceSubmission = async () => {
    if (!masterAudioRef || !placementKey || songEnd <= songStart) {
      setSeedanceAudioStatus("The selected cut needs durable master audio and a valid song range first.");
      return;
    }
    setIsPreparingAudioReference(true);
    setSeedanceAudioStatus(`Rendering black Video_1 for ${fmtCutTime(songStart)}–${fmtCutTime(songEnd)} plus ${handleSeconds}s handles...`);
    try {
      const requestKey = sanitizeSeedanceRequestKey(`${projectId}-${slot?.item.id ?? selectedSegment?.sectionId ?? "section"}-${songStart.toFixed(3)}-${songEnd.toFixed(3)}`);
      const queueAudioReference = async (audio: SeedanceMasterAudioRef) => {
        const response = await fetch("/api/generate/seedance/audio-reference", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestKey,
            audio,
            songStart,
            songEnd,
            songDuration: audio.duration,
            handleSeconds,
          }),
        });
        const queued = await response.json() as { runId?: string; error?: string };
        return { response, queued };
      };

      let activeMasterAudio = masterAudioRef;
      let { response, queued } = await queueAudioReference(activeMasterAudio);
      if (response.status === 403 && /does not belong to this signed-in user/i.test(queued.error ?? "")) {
        setSeedanceAudioStatus("Re-registering the restored master audio under this signed-in account...");
        activeMasterAudio = await onEnsureOwnedMasterAudio();
        ({ response, queued } = await queueAudioReference(activeMasterAudio));
      }
      if (!response.ok || !queued.runId) throw new Error(queued.error || `Seedance timing render failed (${response.status}).`);
      const output = await waitForTriggerRunOutput(queued.runId, { timeoutMs: 15 * 60_000 }) as Omit<PreparedSeedanceAudioReference, "placementKey">;
      if (!output.videoUrl) throw new Error("Trigger completed without a durable Video_1 URL.");
      const activePlacementKey = buildSeedanceAudioPlacementKey({
        audioObjectKey: activeMasterAudio.objectKey,
        songStart,
        songEnd,
        songDuration: activeMasterAudio.duration,
        handleSeconds,
      });
      setPreparedAudioReference({ ...output, placementKey: activePlacementKey });
      setSeedanceAudioStatus(`Video_1 ready · audio ${fmtCutTime(output.clipStart)}–${fmtCutTime(output.clipEnd)} · selected section begins ${output.sectionStartOffset.toFixed(2)}s into the reference.`);
      setSeedanceCopyStatus("Video_1 is ready. Copy the complete submission packet when the prompt is approved.");
    } catch (error) {
      setSeedanceAudioStatus(error instanceof Error ? error.message : "Seedance timing reference failed.");
    } finally {
      setIsPreparingAudioReference(false);
    }
  };
  const copySeedancePacket = async () => {
    try {
      await navigator.clipboard.writeText(serializeSeedanceContinuationPacket(seedancePacket));
      setSeedanceCopyStatus("Copied prompt, exact reference order, and verified test settings.");
    } catch {
      setSeedanceCopyStatus("Clipboard access failed. Copy the prompt and reference URLs below manually.");
    }
  };

  return (
    <div className="space-y-3">
      {selectedSegment ? (
        <div className="rounded-[2px] border border-[#2b2119] bg-[#100a06] px-2 py-1.5 font-mono text-[8px] text-[#b27a56]">
          Selected cut anchor · {selectedSegment.sourceRefLabel ?? moment?.sourceRefLabel ?? "source"} · song {fmtCutTime(selectedSegment.musicStart)}–{fmtCutTime(selectedSegment.musicEnd)} · source {fmtCutTime(selectedSegment.startTime)}–{fmtCutTime(selectedSegment.endTime)}
        </div>
      ) : null}
      <div className="grid grid-cols-3 gap-2">
        {frames.map((frame) => (
          <div key={frame.label} className="overflow-hidden rounded-[2px] border border-[#202020] bg-[#070707]">
            <div className="relative aspect-video bg-[#030303]">
              {frame.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={frame.url} alt={frame.label} className="h-full w-full object-cover" loading="lazy" decoding="async" />
              ) : <div className="flex h-full items-center justify-center text-[8px] uppercase tracking-[0.12em] text-[#444]">No frame</div>}
              <span className="absolute left-1 top-1 rounded-[2px] bg-[#000000b8] px-1.5 py-1 text-[7px] uppercase tracking-[0.1em] text-[#ddd]">{frame.label}</span>
            </div>
            <button type="button" disabled className="w-full cursor-not-allowed border-t border-[#181818] px-2 py-1.5 text-[8px] uppercase tracking-[0.12em] text-[#666]" title="Generation endpoint pending">{frame.action}</button>
          </div>
        ))}
      </div>
      <div className="rounded-[2px] border border-[#1f1f1f] bg-[#070707] p-2">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-[8px] uppercase tracking-[0.16em] text-[#555]">Nano Banana Pro reference order</div>
          <div className="font-mono text-[8px] text-[#777]">{referencePlan.imageUrls.length} image_urls</div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <ReferenceSelect label="Char 1" value={referenceSelection.character1Id ?? ""} assets={referenceAssets.filter((asset) => asset.role === "character-1")} onChange={(id) => onReferenceSelection({ ...referenceSelection, character1Id: id || undefined })} />
          <ReferenceSelect label="Char 2" value={referenceSelection.character2Id ?? ""} assets={referenceAssets.filter((asset) => asset.role === "character-2")} onChange={(id) => onReferenceSelection({ ...referenceSelection, character2Id: id || undefined })} />
          <ReferenceSelect label="Environment" value={referenceSelection.environmentId ?? ""} assets={referenceAssets.filter((asset) => asset.role === "environment")} onChange={(id) => onReferenceSelection({ ...referenceSelection, environmentId: id || undefined })} />
          <ReferenceSelect label="Custom" value={referenceSelection.customId ?? ""} assets={referenceAssets.filter((asset) => asset.role === "custom")} onChange={(id) => onReferenceSelection({ ...referenceSelection, customId: id || undefined })} />
        </div>
        <CrowdReferenceMultiSelect
          assets={referenceAssets.filter((asset) => asset.role === "crowd")}
          values={referenceSelection.crowdIds ?? []}
          onChange={(crowdIds) => onReferenceSelection({ ...referenceSelection, crowdIds })}
        />
        {referencePlan.errors.length ? (
          <div className="mt-2 rounded-[2px] border border-[#743029] bg-[#160706] p-2 text-[9px] leading-4 text-[#d24b3f]">
            {referencePlan.errors.map((error) => <div key={error}>{error}</div>)}
          </div>
        ) : null}
        <div className="mt-2 space-y-1 font-mono text-[8px] text-[#666]">
          {referencePlan.inputs.map((input, index) => (
            <div key={`${input.role}-${input.assetId ?? input.url}`} className="truncate" title={input.url}>[{index}] {input.role} · {input.label} · {input.url}</div>
          ))}
          {!referencePlan.inputs.length ? <div>No source frame or references selected.</div> : null}
        </div>
      </div>

      <div className="rounded-[2px] border border-[#24476f] bg-[#050b16] p-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-[8px] uppercase tracking-[0.16em] text-[#6ca6d2]">Seedance whole-shot replacement handoff</div>
            <div className="mt-1 text-[9px] leading-4 text-[#7d8fa1]">Opening frame = composition/layout only. High-resolution character sheets always control identity. Replace the entire shot plus handles, never append matching movement to its ending frame. Video_1 carries master-song timing only.</div>
          </div>
          <div className="rounded-[2px] border border-[#24476f] px-2 py-1 font-mono text-[8px] uppercase tracking-[0.12em] text-[#6ca6d2]">{seedanceModel} · {seedancePacket.durationSeconds}s · 16:9 · {seedanceResolution}</div>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2 text-[10px] text-[#aaa]">
          <label>Video model<select aria-label="Seedance video model" value={seedanceModel} onChange={(event) => setSeedanceModel(event.target.value as SeedanceVideoModel)} className="w-full bg-[#111] p-2"><option>Seedance 2.0</option><option>Seedance 2.5</option></select></label>
          <label>Video resolution<select aria-label="Seedance video resolution" value={seedanceResolution} onChange={(event) => setSeedanceResolution(event.target.value as "480p" | "720p")} className="w-full bg-[#111] p-2"><option>480p</option><option>720p</option></select></label>
          <label>Handles per side<select aria-label="Replacement handles" value={handleSeconds} onChange={(event) => setHandleSeconds(Number(event.target.value))} className="w-full bg-[#111] p-2"><option value={0}>0s</option><option value={1}>1s</option><option value={2}>2s</option><option value={3}>3s</option></select></label>
        </div>
        <div className="mt-2 rounded-[2px] border border-[#14283d] bg-[#03070c] p-2 font-mono text-[8px] leading-4 text-[#72879a]">
          <div>{seedancePacket.references.length} ordered image references · @Image_1 is opening composition only · @Video_1 is audio/rhythm/lip-sync timing only. Verify provider subscription and mode before submitting; no video is submitted by this page.</div>
          <div className={`mt-1 ${activeAudioReference ? "text-[#78c878]" : "text-[#d3a236]"}`}>{activeAudioReference ? `@Video_1 · ${activeAudioReference.videoUrl}` : "@Video_1 · not prepared for this placement"}</div>
          {seedancePacket.references.map((reference) => (
            <div key={`${reference.tag}-${reference.url}`} className="mt-1 truncate" title={reference.url}>{reference.tag} · {reference.role} · {reference.label} · {reference.url}</div>
          ))}
        </div>
        {seedancePacket.errors.length ? (
          <div className="mt-2 rounded-[2px] border border-[#743029] bg-[#160706] p-2 text-[9px] leading-4 text-[#d24b3f]">
            {seedancePacket.errors.map((error) => <div key={error}>{error}</div>)}
          </div>
        ) : null}
        <label className="mt-2 block">
          <span className="mb-1 block text-[8px] uppercase tracking-[0.14em] text-[#6c8294]">Current-clip prompt only</span>
          <textarea readOnly value={seedancePacket.prompt} rows={9} className="w-full resize-y rounded-[2px] border border-[#14283d] bg-[#03070c] px-2 py-1.5 font-mono text-[9px] leading-4 text-[#9fb4c5] outline-none" />
        </label>
        <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
          <div className="rounded-[2px] border border-[#14283d] bg-[#03070c] p-2 font-mono text-[8px] leading-4 text-[#72879a]">{activeAudioReference ? seedanceCopyStatus : visibleAudioStatus}</div>
          <button type="button" disabled={isPreparingAudioReference || seedancePacket.errors.length > 0 || !masterAudioRef || !placementKey} onClick={() => void prepareSeedanceSubmission()} className="rounded-[2px] border border-[#695019] bg-[#120e04] px-3 py-2 text-[8px] uppercase tracking-[0.12em] text-[#d3a236] disabled:cursor-not-allowed disabled:opacity-45">{isPreparingAudioReference ? "Rendering Video_1..." : activeAudioReference ? "Re-render Video_1" : "Prepare Video_1"}</button>
          <button type="button" disabled={seedancePacket.errors.length > 0 || !activeAudioReference} onClick={copySeedancePacket} className="rounded-[2px] border border-[#24476f] bg-[#07111e] px-3 py-2 text-[8px] uppercase tracking-[0.12em] text-[#6ca6d2] disabled:cursor-not-allowed disabled:opacity-45">Copy submission packet</button>
        </div>
      </div>


      <div className="rounded-[2px] border border-[#1f1f1f] bg-[#070707] p-2">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-[8px] uppercase tracking-[0.16em] text-[#555]">Local SwarmUI gateway</div>
            <div className="mt-1 text-[9px] leading-4 text-[#777]">Server-side route uses SWARMUI_URL. Raw Comfy calls go through SwarmUI /ComfyBackendDirect, so the Mac does not need direct Comfy port access.</div>
          </div>
<div className="rounded-[2px] border border-[#202020] bg-[#050505] px-2 py-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-[#9a9a9a]">SwarmUI API</div>
        </div>
        <div className="rounded-[2px] border border-[#151515] bg-[#050505] p-2 font-mono text-[8px] leading-4 text-[#777]">{providerStatus}</div>
        <label className="mt-2 block">
          <span className="mb-1 block text-[8px] uppercase tracking-[0.14em] text-[#666]">Local image preset</span>
          <select
            value={selectedPresetTitle}
            onChange={(event) => onPresetChange(event.target.value)}
            className="w-full rounded-[2px] border border-[#202020] bg-[#050505] px-2 py-1.5 font-mono text-[9px] text-[#9a9a9a] outline-none focus:border-[#e05c00]"
          >
            {presets.map((preset) => (
              <option key={preset.title} value={preset.title}>
                {preset.label} · {preset.width}x{preset.height}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[9px] leading-4 text-[#666]">{selectedPreset.description}</span>
        </label>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <button type="button" onClick={onCheckProvider} className="rounded-[2px] border border-[#2a2a2a] px-2 py-2 text-[8px] uppercase tracking-[0.12em] text-[#aaa] hover:border-[#e05c00] hover:text-[#e05c00]">Check SwarmUI</button>
          <button type="button" disabled={isGenerating || !slot} onClick={onGenerateImage} className="rounded-[2px] border border-[#6e3425] bg-[#160905] px-2 py-2 text-[8px] uppercase tracking-[0.12em] text-[#d26c42] disabled:cursor-not-allowed disabled:opacity-45">Generate image</button>
          <button type="button" disabled title="Video generation uses the Seedance replacement handoff" className="rounded-[2px] border border-[#24476f] bg-[#050b16] px-2 py-2 text-[8px] uppercase tracking-[0.12em] text-[#6ca6d2] disabled:cursor-not-allowed disabled:opacity-45">Seedance video only</button>
        </div>
        {generatedAssets.length ? (
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {generatedAssets.slice(0, 6).map((asset, index) => (
              <a key={`${asset.url}-${index}`} href={asset.url} target="_blank" rel="noreferrer" className="overflow-hidden rounded-[2px] border border-[#202020] bg-[#050505]">
                <div className="flex aspect-video items-center justify-center text-[8px] uppercase tracking-[0.12em] text-[#777]">
                  {asset.kind === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={asset.url} alt={asset.filename ?? asset.path ?? "generated image"} className="h-full w-full object-cover" loading="lazy" decoding="async" />
                  ) : "Generated video"}
                </div>
                <div className="truncate border-t border-[#151515] px-2 py-1 font-mono text-[7px] text-[#666]">{asset.filename ?? asset.path ?? asset.provider}</div>
              </a>
            ))}
          </div>
        ) : null}
        <div className="mt-2 rounded-[2px] border border-[#151515] bg-[#050505] p-2 text-[8px] leading-4 text-[#777]">
          Grid splitting is reserved for Higgsfield / Nano Banana contact-sheet outputs. SwarmUI still generations stay as normal single images here.
        </div>
      </div>
    </div>
  );
}


function ReferenceSelect({ label, value, assets, onChange }: { label: string; value: string; assets: ReferenceAsset[]; onChange: (id: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[8px] uppercase tracking-[0.14em] text-[#666]">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-[2px] border border-[#202020] bg-[#050505] px-2 py-1.5 font-mono text-[9px] text-[#9a9a9a] outline-none focus:border-[#e05c00]"
      >
        <option value="">None</option>
        {assets.map((asset) => (
          <option key={asset.id} value={asset.id}>
            {asset.displayName} · {asset.storageStatus}
          </option>
        ))}
      </select>
    </label>
  );
}

function CrowdReferenceMultiSelect({ assets, values, onChange }: { assets: ReferenceAsset[]; values: string[]; onChange: (ids: string[]) => void }) {
  const selectedIds = normalizeCrowdReferenceIds(values);
  const selectedSet = new Set(selectedIds);
  const atLimit = selectedIds.length >= MAX_CROWD_REFERENCE_SELECTIONS;

  const toggle = (assetId: string) => {
    if (selectedSet.has(assetId)) {
      onChange(selectedIds.filter((id) => id !== assetId));
      return;
    }
    if (!atLimit) onChange([...selectedIds, assetId]);
  };

  return (
    <details className="mt-2 rounded-[2px] border border-[#202020] bg-[#050505]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-2 py-2 marker:hidden">
        <div>
          <div className="text-[8px] uppercase tracking-[0.14em] text-[#777]">Crowd / extras</div>
          <div className="mt-1 text-[8px] text-[#555]">Expandable sheet tray · choose up to {MAX_CROWD_REFERENCE_SELECTIONS} for this shot</div>
        </div>
        <div className="font-mono text-[8px] text-[#78c878]">{selectedIds.length}/{assets.length} selected</div>
      </summary>
      <div className="border-t border-[#181818] p-2">
        {assets.length ? (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {assets.map((asset) => {
              const selected = selectedSet.has(asset.id);
              const disabled = !selected && atLimit;
              return (
                <button
                  key={asset.id}
                  type="button"
                  aria-pressed={selected}
                  disabled={disabled}
                  onClick={() => toggle(asset.id)}
                  className={`w-[184px] shrink-0 overflow-hidden rounded-[2px] border text-left disabled:cursor-not-allowed disabled:opacity-35 ${selected ? "border-[#e05c00] bg-[#120904]" : "border-[#202020] bg-[#070707]"}`}
                >
                  <div className="relative aspect-video bg-black">
                    {asset.previewUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={asset.previewUrl} alt={asset.displayName} className="h-full w-full object-contain" loading="lazy" decoding="async" />
                    ) : <div className="flex h-full items-center justify-center text-[8px] uppercase text-[#444]">No preview</div>}
                    <span className={`absolute right-1 top-1 rounded-[1px] px-1.5 py-0.5 font-mono text-[7px] uppercase ${selected ? "bg-[#e05c00] text-black" : "bg-[#000000c7] text-[#777]"}`}>{selected ? "Selected" : "Available"}</span>
                  </div>
                  <div className="truncate px-2 py-1.5 font-mono text-[8px] text-[#aaa]">{asset.displayName}</div>
                </button>
              );
            })}
          </div>
        ) : <div className="py-3 text-center text-[8px] uppercase tracking-[0.12em] text-[#555]">Add crowd sheets in Ingest</div>}
      </div>
    </details>
  );
}

function fillDefaultReferenceSelection(selection: GenerationReferenceSelection, assets: ReferenceAsset[]): GenerationReferenceSelection {
  const pick = (role: ReferenceAsset["role"]) => assets.find((asset) => asset.role === role)?.id;
  return {
    character1Id: selection.character1Id ?? pick("character-1"),
    character2Id: selection.character2Id ?? pick("character-2"),
    environmentId: selection.environmentId ?? pick("environment"),
    crowdIds: selection.crowdIds ?? assets.filter((asset) => asset.role === "crowd").slice(0, MAX_CROWD_REFERENCE_SELECTIONS).map((asset) => asset.id),
    customId: selection.customId ?? pick("custom"),
  };
}

function GeneratedShotBank({
  assets,
  previewSegments,
  onUpdate,
  onAudition,
}: {
  assets: GeneratedStudioAsset[];
  previewSegments: EditPlanPreviewSegment[];
  onUpdate: (asset: GeneratedStudioAsset) => void;
  onAudition: (asset: GeneratedStudioAsset, contextRadius: number) => void;
}) {
  const videos = assets
    .filter((asset) => asset.mediaKind === "video")
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  if (!videos.length) {
    return <EmptyState label="No returned generated clips" detail="Import completed Seedance videos here. They stay out of Join until you explicitly approve one for its assigned song slot." />;
  }
  return (
    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
      {videos.map((asset, index) => (
        <GeneratedShotCard
          key={asset.id}
          asset={asset}
          index={index}
          previewSegments={previewSegments}
          onUpdate={onUpdate}
          onAudition={onAudition}
        />
      ))}
    </div>
  );
}

function GeneratedShotCard({
  asset,
  index,
  previewSegments,
  onUpdate,
  onAudition,
}: {
  asset: GeneratedStudioAsset;
  index: number;
  previewSegments: EditPlanPreviewSegment[];
  onUpdate: (asset: GeneratedStudioAsset) => void;
  onAudition: (asset: GeneratedStudioAsset, contextRadius: number) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [note, setNote] = useState(asset.reviewNotes ?? "");
  const [playingSelection, setPlayingSelection] = useState(false);
  const [previewTrimFrame, setPreviewTrimFrame] = useState<number | null>(null);
  const previewTrimFrameRef = useRef<number | null>(null);
  const dragPointerIdRef = useRef<number | null>(null);
  const videoUrl = asset.fullStorage?.mediaUrl ?? asset.fullStorage?.publicUrl ?? asset.resultUrl;
  const reviewStatus = asset.reviewStatus ?? "pending";
  const committedTrimWindow = resolveGeneratedAssetTrimWindow({
    trimStart: asset.trimStart,
    sourceDuration: asset.durationSeconds,
    requiredDuration: (asset.target?.songEnd ?? 0) - (asset.target?.songStart ?? 0),
  });
  const { framesPerSecond: trimFramesPerSecond, maxFrame: maxTrimStartFrame, valueFrame: trimStartFrame } = resolveGeneratedAssetTrimFrameControl({
    trimStart: committedTrimWindow.trimStart,
    maxTrimStart: committedTrimWindow.maxTrimStart,
  });
  const activeTrimFrame = Math.max(0, Math.min(previewTrimFrame ?? trimStartFrame, maxTrimStartFrame));
  const { requiredDuration, sourceDuration, maxTrimStart, trimStart, trimEnd, selectedWidthPct, selectedLeftPct } = resolveGeneratedAssetTrimWindow({
    trimStart: activeTrimFrame / trimFramesPerSecond,
    sourceDuration: asset.durationSeconds,
    requiredDuration: (asset.target?.songEnd ?? 0) - (asset.target?.songStart ?? 0),
  });
  const context = buildGeneratedAssetContextPreview(previewSegments, asset, 2);

  const commitTrimStart = (value: number) => {
    const next = Math.max(0, Math.min(value, maxTrimStart));
    onUpdate({ ...asset, trimStart: Number(next.toFixed(3)) });
  };

  const previewFrame = (value: number) => {
    const nextFrame = Math.max(0, Math.min(Math.round(value), maxTrimStartFrame));
    previewTrimFrameRef.current = nextFrame;
    setPreviewTrimFrame(nextFrame);
  };

  const commitPreviewFrame = () => {
    const nextFrame = previewTrimFrameRef.current;
    if (nextFrame === null) return;
    previewTrimFrameRef.current = null;
    if (nextFrame === trimStartFrame) {
      setPreviewTrimFrame(null);
      return;
    }
    commitTrimStart(nextFrame / trimFramesPerSecond);
  };

  const previewPointerFrame = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = resolveRangePointerRatio({ clientX: event.clientX, left: bounds.left, width: bounds.width });
    previewFrame(ratio * maxTrimStartFrame);
  };

  const beginPointerDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (maxTrimStartFrame <= 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    dragPointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    previewPointerFrame(event);
  };

  const continuePointerDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragPointerIdRef.current !== event.pointerId) return;
    previewPointerFrame(event);
  };

  const finishPointerDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragPointerIdRef.current !== event.pointerId) return;
    previewPointerFrame(event);
    dragPointerIdRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    commitPreviewFrame();
  };

  const cancelPointerDrag = () => {
    dragPointerIdRef.current = null;
    commitPreviewFrame();
  };

  const handleTrimKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const direction = event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : event.key === "ArrowRight" || event.key === "ArrowUp" ? 1 : 0;
    const nextFrame = event.key === "Home" ? 0 : event.key === "End" ? maxTrimStartFrame : direction ? activeTrimFrame + direction : null;
    if (nextFrame === null) return;
    event.preventDefault();
    previewFrame(nextFrame);
    commitPreviewFrame();
  };

  useEffect(() => {
    if (previewTrimFrame === null || previewTrimFrame !== trimStartFrame) return;
    const clearPreviewTimer = window.setTimeout(() => setPreviewTrimFrame(null), 0);
    return () => window.clearTimeout(clearPreviewTimer);
  }, [previewTrimFrame, trimStartFrame]);

  const playSelectedWindow = async () => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = trimStart;
    setPlayingSelection(true);
    await video.play();
  };

  return (
    <article className={`rounded-[2px] border bg-[#080808] p-2 ${reviewStatus === "approved" ? "border-[#245c2c]" : reviewStatus === "rejected" ? "border-[#743029]" : "border-[#695019]"}`}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="min-w-0 truncate font-mono text-[9px] uppercase tracking-[0.14em] text-[#d0d0d0]">GEN_{String(index + 1).padStart(2, "0")} · {asset.model}</div>
            <span className={`rounded-[2px] border px-1.5 py-0.5 text-[7px] uppercase tracking-[0.1em] ${reviewStatus === "approved" ? "border-[#245c2c] text-[#78c878]" : reviewStatus === "rejected" ? "border-[#743029] text-[#dc6257]" : "border-[#695019] text-[#d3a236]"}`}>{reviewStatus}</span>
          </div>
          <div className="overflow-hidden rounded-[1px] border border-[#1b1b1b] bg-black">
            {videoUrl ? (
              <video
                ref={videoRef}
                src={videoUrl}
                controls
                preload="metadata"
                onTimeUpdate={(event) => {
                  if (playingSelection && event.currentTarget.currentTime >= trimEnd) {
                    event.currentTarget.pause();
                    setPlayingSelection(false);
                  }
                }}
                onPause={() => setPlayingSelection(false)}
                className="aspect-video w-full object-contain"
              />
            ) : <div className="flex aspect-video items-center justify-center text-[8px] uppercase tracking-[0.12em] text-[#555]">Missing video</div>}
          </div>
          <div className="mt-2 font-mono text-[8px] text-[#777]">
            <div className="min-w-0 border-b border-[#171717] pb-2">
              <div className="truncate" title={asset.target?.sectionLabel}>{asset.target?.sectionLabel ?? "Unassigned slot"}</div>
              <div className="mt-1">SONG {fmtCutTime(asset.target?.songStart ?? 0)}–{fmtCutTime(asset.target?.songEnd ?? 0)} · need {requiredDuration.toFixed(2)}s</div>
            </div>

            <div className="mt-2 rounded-[2px] border border-[#1b1b1b] bg-[#050505] p-2">
              <div className="flex items-center justify-between gap-2 uppercase tracking-[0.1em] text-[#666]">
                <span>Source window · fixed to song slot</span>
                <span>{sourceDuration.toFixed(2)}s source</span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  aria-label={`Move source window for ${asset.title ?? asset.model} one frame earlier`}
                  disabled={activeTrimFrame <= 0}
                  onClick={() => commitTrimStart((activeTrimFrame - 1) / trimFramesPerSecond)}
                  className="h-7 w-7 shrink-0 rounded-[2px] border border-[#262626] text-[12px] text-[#777] hover:border-[#555] hover:text-[#ddd] disabled:opacity-30"
                >−</button>
                <div className="relative h-9 min-w-0 flex-1">
                  <div className="pointer-events-none absolute inset-x-0 top-1/2 h-[6px] -translate-y-1/2 overflow-hidden rounded-[2px] border border-[#242424] bg-[#171717]">
                    <div className="absolute inset-y-0 bg-[#1c5b6d]" style={{ left: `${selectedLeftPct}%`, width: `${selectedWidthPct}%` }} />
                  </div>
                  <div className="pointer-events-none absolute top-1/2 h-5 w-px -translate-y-1/2 bg-[#55c5e5]" style={{ left: `${selectedLeftPct}%` }} title={`In ${trimStart.toFixed(2)}s`} />
                  <div className="pointer-events-none absolute top-1/2 h-5 w-px -translate-x-full -translate-y-1/2 bg-[#55c5e5]" style={{ left: `${selectedLeftPct + selectedWidthPct}%` }} title={`Out ${trimEnd.toFixed(2)}s`} />
                  <div
                    role="slider"
                    tabIndex={maxTrimStartFrame <= 0 ? -1 : 0}
                    aria-label={`Move source window for ${asset.title ?? asset.model}`}
                    aria-valuemin={0}
                    aria-valuemax={maxTrimStartFrame}
                    aria-valuenow={activeTrimFrame}
                    aria-valuetext={`${trimStart.toFixed(2)} to ${trimEnd.toFixed(2)} seconds`}
                    title={`Selected source window: ${trimStart.toFixed(2)}s–${trimEnd.toFixed(2)}s`}
                    aria-disabled={maxTrimStartFrame <= 0}
                    onPointerDown={beginPointerDrag}
                    onPointerMove={continuePointerDrag}
                    onPointerUp={finishPointerDrag}
                    onPointerCancel={cancelPointerDrag}
                    onKeyDown={handleTrimKeyDown}
                    onBlur={commitPreviewFrame}
                    className="studio-window-control absolute inset-0 z-20 h-full w-full"
                  >
                    <span className="studio-window-thumb" style={{ left: `${selectedLeftPct}%` }} aria-hidden="true" />
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={`Move source window for ${asset.title ?? asset.model} one frame later`}
                  disabled={activeTrimFrame >= maxTrimStartFrame}
                  onClick={() => commitTrimStart((activeTrimFrame + 1) / trimFramesPerSecond)}
                  className="h-7 w-7 shrink-0 rounded-[2px] border border-[#262626] text-[12px] text-[#777] hover:border-[#555] hover:text-[#ddd] disabled:opacity-30"
                >+</button>
              </div>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <div className="rounded-[1px] border border-[#1d343a] bg-[#071014] px-2 py-1"><span className="text-[#52737c]">IN / START FRAME</span><div className="mt-0.5 text-[#b6e6ef]">{trimStart.toFixed(2)}s · f{Math.round(trimStart * 30)}</div></div>
                <div className="rounded-[1px] border border-[#1d343a] bg-[#071014] px-2 py-1"><span className="text-[#52737c]">OUT / LAST FRAME</span><div className="mt-0.5 text-[#b6e6ef]">{trimEnd.toFixed(2)}s · f{Math.round(trimEnd * 30)}</div></div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button type="button" disabled={!videoUrl} onClick={() => void playSelectedWindow()} className="rounded-[2px] border border-[#1d5362] px-2 py-1 uppercase tracking-[0.1em] text-[#6bc8dc] disabled:opacity-35">Play selected</button>
                <button type="button" disabled={!videoUrl} onClick={() => commitTrimStart(videoRef.current?.currentTime ?? trimStart)} className="rounded-[2px] border border-[#303030] px-2 py-1 uppercase tracking-[0.1em] text-[#888] disabled:opacity-35">Set in at playhead</button>
                <button type="button" disabled={!context || !videoUrl} onClick={() => onAudition(asset, 2)} className="rounded-[2px] border border-[#e05c00] bg-[#120b06] px-2 py-1 uppercase tracking-[0.1em] text-[#e05c00] disabled:border-[#303030] disabled:bg-transparent disabled:text-[#555]">Audition ±2 cuts</button>
              </div>
            </div>
          </div>

          {context ? (
            <div className="mt-2 rounded-[2px] border border-[#1b1b1b] bg-[#050505] p-2">
              <div className="mb-1 text-[7px] uppercase tracking-[0.12em] text-[#555]">Edit context · generated clip replaces the cyan slot only</div>
              <div className="flex gap-1">
                {context.segments.map((segment, contextIndex) => {
                  const absoluteIndex = context.startIndex + contextIndex;
                  const isTarget = absoluteIndex === context.targetIndex;
                  return (
                    <div key={`${segment.musicStart}-${absoluteIndex}`} className={`min-w-0 flex-1 rounded-[1px] border px-1 py-1 text-center font-mono text-[7px] ${isTarget ? "border-[#55c5e5] bg-[#0a1d23] text-[#9bddeb]" : "border-[#202020] bg-[#090909] text-[#666]"}`}>
                      <div>{isTarget ? "GEN" : `CUT ${String(absoluteIndex + 1).padStart(3, "0")}`}</div>
                      <div className="mt-0.5 truncate">{fmtCutTime(segment.musicStart)}–{fmtCutTime(segment.musicEnd)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Review notes: identity, duplicates, continuity, action..."
            rows={2}
            className="mt-2 w-full resize-y rounded-[1px] border border-[#202020] bg-[#040404] px-2 py-1 font-mono text-[8px] leading-4 text-[#aaa] outline-none placeholder:text-[#444] focus:border-[#e05c00]"
          />
          <div className="mt-2 flex gap-1.5">
            <button type="button" disabled={!videoUrl} onClick={() => onUpdate({ ...asset, reviewStatus: "approved", reviewNotes: note })} className="flex-1 rounded-[2px] border border-[#245c2c] px-2 py-1 text-[8px] uppercase tracking-[0.1em] text-[#78c878] disabled:cursor-not-allowed disabled:opacity-40">Approve into Join</button>
            <button type="button" onClick={() => onUpdate({ ...asset, reviewStatus: "rejected", reviewNotes: note })} className="flex-1 rounded-[2px] border border-[#743029] px-2 py-1 text-[8px] uppercase tracking-[0.1em] text-[#dc6257]">Reject</button>
            <button type="button" onClick={() => onUpdate({ ...asset, reviewStatus: "pending", reviewNotes: note })} className="rounded-[2px] border border-[#303030] px-2 py-1 text-[8px] uppercase tracking-[0.1em] text-[#777]">Reopen</button>
          </div>
    </article>
  );
}

function inferSeedanceModel(filename: string) {
  if (/seedance[-_. ]?2[._-]?5/i.test(filename)) return "seedance_2_5";
  if (/seedance[-_. ]?2[._-]?0/i.test(filename)) return "seedance_2_0";
  return "seedance";
}

function readVideoDuration(file: File) {
  return new Promise<number>((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    const finish = (duration: number) => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(duration) ? duration : 0);
    };
    video.preload = "metadata";
    video.onloadedmetadata = () => finish(video.duration);
    video.onerror = () => finish(0);
    video.src = url;
  });
}

function TrackLaneBoard({ slots, duration }: { slots: CoverageSlot[]; duration: number }) {
  const lanes = [
    { label: "Track A", sub: "real matched footage", color: "#255f34", filter: (slot: CoverageSlot) => slot.status === "filled" || slot.status === "short" },
    { label: "Track B", sub: "generated B-roll / alt", color: "#28657f", filter: (slot: CoverageSlot) => slot.status === "missing" || slot.status === "weak" },
    { label: "Track C", sub: "extensions / bridges", color: "#7a3aa0", filter: (slot: CoverageSlot) => slot.status === "short" || slot.needs.includes("bridge") },
    { label: "Track D", sub: "effects / texture", color: "#a85a18", filter: () => true },
  ];
  return (
    <div className="space-y-2">
      {lanes.map((lane) => (
        <div key={lane.label} className="grid grid-cols-[120px_1fr] gap-2 rounded-[2px] border border-[#161616] bg-[#070707] p-2">
          <div>
            <div className="text-[9px] uppercase tracking-[0.16em] text-[#d0d0d0]">{lane.label}</div>
            <div className="mt-1 text-[9px] text-[#555]">{lane.sub}</div>
          </div>
          <div className="relative h-8 border border-[#101010] bg-[#030303]">
            {slots.filter(lane.filter).map((slot) => {
              const left = clamp01(slot.item.start / duration) * 100;
              const width = Math.max(0.35, clamp01(slot.requiredDuration / duration) * 100);
              return <div key={`${lane.label}-${slot.item.id}`} className="absolute inset-y-1 rounded-[1px]" style={{ left: `${left}%`, width: `${width}%`, background: lane.color, opacity: slot.status === "missing" ? 0.35 : 0.82 }} title={`${lane.label} · ${slot.item.label}`} />;
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function FrameThumb({ moment, label }: { moment?: VideoMoment; label: string }) {
  const url = moment?.firstFrameUrl ?? moment?.thumbnailUrl;
  return (
    <div className="overflow-hidden rounded-[2px] border border-[#202020] bg-[#050505]">
      <div className="relative aspect-video">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={label} className="h-full w-full object-cover" loading="lazy" decoding="async" />
        ) : <div className="flex h-full items-center justify-center text-[8px] uppercase tracking-[0.12em] text-[#444]">No frame</div>}
      </div>
      <div className="truncate border-t border-[#181818] px-2 py-1 font-mono text-[8px] text-[#666]">{label}</div>
    </div>
  );
}

function EmptyState({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="rounded-[2px] border border-dashed border-[#252525] bg-[#070707] px-3 py-8 text-center">
      <div className="text-[10px] uppercase tracking-[0.16em] text-[#555]">{label}</div>
      <div className="mt-2 text-[10px] text-[#666]">{detail}</div>
    </div>
  );
}

function buildSuggestedPrompt(slot?: CoverageSlot, moment?: VideoMoment, referenceInstructions: string[] = [], characterNames: string[] = []) {
  if (!slot) return "Select a weak, short, or missing timeline slot to draft an extension prompt.";
  const action = slot.status === "missing" ? "Create a new connected music-video shot" : slot.status === "short" ? "Extend this source clip naturally" : slot.status === "weak" ? "Create an alternate angle that better matches the lyric/story intent" : "Create an optional Camera B variation";
  const motion = describeMotion(moment?.motionDescriptor ?? moment?.visualAnalysis?.motion);
  const momentCaption = getGenerationMomentCaption(moment, characterNames);
  const caption = momentCaption ? ` Source caption: ${momentCaption}` : "";
  const references = referenceInstructions.length ? ` References: ${referenceInstructions.join(" ")}` : "";
  return `${action} for ${slot.item.label} (${fmt(slot.item.start)}–${fmt(slot.item.end)}). Story intent: ${slot.item.prompt}.${caption} Maintain motion continuity (${motion}), preserve the color palette, and leave handles for a music-video edit.${references}`;
}

function getMomentCaption(moment?: VideoMoment) {
  const caption = parseCaptionText(moment?.captionMeta?.caption) ?? parseCaptionText(moment?.caption);
  return caption ? moderationSafeText(caption) : undefined;
}

export function getGenerationMomentCaption(moment: VideoMoment | undefined, characterNames: string[]) {
  const caption = getMomentCaption(moment);
  if (!caption || !characterNames.some((name) => containsCharacterName(caption, name))) return caption;
  return undefined;
}

function getSelectedCharacterNames(assets: ReferenceAsset[], selection: GenerationReferenceSelection) {
  return [selection.character1Id, selection.character2Id]
    .flatMap((id) => id ? assets.filter((asset) => asset.id === id).map((asset) => asset.displayName.trim()) : [])
    .filter(Boolean);
}

function containsCharacterName(value: string, name: string) {
  const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return Boolean(escaped) && new RegExp(`\\b${escaped}\\b`, "i").test(value);
}

// Nano Banana Pro rejects prompts with NSFW-flagged vocabulary even when it
// only describes wardrobe/lighting from real footage — these rewrites keep
// story text and captions passing moderation without changing visual intent.
const MODERATION_SAFE_REWRITES: Array<[RegExp, string]> = [
  [/\bsteamy\b/gi, "haze-filled"],
  [/\bsexy\b/gi, "stylish"],
  [/\bsensual\b/gi, "elegant"],
  [/\bseductive\b/gi, "confident"],
  [/\bprovocative\b/gi, "striking"],
  [/\bsultry\b/gi, "moody"],
  [/\berotic\b/gi, "dramatic"],
  [/\bshirtless\b/gi, "wearing an open shirt"],
  [/\bclimax\b/gi, "tension peak"],
];

export function moderationSafeText(value: string) {
  return MODERATION_SAFE_REWRITES.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}

function parseCaptionText(value?: string) {
  const raw = value?.trim();
  if (!raw) return undefined;
  if (!raw.startsWith("{")) return raw;
  const normalized = raw.replace(/\\"/g, '"');
  try {
    const parsed = JSON.parse(normalized) as { caption?: unknown };
    return typeof parsed.caption === "string" && parsed.caption.trim() ? parsed.caption : raw;
  } catch {
    const captionMatch = normalized.match(/"caption"\s*:\s*"([\s\S]*?)"\s*,/);
    if (captionMatch?.[1]) {
      return captionMatch[1].replace(/\\"/g, '"');
    }
    return raw;
  }
}

function getPalette(moment?: VideoMoment): string[] {
  const swatches = moment?.visualAnalysis?.color?.palette ?? moment?.visualAnalysis?.color?.middlePalette ?? [];
  const colors = swatches.map(swatchToColor).filter((color): color is string => Boolean(color));
  return colors.length ? colors.slice(0, 5) : ["#263b35", "#617c54", "#c8923a", "#1b252a", "#4f3228"];
}

function swatchToColor(swatch: ColorPaletteSwatch): string | null {
  if (swatch.hex && /^#[0-9a-f]{6}$/i.test(swatch.hex)) return swatch.hex;
  return null;
}

function describeMotion(motion?: MotionDescriptor | null) {
  if (!motion) return "unknown";
  const type = motion.cameraMotionType ?? "unknown";
  const strength = motion.cameraMotionStrength ?? motion.dominantMagnitude ?? 0;
  const direction = typeof motion.dominantAngleDeg === "number" ? `${Math.round(motion.dominantAngleDeg)}°` : "no angle";
  return `${type} · ${strength.toFixed(2)} · ${direction}`;
}

function fmtCutTime(value: number) {
  const safe = Math.max(0, Number.isFinite(value) ? value : 0);
  const minutes = Math.floor(safe / 60);
  const seconds = (safe - minutes * 60).toFixed(2).padStart(5, "0");
  return `${minutes}:${seconds}`;
}

function sanitizeSeedanceRequestKey(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 160) || "seedance-section";
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
