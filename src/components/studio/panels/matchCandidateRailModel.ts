import type { SemanticClipMatch, VideoMoment } from "../musicVideoProject";
import { getDisplayCaption } from "./matchCaptions";
import { getMatchModeScore, type MatchMode } from "./matchModes";

export interface MatchCandidateRailItem {
  match: SemanticClipMatch;
  moment: VideoMoment;
  rank: number;
  selected: boolean;
  scorePercent: number;
  modeScorePercent: number;
  caption: string;
  reason: string;
  frameUrl: string | undefined;
}

export function buildMatchCandidateRailItems(params: {
  candidateMatches: SemanticClipMatch[];
  selectedMomentId: string | null;
  momentsById: Map<string, VideoMoment>;
  mode: MatchMode;
  limit?: number;
}): MatchCandidateRailItem[] {
  const limit = params.limit ?? 5;
  return params.candidateMatches
    .slice(0, limit)
    .map((match, index) => {
      const moment = params.momentsById.get(match.momentId);
      if (!moment) return null;
      return {
        match,
        moment,
        rank: index + 1,
        selected: match.momentId === params.selectedMomentId,
        scorePercent: Math.round(match.score * 100),
        modeScorePercent: Math.round(getMatchModeScore(params.mode, match) * 100),
        caption: getDisplayCaption(moment) || moment.label,
        reason: match.reasons[0] ?? "ranked candidate",
        frameUrl: moment.firstFrameUrl ?? moment.middleFrameUrl ?? moment.thumbnailUrl,
      } satisfies MatchCandidateRailItem;
    })
    .filter((candidate): candidate is MatchCandidateRailItem => candidate !== null);
}
