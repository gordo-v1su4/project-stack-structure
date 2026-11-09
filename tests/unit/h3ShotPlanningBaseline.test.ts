import { afterEach, describe, expect, mock, test } from "bun:test";
import { h3ProjectFixture } from "../helpers/h3Project";
import { buildStoryContentSignature } from "@/components/studio/storyTreatments";
import { buildStudioSourceContextSignature } from "@/components/studio/studioSourceContext";
import { effectiveGenerationScope, type GenerationScopeReceipt } from "@/components/studio/generationScope";
import { placementInputSignature } from "@/components/studio/musicVideoProject";

const baselines = new Map<string, GenerationScopeReceipt>();
let writes = 0, pinCalls = 0, referencesIntact = true, mediaIntact = true, pinFailure = false, changeAfterStore = false;
const key = (owner: string, project: string, scope: string, semantic: string) => JSON.stringify([owner, project, scope, semantic]);
mock.module("@/lib/generationScopeStore", () => ({
  sourceConfirmationStorage: () => { throw new Error("Unexpected real storage access"); },
  readGenerationScopeBaseline: async (owner: string, project: string, scope: string, semantic: string) => baselines.get(key(owner, project, scope, semantic)) ?? null,
  storeGenerationScopeBaseline: async (receipt: GenerationScopeReceipt) => {
    const body = receipt.body; writes++;
    baselines.set(key(body.ownerId, body.projectId, body.scopeSignature, body.semanticSha256), structuredClone(receipt));
    if (changeAfterStore) mediaIntact = false;
  },
  readGenerationScopeReceipt: async () => null, storeGenerationScopeReceipt: async () => { throw new Error("Unexpected receipt write"); },
}));
mock.module("@/lib/generationScopeRawReferences", () => ({
  pinGenerationScopeRawReferences: async (_owner: string, refs: GenerationScopeReceipt["body"]["references"]) => {
    pinCalls++; if (pinFailure) throw new Error("Reference pin failed");
    return refs.map(ref => ({ assetId: ref.id, bucket: ref.storageBucket!, objectKey: ref.storagePath!, etag: '"v1"', sha256: "a".repeat(64), byteLength: 12 }));
  },
  verifyGenerationScopeRawReferences: async () => { if (!referencesIntact) throw new Error("Reference pixels changed"); },
}));
mock.module("@/lib/generationScopeMedia", () => ({
  bootstrapR31SourceMedia: async () => [], pinGenerationScopeMedia: async () => [],
  verifyGenerationScopeMedia: async () => { if (!mediaIntact) throw new Error("Media changed"); },
}));
const { sourceSha, storySha, validateSavedGenerationScope } = await import("@/lib/generationScopeServer");
const { loadH3ShotPlanningContext } = await import("@/lib/h3ShotPlanningServer");

function fixture() {
  const { saved } = h3ProjectFixture();
  const versioned = { ...saved, revision: '"saved-revision"' };
  const story = saved.draft.storyState, project = saved.draft.musicVideoProject!;
  story.confirmedTreatmentSnapshot!.anchors = [];
  story.storyContentSignature = buildStoryContentSignature(story.confirmedTreatmentSnapshot!, story.storyBeats);
  story.confirmedSourceContextSignature = buildStudioSourceContextSignature({ analysis: null, videoSources: [], referenceAssets: saved.draft.referenceAssets });
  project.sourceContextSignature = story.confirmedSourceContextSignature;
  project.generationScopeVersion = 2;
  project.generationSourceContextSha256 = sourceSha(saved.draft);
  project.generationStorySha256 = storySha(saved.draft);
  project.placementPlan!.inputSignature = placementInputSignature(project);
  const expected = { planSignature: effectiveGenerationScope(project)! };
  const dependencies = { read: async () => structuredClone(versioned), validate: validateSavedGenerationScope };
  const load = (override: typeof expected & { bindingSha256?: string } = expected) => loadH3ShotPlanningContext(saved.project.ownerId, saved.project.id, override, dependencies);
  return { saved: versioned, expected, load };
}
afterEach(() => { baselines.clear(); writes = 0; pinCalls = 0; referencesIntact = true; mediaIntact = true; pinFailure = false; changeAfterStore = false; });

describe("first confirmed-story shot planning baseline", () => {
  test("actual strict scope validation rejects missing baseline before planning, then planning establishes and strictly verifies it", async () => {
    const f = fixture();
    await expect(validateSavedGenerationScope(f.saved.project.ownerId, f.saved)).rejects.toThrow("baseline is unavailable");
    const before = JSON.stringify(f.saved);
    const result = await f.load();
    expect(result.input.planSignature).toBe(f.expected.planSignature);
    expect(result.input.groups.length > 0).toBe(true);
    expect(writes).toBe(1); expect(pinCalls).toBe(1);
    expect(await validateSavedGenerationScope(f.saved.project.ownerId, f.saved)).toBe(f.expected.planSignature);
    expect(JSON.stringify(f.saved)).toBe(before);
    expect((await f.load()).input.bindingSha256).toBe(result.input.bindingSha256);
    expect(writes).toBe(1); expect(pinCalls).toBe(1);
  });
  test("changed strong source or story hashes cannot be pinned as a fresh baseline", async () => {
    for (const field of ["generationSourceContextSha256", "generationStorySha256"] as const) {
      const f = fixture(); f.saved.draft.musicVideoProject![field] = "0".repeat(64);
      await expect(f.load()).rejects.toThrow("strong source inventory or story changed");
      expect(writes).toBe(0); expect(pinCalls).toBe(0);
    }
  });
  test("stale plan or client binding causes no baseline writes", async () => {
    const f = fixture();
    await expect(f.load({ planSignature: "stale" })).rejects.toThrow("cut plan changed");
    await expect(f.load({ ...f.expected, bindingSha256: "0".repeat(64) })).rejects.toThrow("planning context changed");
    expect(writes).toBe(0); expect(pinCalls).toBe(0);
  });
  test("existing canonical baseline still rejects changed media and references", async () => {
    const f = fixture(); await f.load(); referencesIntact = false;
    await expect(f.load()).rejects.toThrow("media versions differ");
    referencesIntact = true; mediaIntact = false;
    await expect(f.load()).rejects.toThrow("media versions differ");
    expect(writes).toBe(1); expect(pinCalls).toBe(1);
  });
  test("strict revalidation after first baseline creation rejects a media race before returning input", async () => {
    const f = fixture(); changeAfterStore = true;
    await expect(f.load()).rejects.toThrow("media versions differ");
    expect(writes).toBe(1);
  });
  test("pin failure or missing saved revision never produces planning input", async () => {
    const f = fixture(); pinFailure = true;
    await expect(f.load()).rejects.toThrow("Reference pin failed");
    expect(writes).toBe(0);
    pinFailure = false; delete (f.saved as { revision?: string }).revision;
    await expect(f.load()).rejects.toThrow("baseline is unavailable");
    expect(writes).toBe(0);
  });
});
