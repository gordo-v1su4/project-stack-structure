import { describe, expect, test } from "bun:test";
import { effectiveGenerationScope } from "@/components/studio/generationScope";
import { executeH3ShotPlanning, loadH3ShotPlanningContext } from "@/lib/h3ShotPlanningServer";
import type { SavedStudioProject } from "@/lib/studioProjectStore";
import { h3ProjectFixture } from "../helpers/h3Project";

function fixture() {
  const { saved } = h3ProjectFixture();
  const calls: string[] = [];
  const expected = { planSignature: effectiveGenerationScope(saved.draft.musicVideoProject!)! };
  const dependencies = {
    read: async (ownerId: string, projectId: string, options?: { fresh?: boolean }) => {
      calls.push(`read:${ownerId}:${projectId}:${options?.fresh}`);
      return structuredClone(saved);
    },
    validate: async (_ownerId: string, value: SavedStudioProject) => {
      calls.push("canonical-validation");
      return effectiveGenerationScope(value.draft.musicVideoProject!);
    },
  };
  return { saved, expected, dependencies, calls };
}

describe("canonical server shot planning context", () => {
  test("fresh owned source checks precede complete planning; no project mutation or dispatch", async () => {
    const f = fixture();
    const before = structuredClone(f.saved);
    const result = await loadH3ShotPlanningContext(f.saved.project.ownerId, f.saved.project.id, f.expected, f.dependencies);
    expect(f.calls).toEqual([`read:${f.saved.project.ownerId}:${f.saved.project.id}:true`, "canonical-validation"]);
    expect(result.input.projectId).toBe(f.saved.project.id);
    expect(result.input.planSignature).toBe(f.expected.planSignature);
    expect(result.input.groups.flatMap(group => group.windows)).not.toHaveLength(0);
    expect(f.saved).toEqual(before);
    expect(await loadH3ShotPlanningContext(f.saved.project.ownerId, f.saved.project.id,
      { ...f.expected, bindingSha256: result.input.bindingSha256 }, f.dependencies)).toEqual(result);
  });

  test("foreign and unconfirmed projects never reach canonical storage validation", async () => {
    const f = fixture();
    await expect(loadH3ShotPlanningContext("other-user", f.saved.project.id, f.expected, f.dependencies)).rejects.toThrow("Project not found");
    expect(f.calls).toHaveLength(1);
    f.calls.length = 0;
    f.saved.draft.storyState.storyGenerated = false;
    await expect(loadH3ShotPlanningContext(f.saved.project.ownerId, f.saved.project.id, f.expected, f.dependencies)).rejects.toThrow("Confirm the story");
    expect(f.calls).toHaveLength(1);
  });

  test("failed source verification cannot produce model input", async () => {
    const f = fixture();
    await expect(loadH3ShotPlanningContext(f.saved.project.ownerId, f.saved.project.id, f.expected, {
      ...f.dependencies, validate: async () => { throw new Error("source versions changed"); },
    })).rejects.toThrow("source versions changed");
  });

  test("stale expected scope and stale planning binding both fail closed", async () => {
    const f = fixture();
    await expect(loadH3ShotPlanningContext(f.saved.project.ownerId, f.saved.project.id,
      { planSignature: "stale" }, f.dependencies)).rejects.toThrow("cut plan changed");
    await expect(loadH3ShotPlanningContext(f.saved.project.ownerId, f.saved.project.id,
      { ...f.expected, bindingSha256: "0".repeat(64) }, f.dependencies)).rejects.toThrow("planning context changed");
  });

  test("worker reuses the bound stored plan without a model call", async () => {
    const f = fixture();
    const context = await loadH3ShotPlanningContext(f.saved.project.ownerId, f.saved.project.id, f.expected, f.dependencies);
    const result = { version: 1 as const, bindingSha256: context.input.bindingSha256, directions: [] };
    let generated = 0, written = 0;
    expect(await executeH3ShotPlanning({ ownerId: f.saved.project.ownerId, projectId: f.saved.project.id,
      ...f.expected, bindingSha256: context.input.bindingSha256 }, {
      load: async () => context, read: async () => result,
      generate: async () => { generated++; return result; },
      store: async () => { written++; return result; },
    })).toEqual(result);
    expect(generated).toBe(0);
    expect(written).toBe(0);
  });

  test("a project change during model planning prevents any result write", async () => {
    const f = fixture();
    const context = await loadH3ShotPlanningContext(f.saved.project.ownerId, f.saved.project.id, f.expected, f.dependencies);
    let reads = 0, written = 0;
    await expect(executeH3ShotPlanning({ ownerId: f.saved.project.ownerId, projectId: f.saved.project.id,
      ...f.expected, bindingSha256: context.input.bindingSha256 }, {
      load: async () => { if (++reads === 2) throw new Error("current binding changed"); return context; },
      read: async () => null,
      generate: async () => ({ version: 1, bindingSha256: context.input.bindingSha256, directions: [] }),
      store: async () => { written++; throw new Error("must not write"); },
    })).rejects.toThrow("current binding changed");
    expect(reads).toBe(2);
    expect(written).toBe(0);
  });
});
