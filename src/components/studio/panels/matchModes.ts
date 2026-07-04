import type { SemanticClipMatch } from "../musicVideoProject";

export type MatchMode = "semantic" | "story" | "motion" | "energy" | "color";

export const MATCH_MODE_LABELS: Record<MatchMode, string> = {
  semantic: "Semantic",
  story: "Story Intent",
  motion: "Motion",
  energy: "Energy",
  color: "Color",
};

export const MATCH_MODE_DETAILS: Record<MatchMode, string> = {
  semantic: "Caption/theme meaning fits the lyric and section prompt.",
  story: "Beginning/middle/end story intent gets stronger weight.",
  motion: "Clip edge direction and action continuity are favored.",
  energy: "Per-section onset blocks get denser where the song is stronger.",
  color: "Clip edges favor palette continuity between last and first frames.",
};

export function getMatchModeScore(mode: MatchMode, match?: SemanticClipMatch) {
  if (!match) return 0;
  switch (mode) {
    case "story":
      return Math.max(match.semanticScore, match.actionIntentScore);
    case "motion":
      return Math.max(match.motionContinuityScore, match.actionIntentScore);
    case "energy":
      return match.motionEnergyScore;
    case "color":
      return Math.max(match.semanticScore * 0.6, match.motionContinuityScore * 0.8);
    default:
      return Math.max(match.semanticScore, match.lyricCaptionScore);
  }
}

export function getMatchModeLabel(mode: MatchMode, match?: SemanticClipMatch) {
  if (!match) return "missing";
  const score = Math.round(getMatchModeScore(mode, match) * 100);
  return `${MATCH_MODE_LABELS[mode]} ${score}`;
}
