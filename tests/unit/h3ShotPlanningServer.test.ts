import { describe, expect, test } from "bun:test";
import { effectiveGenerationScope } from "@/components/studio/generationScope";
import { executeH3ShotPlanning, loadH3ShotPlanningContext } from "@/lib/h3ShotPlanningServer";
import type { SavedStudioProject } from "@/lib/studioProjectStore";
import { h3ProjectFixture } from "../helpers/h3Project";
import { buildStoryBibleBinding } from "@/components/studio/storyBibleBinding";
import { STORY_BIBLE_ADAPTER } from "@/components/studio/storyBible";
import { buildStoryContentSignature, hydrateTreatmentCoverage, parseGeneratedTreatment } from "@/components/studio/storyTreatments";
import { buildH3DraftPlanningInput } from "@/components/studio/h3PlannedDraftRequests";
import { sourceSha, storySha } from "@/lib/generationScopeServer";
import { buildStudioSourceContextSignature } from "@/components/studio/studioSourceContext";
import { placementInputSignature } from "@/components/studio/musicVideoProject";

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

function withCanon() {
  const f = fixture(), refs = f.saved.draft.referenceAssets!;
  const treatment = hydrateTreatmentCoverage([parseGeneratedTreatment({ id: "story-1", kind: "faithful", title: "Club journey", logline: "Diego crosses the club floor.",
    synopsis: "Diego arrives. Diego crosses the floor. Diego leaves.", visualThesis: "Concrete and warm light.", endingHook: "Diego leaves.", structure: "visual-arc",
    anchors: ["verse", "ending"].map(id => ({ id, title: id, description: "Diego crosses CLUB_MAIN.", purpose: "Move toward the exit.", generationPrompt: "Diego crosses CLUB_MAIN.",
      requirements: [{ id: `${id}-shot`, momentId: id, description: "Diego crosses CLUB_MAIN.", constraints: { subjects: ["Diego"] } }] })) })], [])[0];
  treatment.storyBible = { version: 1, adapter: STORY_BIBLE_ADAPTER, binding: buildStoryBibleBinding({ projectId: f.saved.project.id, treatment, referenceAssets: refs }),
    characters: [{ id: "diego", canonicalName: "Diego", referenceAssetIds: ["diego"] }], relationships: [], facts: [
      { id: "movement", kind: "movement", value: "Grounded steps carry Diego forward.", state: "confirmed", visibility: "public", channel: "positive", characterIds: ["diego"], referenceAssetIds: ["diego"], provenance: { kind: "user", sourceIds: ["brief"] } },
      { id: "private", kind: "backstory", value: "PRIVATE_HISTORY", state: "confirmed", visibility: "private", channel: "positive", characterIds: ["diego"], referenceAssetIds: ["diego"], provenance: { kind: "user", sourceIds: ["brief"] } },
    ] };
  f.saved.draft.storyState.confirmedTreatmentSnapshot = treatment;
  f.saved.draft.storyState.storyContentSignature = buildStoryContentSignature(treatment, f.saved.draft.storyState.storyBeats);
  return { ...f, treatment };
}

describe("canonical server shot planning context", () => {
  test("server uses the identical client builder for canon-bound confirmed treatment and refs", async () => {
    const f = withCanon();
    const server = await loadH3ShotPlanningContext(f.saved.project.ownerId, f.saved.project.id, f.expected, f.dependencies);
    const client = buildH3DraftPlanningInput(f.saved.project.id, f.saved.draft.musicVideoProject!, f.saved.draft.referenceAssets!, { confirmedTreatment: f.treatment });
    expect(server.input).toEqual(client);
    expect(server.input.groups.some(group => group.storyCanon?.positiveFacts.some(fact => fact.id === "movement"))).toBe(true);
    expect(JSON.stringify(server.input)).not.toContain("PRIVATE_HISTORY");
  });

  test("stale canon fails before a fresh scope baseline can be issued", async () => {
    const f = withCanon();
    const project = f.saved.draft.musicVideoProject!, story = f.saved.draft.storyState;
    const bindScope = () => {
      story.storyContentSignature = buildStoryContentSignature(f.treatment, story.storyBeats);
      story.confirmedSourceContextSignature = buildStudioSourceContextSignature({ analysis: null, videoSources: [], referenceAssets: f.saved.draft.referenceAssets });
      project.sourceContextSignature = story.confirmedSourceContextSignature;
      project.generationScopeVersion = 2;
      project.generationSourceContextSha256 = sourceSha(f.saved.draft);
      project.generationStorySha256 = storySha(f.saved.draft);
      project.placementPlan!.inputSignature = placementInputSignature(project);
      f.expected.planSignature = effectiveGenerationScope(project)!;
    };
    bindScope();
    let baseline = 0;
    const dependencies = { ...f.dependencies, validate: async () => f.expected.planSignature, baseline: async () => { baseline++; } };
    await loadH3ShotPlanningContext(f.saved.project.ownerId, f.saved.project.id, f.expected, dependencies);
    expect(baseline).toBe(1);
    baseline = 0;
    f.treatment.storyBible!.binding.referenceSignature = "historical-import-format";
    bindScope();
    await expect(loadH3ShotPlanningContext(f.saved.project.ownerId, f.saved.project.id, f.expected, {
      ...dependencies,
    })).rejects.toThrow("bounded shot planning context");
    expect(baseline).toBe(0);
  });

  test("changed canonical facts cannot retain an older client planning binding", async () => {
    const f = withCanon();
    const first = await loadH3ShotPlanningContext(f.saved.project.ownerId, f.saved.project.id, f.expected, f.dependencies);
    f.treatment.storyBible!.facts[0].value = "Diego turns toward the rail.";
    f.saved.draft.storyState.storyContentSignature = buildStoryContentSignature(f.treatment, f.saved.draft.storyState.storyBeats);
    await expect(loadH3ShotPlanningContext(f.saved.project.ownerId, f.saved.project.id,
      { ...f.expected, bindingSha256: first.input.bindingSha256 }, f.dependencies)).rejects.toThrow("planning context changed");
  });

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
