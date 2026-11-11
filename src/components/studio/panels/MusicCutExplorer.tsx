"use client";

import { useMemo, useState } from "react";
import { buildAdaptiveCueMap } from "../adaptiveCueMap";
import type { MusicVideoProject, StoryEditSettings } from "../musicVideoProject";
import type { BeatJoinAnalysis } from "../types";
import { ParamSlider } from "../ParamSlider";
import { Button, Surface } from "../ui";
import { MatchMusicCueTimeline } from "./MatchMusicCueTimeline";
import type { SelectionGesture, SongRange } from "../reviewSelection";

export type MusicCutExplorerProps = {
  analysis: BeatJoinAnalysis | null;
  project: MusicVideoProject | null;
  onsetDensity: number;
  lyricCueBlend: number;
  lyricMergeWindow: number;
  onOnsetDensity: (value: number) => void;
  onLyricCueBlend: (value: number) => void;
  onLyricMergeWindow: (value: number) => void;
  onOpenMatch?: () => void;
  matchReady?: boolean;
  editSettings?: StoryEditSettings;
  selectedRanges?: SongRange[];
  visibleRange?: SongRange | null;
  multiSelect?: boolean;
  onSelectRange?: (range: SongRange, gesture: SelectionGesture) => void;
  coverage?: Array<SongRange & { filled: boolean }>;
};

/** Suggestion settings only: this component has no placement, approval or dispatch callback. */
export function MusicCutExplorer(props: MusicCutExplorerProps) {
  const [selectedChunkId, setSelectedChunkId] = useState<string | null>(null);
  const [paceOverride, setPaceOverride] = useState<"saved" | "fast" | "balanced" | "relaxed">("saved");
  const { analysis, project, onsetDensity, lyricCueBlend, lyricMergeWindow } = props;
  const savedPace = project?.placementPlan?.settings ?? props.editSettings;
  const pace = useMemo(() => paceOverride === "saved" ? savedPace : { cutDensity: paceOverride === "fast" ? 0.82 : paceOverride === "relaxed" ? 0.3 : 0.55, preferOnsets: true }, [paceOverride, savedPace]);
  const fast = Boolean(pace && pace.cutDensity >= 0.8);
  const cueMap = useMemo(() => buildAdaptiveCueMap({ analysis, project, density: onsetDensity / 100,
    lyricBlend: lyricCueBlend / 100, lyricMergeWindowSeconds: lyricMergeWindow, editSettings: pace }),
  [analysis, project, onsetDensity, lyricCueBlend, lyricMergeWindow, pace]);
  const selected = cueMap.chunks.find(chunk => chunk.id === selectedChunkId) ?? cueMap.chunks[0];
  const boundaryLabel = (time: number) => {
    const markers = cueMap.markers.filter(marker => marker.active && Math.abs(marker.time - time) < 1e-6);
    const beat = (analysis ?? project?.song)?.beats.some(value => Math.abs(value - time) < 0.001);
    return [markers.some(marker => marker.kind === "onset") ? "onset" : "", beat ? "beat" : "",
      markers.some(marker => marker.kind === "lyric") ? "lyric phrase" : ""].filter(Boolean).join(" + ") || "section or spacing boundary";
  };
  return <Surface as="section" aria-label="Music and cut timing">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-sm font-medium text-fg-0">Music and cut timing</h2>
        <p className="mt-1 max-w-3xl text-xs leading-5 text-fg-2">Drag the sliders to explore onset, beat and lyric timing before confirming Story or reviewing Draft. The graph updates as you drag. These suggestions do not change your saved cut or approvals.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {props.onOpenMatch ? <Button onClick={props.onOpenMatch} disabled={!props.matchReady}
          reason={props.matchReady ? undefined : "Confirm Story before reviewing footage matches"}>Review footage matches</Button> : null}
        <Button onClick={() => { setPaceOverride("saved"); props.onOnsetDensity(65); props.onLyricCueBlend(60); props.onLyricMergeWindow(3); }}>Reset suggestions</Button>
      </div>
    </div>
    <label className="mt-3 block text-xs text-fg-2">Suggestion pace
      <select aria-label="Suggestion pace" className="ml-2 rounded-md border border-line bg-ink-1 p-2 text-fg-1" value={paceOverride}
        onChange={event => setPaceOverride(event.target.value as typeof paceOverride)}>
        <option value="saved">Follow saved Story pace{fast && paceOverride === "saved" ? " · Fast" : ""}</option>
        <option value="fast">Fast · 1–3s</option><option value="balanced">Balanced · 4s minimum</option><option value="relaxed">Relaxed · 4s minimum</option>
      </select>
    </label>
    <div className="my-3 grid gap-3 md:grid-cols-3">
      <ParamSlider label="Cue density" value={onsetDensity} min={5} max={100} step={5} unit="%" layout="stack" accent="var(--color-accent)" onChange={props.onOnsetDensity} />
      <ParamSlider label="Lyric influence" value={lyricCueBlend} min={0} max={100} step={5} unit="%" layout="stack" accent="var(--color-accent)" onChange={props.onLyricCueBlend} />
      <ParamSlider label="Combine nearby cues" value={lyricMergeWindow} min={0} max={5} step={0.5} unit="s" layout="stack" accent="var(--color-accent)" onChange={props.onLyricMergeWindow} />
    </div>
    <p className="mb-2 text-xs text-fg-3" aria-live="polite">{cueMap.chunks.length} suggested blocks · {cueMap.onsetActiveCount} music cues · {cueMap.lyricActiveCount} lyric cues. {fast ? "Fast targets 1–3 seconds using actual music cues; sparse cues may leave longer blocks." : "Suggested pace is 4–6 seconds; short section edges remain visible."}</p>
    <MatchMusicCueTimeline cueMap={cueMap} project={project} selectedChunkId={selected?.id} onSelectChunk={setSelectedChunkId}
      selectedRanges={props.selectedRanges} visibleRange={props.visibleRange} onSelectRange={props.onSelectRange} multiSelect={props.multiSelect} coverage={props.coverage} />
    {selected ? <p className="mt-2 font-mono text-xs text-fg-1" aria-live="polite">Selected suggestion: {selected.start.toFixed(3)}–{selected.end.toFixed(3)}s · {(selected.end - selected.start).toFixed(3)}s · starts on {boundaryLabel(selected.start)}</p> : null}
    <p className="mt-1 text-xs text-fg-3">Choose a block to inspect its exact timing. Onsets and phrases use their detected timestamps; section and spacing boundaries may fall between beats. Pace changes here only explore suggestions; saved Story settings remain unchanged.</p>
    <p className="mt-2 text-xs leading-5 text-fg-3">Orange marks musical accents; cyan marks lyric phrases. Without timed lyrics, musical cues still work. Footage semantics remain in Match review; this graph does not rerank or apply footage.</p>
  </Surface>;
}
