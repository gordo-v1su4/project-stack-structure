import { isUsableStoryMatch } from "../storyMatchAssessment";
import { fmt } from "../math";
import { sceneMotionLabel, scenePalette } from "./matchVisualEvidence";
import type { SemanticClipMatch, VideoMoment } from "../musicVideoProject";
import { MatchCandidateRail } from "./MatchCandidateRail";
import { getDisplayCaption } from "./matchCaptions";
import { getMatchModeLabel, getMatchModeScore, type MatchMode } from "./matchModes";

export function ThumbMatchCard({ label, start, end, match, moment, mode }: { label: string; start: number; end: number; match?: SemanticClipMatch; moment?: VideoMoment; mode: MatchMode }) {
  const hole = !moment || !isUsableStoryMatch(match?.assessment);
  const direction = sceneMotionLabel(moment);
  const palette = scenePalette(moment);
  const frameUrl = moment?.firstFrameUrl ?? moment?.thumbnailUrl;

  return (
    <article className={`overflow-hidden rounded-sm border ${hole ? "border-danger/40 bg-ink-2" : "border-line bg-ink-1"}`}>
      <div className="relative aspect-video bg-ink-0">
        {frameUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={frameUrl} alt={label} className="h-full w-full object-contain" loading="lazy" decoding="async" />
        ) : null}
        <div className="absolute left-2 top-2 rounded-sm bg-ink-0/80 px-2 py-1 text-[8px] uppercase tracking-[0.12em] text-fg-0">{label}</div>
        <div className={`absolute right-2 top-2 rounded-sm border px-2 py-1 font-mono text-[8px] ${hole ? "border-danger/40 text-danger" : "border-line-2 text-fg-1"}`}>{hole ? "No usable selection" : "Selected · review fit"}</div>
        <div className="absolute bottom-2 left-2 rounded-sm bg-ink-0/80 px-2 py-1 font-mono text-[8px] text-accent">{direction}</div>
        <div className="absolute bottom-2 right-2 rounded-sm bg-ink-0/80 px-2 py-1 font-mono text-[8px] text-fg-2">{fmt(start)}–{fmt(end)}</div>
      </div>
      <PaletteStrip palette={palette} />
      <div className="flex items-center justify-between gap-2 border-t border-line px-2 py-2 font-mono text-[8px] uppercase tracking-[0.1em] text-fg-3">
        <span className="truncate">{moment?.sourceRefLabel ?? "No candidate"}</span>
        <span className={hole ? "text-danger" : "text-fg-3"}>{getMatchModeLabel(mode, match)}</span>
      </div>
      <div className="border-t border-line px-2 py-1.5 text-[8px] leading-4 text-fg-3">
        Scene flow is an estimate, not trim-boundary continuity. Selection and scores do not confirm an exact match.
      </div>
    </article>
  );
}

export function MatchCard({
  label,
  start,
  end,
  prompt,
  match,
  moment,
  mode,
  candidateMatches,
  momentsById,
  onSelectCandidate,
}: {
  label: string;
  start: number;
  end: number;
  prompt: string;
  match?: SemanticClipMatch;
  moment?: VideoMoment;
  mode: MatchMode;
  candidateMatches: SemanticClipMatch[];
  momentsById: Map<string, VideoMoment>;
  onSelectCandidate?: (momentId: string) => void;
}) {
  const ready = Boolean(moment && isUsableStoryMatch(match?.assessment));
  const modeScore = getMatchModeScore(mode, match);
  const caption = getDisplayCaption(moment);
  const palette = scenePalette(moment);
  const direction = sceneMotionLabel(moment);

  return (
    <article className={`overflow-hidden rounded-sm border ${ready ? "border-line-2 bg-ink-2" : "border-line bg-ink-2"}`}>
      <div className="grid gap-0 md:grid-cols-[230px_1fr]">
        <FrameStrip moment={moment} palette={palette} />
        <div className="flex min-w-0 flex-col p-3">
          <div className="mb-2 flex items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-0">{label}</div>
              <div className="mt-1 font-mono text-[9px] text-fg-3">{fmt(start)}–{fmt(end)}</div>
            </div>
            <div className={`rounded-sm border px-2 py-1 font-mono text-[9px] ${ready ? "border-line-2 text-fg-1" : "border-danger/40 text-danger"}`}>{ready ? "Selected · review fit" : "No usable selection"}</div>
          </div>
          <div className="rounded-sm border border-line bg-ink-0 p-2 text-[10px] leading-4 text-fg-2">
            <span className="text-accent">Story:</span> {prompt}
          </div>
          <div className="mt-2 rounded-sm border border-line bg-ink-0 p-2 text-[10px] leading-4 text-fg-1">
            <div className="mb-1 text-[8px] uppercase tracking-[0.14em] text-fg-3">Candidate caption / semantic meaning</div>
            {moment ? caption : <span className="text-danger">No video moment selected yet.</span>}
            {moment ? <div className="mt-2 font-mono text-[8px] text-fg-3">{moment.sourceRefLabel ?? `S${moment.sourceClipId + 1}`} · {fmt(moment.start)}–{fmt(moment.end)}</div> : null}
            {match?.reasons.length ? <div className="mt-2 text-[8px] uppercase tracking-[0.12em] text-fg-3">{match.reasons.join(" · ")}</div> : null}
          </div>
          <MatchCandidateRail candidateMatches={candidateMatches} selectedMomentId={moment?.id ?? match?.momentId ?? null} momentsById={momentsById} mode={mode} onSelectCandidate={onSelectCandidate} />
          <div className="mt-2 grid gap-2 md:grid-cols-[1fr_170px]">
            <div className="rounded-sm border border-line bg-ink-0 p-2">
              <div className="mb-2 text-[8px] uppercase tracking-[0.14em] text-fg-3">Scene flow estimate</div>
              <div className="font-mono text-xs text-fg-1">{direction}</div>
              <p className="mt-2 text-[10px] leading-4 text-fg-3">Trim-boundary continuity has not been measured. Scene flow does not separate camera movement from subject movement.</p>
            </div>
            <div className="rounded-sm border border-line bg-ink-0 p-2">
              <div className="mb-2 text-[8px] uppercase tracking-[0.14em] text-fg-3">Ranking advice</div>
              <ScoreBar label="Overall" value={match ? modeScore : undefined} active />
              <ScoreBar label="Caption" value={match?.lyricCaptionScore} />
              <ScoreBar label="Action" value={match?.actionIntentScore} />
              <ScoreBar label="Duration" value={match?.durationFitScore} />
              <p className="mt-2 text-[9px] leading-4 text-fg-3">Scores guide selection; they are not approval or match probabilities.</p>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

function FrameStrip({ moment, palette }: { moment?: VideoMoment; palette: string[] }) {
  const frames = [
    { label: moment?.firstFrameUrl ? "First" : "Thumbnail", url: moment?.firstFrameUrl ?? moment?.thumbnailUrl },
    { label: "Middle", url: moment?.middleFrameUrl },
    { label: "Last", url: moment?.lastFrameUrl },
  ];

  return (
    <div className="border-b border-line bg-ink-0 p-2 md:border-b-0 md:border-r">
      <div className="grid grid-cols-3 gap-1 md:grid-cols-1">
        {frames.map((frame) => (
          <div key={frame.label} className="relative aspect-video overflow-hidden rounded-sm border border-line bg-ink-0">
            {frame.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={frame.url} alt={frame.label} className="h-full w-full object-contain" loading="lazy" decoding="async" />
            ) : <div className="flex h-full items-center justify-center pt-3 text-[8px] text-fg-3">Unavailable</div>}
            <div className="absolute left-1 top-1 rounded-[1px] bg-ink-0/80 px-1 py-[1px] text-[7px] uppercase tracking-[0.1em] text-fg-0">{frame.label}</div>
          </div>
        ))}
      </div>
      <PaletteStrip palette={palette} />
    </div>
  );
}

function ScoreBar({ label, value, active = false }: { label: string; value?: number; active?: boolean }) {
  const score = value === undefined || !Number.isFinite(value) ? null : Math.min(1, Math.max(0, value));
  return (
    <div className="mb-[5px] grid grid-cols-[48px_1fr_28px] items-center gap-2 text-[8px] uppercase tracking-[0.1em]">
      <span className={active ? "text-accent" : "text-fg-3"}>{label}</span>
      <div className="h-[3px] rounded-full bg-line">
        {score !== null ? <div className={`h-full rounded-full ${active ? "bg-accent" : "bg-fg-3"}`} style={{ width: `${score * 100}%` }} /> : null}
      </div>
      <span className="text-right font-mono text-fg-3">{score === null ? "—" : Math.round(score * 100)}</span>
    </div>
  );
}

function PaletteStrip({ palette }: { palette: string[] }) {
  if (!palette.length) return <p className="px-2 py-1 text-[9px] text-fg-3">Color unavailable</p>;
  return <div className="mt-2 flex h-3 overflow-hidden rounded-sm border border-line" aria-label="Analyzed scene colors">
    {palette.map((color, index) => <div key={`${color}-${index}`} className="flex-1" style={{ backgroundColor: color }} />)}
  </div>;
}
