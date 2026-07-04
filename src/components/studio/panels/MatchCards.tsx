import { fmt } from "../math";
import type { ColorPaletteSwatch, MotionDescriptor } from "../types";
import type { SemanticClipMatch, VideoMoment } from "../musicVideoProject";
import { MatchCandidateRail } from "./MatchCandidateRail";
import { getDisplayCaption } from "./matchCaptions";
import { getMatchModeLabel, getMatchModeScore, type MatchMode } from "./matchModes";

export function ThumbMatchCard({ label, start, end, match, moment, mode }: { label: string; start: number; end: number; match?: SemanticClipMatch; moment?: VideoMoment; mode: MatchMode }) {
  const score = match ? Math.round(match.score * 100) : 0;
  const hole = !moment || score < 35;
  const direction = inferMotionDirection(moment);
  const palette = buildPalette(moment, mode);
  const frameUrl = moment?.firstFrameUrl ?? moment?.thumbnailUrl;

  return (
    <article className={`overflow-hidden rounded-[2px] border ${hole ? "border-[#7a241e] bg-[#120706]" : "border-[#202020] bg-[#080808]"}`}>
      <div className="relative aspect-video bg-[#030303]">
        {frameUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={frameUrl} alt={label} className="h-full w-full object-cover" loading="lazy" decoding="async" />
        ) : null}
        <div className="absolute left-2 top-2 rounded-[2px] bg-[#000000b8] px-2 py-1 text-[8px] uppercase tracking-[0.12em] text-[#d0d0d0]">{label}</div>
        <div className={`absolute right-2 top-2 rounded-[2px] border px-2 py-1 font-mono text-[8px] ${hole ? "border-[#7a241e] text-[#d24b3f]" : "border-[#245c2c] text-[#79c779]"}`}>{hole ? "HOLE" : `${score}%`}</div>
        <div className="absolute bottom-2 left-2 rounded-[2px] bg-[#000000b8] px-2 py-1 font-mono text-[8px] text-[#e05c00]">{direction.label}</div>
        <div className="absolute bottom-2 right-2 rounded-[2px] bg-[#000000b8] px-2 py-1 font-mono text-[8px] text-[#aaa]">{fmt(start)}–{fmt(end)}</div>
      </div>
      <div className="flex h-3">
        {palette.map((color, index) => <div key={`${label}-${color}-${index}`} className="flex-1" style={{ background: color }} />)}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-[#141414] px-2 py-2 font-mono text-[8px] uppercase tracking-[0.1em] text-[#666]">
        <span className="truncate">{moment?.sourceRefLabel ?? "No candidate"}</span>
        <span className={hole ? "text-[#d24b3f]" : "text-[#777]"}>{getMatchModeLabel(mode, match)}</span>
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
  const score = match ? Math.round(match.score * 100) : 0;
  const ready = Boolean(moment?.caption && score >= 45);
  const modeScore = getMatchModeScore(mode, match);
  const caption = getDisplayCaption(moment);
  const palette = buildPalette(moment, mode);
  const direction = inferMotionDirection(moment);

  return (
    <article className={`overflow-hidden rounded-[2px] border ${ready ? "border-[#245c2c] bg-[#071007]" : "border-[#2a1717] bg-[#0c0707]"}`}>
      <div className="grid gap-0 md:grid-cols-[230px_1fr]">
        <FrameStrip moment={moment} direction={direction} palette={palette} />
        <div className="flex min-w-0 flex-col p-3">
          <div className="mb-2 flex items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#d0d0d0]">{label}</div>
              <div className="mt-1 font-mono text-[9px] text-[#777]">{fmt(start)}–{fmt(end)}</div>
            </div>
            <div className={`rounded-[2px] border px-2 py-1 font-mono text-[9px] ${ready ? "border-[#245c2c] text-[#79c779]" : "border-[#7a241e] text-[#d24b3f]"}`}>{ready ? `${score}% match` : "needs match"}</div>
          </div>
          <div className="rounded-[2px] border border-[#171717] bg-[#050505] p-2 text-[10px] leading-4 text-[#9a9a9a]">
            <span className="text-[#e05c00]">Story:</span> {prompt}
          </div>
          <div className="mt-2 rounded-[2px] border border-[#171717] bg-[#050505] p-2 text-[10px] leading-4 text-[#b0b0b0]">
            <div className="mb-1 text-[8px] uppercase tracking-[0.14em] text-[#555]">Candidate caption / semantic meaning</div>
            {moment ? caption : <span className="text-[#d24b3f]">No video moment selected yet.</span>}
            {moment ? <div className="mt-2 font-mono text-[8px] text-[#666]">{moment.sourceRefLabel ?? `S${moment.sourceClipId + 1}`} · {fmt(moment.start)}–{fmt(moment.end)}</div> : null}
            {match?.reasons.length ? <div className="mt-2 text-[8px] uppercase tracking-[0.12em] text-[#606060]">{match.reasons.slice(0, 3).join(" · ")}</div> : null}
          </div>
          <MatchCandidateRail candidateMatches={candidateMatches} selectedMomentId={moment?.id ?? match?.momentId ?? null} momentsById={momentsById} mode={mode} onSelectCandidate={onSelectCandidate} />
          <div className="mt-2 grid gap-2 md:grid-cols-[1fr_170px]">
            <div className="rounded-[2px] border border-[#171717] bg-[#050505] p-2">
              <div className="mb-2 text-[8px] uppercase tracking-[0.14em] text-[#555]">Edge / continuity labels</div>
              <div className="grid grid-cols-3 gap-1 text-[8px] uppercase tracking-[0.1em]">
                <div className="rounded-[2px] border border-[#1d1d1d] px-2 py-1 text-[#777]">In edge<br /><span className="font-mono text-[#b0b0b0]">{direction.inEdge}</span></div>
                <div className="rounded-[2px] border border-[#1d1d1d] px-2 py-1 text-[#777]">Motion<br /><span className="font-mono text-[#e05c00]">{direction.label}</span></div>
                <div className="rounded-[2px] border border-[#1d1d1d] px-2 py-1 text-[#777]">Out edge<br /><span className="font-mono text-[#b0b0b0]">{direction.outEdge}</span></div>
              </div>
            </div>
            <div className="rounded-[2px] border border-[#171717] bg-[#050505] p-2">
              <div className="mb-2 text-[8px] uppercase tracking-[0.14em] text-[#555]">Weights</div>
              <ScoreBar label="Mode" value={modeScore} active />
              <ScoreBar label="Caption" value={match?.lyricCaptionScore ?? 0} />
              <ScoreBar label="Action" value={match?.actionIntentScore ?? 0} />
              <ScoreBar label="Motion" value={match?.motionContinuityScore ?? 0} />
              <ScoreBar label="Energy" value={match?.motionEnergyScore ?? 0} />
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

function FrameStrip({ moment, direction, palette }: { moment?: VideoMoment; direction: MotionLabel; palette: string[] }) {
  const frames = [
    { label: "First", url: moment?.firstFrameUrl ?? moment?.thumbnailUrl },
    { label: direction.label, url: moment?.middleFrameUrl ?? moment?.thumbnailUrl },
    { label: "Last", url: moment?.lastFrameUrl ?? moment?.thumbnailUrl },
  ];

  return (
    <div className="border-b border-[#141414] bg-[#050505] p-2 md:border-b-0 md:border-r">
      <div className="grid grid-cols-3 gap-1">
        {frames.map((frame) => (
          <div key={frame.label} className="relative aspect-[4/5] overflow-hidden rounded-[2px] border border-[#151515] bg-[#030303]">
            {frame.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={frame.url} alt={frame.label} className="h-full w-full object-cover" loading="lazy" decoding="async" />
            ) : <div className="h-full w-full bg-[#101010]" />}
            <div className="absolute left-1 top-1 rounded-[1px] bg-[#000000aa] px-1 py-[1px] text-[7px] uppercase tracking-[0.1em] text-[#d0d0d0]">{frame.label}</div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex h-3 overflow-hidden rounded-[2px] border border-[#111]">
        {palette.map((color, index) => <div key={`${color}-${index}`} className="flex-1" style={{ background: color }} />)}
      </div>
    </div>
  );
}

function ScoreBar({ label, value, active = false }: { label: string; value: number; active?: boolean }) {
  const score = clamp01(value);
  return (
    <div className="mb-[5px] grid grid-cols-[48px_1fr_28px] items-center gap-2 text-[8px] uppercase tracking-[0.1em]">
      <span className={active ? "text-[#e05c00]" : "text-[#555]"}>{label}</span>
      <div className="h-[3px] rounded-full bg-[#171717]">
        <div className="h-full rounded-full" style={{ width: `${score * 100}%`, background: active ? "#e05c00" : score >= 0.45 ? "#477d47" : "#333" }} />
      </div>
      <span className="text-right font-mono text-[#666]">{Math.round(score * 100)}</span>
    </div>
  );
}

type MotionLabel = { label: string; inEdge: string; outEdge: string };

function inferMotionDirection(moment?: VideoMoment): MotionLabel {
  const descriptor = moment?.motionDescriptor ?? moment?.visualAnalysis?.motion;
  const descriptorLabel = descriptor ? motionLabelFromDescriptor(descriptor) : null;
  if (descriptorLabel) return descriptorLabel;

  const text = [moment?.caption, moment?.captionMeta?.action, moment?.captionMeta?.setting, moment?.captionMeta?.shotType].filter(Boolean).join(" ").toLowerCase();
  if (/rain|down|fall|descend|drop/.test(text)) return { label: "Down", inEdge: "north", outEdge: "south" };
  if (/rise|up|stand|lift/.test(text)) return { label: "Up", inEdge: "south", outEdge: "north" };
  if (/turn|spin|crowd|dance|club/.test(text)) return { label: "Mixed", inEdge: "center", outEdge: "center" };
  if (/walk|street|alley|confront|face/.test(text)) return { label: "West→East", inEdge: "west", outEdge: "east" };
  if (/static|still|table|wall|hands/.test(text)) return { label: "Static", inEdge: "hold", outEdge: "hold" };
  return { label: "Unknown", inEdge: "open", outEdge: "open" };
}

function buildPalette(moment: VideoMoment | undefined, mode: MatchMode) {
  const analyzedPalette = [
    ...(moment?.visualAnalysis?.color?.firstPalette ?? []),
    ...(moment?.visualAnalysis?.color?.middlePalette ?? []),
    ...(moment?.visualAnalysis?.color?.lastPalette ?? []),
    ...(moment?.visualAnalysis?.color?.palette ?? []),
  ];
  const realColors = paletteToHex(analyzedPalette);
  if (realColors.length) return realColors.slice(0, 5);

  const seed = `${mode}:${moment?.caption ?? moment?.label ?? "empty"}`;
  const palettes = [
    ["#2a4966", "#8f3f86", "#e07929"],
    ["#1e2f26", "#5f7f52", "#c49342"],
    ["#221a35", "#5d3c88", "#d45f7f"],
    ["#0d2b3a", "#1f7a8c", "#d7a64a"],
    ["#2c1612", "#8a3024", "#e08230"],
  ];
  return palettes[Math.abs(hashString(seed)) % palettes.length];
}

function motionLabelFromDescriptor(descriptor: MotionDescriptor): MotionLabel | null {
  if (descriptor.provenance.kind === "placeholder" || descriptor.confidence.overall < 0.2) return null;
  const type = descriptor.cameraMotionType;
  const angle = descriptor.dominantAngleDeg;
  if (type === "static" || (descriptor.dominantMagnitude ?? 0) < 0.08) return { label: "Static", inEdge: "hold", outEdge: "hold" };
  if (type === "push") return { label: "Push", inEdge: "wide", outEdge: "close" };
  if (type === "pull") return { label: "Pull", inEdge: "close", outEdge: "wide" };
  if (type === "tilt" && angle !== null) return angle > 0 ? { label: "Up", inEdge: "south", outEdge: "north" } : { label: "Down", inEdge: "north", outEdge: "south" };
  if (type === "pan" || angle !== null) {
    const normalized = angle === null ? 0 : ((angle % 360) + 360) % 360;
    if (normalized >= 315 || normalized < 45) return { label: "West→East", inEdge: "west", outEdge: "east" };
    if (normalized >= 135 && normalized < 225) return { label: "East→West", inEdge: "east", outEdge: "west" };
    if (normalized >= 45 && normalized < 135) return { label: "Up", inEdge: "south", outEdge: "north" };
    return { label: "Down", inEdge: "north", outEdge: "south" };
  }
  if (type === "mixed" || type === "roll") return { label: "Mixed", inEdge: "center", outEdge: "center" };
  return null;
}

function paletteToHex(palette: ColorPaletteSwatch[]) {
  return palette
    .filter((swatch) => swatch.weight > 0)
    .sort((left, right) => right.weight - left.weight)
    .map((swatch) => swatch.hex ?? labToHex(swatch))
    .filter((color): color is string => Boolean(color));
}

function labToHex(swatch: ColorPaletteSwatch) {
  if (!Number.isFinite(swatch.l) || !Number.isFinite(swatch.a) || !Number.isFinite(swatch.b)) return null;
  const y = (swatch.l! + 16) / 116;
  const x = swatch.a! / 500 + y;
  const z = y - swatch.b! / 200;
  const xyz = [x, y, z].map((value, index) => {
    const cubed = value ** 3;
    const normalized = cubed > 0.008856 ? cubed : (value - 16 / 116) / 7.787;
    return normalized * [95.047, 100, 108.883][index] / 100;
  });
  let [r, g, b] = [
    xyz[0] * 3.2406 + xyz[1] * -1.5372 + xyz[2] * -0.4986,
    xyz[0] * -0.9689 + xyz[1] * 1.8758 + xyz[2] * 0.0415,
    xyz[0] * 0.0557 + xyz[1] * -0.204 + xyz[2] * 1.057,
  ];
  [r, g, b] = [r, g, b].map((value) => {
    const corrected = value > 0.0031308 ? 1.055 * value ** (1 / 2.4) - 0.055 : 12.92 * value;
    return clamp(Math.round(corrected * 255), 0, 255);
  });
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return hash;
}

function clamp01(value: number) {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
