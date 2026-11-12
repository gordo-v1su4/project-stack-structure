"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { BrowserPreviewPlayer } from "./previewPlayer";
import { PreviewPlayer } from "./PreviewPlayerComponent";
import { usePreviewPlayerState } from "./usePreviewPlayerState";
import { ReviewSelectionBar } from "./ReviewSelectionBar";
import { buildSelectedPlayback, previewOffsetAtSongTime, selectSongRange, type SelectionGesture, type SongRange, type SongSelection } from "./reviewSelection";
import { BeatSpine } from "./shell/BeatSpine";
import { buildSpineSlots } from "./shell/spineSlots";
import type { BeatJoinAnalysis } from "./types";
import type { EditPlanPreviewSegment } from "./musicVideoProject";
import { animaticImage, animaticShotAtTime, type StillAnimaticPlan } from "./stillAnimatic";
import { animaticFootageSongTime } from "./shell/AnimaticFootageLabels";
import { AnimaticShotOverlay, AnimaticTimingCard } from "./AnimaticShotIdentity";
import { mediaThumbnailUrl } from "./mediaThumbnailUrl";
import { Button } from "./ui";

/** One current/standby player, shared master clock, and honest still/gap fallbacks. */
export function CutReviewPlayer({ segments, audioUrl, plan, context, initialRanges, autoPlay = false, selection = null, onSelectionChange, multiSelect = false, onMultiSelect, analysis, focusedShotId, onFocusShot, initialViewport, onViewportChange }: {
  segments: EditPlanPreviewSegment[]; audioUrl: string; plan?: StillAnimaticPlan | null; context: string;
  initialRanges?: SongRange[]; autoPlay?: boolean;
  selection?: SongSelection | null; onSelectionChange?: (selection: SongSelection | null) => void;
  multiSelect?: boolean; onMultiSelect?: () => void;
  analysis?: BeatJoinAnalysis; focusedShotId?: string; onFocusShot?: (id: string) => void;
  initialViewport?: SongRange | null; onViewportChange?: (range: SongRange) => void;
}) {
  const [player] = useState(() => new BrowserPreviewPlayer());
  const [audition, setAudition] = useState<SongRange[] | null>(() => autoPlay ? initialRanges ?? null : null);
  const [playRequest, setPlayRequest] = useState(autoPlay ? 1 : 0);
  const [labels, setLabels] = useState(true);
  const handledRequest = useRef(0);
  const state = usePreviewPlayerState(player);
  const displayed = useMemo(() => audition ? buildSelectedPlayback(segments, audition) : segments, [segments, audition]);
  const slots = useMemo(() => buildSpineSlots({ segments, project: null, generatedAssets: [] }), [segments]);
  const select = (range: SongRange, gesture: SelectionGesture = {}) => {
    onSelectionChange?.(selectSongRange(selection, range, { ...gesture, toggle: gesture.toggle || (!gesture.add && multiSelect) }));
    const focus = segments.find(s => s.musicEnd > range.start && s.musicStart < range.end);
    if (focus?.animaticShotId) onFocusShot?.(focus.animaticShotId);
  };
  useEffect(() => {
    if (!playRequest || handledRequest.current === playRequest) return;
    handledRequest.current = playRequest;
    player.load(displayed);
    void player.play();
    // Playback requests originate only from an explicit click, never arrival/poll updates.
  }, [displayed, playRequest, player]);
  useEffect(() => () => { handledRequest.current = 0; player.stop(); player.detach(); }, [player]);
  const current = displayed[state.currentIndex];
  const time = animaticFootageSongTime(displayed, state.currentIndex, state.currentTime);
  const shot = plan && context === plan.contextSha256 && time !== null ? animaticShotAtTime(plan, time) : undefined;
  const image = shot && plan ? animaticImage(plan, shot, context) : undefined;
  const isGap = !current?.videoUrl || current.kind === "gap";
  return <section aria-label="Current video cut" className="space-y-2">
    {focusedShotId ? <p className="font-mono text-xs text-accent">Focused shot: {focusedShotId} · selection is for review only</p> : null}
    <ReviewSelectionBar selection={selection} multiSelect={multiSelect} onMultiSelect={() => onMultiSelect?.()} hideMultiSelect={!onMultiSelect} onClear={() => onSelectionChange?.(null)}
      onPlay={() => { if (selection) { setAudition(selection.ranges); setPlayRequest(n => n + 1); } }}
      auditioning={Boolean(audition)} auditionRanges={audition ?? undefined}
      onFullSong={() => { player.pause(); setAudition(null); }} />
    {analysis ? <BeatSpine analysis={analysis} bpm={analysis.bpm ?? 120} playhead={(time ?? 0) / Math.max(analysis.duration, .001)}
      caption="Current cut · song time" slots={slots} takes={[]} onPreviewSource={() => {}}
      selectedSlotId={slots.find(s => s.animaticShotId === focusedShotId)?.id ?? null}
      selectedRanges={selection?.ranges ?? []} onSelectRange={select} initialVisibleRange={initialViewport} onVisibleRangeChange={onViewportChange}
      onSelectSection={(start, end, extend, toggle) => select({ start, end }, { extend, toggle })}
      onSelectSlot={(slot, extend, toggle) => { if (slot) select(slot, { extend, toggle }); else onSelectionChange?.(null); }}
      onSeek={fraction => { const offset = previewOffsetAtSongTime(displayed, fraction * analysis.duration); if (offset !== null) void player.seekToTime(offset); }} /> : null}
    <div className="relative aspect-video overflow-hidden rounded-md border border-line bg-ink-0">
      <PreviewPlayer player={player} segments={displayed} masterAudioUrl={audioUrl || null} variant="monitor" />
      {isGap ? <div className="pointer-events-none absolute inset-0">
        {image ? <>
          {/* eslint-disable-next-line @next/next/no-img-element -- small authenticated still fallback */}
          <img src={mediaThumbnailUrl(image, 640)} alt="Still fallback: video is not selected" className="h-full w-full object-contain" />
        </> : shot ? <AnimaticTimingCard shot={shot} fps={plan!.fps} /> : <div className="flex h-full items-center justify-center text-sm text-fg-3">Missing selected video · master song continues</div>}
        <span className="absolute right-2 top-2 rounded-sm bg-ink-0/90 px-2 py-1 text-xs text-warn">{image ? "Still fallback" : "Video gap"}</span>
      </div> : null}
      {labels && shot && plan ? <AnimaticShotOverlay shot={shot} fps={plan.fps} /> : null}
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <Button disabled={!displayed.length || !audioUrl} onClick={() => {
        if (state.status === "playing" || state.status === "loading") player.pause();
        else if (state.status === "paused") player.resume();
        else void player.play();
      }}>{state.status === "playing" || state.status === "loading" ? "Pause cut" : "Play cut"}</Button>
      <Button onClick={() => player.stop()}>Stop</Button>
      <Button aria-pressed={labels} onClick={() => setLabels(value => !value)}>Shot labels {labels ? "on" : "off"}</Button>
      <span className="text-xs text-fg-3">Draft viewing only · ready media and cut approval are separate.</span>
    </div>
    {state.errorMessage ? <p role="alert" className="text-xs text-danger">{state.errorMessage}</p> : null}
  </section>;
}
