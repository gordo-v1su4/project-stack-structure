"use client";

import { useMemo, useState } from "react";
import { fmt } from "../math";
import { buildGenerationReferenceInputs, type GenerationReferenceSelection, type ReferenceAsset } from "../referenceAssets";
import type { BeatJoinAnalysis, ColorPaletteSwatch, MotionDescriptor } from "../types";
import type { GeneratedStudioAsset } from "../generatedAssets";
import { buildSeedanceContinuationPacket, serializeSeedanceContinuationPacket } from "../seedanceContinuation";
import { buildAdaptiveCueMap } from "../adaptiveCueMap";
import type { EditPlanPreviewSegment, MusicVideoProject, TimelineItem, VideoMoment } from "../musicVideoProject";
import { selectPreviewCutRange, selectPreviewSectionRange, type PreviewCutRange } from "../resolvedPreviewSelection";
import { waitForTriggerRunOutput } from "@/lib/clientTriggerRuns";
import type { MediaGatewayUploadResult } from "@/lib/mediaGateway";

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
  onGeneratedAsset: (asset: GeneratedStudioAsset) => void;
  selectedPreviewRange: PreviewCutRange | null;
  onSelectedPreviewRange: (range: PreviewCutRange | null) => void;
  onAuditionPreviewRange: (range: PreviewCutRange) => void;
};

export type SlotStatus = "filled" | "weak" | "short" | "missing";
type GenerationNeed = "b-roll" | "alt-angle" | "extend-start" | "extend-end" | "bridge" | "reroll-match";
type TimelineZoomMode = "fit" | "section" | "selected";

type GeneratedLocalAsset = { provider: "swarmui" | "comfyui"; kind: "image" | "video"; url: string; filename?: string; path?: string };

type HiggsfieldGenerationFormState = {
  title: string;
  characterName: string;
  prompt: string;
  resolution: "1k" | "2k" | "4k";
  splitRows: number;
  splitCols: number;
  extraReferenceUrls: string;
};

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

const STATUS_LABELS: Record<SlotStatus, string> = {
  filled: "filled",
  weak: "weak match",
  short: "needs extension",
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
  "extend-start": "Extend From First Frame",
  "extend-end": "Extend From Last Frame",
  bridge: "Bridge A→B",
  "reroll-match": "Reroll Match",
};

export function GenerateTab({ project, analysis, storyGenerated, onSelectMatch, onSelectJoin, onsetDensity, lyricCueBlend, lyricMergeWindow, previewSegments, referenceAssets, persistedGeneratedAssets, onGeneratedAsset, selectedPreviewRange, onSelectedPreviewRange, onAuditionPreviewRange }: GenerateTabProps) {
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [timelineZoomMode, setTimelineZoomMode] = useState<TimelineZoomMode>("fit");
  const [referenceSelection, setReferenceSelection] = useState<GenerationReferenceSelection>({});
  const [generationStatus, setGenerationStatus] = useState("Local generator not checked yet.");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedAssets, setGeneratedAssets] = useState<GeneratedLocalAsset[]>([]);
  const [selectedPresetTitle, setSelectedPresetTitle] = useState(LOCAL_SWARM_PRESETS[0].title);
  const [higgsfieldStatus, setHiggsfieldStatus] = useState("Higgsfield not checked yet.");
  const [isHiggsfieldGenerating, setIsHiggsfieldGenerating] = useState(false);
  const [generatedImportStatus, setGeneratedImportStatus] = useState("Choose completed Seedance clips to return them to this exact edit slot.");
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
  const requiredIssues = issueGroups.filter((issue) => issue.status === "missing" || issue.status === "short");
  const reviewIssues = issueGroups.filter((issue) => issue.status === "weak");
  const focusSlot = slots.find((slot) => slot.item.id === selectedSlotId) ?? slots.find((slot) => slot.status !== "filled") ?? slots[0];
  const selectedPreset = LOCAL_SWARM_PRESETS.find((preset) => preset.title === selectedPresetTitle) ?? LOCAL_SWARM_PRESETS[0];
  const frameMoment = focusSlot?.moment ?? project?.videoMoments.find((moment) => moment.firstFrameUrl || moment.thumbnailUrl);
  const effectiveReferenceSelection = useMemo(() => fillDefaultReferenceSelection(referenceSelection, referenceAssets), [referenceAssets, referenceSelection]);
  const hasRequiredInputs = storyGenerated && Boolean(project?.editPlan.timelineItems.length);
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
    if (!focusSlot || !files.length) return;
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
        const formData = new FormData();
        formData.append("file", file);
        formData.append("folder", `media-uploads/generated/higgsfield/seedance/${project?.id ?? "draft"}/${focusSlot.item.id}`);
        const response = await fetch("/api/storage/upload", { method: "POST", body: formData });
        const payload = await response.json() as MediaGatewayUploadResult & { error?: string };
        if (!response.ok || payload.error) throw new Error(payload.error ?? `Generated clip upload failed with HTTP ${response.status}`);
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
            timelineItemId: focusSlot.item.id,
            sectionId: focusSlot.item.sectionId,
            sectionLabel: focusSlot.item.label,
            parentMomentId: focusSlot.moment?.id,
            songStart: focusSlot.item.start,
            songEnd: focusSlot.item.end,
          },
        });
      }
      setGeneratedImportStatus(`Returned ${videos.length} generated clip${videos.length === 1 ? "" : "s"} to ${focusSlot.item.label}. Review before Join.`);
    } catch (error) {
      setGeneratedImportStatus(error instanceof Error ? error.message : "Generated clip import failed.");
    } finally {
      setIsImportingGenerated(false);
    }
  };


  const runHiggsfieldGeneration = async (params: HiggsfieldGenerationFormState) => {
    const inputImages = buildHiggsfieldInputImages(referenceAssets, effectiveReferenceSelection, params.extraReferenceUrls);
    if (!inputImages.length) {
      setHiggsfieldStatus("Add at least one RustFS reference image before running Nano Banana Pro.");
      return;
    }
    setIsHiggsfieldGenerating(true);
    setHiggsfieldStatus(`Sending ${params.resolution.toUpperCase()} Nano Banana Pro grid to Higgsfield...`);
    try {
      const response = await fetch("/api/generate/higgsfield", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: params.title,
          characterName: params.characterName,
          prompt: params.prompt,
          aspectRatio: "16:9",
          resolution: params.resolution,
          inputImages,
          splitRows: params.splitRows,
          splitCols: params.splitCols,
        }),
      });
      const payload = await response.json() as { success?: boolean; error?: string; runId?: string };
      if (!response.ok || payload.error || !payload.runId) throw new Error(payload.error ?? `Higgsfield failed with HTTP ${response.status}`);
      setHiggsfieldStatus(`Higgsfield job queued through Trigger.dev (${payload.runId})...`);
      const asset = await waitForTriggerRunOutput(payload.runId, { timeoutMs: 20 * 60 * 1_000, pollIntervalMs: 3_000 }) as GeneratedStudioAsset;
      if (!asset?.id || asset.provider !== "higgsfield") throw new Error("Higgsfield completed without a valid durable asset.");
      onGeneratedAsset(asset);
      setHiggsfieldStatus(`Completed ${asset.jobId}. Full grid and ${asset.split?.panels.length ?? 0} panels uploaded to RustFS.`);
    } catch (error) {
      setHiggsfieldStatus(error instanceof Error ? error.message : "Higgsfield generation failed.");
    } finally {
      setIsHiggsfieldGenerating(false);
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
            <div className="text-[10px] uppercase tracking-[0.18em] text-[#e05c00]">Generate missing footage / extensions</div>
            <div className="mt-1 max-w-5xl text-[11px] leading-5 text-[#6d6d6d]">
              This page sits between Match and Join. Match exposes holes and weak candidates; Generate turns selected source frames into new B-roll, alt angles, bridges, or clip extensions; Join only assembles approved real/generated shots.
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
          <MetricCard label="True gaps" value={fmt(coverage.trueGapDuration)} ready={coverage.trueGapDuration === 0 && coverage.requiredDuration > 0} alert={coverage.trueGapDuration > 0} />
          <MetricCard label="Strong match" value={`${coverage.strongMatchPct}%`} ready={coverage.strongMatchPct >= 70} />
          <MetricCard label="Required queue" value={`${coverage.requiredNeedCount} chunks`} ready={coverage.requiredNeedCount === 0 && slots.length > 0} alert={coverage.requiredNeedCount > 0} />
          <MetricCard label="Optional rerolls" value={`${coverage.reviewCount} chunks · ${coverage.reviewSectionCount} sections`} ready={coverage.reviewCount === 0 && slots.length > 0} />
        </div>
      </section>

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
            <div className="mt-1 text-[11px] text-[#6d6d6d]">Blocks are song-length aligned. Red gaps become generate tasks; purple gaps become source-frame extensions; yellow blocks need match approval or reroll.</div>
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
            <div className="font-mono text-[10px] text-[#777]">{requiredIssues.length} required ranges · {reviewIssues.length} optional ranges</div>
          </div>
          {slots.length ? (
            <div className="space-y-4">
              <IssueGroupSection
                title="Required gaps"
                detail="Red means no source is assigned. Purple means the assigned source is too short. These ranges block Join."
                emptyLabel="No true gaps"
                emptyDetail={`Every one of the ${slots.length} adaptive chunks has enough real footage assigned. Nothing must be generated before Join.`}
                issues={requiredIssues}
                selectedSlotId={focusSlot?.item.id ?? null}
                onSelectSlot={setSelectedSlotId}
              />
              <IssueGroupSection
                title="Optional match review"
                detail="Yellow ranges already contain real footage. They are listed because the section match score is below 45%, not because video is missing."
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
          <div className="mb-3">
            <div className="text-[10px] uppercase tracking-[0.18em] text-[#e05c00]">Source-frame extension lab</div>
            <div className="mt-1 text-[11px] text-[#6d6d6d]">Start/middle/end frames are retained so generation can extend an intro/outro, bridge between clips, or create a related Camera B angle.</div>
          </div>
          <FrameExtensionPanel
            projectId={project?.id ?? "music-video-project-draft"}
            slot={focusSlot}
            moment={frameMoment}
            referenceAssets={referenceAssets}
            referenceSelection={effectiveReferenceSelection}
            onReferenceSelection={setReferenceSelection}
            higgsfieldStatus={higgsfieldStatus}
            isHiggsfieldGenerating={isHiggsfieldGenerating}
            persistedGeneratedAssets={persistedGeneratedAssets}
            onRunHiggsfield={runHiggsfieldGeneration}
            providerStatus={generationStatus}
            isGenerating={isGenerating}
            generatedAssets={generatedAssets}
            presets={LOCAL_SWARM_PRESETS}
            selectedPresetTitle={selectedPreset.title}
            onPresetChange={setSelectedPresetTitle}
            onCheckProvider={checkLocalGenerator}
            onGenerateImage={() => runLocalGeneration("image")}
            onGenerateVideo={() => runLocalGeneration("video")}
          />
        </section>
      </div>

      <section className="rounded-[2px] border border-[#1a1a1a] bg-[#0b0b0b] p-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-[#e05c00]">Generated shot bank / approval queue</div>
            <div className="mt-1 text-[11px] text-[#6d6d6d]">Generated assets from the local SwarmUI gateway appear in the source-frame lab first; approval and timeline replacement remain explicit so nothing silently enters Join.</div>
          </div>
          <label className={`rounded-[2px] border border-[#6e3425] bg-[#160905] px-3 py-2 text-[8px] uppercase tracking-[0.12em] text-[#d26c42] ${isImportingGenerated || !focusSlot ? "cursor-not-allowed opacity-45" : "cursor-pointer hover:border-[#e05c00]"}`}>
            {isImportingGenerated ? "Importing..." : "Import generated clips"}
            <input
              type="file"
              accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
              multiple
              disabled={isImportingGenerated || !focusSlot}
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
          onUpdate={onGeneratedAsset}
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

export function buildCoverageSlots(project: MusicVideoProject | null, chunks: Array<{ id: string; sectionId: string; sectionLabel: string; start: number; end: number; strength: number; cueCount: number }>): CoverageSlot[] {
  if (!project) return [];
  const momentsById = new Map(project.videoMoments.map((moment) => [moment.id, moment]));
  const itemsBySection = new Map(project.editPlan.timelineItems.map((item) => [item.sectionId, item]));
  const sourceItems = chunks.length
    ? chunks.map((chunk, index) => {
        const base = itemsBySection.get(chunk.sectionId) ?? project.editPlan.timelineItems.find((item) => item.start <= chunk.start && item.end >= chunk.end) ?? project.editPlan.timelineItems[0];
        return {
          ...(base ?? { id: `chunk-${chunk.id}`, sectionId: chunk.sectionId, lyricChunkIds: [], videoMomentId: null, start: chunk.start, end: chunk.end, label: chunk.sectionLabel, prompt: "No story prompt is attached to this adaptive chunk." }),
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
    const status: SlotStatus = !moment ? "missing" : missingDuration > 0.5 ? "short" : score < 0.45 ? "weak" : "filled";
    const needs = deriveGenerationNeeds(status, requiredDuration, availableDuration);

    return { item, moment, requiredDuration, assignedDuration, missingDuration, score, status, needs };
  });
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

export function summarizeCoverage(slots: CoverageSlot[], cueDuration = 0) {
  const requiredDuration = slots.reduce((total, slot) => total + slot.requiredDuration, 0);
  const assignedDuration = slots.reduce((total, slot) => total + slot.assignedDuration, 0);
  const trueGapDuration = slots.reduce((total, slot) => total + slot.missingDuration, 0);
  const strongMatchDuration = slots.reduce((total, slot) => total + (slot.status === "filled" ? slot.assignedDuration : 0), 0);
  const weakMatchDuration = slots.reduce((total, slot) => total + (slot.status === "weak" ? slot.assignedDuration : 0), 0);
  const coveragePct = requiredDuration > 0 ? Math.round((assignedDuration / requiredDuration) * 100) : 0;
  const strongMatchPct = requiredDuration > 0 ? Math.round((strongMatchDuration / requiredDuration) * 100) : 0;
  const duration = Math.max(cueDuration, slots[slots.length - 1]?.item.end ?? 0, requiredDuration, 1);
  const requiredNeedCount = slots.filter((slot) => slot.status === "missing" || slot.status === "short").length;
  const reviewCount = slots.filter((slot) => slot.status === "weak").length;
  const reviewSectionCount = new Set(slots.filter((slot) => slot.status === "weak").map((slot) => slot.item.sectionId)).size;
  return { requiredDuration, assignedDuration, trueGapDuration, strongMatchDuration, weakMatchDuration, coveragePct, strongMatchPct, duration, requiredNeedCount, reviewCount, reviewSectionCount };
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
    return `No source scene is assigned from ${fmt(issue.start)} to ${fmt(issue.end)}. This is a true gap and must be filled before Join.`;
  }
  if (issue.status === "short") {
    return `The assigned source covers ${fmt(issue.assignedDuration)} of ${fmt(issue.requiredDuration)}, leaving ${fmt(issue.missingDuration)} uncovered. Extend or replace it before Join.`;
  }
  return `This Story section's selected match scores ${Math.round(issue.score * 100)}%, below the 45% review threshold. All ${issue.slots.length} chunks contain real footage, so generation is optional.`;
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
        <span>green usable · yellow weak · purple extend · red missing</span>
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
  referenceAssets,
  referenceSelection,
  onReferenceSelection,
  higgsfieldStatus,
  isHiggsfieldGenerating,
  persistedGeneratedAssets,
  onRunHiggsfield,
  providerStatus,
  isGenerating,
  generatedAssets,
  presets,
  selectedPresetTitle,
  onPresetChange,
  onCheckProvider,
  onGenerateImage,
  onGenerateVideo,
}: {
  projectId: string;
  slot?: CoverageSlot;
  moment?: VideoMoment;
  referenceAssets: ReferenceAsset[];
  referenceSelection: GenerationReferenceSelection;
  onReferenceSelection: (selection: GenerationReferenceSelection) => void;
  higgsfieldStatus: string;
  isHiggsfieldGenerating: boolean;
  persistedGeneratedAssets: GeneratedStudioAsset[];
  onRunHiggsfield: (params: HiggsfieldGenerationFormState) => void;
  providerStatus: string;
  isGenerating: boolean;
  generatedAssets: GeneratedLocalAsset[];
  presets: LocalSwarmPreset[];
  selectedPresetTitle: string;
  onPresetChange: (title: string) => void;
  onCheckProvider: () => void;
  onGenerateImage: () => void;
  onGenerateVideo: () => void;
}) {
  const frames = [
    { label: "First / start anchor", url: moment?.firstFrameUrl ?? moment?.thumbnailUrl, action: "Extend From First Frame" },
    { label: "Middle / context", url: moment?.middleFrameUrl ?? moment?.storyboardUrl ?? moment?.thumbnailUrl, action: "Generate Alt Angle" },
    { label: "Last / end anchor", url: moment?.lastFrameUrl ?? moment?.thumbnailUrl, action: "Extend From Last Frame" },
  ];
  const anchorUrl = moment?.firstFrameUrl ?? moment?.thumbnailUrl;
  const referencePlan = buildGenerationReferenceInputs({
    anchorUrl,
    anchorLabel: slot?.item.label ?? moment?.sourceRefLabel ?? "source frame",
    assets: referenceAssets,
    selection: referenceSelection,
  });
  const selectedPreset = presets.find((preset) => preset.title === selectedPresetTitle) ?? presets[0];
  const character1Asset = referenceAssets.find((asset) => asset.id === referenceSelection.character1Id);
  const character2Asset = referenceAssets.find((asset) => asset.id === referenceSelection.character2Id);
  const environmentAsset = referenceAssets.find((asset) => asset.id === referenceSelection.environmentId);
  const customAsset = referenceAssets.find((asset) => asset.id === referenceSelection.customId);
  const characterNames = [character1Asset?.displayName, character2Asset?.displayName].filter(Boolean) as string[];
  const defaultCharacterName = characterNames.join(" & ") || "Character";
  const gridReferences: Array<{ kind: "character" | "environment" | "custom"; name?: string }> = [];
  if (character1Asset) gridReferences.push({ kind: "character", name: character1Asset.displayName });
  if (character2Asset) gridReferences.push({ kind: "character", name: character2Asset.displayName });
  if (environmentAsset) gridReferences.push({ kind: "environment", name: environmentAsset.displayName });
  if (customAsset) gridReferences.push({ kind: "custom", name: customAsset.displayName });
  const gridPrompt = buildStoryboardGridPrompt({
    slot,
    moment,
    references: gridReferences,
  });
  const gridTitle = `${slot?.item.label ?? "storyboard"} grid`;
  const [editedForm, setEditedForm] = useState<Partial<HiggsfieldGenerationFormState>>({});
  const higgsfieldForm: HiggsfieldGenerationFormState = {
    title: gridTitle,
    characterName: defaultCharacterName,
    resolution: "2k",
    splitRows: 3,
    splitCols: 3,
    extraReferenceUrls: "",
    prompt: gridPrompt,
    ...editedForm,
  };
  const setHiggsfieldForm = (update: Partial<HiggsfieldGenerationFormState>) => setEditedForm((current) => ({ ...current, ...update }));
  const higgsfieldInputCount = buildHiggsfieldInputImages(referenceAssets, referenceSelection, higgsfieldForm.extraReferenceUrls).length;
  const latestContactSheet = [...persistedGeneratedAssets]
    .filter((asset) => asset.status === "completed" && Boolean(asset.fullStorage || asset.resultUrl))
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];
  const seedancePacket = buildSeedanceContinuationPacket({
    projectId,
    sectionId: slot?.item.sectionId ?? "unassigned-section",
    sectionLabel: slot?.item.label ?? "Current section",
    storyIntent: slot?.item.prompt ?? "advance the current music-video section",
    songStart: slot?.item.start ?? 0,
    songEnd: slot?.item.end ?? 0,
    moment,
    referenceAssets,
    referenceSelection,
    contactSheet: latestContactSheet,
  });
  const [seedanceCopyStatus, setSeedanceCopyStatus] = useState("Ready to copy the operator packet.");
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
        <div className="mb-1 flex items-center justify-between gap-2">
          <div className="text-[8px] uppercase tracking-[0.16em] text-[#555]">AI suggested prompt draft</div>
          <button type="button" onClick={() => setHiggsfieldForm({ prompt: gridPrompt, title: gridTitle })} className="rounded-[2px] border border-[#2a2a2a] px-2 py-1 text-[8px] uppercase tracking-[0.12em] text-[#aaa] hover:border-[#e05c00] hover:text-[#e05c00]">Use in grid form</button>
        </div>
        <div className="text-[11px] leading-5 text-[#b0b0b0]">{gridPrompt}</div>
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
            <div className="text-[8px] uppercase tracking-[0.16em] text-[#6ca6d2]">Seedance continuation handoff</div>
            <div className="mt-1 text-[9px] leading-4 text-[#7d8fa1]">Uses the selected shot&apos;s real last frame as @Image_1, then the named character/location sheets and latest contact sheet with strict role boundaries. This is the project&apos;s manual Unlimited lane, not the paid Nano Banana API task.</div>
          </div>
          <div className="rounded-[2px] border border-[#24476f] px-2 py-1 font-mono text-[8px] uppercase tracking-[0.12em] text-[#6ca6d2]">Fast · Unlimited · 15s · 16:9 · 720p</div>
        </div>
        <div className="mt-2 rounded-[2px] border border-[#14283d] bg-[#03070c] p-2 font-mono text-[8px] leading-4 text-[#72879a]">
          <div>{seedancePacket.references.length} ordered references · @Image_1 must be the accepted ending frame · 720p is the lowest verified setting on this existing Unlimited surface.</div>
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
        <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
          <div className="rounded-[2px] border border-[#14283d] bg-[#03070c] p-2 font-mono text-[8px] leading-4 text-[#72879a]">{seedanceCopyStatus}</div>
          <button type="button" disabled={seedancePacket.errors.length > 0} onClick={copySeedancePacket} className="rounded-[2px] border border-[#24476f] bg-[#07111e] px-3 py-2 text-[8px] uppercase tracking-[0.12em] text-[#6ca6d2] disabled:cursor-not-allowed disabled:opacity-45">Copy Seedance packet</button>
        </div>
      </div>

      <div className="rounded-[2px] border border-[#352012] bg-[#090604] p-2">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-[8px] uppercase tracking-[0.16em] text-[#e05c00]">Higgsfield / Nano Banana Pro storyboard grid</div>
            <div className="mt-1 text-[9px] leading-4 text-[#777]">Creates the full grid, uploads that full grid to RustFS, splits fixed panels, then uploads the panels to RustFS too.</div>
          </div>
          <div className="font-mono text-[8px] uppercase tracking-[0.12em] text-[#9a9a9a]">{higgsfieldInputCount} refs · 16:9</div>
        </div>
        <div className="grid gap-2 sm:grid-cols-[1fr_130px_90px]">
          <label className="block">
            <span className="mb-1 block text-[8px] uppercase tracking-[0.14em] text-[#666]">Character name (from selected refs)</span>
            <input value={higgsfieldForm.characterName} onChange={(event) => setHiggsfieldForm({ characterName: event.target.value })} className="w-full rounded-[2px] border border-[#202020] bg-[#050505] px-2 py-1.5 font-mono text-[9px] text-[#9a9a9a] outline-none focus:border-[#e05c00]" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[8px] uppercase tracking-[0.14em] text-[#666]">Resolution</span>
            <select value={higgsfieldForm.resolution} onChange={(event) => setHiggsfieldForm({ resolution: event.target.value as HiggsfieldGenerationFormState["resolution"] })} className="w-full rounded-[2px] border border-[#202020] bg-[#050505] px-2 py-1.5 font-mono text-[9px] text-[#9a9a9a] outline-none focus:border-[#e05c00]">
              <option value="1k">1k</option>
              <option value="2k">2k</option>
              <option value="4k">4k</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[8px] uppercase tracking-[0.14em] text-[#666]">Grid</span>
            <select value={`${higgsfieldForm.splitRows}x${higgsfieldForm.splitCols}`} onChange={(event) => {
              const [rows, cols] = event.target.value.split("x").map(Number);
              setHiggsfieldForm({ splitRows: rows, splitCols: cols });
            }} className="w-full rounded-[2px] border border-[#202020] bg-[#050505] px-2 py-1.5 font-mono text-[9px] text-[#9a9a9a] outline-none focus:border-[#e05c00]">
              <option value="3x3">3x3</option>
              <option value="2x2">2x2</option>
            </select>
          </label>
        </div>
        <label className="mt-2 block">
          <span className="mb-1 block text-[8px] uppercase tracking-[0.14em] text-[#666]">Title / storage slug</span>
          <input value={higgsfieldForm.title} onChange={(event) => setHiggsfieldForm({ title: event.target.value })} className="w-full rounded-[2px] border border-[#202020] bg-[#050505] px-2 py-1.5 font-mono text-[9px] text-[#9a9a9a] outline-none focus:border-[#e05c00]" />
        </label>
        <label className="mt-2 block">
          <span className="mb-1 block text-[8px] uppercase tracking-[0.14em] text-[#666]">Extra reference URLs, one per line, appended after selected refs</span>
          <textarea value={higgsfieldForm.extraReferenceUrls} onChange={(event) => setHiggsfieldForm({ extraReferenceUrls: event.target.value })} rows={2} className="w-full resize-y rounded-[2px] border border-[#202020] bg-[#050505] px-2 py-1.5 font-mono text-[9px] leading-4 text-[#9a9a9a] outline-none focus:border-[#e05c00]" />
        </label>
        <label className="mt-2 block">
          <span className="mb-1 block text-[8px] uppercase tracking-[0.14em] text-[#666]">Prompt</span>
          <textarea value={higgsfieldForm.prompt} onChange={(event) => setHiggsfieldForm({ prompt: event.target.value })} rows={10} className="w-full resize-y rounded-[2px] border border-[#202020] bg-[#050505] px-2 py-1.5 font-mono text-[9px] leading-4 text-[#c0c0c0] outline-none focus:border-[#e05c00]" />
        </label>
        <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
          <div className="rounded-[2px] border border-[#151515] bg-[#050505] p-2 font-mono text-[8px] leading-4 text-[#777]">{higgsfieldStatus}</div>
          <button type="button" disabled={isHiggsfieldGenerating || !higgsfieldInputCount} onClick={() => onRunHiggsfield(higgsfieldForm)} className="rounded-[2px] border border-[#6e3425] bg-[#160905] px-3 py-2 text-[8px] uppercase tracking-[0.12em] text-[#d26c42] disabled:cursor-not-allowed disabled:opacity-45">Generate grid → split into panels</button>
        </div>
        {persistedGeneratedAssets.length ? <GeneratedHiggsfieldAssetGrid assets={persistedGeneratedAssets} /> : null}
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
          <button type="button" disabled={isGenerating || !slot} onClick={onGenerateVideo} className="rounded-[2px] border border-[#24476f] bg-[#050b16] px-2 py-2 text-[8px] uppercase tracking-[0.12em] text-[#6ca6d2] disabled:cursor-not-allowed disabled:opacity-45">Queue video</button>
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

function buildHiggsfieldInputImages(assets: ReferenceAsset[], selection: GenerationReferenceSelection, extraReferenceUrls: string) {
  const selectedIds = [selection.character1Id, selection.character2Id, selection.environmentId, selection.customId].filter(Boolean) as string[];
  const selected = selectedIds.flatMap((id) => {
    const asset = assets.find((candidate) => candidate.id === id);
    const url = asset?.storageUrl || asset?.previewUrl;
    return asset && url ? [{ url, label: asset.displayName }] : [];
  });
  const extra = extraReferenceUrls
    .split(/\r?\n/)
    .map((url) => url.trim())
    .filter(Boolean)
    .map((url, index) => ({ url, label: `Extra reference ${index + 1}` }));
  return [...selected, ...extra];
}

function buildStoryboardGridPrompt(args: {
  slot?: CoverageSlot;
  moment?: VideoMoment;
  references: Array<{ kind: "character" | "environment" | "custom"; name?: string }>;
}) {
  const { slot, moment, references } = args;
  const characterNames = references
    .filter((reference) => reference.kind === "character")
    .map((reference) => reference.name)
    .filter(Boolean) as string[];
  const cast = characterNames.length ? characterNames.join(" and ") : "the lead character";
  const sectionLine = slot
    ? `This grid continues the section "${slot.item.label}" (${fmt(slot.item.start)}\u2013${fmt(slot.item.end)}). Story intent: ${moderationSafeText(slot.item.prompt)}`
    : "This grid continues the current music-video section.";
  const caption = getGenerationMomentCaption(moment, characterNames);
  const beatLine = caption ? ` The source beat to continue from (text context only \u2014 it is NOT an attached image): ${caption}.` : "";

  // The image map MUST mirror buildHiggsfieldInputImages order exactly —
  // these are the only images the model actually receives, and a mismatch
  // scrambles which reference anchors identity vs location.
  const imageMap: string[] = [];
  let imageIndex = 1;
  for (const reference of references) {
    if (reference.kind === "character") {
      imageMap.push(`Image_${imageIndex} is the authoritative character reference for ${reference.name} \u2014 keep the exact visual identity and continuity from that sheet in every panel featuring them; do not invent or restate appearance details in text.`);
    } else if (reference.kind === "environment") {
      imageMap.push(`Image_${imageIndex} is the location lock for ${reference.name ?? "the environment"} \u2014 every panel takes place inside this exact space; preserve its layout, materials, palette, and lighting direction.`);
    } else {
      imageMap.push(`Image_${imageIndex} is an additional reference${reference.name ? ` (${reference.name})` : ""} \u2014 honor it wherever relevant.`);
    }
    imageIndex += 1;
  }

  return `Cinematic 3x3 anamorphic grid of shots for ${cast}, built from the ${references.length} attached reference images.

${imageMap.join("\n")}

${sectionLine}.${beatLine}

Render the 3x3 grid of shots as ONE continuing action that reads left-to-right, top-to-bottom: panel 1 opens on ${cast.split(" and ")[0] ?? cast} in the Image_${references.findIndex((reference) => reference.kind === "environment") + 1 || 1} location, and each following panel advances to the next logical beat \u2014 reaction, movement, escalation, turn, consequence, approach, tension peak, settle, and a final forward-moving beat that hands off to the next section. Stay in the same scene and space; do not jump to unrelated moments or invent new locations.

Cinematic register across all nine panels: vintage 2x anamorphic lens character \u2014 oval bokeh on background lights, subtle horizontal flare on point sources, soft frame-edge falloff, gentle halation lifting highlights. Practical-driven night lighting: hard neon, lamp, and fixture practicals cutting through visible volumetric haze, deep shadows that hold detail, rim and edge light separating subjects from darkness, skin reading warm against cooler ambient light at its true natural tone. Atmospheric perspective with real air between planes \u2014 distant elements softer, desaturated, lower contrast than the foreground. Highlights roll off in a filmic curve, blacks lifted but never milky. Fine theatrical 35mm grain across every panel, natural fabric weave and skin texture, no smoothing, unposed realism \u2014 photographed not generated. No labels, no numbers, no text, no borders between panels.`;
}

function GeneratedHiggsfieldAssetGrid({ assets }: { assets: GeneratedStudioAsset[] }) {
  return (
    <div className="mt-3 space-y-3">
      {assets.slice(0, 4).map((asset) => (
        <article key={asset.id} className="rounded-[2px] border border-[#202020] bg-[#050505] p-2">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#d0d0d0]">{asset.characterName ?? "Character"} · {asset.resolution ?? "?"} · {asset.aspectRatio ?? "16:9"}</div>
              <div className="mt-1 font-mono text-[8px] text-[#666]">job {asset.jobId} · full grid + {asset.split?.panels.length ?? 0} panels persisted</div>
            </div>
            <a href={asset.fullStorage?.mediaUrl ?? asset.fullStorage?.publicUrl ?? asset.resultUrl} target="_blank" rel="noreferrer" className="rounded-[2px] border border-[#6e3425] px-2 py-1 text-[8px] uppercase tracking-[0.12em] text-[#d26c42]">Open full</a>
          </div>
          <div className="grid gap-2 lg:grid-cols-[180px_1fr]">
            <a href={asset.fullStorage?.mediaUrl ?? asset.fullStorage?.publicUrl ?? asset.resultUrl} target="_blank" rel="noreferrer" className="overflow-hidden rounded-[2px] border border-[#181818] bg-[#030303]">
              {asset.fullStorage?.mediaUrl || asset.fullStorage?.publicUrl || asset.resultUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={asset.fullStorage?.mediaUrl ?? asset.fullStorage?.publicUrl ?? asset.resultUrl} alt={asset.title ?? asset.jobId ?? "generated grid"} className="aspect-video w-full object-cover" loading="lazy" decoding="async" />
              ) : <div className="flex aspect-video items-center justify-center text-[8px] uppercase tracking-[0.12em] text-[#444]">No preview</div>}
            </a>
            <div className="grid grid-cols-3 gap-1">
              {(asset.split?.panels ?? []).slice(0, 9).map((panel) => (
                <a key={panel.index} href={panel.storage?.mediaUrl ?? panel.storage?.publicUrl ?? panel.url} target="_blank" rel="noreferrer" className="overflow-hidden rounded-[1px] border border-[#181818] bg-[#030303]" title={`${panel.label} · ${panel.storage?.storagePath ?? panel.assetPath}`}>
                  {panel.storage?.mediaUrl || panel.storage?.publicUrl || panel.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={panel.storage?.mediaUrl ?? panel.storage?.publicUrl ?? panel.url} alt={panel.label} className="aspect-video w-full object-cover" loading="lazy" decoding="async" />
                  ) : <div className="flex aspect-video items-center justify-center text-[7px] text-[#444]">{panel.label}</div>}
                </a>
              ))}
            </div>
          </div>
          <div className="mt-2 truncate font-mono text-[7px] text-[#555]" title={asset.fullStorage?.storagePath}>full: {asset.fullStorage?.storagePath ?? "not uploaded"}</div>
        </article>
      ))}
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

function fillDefaultReferenceSelection(selection: GenerationReferenceSelection, assets: ReferenceAsset[]): GenerationReferenceSelection {
  const pick = (role: ReferenceAsset["role"]) => assets.find((asset) => asset.role === role)?.id;
  return {
    character1Id: selection.character1Id ?? pick("character-1"),
    character2Id: selection.character2Id ?? pick("character-2"),
    environmentId: selection.environmentId ?? pick("environment"),
    customId: selection.customId ?? pick("custom"),
  };
}

function GeneratedShotBank({ assets, onUpdate }: { assets: GeneratedStudioAsset[]; onUpdate: (asset: GeneratedStudioAsset) => void }) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const videos = assets
    .filter((asset) => asset.mediaKind === "video")
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  if (!videos.length) {
    return <EmptyState label="No returned generated clips" detail="Import completed Seedance videos here. They stay out of Join until you explicitly approve one for its assigned song slot." />;
  }
  return (
    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
      {videos.map((asset, index) => {
        const videoUrl = asset.fullStorage?.mediaUrl ?? asset.fullStorage?.publicUrl ?? asset.resultUrl;
        const reviewStatus = asset.reviewStatus ?? "pending";
        const requiredDuration = Math.max(0, (asset.target?.songEnd ?? 0) - (asset.target?.songStart ?? 0));
        const note = notes[asset.id] ?? asset.reviewNotes ?? "";
        return (
        <article key={asset.id} className={`rounded-[2px] border bg-[#080808] p-2 ${reviewStatus === "approved" ? "border-[#245c2c]" : reviewStatus === "rejected" ? "border-[#743029]" : "border-[#695019]"}`}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="min-w-0 truncate font-mono text-[9px] uppercase tracking-[0.14em] text-[#d0d0d0]">GEN_{String(index + 1).padStart(2, "0")} · {asset.model}</div>
            <span className={`rounded-[2px] border px-1.5 py-0.5 text-[7px] uppercase tracking-[0.1em] ${reviewStatus === "approved" ? "border-[#245c2c] text-[#78c878]" : reviewStatus === "rejected" ? "border-[#743029] text-[#dc6257]" : "border-[#695019] text-[#d3a236]"}`}>{reviewStatus}</span>
          </div>
          <div className="overflow-hidden rounded-[1px] border border-[#1b1b1b] bg-black">
            {videoUrl ? <video src={videoUrl} controls preload="metadata" className="aspect-video w-full object-contain" /> : <div className="flex aspect-video items-center justify-center text-[8px] uppercase tracking-[0.12em] text-[#555]">Missing video</div>}
          </div>
          <div className="mt-2 grid grid-cols-[1fr_90px] gap-2 font-mono text-[8px] text-[#777]">
            <div className="min-w-0">
              <div className="truncate" title={asset.target?.sectionLabel}>{asset.target?.sectionLabel ?? "Unassigned slot"}</div>
              <div className="mt-1">SONG {fmtCutTime(asset.target?.songStart ?? 0)}–{fmtCutTime(asset.target?.songEnd ?? 0)} · need {requiredDuration.toFixed(2)}s</div>
            </div>
            <label className="block">
              <span className="mb-1 block uppercase tracking-[0.1em] text-[#555]">Trim in</span>
              <input
                type="number"
                min={0}
                max={Math.max(0, (asset.durationSeconds ?? requiredDuration) - requiredDuration)}
                step={0.1}
                value={asset.trimStart ?? 0}
                onChange={(event) => onUpdate({ ...asset, trimStart: Number(event.target.value) || 0 })}
                className="w-full rounded-[1px] border border-[#202020] bg-[#040404] px-2 py-1 text-[#aaa] outline-none focus:border-[#e05c00]"
              />
            </label>
          </div>
          <textarea
            value={note}
            onChange={(event) => setNotes((current) => ({ ...current, [asset.id]: event.target.value }))}
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
      )})}
    </div>
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

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
