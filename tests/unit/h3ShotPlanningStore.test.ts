import { describe, expect, test } from "bun:test";
import { buildH3ShotPlanningInput, type H3ShotPlanningResult } from "@/components/studio/h3ShotPlanning";
import { buildEditPlanPreviewSegments, createMusicVideoProject, prepareApprovedPlacements } from "@/components/studio/musicVideoProject";
import { readH3ShotPlan, storeH3ShotPlan } from "@/lib/h3ShotPlanningStore";
import { StudioProjectConflictError, type StudioJsonObjectStore } from "@/lib/studioProjectObjectStore";

function fixture() {
  const project = prepareApprovedPlacements({ project: createMusicVideoProject({
    duration: 6, videoSources: [], analysis: { duration: 6, sourceLabel: "master.wav", audioUrl: "", sections: [],
      beats: [0, 1, 2, 3, 4, 5, 6], onsets: [], waveform: [], energy: [] },
    storyDrafts: [{ id: "intro", label: "Intro", start: 0, end: 6, prompt: "Diego moves through CLUB_MAIN." }],
  }), videoSources: [], editSettings: { cutDensity: 1 } });
  const input = buildH3ShotPlanningInput({ projectId: "project-a", project,
    segments: buildEditPlanPreviewSegments({ project, videoSources: [] }), subjectNames: ["Diego"] });
  const result: H3ShotPlanningResult = { version: 1, bindingSha256: input.bindingSha256,
    directions: input.groups.flatMap(group => group.windows.map(window => ({ windowKey: window.key,
      direction: "Diego continues forward.", entryState: "Diego is moving forward.", exitState: "Diego is moving forward.", actionIndices: [] }))) };
  const rows = new Map<string, { value: unknown; revision: string }>();
  let writes = 0;
  const objects: StudioJsonObjectStore = {
    async read<T>(key: string) { return (structuredClone(rows.get(key)) ?? null) as { value: T; revision: string } | null; },
    async write<T>(key: string, value: T, revision: string | null) {
      writes++;
      if (revision !== null || rows.has(key)) throw new StudioProjectConflictError();
      rows.set(key, { value: structuredClone(value), revision: '"first"' });
      return '"first"';
    },
  };
  return { input, result, rows, objects, writes: () => writes };
}

describe("owned durable shot planning", () => {
  test("reload restores exact directions; identical replay never rewrites them", async () => {
    const f = fixture();
    expect(await storeH3ShotPlan("user-a", "project-a", f.input, f.result, f.objects)).toEqual(f.result);
    expect(await readH3ShotPlan("user-a", "project-a", f.input, f.objects)).toEqual(f.result);
    expect(await storeH3ShotPlan("user-a", "project-a", f.input, f.result, f.objects)).toEqual(f.result);
    expect(f.writes()).toBe(1);
    expect(await readH3ShotPlan("user-b", "project-a", f.input, f.objects)).toBeNull();
    await expect(readH3ShotPlan("user-a", "other-project", f.input, f.objects)).rejects.toThrow("owned shot planning context");
  });

  test("a different valid direction set cannot replace the saved plan", async () => {
    const f = fixture();
    await storeH3ShotPlan("user-a", "project-a", f.input, f.result, f.objects);
    const changed = structuredClone(f.result);
    changed.directions[0].direction = "Diego advances in a medium tracking shot.";
    await expect(storeH3ShotPlan("user-a", "project-a", f.input, changed, f.objects)).rejects.toThrow("different shot plan");
    expect(f.writes()).toBe(1);
    expect(await readH3ShotPlan("user-a", "project-a", f.input, f.objects)).toEqual(f.result);
  });

  test("lost write acknowledgement reconciles once without another write", async () => {
    const f = fixture();
    const uncertain: StudioJsonObjectStore = { ...f.objects, async write(key, value, revision) {
      await f.objects.write(key, value, revision);
      throw new Error("response lost");
    } };
    expect(await storeH3ShotPlan("user-a", "project-a", f.input, f.result, uncertain)).toEqual(f.result);
    expect(f.writes()).toBe(1);
  });

  test("concurrent identical writes converge on one immutable result", async () => {
    const f = fixture();
    const results = await Promise.all([
      storeH3ShotPlan("user-a", "project-a", f.input, f.result, f.objects),
      storeH3ShotPlan("user-a", "project-a", f.input, f.result, f.objects),
    ]);
    expect(results).toEqual([f.result, f.result]);
    expect(f.rows.size).toBe(1);
  });

  test("rejects invalid output before writing and detects corrupted saved context", async () => {
    const f = fixture();
    await expect(storeH3ShotPlan("user-a", "project-a", f.input, { ...f.result, directions: [] }, f.objects)).rejects.toThrow();
    expect(f.writes()).toBe(0);
    const stale = structuredClone(f.input);
    stale.groups[0].approvedDirection = "Changed story";
    await expect(readH3ShotPlan("user-a", "project-a", stale, f.objects)).rejects.toThrow("owned shot planning context");
    await storeH3ShotPlan("user-a", "project-a", f.input, f.result, f.objects);
    const record = [...f.rows.values()][0].value as { resultSha256: string };
    record.resultSha256 = "changed";
    await expect(readH3ShotPlan("user-a", "project-a", f.input, f.objects)).rejects.toThrow("Stored shot planning context changed");
  });
});
