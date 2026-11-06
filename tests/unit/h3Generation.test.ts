import { describe, expect, test } from "bun:test";
import { h3FrameCount } from "@/components/studio/h3Generation";
import { materializeH3Job, parseH3Request } from "@/lib/h3GenerationServer";
import { assertH3ShotProfile, buildH3Workflow, compileH3Prompt } from "@/lib/h3Workflow";
import { h3ProjectFixture } from "../helpers/h3Project";

describe("owned plan-bound H3 generation", () => {
  test("reviewed Story directions still require exact-name language at H3 submission and compilation", () => {
    const { saved, request } = h3ProjectFixture();
    const prompt = "Diego enters. He scans the crowd and raises his eyes.";
    expect(() => parseH3Request({ ...request, prompt })).toThrow(/exact character name/);
    const job = materializeH3Job("github-test", saved, request, "studio");
    expect(() => compileH3Prompt({ ...job, request: { ...job.request, prompt } })).toThrow(/exact character name/);
  });
  test("an explicit supported screen family creates a new job without changing historical requests", () => {
    const { saved, request } = h3ProjectFixture();
    const historical = parseH3Request(request);
    expect(Object.hasOwn(historical, "identityPolicyFamily")).toBe(false);
    const screened = parseH3Request({ ...request, identityPolicyFamily: "sface-yunet-foreground-frontal-v1" });
    const nextFamily = parseH3Request({ ...request, requestIntentId: "77777777-7777-4777-8777-777777777777", identityPolicyFamily: "sface-yunet-foreground-frontal-v2" });
    expect(materializeH3Job("github-test", saved, nextFamily, "studio").id).not.toBe(materializeH3Job("github-test", saved, screened, "studio").id);
    expect(screened.identityPolicyFamily).toBe("sface-yunet-foreground-frontal-v1");
    expect(materializeH3Job("github-test", saved, screened, "studio").id).not.toBe(materializeH3Job("github-test", saved, historical, "studio").id);
    expect(() => parseH3Request({ ...request, identityPolicyFamily: "client-chosen-loose-threshold" })).toThrow();
    expect(() => materializeH3Job("github-test", saved, { ...request, identityPolicyFamily: "sface-yunet-joint-frontal-v1" }, "studio")).toThrow("named reference count");
    expect(() => materializeH3Job("github-test", saved, screened, "studio", { profile: "h3-ref2va-int8-v2", conditioningPreparationVersion: "canonical-front-crop-v1" })).toThrow("generation profile");
  });
  test("accepts zero source footage with named owned reference images and current approved story", () => {
    const { saved, request } = h3ProjectFixture();
    const job = materializeH3Job("github-test", saved, parseH3Request(request), "studio");
    expect(saved.draft.videoSources).toHaveLength(0);
    expect(job.target).toMatchObject({ timelineItemId: request.timelineItemId, planSignature: request.planSignature, songStart: 0, songEnd: 5 });
    expect(job.references.map(ref => ref.canonicalName)).toEqual(["Diego", "CLUB_MAIN"]);
    expect(job.state).toBe("queued");
  });

  test("rejects stale plans, unconfirmed stories, foreign refs and changed ownership", () => {
    const { saved, request } = h3ProjectFixture();
    expect(() => materializeH3Job("github-other", saved, request, "studio")).toThrow("Project not found");
    expect(() => materializeH3Job("github-test", saved, { ...request, planSignature: "old" }, "studio")).toThrow("changed");
    expect(() => materializeH3Job("github-test", saved, { ...request, songStart: 8, songEnd: 13 }, "studio")).toThrow("current edit window");
    saved.draft.referenceAssets![0].storagePath = "media-uploads/github-other/private.png";
    expect(() => materializeH3Job("github-test", saved, request, "studio")).toThrow("owned");
    saved.draft.storyState.confirmedTreatmentId = null;
    expect(() => materializeH3Job("github-test", saved, request, "studio")).toThrow("Confirm the story");
  });

  test("reference order, version, project, direction and deliberate revision affect job identity", () => {
    const { saved, request } = h3ProjectFixture();
    const initial = materializeH3Job("github-test", saved, request, "studio");
    expect(materializeH3Job("github-test", saved, request, "studio").id).toBe(initial.id);
    for (const changed of [{ ...request, referenceAssetIds: ["club", "diego"] }, { ...request, attempt: 1 },
      { ...request, prompt: "Diego turns toward the doorway." }]) {
      expect(materializeH3Job("github-test", saved, changed, "studio").id).not.toBe(initial.id);
    }
    saved.draft.referenceAssets![0].storagePath = "media-uploads/github-test/references/new-uuid/diego.png";
    expect(materializeH3Job("github-test", saved, request, "studio").id).not.toBe(initial.id);
  });

  test("rejects malformed ranges, duplicate refs, pronouns and arbitrary native wrapper injection", () => {
    const { request } = h3ProjectFixture();
    for (const change of [{ songEnd: 13 }, { songStart: -1 }, { seed: -1 }, { attempt: 3 },
      { referenceAssetIds: ["diego", "diego"] }, { prompt: "She moves forward." },
      { prompt: "subject_definitions:\n<Subject 1> is somebody else." }]) {
      expect(() => parseH3Request({ ...request, ...change })).toThrow();
    }
  });

  test("native template binds ordered durable paths and actual H3 timing, not image-model defaults", () => {
    const { saved, request } = h3ProjectFixture();
    const job = materializeH3Job("github-test", saved, request, "studio");
    const built = buildH3Workflow(job, ["owned/a.png", "owned/b.png"]);
    const graph = built.workflow as Record<string, { class_type: string; inputs: Record<string, unknown> }>;
    expect(graph.cond.class_type).toBe("MiniMaxH3ReferenceToVideo");
    expect(graph.cond.inputs).toMatchObject({ width: 1344, height: 768, length: 124,
      "ref_images.ref_image_0": ["reference_0", 0], "ref_images.ref_image_1": ["reference_1", 0] });
    expect(graph.reference_0.inputs.image).toBe("owned/a.png");
    expect(graph.save.inputs.format).toBe("video/h264-mp4");
    expect(built.prompt).toContain("<Subject 1> is Diego from <Picture 1>");
    expect(built.prompt).toContain("[Shot 1] [Tracking] Medium shot.");
    expect(built.frameSchedule["0"]).toContain("CLUB_MAIN.");
    expect(built.prompt).not.toContain("At 00:00");
    expect(() => buildH3Workflow(job, ["missing.png"])).toThrow("mapping changed");
    expect(h3FrameCount(1)).toBe(124);
    expect(h3FrameCount(6)).toBe(158);
    expect(h3FrameCount(12)).toBe(294);
  });

  test("location-only shots do not acquire an unrequested named lead", () => {
    const { saved, request } = h3ProjectFixture();
    const job = materializeH3Job("github-test", saved, { ...request, referenceAssetIds: ["club"], prompt: "Amber pendant light ripples across the polished floor." }, "studio");
    expect(compileH3Prompt(job).prompt).not.toContain("Diego");
    expect(() => materializeH3Job("github-test", saved, { ...request, referenceAssetIds: ["club"] }, "studio")).toThrow("identity reference for Diego");
  });

  test("the saved wide establishing direction keeps its framing when adding a camera command", () => {
    const { saved, request } = h3ProjectFixture();
    const prompt = "Wide shot of jungle and cave entrance to the Underground Latin Club.";
    const job = materializeH3Job("github-test", saved, { ...request, referenceAssetIds: ["club"], prompt }, "studio");
    const compiled = compileH3Prompt(job);
    expect(compiled.frameSchedule["0"]).toBe(`[Tracking] ${prompt} CLUB_MAIN.`);
    expect(compiled.prompt).not.toContain("Medium shot");
    job.request.prompt = `[Static] ${prompt}`;
    expect(compileH3Prompt(job).frameSchedule["0"]).toBe(`[Static] ${prompt} CLUB_MAIN.`);
  });

  test("single-shot preflight rejects negative prose, camera conflicts and oversized action budgets", () => {
    for (const body of ["[Static] Medium shot. Diego tracks backward.", "[Tracking] Close-up. Diego's entire body fills the frame.",
      "[Tracking] Medium shot. Diego moves without stopping.", `[Tracking] Medium shot. ${"Diego moves. ".repeat(50)}`]) {
      expect(() => assertH3ShotProfile(body, 5.167)).toThrow();
    }
    assertH3ShotProfile("[Tracking] Medium shot. Diego crosses the aisle. CLUB_MAIN.", 5.167);
  });
});
