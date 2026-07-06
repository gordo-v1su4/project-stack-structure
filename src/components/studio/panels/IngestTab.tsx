"use client";

import { useMemo, useState } from "react";
import { fmt } from "../math";
import { sceneCaptionMatchesMode } from "../sceneCaptioning";
import { SourceVideoLibrary } from "../SourceVideoLibrary";
import { UploadControl } from "../UploadControl";
import type { DeepgramTranscriptSummary } from "../deepgramUtils";
import { REFERENCE_ASSET_SLOT_DETAILS, REFERENCE_ASSET_SLOT_LABELS, type ReferenceAsset, type ReferenceAssetKind, type ReferenceAssetRole } from "../referenceAssets";
import type { BeatJoinAnalysis, DetectedSceneSegment, SceneCaptionMode, UploadedVideoSource } from "../types";

type IngestTabProps = {
  analysis: BeatJoinAnalysis | null;
  audioStatus: string;
  audioError: string | null;
  isPreparingAudio: boolean;
  vocalStemName: string;
  transcriptSummary: DeepgramTranscriptSummary | null;
  videoSources: UploadedVideoSource[];
  videoStatus: string;
  videoError: string | null;
  isPreparingVideos: boolean;
  isRerunningSceneAnalysis: boolean;
  captionMode: SceneCaptionMode;
  onCaptionModeChange: (mode: SceneCaptionMode) => void;
  onVideoUpload: (files: File[]) => void | Promise<void>;
  onAppendVideos: (files: File[]) => void | Promise<void>;
  onRemoveVideo: (sourceId: number) => void;
  onRerunSceneAnalysis: (scope: "failed" | "all") => void;
  onMergeScene: (sourceId: number, sceneId: number) => void;
  referenceAssets: ReferenceAsset[];
  onReferenceAssetUpload: (role: ReferenceAssetRole, files: File[]) => void | Promise<void>;
  onReferenceAssetUpdate: (assetId: string, patch: Partial<Pick<ReferenceAsset, "displayName" | "promptHint" | "kind">>) => void;
  onReferenceAssetRemove: (assetId: string) => void;
  onSelectStory: () => void;
};

type ReadinessTone = "ready" | "processing" | "failed" | "waiting";

export function IngestTab({
  analysis,
  audioStatus,
  audioError,
  isPreparingAudio,
  vocalStemName,
  transcriptSummary,
  videoSources,
  videoStatus,
  videoError,
  isPreparingVideos,
  isRerunningSceneAnalysis,
  captionMode,
  onCaptionModeChange,
  onVideoUpload,
  onAppendVideos,
  onRemoveVideo,
  onRerunSceneAnalysis,
  onMergeScene,
  referenceAssets,
  onReferenceAssetUpload,
  onReferenceAssetUpdate,
  onReferenceAssetRemove,
  onSelectStory,
}: IngestTabProps) {
  const [captionSearch, setCaptionSearch] = useState("");
  const stats = buildVideoStats(videoSources);
  const audioTone: ReadinessTone = audioError ? "failed" : isPreparingAudio ? "processing" : analysis ? "ready" : "waiting";
  const stemTone: ReadinessTone = transcriptSummary ? "ready" : vocalStemName ? "processing" : "waiting";
  const videoTone: ReadinessTone = videoError ? "failed" : isPreparingVideos || stats.detecting > 0 || stats.captioning > 0 ? "processing" : videoSources.length ? "ready" : "waiting";
  const sceneTone: ReadinessTone = stats.sceneFailed > 0 ? "failed" : stats.sceneCount > 0 && stats.detecting === 0 ? "ready" : stats.detecting > 0 ? "processing" : "waiting";
  const captionTone: ReadinessTone = stats.captionFailed > 0 ? "failed" : stats.captionTotal > 0 && stats.captionReady === stats.captionTotal ? "ready" : stats.captioning > 0 ? "processing" : "waiting";
  const storageTone: ReadinessTone = stats.storageFailed > 0 ? "failed" : stats.storageUploaded === videoSources.length && videoSources.length > 0 ? "ready" : videoSources.length > 0 ? "processing" : "waiting";
  const rerunFailedCount = useMemo(
    () =>
      videoSources.filter(
        (source) => Boolean(source.storageBucket && source.storagePath) && (source.sceneStatus === "failed" || !(source.scenes?.length)),
      ).length,
    [videoSources],
  );
  const mismatchedCaptionCount = useMemo(
    () =>
      videoSources.reduce(
        (total, source) => total + (source.scenes ?? []).filter((scene) => scene.caption && !sceneCaptionMatchesMode(scene, captionMode)).length,
        0,
      ),
    [captionMode, videoSources],
  );
  const cutGroups = useMemo(
    () =>
      videoSources
        .map((source) => ({
          source,
          allCuts: source.scenes ?? [],
          cuts: (source.scenes ?? []).filter((scene) => matchesCaptionSearch(captionSearch, source, scene)),
        }))
        .filter((group) => group.allCuts.length > 0 || group.source.sceneStatus === "failed" || group.source.sceneStatus === "detecting"),
    [captionSearch, videoSources],
  );
  const filteredCutCount = cutGroups.reduce((total, group) => total + group.cuts.length, 0);

  return (
    <div className="space-y-3">
      <section className="rounded-[2px] border border-[#1a1a1a] bg-[#0b0b0b] p-3">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-[#e05c00]">Ingest readiness</div>
            <div className="mt-1 max-w-3xl text-[11px] leading-5 text-[#6d6d6d]">
              This is the ordered intake gate for the music-video workflow. Green items are ready to use downstream; orange items are still processing; red items need attention before Match, Join, or Export can run.
            </div>
          </div>
          <button
            type="button"
            onClick={onSelectStory}
            className="rounded-[2px] border border-[#242424] px-3 py-2 text-[9px] uppercase tracking-[0.14em] text-[#9a9a9a] hover:border-[#e05c00] hover:text-[#e05c00]"
          >
            Stem / SRT in Story
          </button>
        </div>

        <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
          <ReadinessCard label="Master song" value={analysis ? `Beat map · ${fmt(analysis.duration)}` : audioStatus} tone={audioTone} detail={audioError ?? "Essentia beat/onset/section analysis"} />
          <ReadinessCard label="Vocal stem / SRT" value={transcriptSummary ? `${transcriptSummary.chunks.length} chunks` : vocalStemName || "Waiting"} tone={stemTone} detail="Deepgram lyrics and timed SRT chunks" />
          <ReadinessCard label="Videos" value={`${videoSources.length} uploaded`} tone={videoTone} detail={videoError ?? videoStatus} />
          <ReadinessCard label="Scenes" value={`${stats.sceneCount} detected`} tone={sceneTone} detail={stats.detecting ? `${stats.detecting} clips still detecting` : "PySceneDetect cuts"} />
          <ReadinessCard label="Captions" value={`${stats.captionReady}/${stats.captionTotal}`} tone={captionTone} detail={stats.captioning ? "captioning scene frames" : "video captions ready for matching"} />
          <ReadinessCard label="RustFS" value={`${stats.storageUploaded}/${videoSources.length}`} tone={storageTone} detail="media + caption manifests" />
        </div>

        {rerunFailedCount > 0 || mismatchedCaptionCount > 0 ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-[2px] border border-[#6f4a12] bg-[#120d05] px-3 py-2">
            <div className="mr-auto text-[10px] leading-4 text-[#c07a3f]">
              {rerunFailedCount > 0 ? `${rerunFailedCount} clip${rerunFailedCount === 1 ? "" : "s"} failed scene detection. ` : ""}
              {mismatchedCaptionCount > 0
                ? `${mismatchedCaptionCount} caption${mismatchedCaptionCount === 1 ? "" : "s"} came from a different lane than the selected ${captionMode === "smart" ? "Smart · Qwen3-VL" : "Fast · LFM"} mode.`
                : ""}
            </div>
            {rerunFailedCount > 0 ? (
              <button
                type="button"
                onClick={() => onRerunSceneAnalysis("failed")}
                disabled={isRerunningSceneAnalysis || isPreparingVideos}
                className="rounded-[2px] border border-[#e05c00] px-3 py-2 text-[9px] uppercase tracking-[0.14em] text-[#e05c00] hover:bg-[#1c0f04] disabled:cursor-not-allowed disabled:border-[#3a3a3a] disabled:text-[#555]"
              >
                {isRerunningSceneAnalysis ? "Re-running…" : `Rerun failed scene detect (${rerunFailedCount})`}
              </button>
            ) : null}
            {mismatchedCaptionCount > 0 ? (
              <button
                type="button"
                onClick={() => onRerunSceneAnalysis("all")}
                disabled={isRerunningSceneAnalysis || isPreparingVideos}
                className="rounded-[2px] border border-[#e05c00] px-3 py-2 text-[9px] uppercase tracking-[0.14em] text-[#e05c00] hover:bg-[#1c0f04] disabled:cursor-not-allowed disabled:border-[#3a3a3a] disabled:text-[#555]"
              >
                {isRerunningSceneAnalysis ? "Re-running…" : `Recaption all · ${captionMode === "smart" ? "Qwen3-VL" : "LFM"}`}
              </button>
            ) : null}
          </div>
        ) : null}
      </section>

      <ReferenceLibrary
        assets={referenceAssets}
        onUpload={onReferenceAssetUpload}
        onUpdate={onReferenceAssetUpdate}
        onRemove={onReferenceAssetRemove}
      />

      <section className="rounded-[2px] border border-[#1a1a1a] bg-[#0b0b0b] p-3">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-[#e05c00]">Caption mode</div>
            <div className="mt-1 max-w-3xl text-[11px] leading-5 text-[#6d6d6d]">
              Fast uses the lightweight LFM lane. Smart sends the same scene frame plus project/lyric/story context to the Qwen3-VL gateway when configured.
            </div>
          </div>
          <div className="flex rounded-[2px] border border-[#242424] bg-[#070707] p-1">
            {(["fast", "smart"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => onCaptionModeChange(mode)}
                className={`px-3 py-2 text-[9px] uppercase tracking-[0.16em] transition-colors ${
                  captionMode === mode
                    ? "bg-[#e05c00] text-white"
                    : "text-[#777] hover:bg-[#141414] hover:text-[#d0d0d0]"
                }`}
              >
                {mode === "fast" ? "Fast" : "Smart · Qwen3-VL"}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          <ReadinessCard label="Active caption lane" value={captionMode === "fast" ? "Fast · LFM" : "Smart · Qwen3-VL"} tone="ready" detail={captionMode === "fast" ? "Lower latency draft captions" : "Richer searchable captions with context"} />
          <ReadinessCard label="Caption context" value={transcriptSummary ? `${transcriptSummary.chunks.length} lyric chunks` : "Video-only"} tone={transcriptSummary ? "ready" : "waiting"} detail={transcriptSummary ? "lyrics/story context included for new captions" : "upload stem/SRT first if you want lyric context"} />
        </div>
      </section>

      {videoSources.length ? (
        <section className="space-y-3">
          <SourceVideoLibrary
            sources={videoSources}
            isPreparingVideos={isPreparingVideos}
            onAppendVideos={onAppendVideos}
            onReplaceVideos={onVideoUpload}
            onRemoveVideo={onRemoveVideo}
          />
        </section>
      ) : (
        <section className="rounded-[2px] border border-[#1e1e1e] bg-[#070707] p-4">
          <div className="mb-3 text-[10px] uppercase tracking-[0.18em] text-[#3a3a3a]">Source videos</div>
          <UploadControl
            accept="video/*"
            multiple
            title="Upload source videos"
            detail="Videos upload to RustFS, then scene detection and scene captioning run before Match can use them."
            actionLabel={isPreparingVideos ? "Processing Videos…" : "Upload Video Clips"}
            disabled={isPreparingVideos}
            isProcessing={isPreparingVideos}
            status={videoStatus}
            error={videoError}
            onFiles={onVideoUpload}
          />
        </section>
      )}

      <section className="rounded-[2px] border border-[#1a1a1a] bg-[#0b0b0b] p-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-[#e05c00]">Scene cuts by clip</div>
            <div className="mt-1 text-[11px] text-[#6d6d6d]">Every detected cut, grouped under its source clip. Each cut carries the caption text that Match will search against lyrics and story prompts.</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={captionSearch}
              onChange={(event) => setCaptionSearch(event.target.value)}
              placeholder="Search captions, tags, actions…"
              className="w-64 rounded-[2px] border border-[#242424] bg-[#060606] px-3 py-2 font-mono text-[10px] text-[#d0d0d0] outline-none placeholder:text-[#444] focus:border-[#e05c00]"
            />
            <div className="font-mono text-[10px] text-[#777]">
              {captionSearch.trim() ? `${filteredCutCount}/${stats.sceneCount} cuts` : `${stats.sceneCount} cuts`}
            </div>
          </div>
        </div>
        {cutGroups.length ? (
          <div className="space-y-3">
            {cutGroups.map(({ source, allCuts, cuts }) => (
              <div key={source.id} className="rounded-[2px] border border-[#161616] bg-[#080808] p-2">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="rounded-[2px] bg-[#141414] px-1.5 py-[2px] font-mono text-[9px] text-[#e05c00]">S{source.id + 1}</span>
                  <span className="max-w-[360px] truncate font-mono text-[10px] text-[#9a9a9a]" title={source.name}>{source.name}</span>
                  <span className="font-mono text-[9px] text-[#555]">
                    {allCuts.length} cut{allCuts.length === 1 ? "" : "s"} · {allCuts.filter((scene) => Boolean(scene.caption)).length}/{allCuts.length} captioned
                  </span>
                  {source.sceneStatus === "detecting" ? (
                    <span className="text-[9px] uppercase tracking-[0.12em] text-[#e05c00]">detecting…</span>
                  ) : null}
                  {source.sceneStatus === "failed" ? (
                    <span className="max-w-[420px] truncate text-[9px] text-[#d24b3f]" title={source.sceneError ?? undefined}>
                      scene detection failed{source.sceneError ? ` · ${source.sceneError}` : ""}
                    </span>
                  ) : null}
                </div>
                {cuts.length ? (
                  <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-5">
                    {cuts.map((scene) => (
                      <CutCaptionCard
                        key={`${source.id}-${scene.id}-${scene.start}`}
                        sourceName={source.name}
                        scene={scene}
                        fallbackThumbnail={source.thumbnailUrl}
                        onMergeLeft={allCuts.findIndex((candidate) => candidate.id === scene.id) > 0 ? () => onMergeScene(source.id, scene.id) : undefined}
                      />
                    ))}
                  </div>
                ) : allCuts.length ? (
                  <div className="rounded-[2px] border border-dashed border-[#202020] bg-[#060606] px-3 py-3 text-[10px] text-[#4f4f4f]">
                    No cuts in this clip match the search.
                  </div>
                ) : (
                  <div className="rounded-[2px] border border-dashed border-[#202020] bg-[#060606] px-3 py-3 text-[10px] text-[#4f4f4f]">
                    {source.sceneStatus === "failed"
                      ? "No cuts yet — use “Rerun failed scene detect” above."
                      : "Waiting for scene detection to finish."}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-[2px] border border-dashed border-[#202020] bg-[#070707] px-3 py-8 text-center text-[10px] uppercase tracking-[0.14em] text-[#4f4f4f]">
            Scene cut thumbnails appear here after videos finish detection.
          </div>
        )}
      </section>
    </div>
  );
}

function ReferenceLibrary({
  assets,
  onUpload,
  onUpdate,
  onRemove,
}: {
  assets: ReferenceAsset[];
  onUpload: (role: ReferenceAssetRole, files: File[]) => void | Promise<void>;
  onUpdate: (assetId: string, patch: Partial<Pick<ReferenceAsset, "displayName" | "promptHint" | "kind">>) => void;
  onRemove: (assetId: string) => void;
}) {
  const roles: ReferenceAssetRole[] = ["character-1", "character-2", "environment", "custom"];
  const readyCount = assets.filter((asset) => asset.storageStatus === "uploaded" && asset.storageUrl).length;
  const failedCount = assets.filter((asset) => asset.storageStatus === "failed").length;

  return (
    <section className="rounded-[2px] border border-[#1a1a1a] bg-[#0b0b0b] p-3">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-[#e05c00]">Reference library / character bible</div>
          <div className="mt-1 max-w-4xl text-[11px] leading-5 text-[#6d6d6d]">
            Upload persistent character sheets and continuity references once. Generate will pass them to Nano Banana Pro in a stable order after the selected source frame: Char 1, Char 2, Environment, Custom.
          </div>
        </div>
        <div className="font-mono text-[10px] text-[#777]">
          {readyCount}/{assets.length || roles.length} refs ready{failedCount ? <span className="text-[#d24b3f]"> · {failedCount} failed</span> : null}
        </div>
      </div>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {roles.map((role) => (
          <ReferenceSlotCard
            key={role}
            role={role}
            asset={assets.find((candidate) => candidate.role === role)}
            onUpload={(files) => onUpload(role, files)}
            onUpdate={onUpdate}
            onRemove={onRemove}
          />
        ))}
      </div>
    </section>
  );
}

function ReferenceSlotCard({
  role,
  asset,
  onUpload,
  onUpdate,
  onRemove,
}: {
  role: ReferenceAssetRole;
  asset?: ReferenceAsset;
  onUpload: (files: File[]) => void | Promise<void>;
  onUpdate: (assetId: string, patch: Partial<Pick<ReferenceAsset, "displayName" | "promptHint" | "kind">>) => void;
  onRemove: (assetId: string) => void;
}) {
  const failed = asset?.storageStatus === "failed";
  const ready = asset?.storageStatus === "uploaded" && Boolean(asset.storageUrl);
  const uploading = asset?.storageStatus === "uploading";
  const border = failed ? "border-[#743029]" : ready ? "border-[#245c2c]" : uploading ? "border-[#6e5522]" : "border-[#242424]";
  const toneText = failed ? "text-[#d24b3f]" : ready ? "text-[#78c878]" : uploading ? "text-[#d6a13a]" : "text-[#777]";

  return (
    <div className={`flex min-h-[424px] flex-col rounded-[2px] border ${border} bg-[#070707] p-2`}>
      <div className="mb-2 grid min-h-[58px] grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
        <div className="min-w-0">
          <div className="text-[9px] uppercase tracking-[0.16em] text-[#d0d0d0]">{REFERENCE_ASSET_SLOT_LABELS[role]}</div>
          <div className="mt-1 line-clamp-2 text-[9px] leading-4 text-[#555]">{REFERENCE_ASSET_SLOT_DETAILS[role]}</div>
        </div>
        <span className={`pt-[1px] text-right font-mono text-[8px] uppercase tracking-[0.12em] ${toneText}`}>{asset ? asset.storageStatus : "empty"}</span>
      </div>

      {asset ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="relative h-[168px] overflow-hidden rounded-[2px] border border-[#181818] bg-[#030303]">
            {asset.previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={asset.previewUrl} alt={asset.displayName} className="h-full w-full object-cover" loading="lazy" decoding="async" />
            ) : <div className="flex h-full items-center justify-center text-[8px] uppercase tracking-[0.12em] text-[#444]">No preview</div>}
            <div className="absolute bottom-1 left-1 rounded-[1px] bg-[#000000b8] px-1.5 py-0.5 font-mono text-[7px] text-[#aaa]">{asset.fileName}</div>
          </div>
          <div className="mt-2 grid gap-2">
            <input
              value={asset.displayName}
              onChange={(event) => onUpdate(asset.id, { displayName: event.target.value })}
              className="h-[30px] w-full rounded-[2px] border border-[#202020] bg-[#050505] px-2 font-mono text-[10px] text-[#d0d0d0] outline-none focus:border-[#e05c00]"
              placeholder="Reference name"
            />
            <select
              value={asset.kind}
              onChange={(event) => onUpdate(asset.id, { kind: event.target.value as ReferenceAssetKind })}
              className="h-[30px] w-full rounded-[2px] border border-[#202020] bg-[#050505] px-2 font-mono text-[10px] text-[#9a9a9a] outline-none focus:border-[#e05c00]"
            >
              {(["character", "environment", "prop", "vehicle", "wardrobe", "custom"] as const).map((kind) => <option key={kind} value={kind}>{kind}</option>)}
            </select>
            <textarea
              value={asset.promptHint}
              onChange={(event) => onUpdate(asset.id, { promptHint: event.target.value })}
              rows={2}
              className="h-[54px] w-full resize-none rounded-[2px] border border-[#202020] bg-[#050505] px-2 py-1.5 text-[10px] leading-4 text-[#9a9a9a] outline-none focus:border-[#e05c00]"
              placeholder="Prompt lock / reference instruction"
            />
          </div>
          <div className="mt-2 min-h-[28px]">
            {asset.storageError ? <div className="rounded-[2px] border border-[#743029] bg-[#160706] p-2 text-[9px] leading-4 text-[#d24b3f]">{asset.storageError}</div> : null}
            {asset.storageUrl ? <div className="truncate font-mono text-[8px] leading-4 text-[#555]" title={asset.storagePath}>{asset.storagePath}</div> : null}
          </div>
          <div className="mt-auto flex gap-1.5 pt-2">
            <UploadControl accept="image/*" title="Replace reference" detail="Upload a new reference image." actionLabel="Replace" variant="button" onFiles={onUpload} />
            <button type="button" onClick={() => onRemove(asset.id)} className="rounded-[2px] border border-[#242424] px-2 py-[2px] text-[10px] uppercase tracking-[0.12em] text-[#777] hover:border-[#743029] hover:text-[#d24b3f]">Remove</button>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex h-[168px] items-center justify-center rounded-[2px] border border-dashed border-[#252525] bg-[#050505] px-5 text-center">
            <div>
              <div className="text-[12px] text-[#b0b0b0]">Upload {REFERENCE_ASSET_SLOT_LABELS[role]}</div>
              <div className="mt-3 text-[9px] uppercase tracking-[0.16em] text-[#555]">Stored to RustFS before Generate can use it.</div>
            </div>
          </div>
          <div className="mt-2 grid gap-2 opacity-45">
            <div className="h-[30px] rounded-[2px] border border-[#1b1b1b] bg-[#050505]" />
            <div className="h-[30px] rounded-[2px] border border-[#1b1b1b] bg-[#050505]" />
            <div className="h-[54px] rounded-[2px] border border-[#1b1b1b] bg-[#050505]" />
          </div>
          <div className="mt-2 min-h-[28px]" />
          <div className="mt-auto pt-2">
            <UploadControl
              accept="image/*"
              title=""
              detail=""
              actionLabel="Add Reference"
              variant="button"
              onFiles={onUpload}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ReadinessCard({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: ReadinessTone }) {
  const colors = toneColors(tone);
  return (
    <div className={`rounded-[2px] border p-3 ${colors.border} ${colors.bg}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[8px] uppercase tracking-[0.16em] text-[#5c5c5c]">{label}</div>
        <span className={`h-2 w-2 rounded-full ${colors.dot}`} />
      </div>
      <div className={`truncate font-mono text-[11px] ${colors.text}`}>{value}</div>
      <div className="mt-2 line-clamp-2 text-[9px] leading-4 text-[#606060]" title={detail}>{detail}</div>
    </div>
  );
}

function CutCaptionCard({ sourceName, scene, fallbackThumbnail, onMergeLeft }: { sourceName: string; scene: DetectedSceneSegment; fallbackThumbnail?: string; onMergeLeft?: () => void }) {
  const hasCaption = Boolean(scene.caption);
  const failed = Boolean(scene.captionError);
  const tone: ReadinessTone = failed ? "failed" : hasCaption ? "ready" : "waiting";
  const colors = toneColors(tone);
  const displayCaption = getDisplayCaption(scene) ?? scene.captionError ?? "No caption yet.";
  const frameStrip = [
    ["first", scene.firstFrameUrl ?? scene.thumbnailUrl ?? fallbackThumbnail],
    ["middle", scene.middleFrameUrl],
    ["last", scene.lastFrameUrl],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));
  return (
    <div className={`overflow-hidden rounded-[2px] border bg-[#080808] ${colors.border}`}>
      <div className="relative aspect-video bg-[#030303]">
        {scene.firstFrameUrl || scene.thumbnailUrl || fallbackThumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={scene.firstFrameUrl ?? scene.thumbnailUrl ?? fallbackThumbnail} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" decoding="async" />
        ) : null}
        <div className="absolute left-[6px] top-[6px] rounded-[2px] bg-[#00000099] px-1 py-[2px] font-mono text-[8px] text-[#e05c00]">CUT {scene.id + 1}</div>
        <div className="absolute bottom-[6px] right-[6px] rounded-[2px] bg-[#00000099] px-1 py-[2px] font-mono text-[8px] text-[#d0d0d0]">{fmt(scene.start)}–{fmt(scene.end)}</div>
      </div>
      <div className="space-y-1 border-t border-[#141414] p-2">
        {frameStrip.length > 1 ? (
          <div className="grid grid-cols-3 gap-1">
            {frameStrip.map(([label, url]) => (
              <div key={label} className="relative aspect-video overflow-hidden rounded-[2px] border border-[#181818] bg-black">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`${label} frame`} className="h-full w-full object-cover" loading="lazy" decoding="async" />
                <span className="absolute bottom-0 left-0 bg-[#000000aa] px-1 py-[1px] font-mono text-[7px] uppercase tracking-[0.1em] text-[#b0b0b0]">{label}</span>
              </div>
            ))}
          </div>
        ) : null}
        <div className="truncate font-mono text-[8px] text-[#666]" title={sourceName}>{sourceName}</div>
        <div className={`text-[8px] uppercase tracking-[0.12em] ${colors.text}`} title={scene.captionError ?? undefined}>
          {failed ? (hasCaption ? "Recaption failed · kept previous" : "Caption failed") : hasCaption ? "Caption ready" : "Caption pending"}
        </div>
        <div className="line-clamp-3 min-h-12 text-[9px] leading-4 text-[#9a9a9a]" title={displayCaption}>
          {displayCaption}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1 font-mono text-[8px] uppercase tracking-[0.1em] text-[#555]">
          {scene.captionMode ? <span className="rounded-[2px] border border-[#1c1c1c] px-1 py-[1px]">{scene.captionMode}</span> : null}
          {scene.captionSource ? <span className="rounded-[2px] border border-[#1c1c1c] px-1 py-[1px]">{scene.captionSource}</span> : null}
          {scene.captionModel ? <span className="max-w-full truncate rounded-[2px] border border-[#1c1c1c] px-1 py-[1px]" title={scene.captionModel}>{scene.captionModel}</span> : null}
          {onMergeLeft ? (
            <button
              type="button"
              onClick={onMergeLeft}
              title="Not a real cut? Merge this cut into the previous one."
              className="ml-auto rounded-[2px] border border-[#242424] px-1.5 py-[1px] uppercase tracking-[0.1em] text-[#777] hover:border-[#e05c00] hover:text-[#e05c00]"
            >
              ← Merge
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function matchesCaptionSearch(query: string, source: UploadedVideoSource, scene: DetectedSceneSegment) {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
  if (!terms.length) return true;

  const haystack = [
    source.name,
    scene.label,
    scene.caption,
    scene.captionError,
    scene.captionSource,
    scene.captionMode,
    scene.captionModel,
    scene.captionMeta?.caption,
    scene.captionMeta?.shotType,
    scene.captionMeta?.action,
    scene.captionMeta?.setting,
    scene.captionMeta?.lighting,
    scene.captionMeta?.timeOfDay,
    scene.captionMeta?.weather,
    ...(scene.captionMeta?.subjects ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return terms.every((term) => haystack.includes(term));
}

function getDisplayCaption(scene: DetectedSceneSegment) {
  const text = scene.captionMeta?.caption ?? scene.caption;
  if (!text) return null;
  const parsed = parseCaptionObject(text) ?? extractCaptionField(text);
  return parsed?.caption ?? text;
}

function parseCaptionObject(text: string) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed) as { caption?: unknown };
    return typeof parsed.caption === "string" && parsed.caption.trim() ? { caption: parsed.caption } : null;
  } catch {
    return null;
  }
}

function extractCaptionField(text: string) {
  const match = /"caption"\s*:\s*"((?:\\.|[^"\\])*)"/i.exec(text.trim());
  if (!match) return null;
  try {
    return { caption: JSON.parse(`"${match[1]}"`) as string };
  } catch {
    return { caption: match[1].replace(/\\"/g, '"') };
  }
}

function buildVideoStats(sources: UploadedVideoSource[]) {
  return sources.reduce(
    (acc, source) => {
      const scenes = source.scenes ?? [];
      acc.sceneCount += scenes.length;
      acc.captionReady += scenes.filter((scene) => Boolean(scene.caption)).length;
      acc.captionTotal += scenes.length;
      if (source.sceneStatus === "detecting") acc.detecting += 1;
      if (source.sceneStatus === "failed") acc.sceneFailed += 1;
      if (source.captionStatus === "captioning") acc.captioning += 1;
      if (source.captionStatus === "failed") acc.captionFailed += 1;
      if (source.storageStatus === "uploaded") acc.storageUploaded += 1;
      if (source.storageStatus === "failed") acc.storageFailed += 1;
      return acc;
    },
    {
      sceneCount: 0,
      captionReady: 0,
      captionTotal: 0,
      detecting: 0,
      sceneFailed: 0,
      captioning: 0,
      captionFailed: 0,
      storageUploaded: 0,
      storageFailed: 0,
    },
  );
}

function toneColors(tone: ReadinessTone) {
  switch (tone) {
    case "ready":
      return { border: "border-[#245c2c]", bg: "bg-[#081108]", dot: "bg-[#3a8a3a]", text: "text-[#79c779]" };
    case "processing":
      return { border: "border-[#6f4a12]", bg: "bg-[#120d05]", dot: "bg-[#e05c00] animate-pulse", text: "text-[#e05c00]" };
    case "failed":
      return { border: "border-[#7a241e]", bg: "bg-[#130706]", dot: "bg-[#d24b3f]", text: "text-[#d24b3f]" };
    default:
      return { border: "border-[#202020]", bg: "bg-[#080808]", dot: "bg-[#454545]", text: "text-[#777]" };
  }
}
