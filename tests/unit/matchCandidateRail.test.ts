import { describe, expect, test } from "bun:test";

import { buildMatchCandidateRailItems } from "@/components/studio/panels/matchCandidateRailModel";
import type { SemanticClipMatch, VideoMoment } from "@/components/studio/musicVideoProject";

function match(momentId: string, score: number, reasons: string[] = ["caption/query match"]): SemanticClipMatch {
  return {
    momentId,
    score,
    semanticScore: score,
    lyricCaptionScore: score - 0.1,
    actionIntentScore: 0.8,
    durationFitScore: 0.7,
    motionContinuityScore: 0.5,
    motionEnergyScore: 0.6,
    repetitionPenalty: 0,
    reasons,
  };
}

function moment(id: string, caption: string, frameUrl?: string): VideoMoment {
  return {
    id,
    sourceClipId: 0,
    label: id,
    start: 0,
    end: 2,
    duration: 2,
    caption,
    captionMeta: { caption },
    sourceRefLabel: `S1 · ${id}`,
    firstFrameUrl: frameUrl,
  };
}

describe("match candidate rail model", () => {
  test("builds visible ranked candidates with selected state, scores, captions, and reasons", () => {
    const momentsById = new Map([
      ["winner", moment("winner", "Singer under blue neon.", "frame:winner")],
      ["backup", moment("backup", "Dancers in rain.")],
    ]);

    const items = buildMatchCandidateRailItems({
      candidateMatches: [match("winner", 0.91), match("backup", 0.56, ["action/intent match"]), match("missing", 0.5)],
      selectedMomentId: "winner",
      momentsById,
      mode: "semantic",
    });

    expect(items).toHaveLength(2);
    expect(items[0].rank).toBe(1);
    expect(items[0].selected).toBe(true);
    expect(items[0].scorePercent).toBe(91);
    expect(items[0].modeScorePercent).toBe(91);
    expect(items[0].caption).toBe("Singer under blue neon.");
    expect(items[0].reason).toBe("caption/query match");
    expect(items[0].frameUrl).toBe("frame:winner");
    expect(items[1].rank).toBe(2);
    expect(items[1].selected).toBe(false);
    expect(items[1].reason).toBe("action/intent match");
  });

  test("limits candidates and falls back to labels/reason text when captions are sparse", () => {
    const momentsById = new Map(Array.from({ length: 7 }, (_, index) => {
      const id = `m${index}`;
      return [id, moment(id, "")] as const;
    }));

    const items = buildMatchCandidateRailItems({
      candidateMatches: Array.from({ length: 7 }, (_, index) => match(`m${index}`, 0.9 - index * 0.05, [])),
      selectedMomentId: "m2",
      momentsById,
      mode: "motion",
      limit: 5,
    });

    expect(items).toHaveLength(5);
    expect(items.map((item) => item.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(items[2].selected).toBe(true);
    expect(items[0].caption).toBe("m0");
    expect(items[0].reason).toBe("ranked candidate");
  });
});
