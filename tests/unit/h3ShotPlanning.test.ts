import { describe, expect, test } from "bun:test";
import { buildH3ShotPlanningInput, parseH3ShotPlanningResult, H3_SHOT_PLANNING_LIMITS, type H3ShotPlanningInput, type H3ShotPlanningResult } from "@/components/studio/h3ShotPlanning";
import { createMusicVideoProject, prepareApprovedPlacements, buildEditPlanPreviewSegments, type EditPlanPreviewSegment } from "@/components/studio/musicVideoProject";
import { h3FrameCount, H3_FPS } from "@/components/studio/h3Generation";

function fixture() {
  const draft = createMusicVideoProject({ analysis: null, duration: 20, videoSources: [], storyDrafts: [
    { id: "approach", label: "Approach", start: 0, end: 10, prompt: "Diego reaches the closed door." },
    { id: "release", label: "Release", start: 10, end: 20, prompt: "Diego crosses the doorway." },
  ] });
  for (const [index, item] of draft.editPlan.timelineItems.entries()) {
    item.requirementId = `requirement-${index}`;
    item.narrativeMomentId = `moment-${index}`;
    item.requirements = { subjects: ["Diego"], setting: "CLUB_MAIN", physicalStates: [index ? "door open" : "door closed"],
      excludedActions: ["grasp again"], actions: ["walking"], actionSequence: index ? ["release rail", "cross threshold"] : ["approach door", "brace door"],
      focalSubjectCount: 1, intent: "Continue the approved escape" };
  }
  const project = prepareApprovedPlacements({ project: draft, videoSources: [], editSettings: { cutDensity: 1, preferOnsets: true } });
  const segments = buildEditPlanPreviewSegments({ project, videoSources: [] }).flatMap(segment => [
    { ...segment, musicEnd: segment.musicStart + 5, endTime: 5 },
    { ...segment, musicStart: segment.musicStart + 5, endTime: 5 },
  ]);
  const names = ["Diego"];
  const input = buildH3ShotPlanningInput({ project, segments, subjectNames: names, projectId: "saved-project" });
  return { project, segments, names, input };
}

function output(input: H3ShotPlanningInput): H3ShotPlanningResult {
  return { version: 1, bindingSha256: input.bindingSha256, directions: input.groups.flatMap(group => group.windows.map((window, index) => ({
    windowKey: window.key, direction: `Bounded direction ${index + 1} for ${group.id}.`,
    entryState: `${group.id} state ${index}`, exitState: `${group.id} state ${index + 1}`, actionIndices: [index],
  }))) };
}

describe("canonical H3 shot planning contract", () => {
  test("retains approved constraints, names, pacing, story bindings and actual inference timing as detached data", () => {
    const { input, project, names } = fixture();
    expect(input.projectId).toBe("saved-project");
    expect(input.groups).toHaveLength(2);
    expect(input.groups[0].constraints).toEqual(project.editPlan.timelineItems[0].requirements!);
    expect(input.settings).toEqual({ cutDensity: 1, preferOnsets: true });
    expect(input.groups[0].approvedDirection).toBe("Diego reaches the closed door.");
    expect(input.groups[0]).toMatchObject({ requirementId: "requirement-0", narrativeMomentId: "moment-0", sectionId: "approach" });
    expect(input.subjectNames).toEqual(["Diego"]);
    const window = input.groups[0].windows[0];
    expect(window.inference).toEqual({ fps: H3_FPS, frames: h3FrameCount(5), durationSeconds: h3FrameCount(5) / H3_FPS });
    expect(window.inference.durationSeconds).toBeGreaterThan(window.songEnd - window.songStart);
    names[0] = "Other";
    project.editPlan.timelineItems[0].requirements!.physicalStates![0] = "changed";
    project.placementPlan!.settings.cutDensity = 0;
    expect(input.subjectNames).toEqual(["Diego"]);
    expect(input.groups[0].constraints.physicalStates).toEqual(["door closed"]);
    expect(input.settings.cutDensity).toBe(1);
    expect(parseH3ShotPlanningResult(output(input), input).directions).toHaveLength(4);
  });

  test("binding is stable across JSON round-trip and changes with cuts, names, settings or approved constraints", () => {
    const { input, project, segments } = fixture();
    expect(buildH3ShotPlanningInput({ project: JSON.parse(JSON.stringify(project)), segments: JSON.parse(JSON.stringify(segments)),
      subjectNames: ["Diego"], projectId: "saved-project" }).bindingSha256).toBe(input.bindingSha256);
    expect(buildH3ShotPlanningInput({ project, segments, subjectNames: ["Valentina"], projectId: "saved-project" }).bindingSha256).not.toBe(input.bindingSha256);
    const shifted = structuredClone(segments);
    shifted[0].musicEnd = 4.5; shifted[1].musicStart = 4.5;
    expect(buildH3ShotPlanningInput({ project, segments: shifted, subjectNames: ["Diego"], projectId: "saved-project" }).bindingSha256).not.toBe(input.bindingSha256);
    const changed = structuredClone(project);
    changed.editPlan.timelineItems[0].requirements!.physicalStates = ["door partly open"];
    const prepared = prepareApprovedPlacements({ project: changed, videoSources: [], editSettings: { cutDensity: 0.5, preferOnsets: false } });
    const replanned = buildEditPlanPreviewSegments({ project: prepared, videoSources: [] }).flatMap(segment => [
      { ...segment, musicEnd: segment.musicStart + 5 }, { ...segment, musicStart: segment.musicStart + 5 },
    ]);
    expect(buildH3ShotPlanningInput({ project: prepared, segments: replanned, subjectNames: ["Diego"], projectId: "saved-project" }).bindingSha256).not.toBe(input.bindingSha256);
  });

  test("rejects stale, forged, duplicated, out-of-order, oversized and partial requirement scaffolds", () => {
    const { project, segments } = fixture();
    const build = (values: EditPlanPreviewSegment[]) => buildH3ShotPlanningInput({ project, segments: values });
    expect(() => build([])).toThrow("count");
    expect(() => build([...segments].reverse())).toThrow("placement");
    expect(() => build([segments[0], segments[0]])).toThrow();
    expect(() => build([{ ...segments[0], planSignature: "earlier" }, ...segments.slice(1)])).toThrow("placement");
    expect(() => build([{ ...segments[0], requirementId: "other" }, ...segments.slice(1)])).toThrow("placement");
    expect(() => build([{ ...segments[0], placementId: "other" }, ...segments.slice(1)])).toThrow("placement");
    expect(() => build([{ ...segments[0], musicStart: -1 }, ...segments.slice(1)])).toThrow("placement");
    expect(() => build([{ ...segments[0], musicEnd: NaN }, ...segments.slice(1)])).toThrow("placement");
    expect(() => build(segments.slice(1))).toThrow("full ordered requirement");
    expect(() => build([{ ...segments[0], musicStart: 0.0009 }, ...segments.slice(1)])).toThrow("full ordered requirement");
    expect(() => build([...segments.slice(0, -1), { ...segments.at(-1)!, musicEnd: 19.9991 }])).toThrow("full ordered requirement");
    expect(() => build([segments[0], { ...segments[1], musicStart: 6 }, ...segments.slice(2)])).toThrow("Disjoint");
    expect(() => build(Array.from({ length: H3_SHOT_PLANNING_LIMITS.windows + 1 }, () => segments[0]))).toThrow("count");
    expect(() => buildH3ShotPlanningInput({ project, segments, subjectNames: ["Diego", "Diego"] })).toThrow("distinct");
    const stale = structuredClone(project); stale.editPlan.timelineItems[0].prompt = "Changed story";
    expect(() => buildH3ShotPlanningInput({ project: stale, segments })).toThrow("Confirm");
  });

  test("accepts only the exact bound ordered window coverage and clones model output", () => {
    const { input } = fixture();
    const result = output(input);
    const parsed = parseH3ShotPlanningResult(JSON.stringify(result), input);
    expect(parsed).toEqual(result);
    result.directions[0].actionIndices[0] = 10;
    expect(parsed.directions[0].actionIndices).toEqual([0]);
    for (const change of [
      (value: H3ShotPlanningResult) => { value.bindingSha256 = "0".repeat(64); },
      (value: H3ShotPlanningResult) => { value.directions.pop(); },
      (value: H3ShotPlanningResult) => { value.directions.push(value.directions[0]); },
      (value: H3ShotPlanningResult) => { [value.directions[0], value.directions[1]] = [value.directions[1], value.directions[0]]; },
      (value: H3ShotPlanningResult) => { value.directions[1].windowKey = value.directions[0].windowKey; },
      (value: H3ShotPlanningResult) => { value.directions[0].windowKey = "unknown"; },
      (value: H3ShotPlanningResult) => { value.directions[0].direction = "x".repeat(H3_SHOT_PLANNING_LIMITS.directionCharacters + 1); },
      (value: H3ShotPlanningResult) => { value.directions[0].entryState = ""; },
      (value: H3ShotPlanningResult) => { value.directions[0].exitState = "x".repeat(H3_SHOT_PLANNING_LIMITS.stateCharacters + 1); },
    ]) {
      const altered = output(input); change(altered);
      expect(() => parseH3ShotPlanningResult(altered, input)).toThrow();
    }
    expect(() => parseH3ShotPlanningResult("not json", input)).toThrow("JSON");
    expect(() => parseH3ShotPlanningResult({ ...output(input), timing: "change" }, input)).toThrow();
    const mutated = structuredClone(input); mutated.subjectNames = ["Other"];
    expect(() => parseH3ShotPlanningResult(output(mutated), mutated)).toThrow("binding changed");
  });

  test("enforces group, per-group window, name and approved text bounds before dispatch", () => {
    const { project, segments } = fixture();
    expect(() => buildH3ShotPlanningInput({ project, segments,
      subjectNames: Array.from({ length: H3_SHOT_PLANNING_LIMITS.subjectNames + 1 }, (_, index) => `Name ${index}`) })).toThrow("bounded");
    const count = H3_SHOT_PLANNING_LIMITS.windowsPerGroup + 1;
    const tinyWindows = Array.from({ length: count }, (_, index) => ({ ...segments[0],
      musicStart: 10 * index / count, musicEnd: 10 * (index + 1) / count }));
    expect(() => buildH3ShotPlanningInput({ project, segments: tinyWindows })).toThrow("group count");
    const total = H3_SHOT_PLANNING_LIMITS.groups + 1;
    const many = prepareApprovedPlacements({ project: createMusicVideoProject({ analysis: null, duration: total,
      storyDrafts: Array.from({ length: total }, (_, index) => ({ id: `part-${index}`, label: `Part ${index}`,
        start: index, end: index + 1, prompt: "Diego continues." })), videoSources: [] }), videoSources: [] });
    expect(() => buildH3ShotPlanningInput({ project: many, segments: buildEditPlanPreviewSegments({ project: many, videoSources: [] }) })).toThrow("group count");
    const long = structuredClone(project);
    long.editPlan.timelineItems[0].prompt = "x".repeat(4001);
    const prepared = prepareApprovedPlacements({ project: long, videoSources: [], editSettings: project.placementPlan!.settings });
    expect(() => buildH3ShotPlanningInput({ project: prepared,
      segments: buildEditPlanPreviewSegments({ project: prepared, videoSources: [] }) })).toThrow("approved direction");
  });

  test("applies the same UTF-8 byte bound to structurally valid object and string results", () => {
    const duration = H3_SHOT_PLANNING_LIMITS.windows;
    const groupCount = duration / H3_SHOT_PLANNING_LIMITS.windowsPerGroup;
    const project = prepareApprovedPlacements({ project: createMusicVideoProject({ analysis: null, duration, videoSources: [],
      storyDrafts: Array.from({ length: groupCount }, (_, index) => ({ id: `part-${index}`, label: `Part ${index}`,
        start: index * 64, end: (index + 1) * 64, prompt: "Diego continues." })) }), videoSources: [] });
    const segments = buildEditPlanPreviewSegments({ project, videoSources: [] }).flatMap(segment =>
      Array.from({ length: 64 }, (_, index) => ({ ...segment, musicStart: segment.musicStart + index, musicEnd: segment.musicStart + index + 1 })));
    const input = buildH3ShotPlanningInput({ project, segments });
    const result = output(input);
    for (const direction of result.directions) {
      direction.actionIndices = [];
      direction.direction = "x".repeat(H3_SHOT_PLANNING_LIMITS.directionCharacters);
      direction.entryState = direction.exitState = "x".repeat(H3_SHOT_PLANNING_LIMITS.stateCharacters);
    }
    expect(result.directions).toHaveLength(512);
    expect(parseH3ShotPlanningResult(result, input).directions).toHaveLength(512);
    for (const direction of result.directions) {
      direction.direction = "界".repeat(H3_SHOT_PLANNING_LIMITS.directionCharacters);
      direction.entryState = direction.exitState = "界".repeat(H3_SHOT_PLANNING_LIMITS.stateCharacters);
    }
    const serialized = JSON.stringify(result);
    expect(new TextEncoder().encode(serialized).length).toBeGreaterThan(H3_SHOT_PLANNING_LIMITS.resultBytes);
    expect(() => parseH3ShotPlanningResult(result, input)).toThrow("byte bound");
    expect(() => parseH3ShotPlanningResult(serialized, input)).toThrow("byte bound");
  });

  test("allocates each ordered approved action exactly once, never cycling or restarting it", () => {
    const { input } = fixture();
    for (const indices of [[[0], [0]], [[1], [0]], [[], [1]], [[0, 1], [1]], [[0], [-1]], [[0], [0.5]], [[0], [2]]]) {
      const result = output(input);
      result.directions[0].actionIndices = indices[0]; result.directions[1].actionIndices = indices[1];
      expect(() => parseH3ShotPlanningResult(result, input)).toThrow();
    }
    const bothInFirst = output(input);
    bothInFirst.directions[0].actionIndices = [0, 1]; bothInFirst.directions[1].actionIndices = [];
    expect(parseH3ShotPlanningResult(bothInFirst, input).directions[0].actionIndices).toEqual([0, 1]);
  });

  test("requires exact adjacent state equality within each requirement but makes no semantic-proof claim", () => {
    const { input } = fixture();
    const mismatch = output(input); mismatch.directions[1].entryState = "paraphrased state";
    expect(() => parseH3ShotPlanningResult(mismatch, input)).toThrow("states do not match");
    const structurallyValid = output(input);
    structurallyValid.directions[0].direction = "This deliberately does not assert semantic compliance.";
    expect(parseH3ShotPlanningResult(structurallyValid, input).directions).toHaveLength(4);
    const noActions = structuredClone(input);
    // Rebuild canonically rather than editing a bound input for an empty sequence.
    const { project, segments } = fixture();
    for (const item of project.editPlan.timelineItems) delete item.requirements!.actionSequence;
    const prepared = prepareApprovedPlacements({ project, videoSources: [], editSettings: { cutDensity: 1, preferOnsets: true } });
    const newSegments = buildEditPlanPreviewSegments({ project: prepared, videoSources: [] }).flatMap(segment => [
      { ...segment, musicEnd: segment.musicStart + 5 }, { ...segment, musicStart: segment.musicStart + 5 },
    ]);
    Object.assign(noActions, buildH3ShotPlanningInput({ project: prepared, segments: newSegments }));
    const noActionResult = output(noActions);
    noActionResult.directions.forEach(direction => { direction.actionIndices = []; });
    expect(parseH3ShotPlanningResult(noActionResult, noActions).directions).toHaveLength(segments.length);
    noActionResult.directions[0].actionIndices = [0];
    expect(() => parseH3ShotPlanningResult(noActionResult, noActions)).toThrow();
  });
});
