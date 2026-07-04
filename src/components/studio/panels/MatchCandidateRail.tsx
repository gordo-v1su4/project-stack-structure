import type { SemanticClipMatch, VideoMoment } from "../musicVideoProject";
import { MATCH_MODE_LABELS, type MatchMode } from "./matchModes";
import { buildMatchCandidateRailItems, type MatchCandidateRailItem } from "./matchCandidateRailModel";

export function MatchCandidateRail({
  candidateMatches,
  selectedMomentId,
  momentsById,
  mode,
}: {
  candidateMatches: SemanticClipMatch[];
  selectedMomentId: string | null;
  momentsById: Map<string, VideoMoment>;
  mode: MatchMode;
}) {
  const candidates = buildMatchCandidateRailItems({ candidateMatches, selectedMomentId, momentsById, mode });
  if (!candidates.length) return null;

  const backupCount = Math.max(0, candidates.length - 1);

  return (
    <div className="mt-2 rounded-[2px] border border-[#171717] bg-[#050505] p-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <div className="text-[8px] uppercase tracking-[0.14em] text-[#555]">Semantic contact sheet</div>
          <div className="mt-1 text-[9px] leading-4 text-[#747474]">Ranked visual backups prove the match instead of hiding the shuffle.</div>
        </div>
        <div className="font-mono text-[8px] uppercase tracking-[0.1em] text-[#666]">{backupCount} backups</div>
      </div>
      <div className="grid gap-1 sm:grid-cols-2 2xl:grid-cols-5">
        {candidates.map((candidate) => (
          <CandidateMiniCard key={`${candidate.match.momentId}-${candidate.rank}`} candidate={candidate} mode={mode} />
        ))}
      </div>
    </div>
  );
}

function CandidateMiniCard({ candidate, mode }: { candidate: MatchCandidateRailItem; mode: MatchMode }) {
  return (
    <article className={`overflow-hidden rounded-[2px] border ${candidate.selected ? "border-[#e05c00] bg-[#100905]" : "border-[#1d1d1d] bg-[#060606]"}`}>
      <div className="relative aspect-video bg-[#030303]">
        {candidate.frameUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={candidate.frameUrl} alt={`${candidate.moment.label} candidate`} className="h-full w-full object-cover" loading="lazy" decoding="async" />
        ) : <div className="h-full w-full bg-[#101010]" />}
        <div className="absolute left-1 top-1 rounded-[1px] bg-[#000000b8] px-1 py-[1px] font-mono text-[7px] uppercase tracking-[0.1em] text-[#d0d0d0]">#{candidate.rank}</div>
        <div className={`absolute right-1 top-1 rounded-[1px] border bg-[#000000b8] px-1 py-[1px] font-mono text-[7px] ${candidate.selected ? "border-[#e05c00] text-[#e05c00]" : "border-[#245c2c] text-[#79c779]"}`}>
          {candidate.scorePercent}%
        </div>
        {candidate.selected ? <div className="absolute bottom-1 left-1 rounded-[1px] bg-[#e05c00] px-1 py-[1px] text-[7px] uppercase tracking-[0.1em] text-white">selected</div> : null}
      </div>
      <div className="p-2">
        <div className="truncate font-mono text-[8px] uppercase tracking-[0.1em] text-[#8a8a8a]">{candidate.moment.sourceRefLabel ?? `S${candidate.moment.sourceClipId + 1}`} · {candidate.modeScorePercent} {MATCH_MODE_LABELS[mode]}</div>
        <div className="mt-1 line-clamp-2 min-h-8 text-[9px] leading-4 text-[#b0b0b0]">{candidate.caption}</div>
        <div className="mt-1 truncate text-[8px] uppercase tracking-[0.1em] text-[#606060]">{candidate.reason}</div>
      </div>
    </article>
  );
}
