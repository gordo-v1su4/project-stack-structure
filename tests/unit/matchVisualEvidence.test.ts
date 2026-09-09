import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MatchCard, ThumbMatchCard } from "@/components/studio/panels/MatchCards";
import { sceneMotionLabel, scenePalette } from "@/components/studio/panels/matchVisualEvidence";
import type { VideoMoment, SemanticClipMatch } from "@/components/studio/musicVideoProject";
import type { MotionDescriptor } from "@/components/studio/types";

const moment: VideoMoment = { id: "scene-1", sourceClipId: 0, label: "Scene 1", start: 0, end: 4, duration: 4,
  caption: "A person walks down the street, then stands by a wall.", thumbnailUrl: "/thumb.jpg" };
const descriptor: MotionDescriptor = {
  id: "flow", targetKind: "segment", filePath: "source.mp4", dominantAngleDeg: 0, dominantMagnitude: 0.6,
  motionCoherence: 0.8, cameraMotionType: "pan", cameraMotionStrength: 0.6, residualMotionStrength: 0.4,
  motionEntropy: 0.2, acceleration: 0.1, confidence: { overall: 0.8, camera: 0.6, residual: 0.6 },
  provenance: { kind: "optical-flow", tool: "opencv-farneback", generatedAt: "2026-09-08" },
};
const withFlow = (overrides: Partial<MotionDescriptor> = {}): VideoMoment => ({ ...moment, motionDescriptor: { ...descriptor, ...overrides } });

describe("Match visual evidence", () => {
  test("caption words cannot manufacture direction or scene colors", () => {
    expect(sceneMotionLabel(moment)).toBe("Motion unavailable");
    expect(scenePalette(moment)).toEqual([]);
    const markup = renderToStaticMarkup(createElement(MatchCard, { label: "Arrival", start: 0, end: 4, prompt: "Arrive",
      moment, mode: "balanced", candidateMatches: [], momentsById: new Map() }));
    expect(markup).toContain("Motion unavailable");
    expect(markup).toContain("Color unavailable");
    expect(markup).toContain("Trim-boundary continuity has not been measured");
    expect(markup).not.toContain("In edge");
    expect(markup).not.toContain("Out edge");
    // A single thumbnail must not be repeated as first/middle/last temporal evidence.
    expect(markup.match(/<img /g)).toHaveLength(1);
    expect(markup).toContain('alt="Thumbnail"');
    expect(markup).not.toContain("object-cover");
    expect(markup).not.toContain("width:50%");
  });

  for (const [angle, expected] of [[0, "Rightward flow"], [90, "Downward flow"], [180, "Leftward flow"], [270, "Upward flow"], [-90, "Upward flow"], [450, "Downward flow"]] as const) {
    test(`image-coordinate angle ${angle} is displayed as ${expected}`, () => {
      expect(sceneMotionLabel(withFlow({ dominantAngleDeg: angle, cameraMotionType: "tilt" }))).toBe(expected);
    });
  }

  test("unknown magnitude and uncertain flow do not become static or a confident direction", () => {
    expect(sceneMotionLabel(withFlow({ dominantMagnitude: null, cameraMotionType: "static" }))).toBe("Motion unavailable");
    expect(sceneMotionLabel(withFlow({ dominantMagnitude: NaN }))).toBe("Motion unavailable");
    expect(sceneMotionLabel(withFlow({ dominantMagnitude: 0.01, dominantAngleDeg: null }))).toBe("Little image motion");
    expect(sceneMotionLabel(withFlow({ motionCoherence: 0.02 }))).toBe("Mixed image motion");
    expect(sceneMotionLabel(withFlow({ motionCoherence: null }))).toBe("Direction unavailable");
    expect(sceneMotionLabel(withFlow({ dominantAngleDeg: null }))).toBe("Direction unavailable");
    expect(sceneMotionLabel(withFlow({ confidence: { overall: 0.1, camera: 0.1, residual: 0.1 } }))).toBe("Motion unavailable");
    expect(sceneMotionLabel(withFlow({ provenance: { ...descriptor.provenance, kind: "placeholder" } }))).toBe("Motion unavailable");
    expect(sceneMotionLabel({ ...moment, visualAnalysis: { motion: descriptor } })).toBe("Rightward flow");
  });

  test("palettes use only analyzed, valid swatches without mutating the evidence", () => {
    const color = { palette: [{ hex: "#ff8800", weight: 0.2 }, { l: 100, a: 0, b: 0, weight: 0.8 },
      { hex: "not-a-color", weight: 1 }, { hex: "#abcdef", weight: 0 }] };
    const before = JSON.stringify(color);
    expect(scenePalette({ ...moment, visualAnalysis: { color } })).toEqual(["#ffffff", "#ff8800"]);
    expect(JSON.stringify(color)).toBe(before);
  });

  test("even high model fit remains a selection to review in both card views", () => {
    const match: SemanticClipMatch = { momentId: moment.id, score: 0.9, semanticScore: 0.9, lyricCaptionScore: 0.8,
      actionIntentScore: 0.7, durationFitScore: 0.9, motionContinuityScore: 0.5, motionEnergyScore: 0.6,
      repetitionPenalty: 0, reasons: [], assessment: { version: 1, requirementId: "arrival", sourceId: moment.id,
        eligibility: "eligible", usableInEdit: true, satisfied: [], unknown: [], contradicted: [], reasons: [], evidenceReferences: [] } };
    const props = { label: "Arrival", start: 0, end: 4, moment, match, mode: "balanced" as const };
    for (const markup of [renderToStaticMarkup(createElement(ThumbMatchCard, props)),
      renderToStaticMarkup(createElement(MatchCard, { ...props, prompt: "Arrival", candidateMatches: [], momentsById: new Map() }))]) {
      expect(markup).toContain("Selected · review fit");
      expect(markup).not.toContain("Supported");
    }
  });
});
