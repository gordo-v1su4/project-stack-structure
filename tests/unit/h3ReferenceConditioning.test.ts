import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { H3_CONDITIONING_PREPARATION_VERSION, H3_LEGACY_PROFILE, H3_PROFILE,
  H3_V2_PROFILE, H3_V2_CONDITIONING_PREPARATION_VERSION } from "@/components/studio/h3Generation";
import { h3GenerationJobId, materializeH3Job } from "@/lib/h3GenerationServer";
import { DIEGO_CANONICAL_REFERENCE_SHA256, VALENTINA_CANONICAL_REFERENCE_SHA256, planH3ReferenceConditioning } from "@/lib/h3ReferenceConditioning";
import { buildH3Workflow } from "@/lib/h3Workflow";
import { h3ProjectFixture } from "../helpers/h3Project";

const input = { profile: H3_PROFILE,
  conditioningPreparationVersion: H3_CONDITIONING_PREPARATION_VERSION,
  rawSha256: DIEGO_CANONICAL_REFERENCE_SHA256, width: 1402, height: 1122,
  canonicalName: "Diego", role: "identity" as const };

describe("versioned canonical H3 conditioning", () => {
  test("only the exact canonical Diego sheet gets one unchanged-pixel front portrait crop", () => {
    const plan = planH3ReferenceConditioning(input);
    expect(plan).toEqual({ version: H3_CONDITIONING_PREPARATION_VERSION, rawSha256: DIEGO_CANONICAL_REFERENCE_SHA256,
      operation: "crop", sourceWidth: 1402, sourceHeight: 1122, crop: { x: 80, y: 10, width: 320, height: 615 },
      ffmpegFilter: "crop=320:615:80:10:exact=1" });
    plan.crop!.x = 100;
    expect(planH3ReferenceConditioning(input).crop!.x).toBe(80);
    for (const changed of [{ rawSha256: "a".repeat(64) }, { canonicalName: "DIEGO" },
      { canonicalName: "Diego front" }, { role: "environment" as const }]) {
      expect(planH3ReferenceConditioning({ ...input, ...changed }).operation).toBe("original");
    }
    expect(() => planH3ReferenceConditioning({ ...input, width: 1400 })).toThrow("dimensions changed");
    expect(() => planH3ReferenceConditioning({ ...input, rawSha256: "not-a-hash" })).toThrow("metadata");
  });

  test("legacy conditioning remains the original image and retains its exact historical job identity", () => {
    expect(planH3ReferenceConditioning({ ...input, profile: H3_LEGACY_PROFILE,
      conditioningPreparationVersion: undefined }).operation).toBe("original");
    const { saved, request } = h3ProjectFixture();
    const job = materializeH3Job("github-test", saved, request, "studio", { profile: H3_LEGACY_PROFILE });
    const expected = `h3-${createHash("sha256").update(JSON.stringify([H3_LEGACY_PROFILE, "github-test", request, job.references])).digest("hex")}`;
    expect(job.id).toBe(expected);
    expect(h3GenerationJobId("github-test", request, job.references)).toBe(expected);
    expect(Object.hasOwn(job, "conditioningPreparationVersion")).toBe(false);
    expect(buildH3Workflow(job, ["diego.png", "club.png"]).prompt).toContain("<Subject 1> is Diego from <Picture 1>");
  });

  test("new jobs bind preparation version and preserve one native subject per canonical picture", () => {
    const { saved, request } = h3ProjectFixture();
    const job = materializeH3Job("github-test", saved, request, "studio");
    expect(job.profile).toBe(H3_PROFILE);
    expect(job.conditioningPreparationVersion).toBe(H3_CONDITIONING_PREPARATION_VERSION);
    expect(job.id).toBe(h3GenerationJobId(job.ownerId, job.request, job.references, job));
    expect(job.id).not.toBe(h3GenerationJobId(job.ownerId, job.request, job.references));
    const graph = buildH3Workflow(job, ["diego-front.png", "club.png"]);
    expect(job.references.map(ref => ref.canonicalName)).toEqual(["Diego", "CLUB_MAIN"]);
    expect(graph.prompt.match(/<Subject \d+> is Diego/g)).toHaveLength(1);
    expect(graph.prompt).not.toContain("Diego front");
    expect(() => h3GenerationJobId(job.ownerId, job.request, job.references, { profile: H3_PROFILE })).toThrow("Unsupported");
    expect(() => buildH3Workflow({ ...job, conditioningPreparationVersion: undefined }, ["a", "b"])).toThrow("Unsupported");
  });

  test("v3 adds only the exact approved Valentina rectangle while v1/v2 remain uncropped", () => {
    const valentina = { ...input, rawSha256: VALENTINA_CANONICAL_REFERENCE_SHA256,
      width: 1448, height: 1086, canonicalName: "Valentina" };
    const plan = planH3ReferenceConditioning(valentina);
    expect(plan).toEqual({ version: "canonical-front-crops-v2", rawSha256: VALENTINA_CANONICAL_REFERENCE_SHA256,
      operation: "crop", sourceWidth: 1448, sourceHeight: 1086, crop: { x: 390, y: 36, width: 344, height: 512 },
      ffmpegFilter: "crop=344:512:390:36:exact=1" });
    plan.crop!.y = 8;
    expect(planH3ReferenceConditioning(valentina).crop!.y).toBe(36);
    for (const changed of [{ rawSha256: "b".repeat(64) }, { canonicalName: "VALENTINA" },
      { canonicalName: "Valentina front" }, { role: "environment" as const }]) {
      expect(planH3ReferenceConditioning({ ...valentina, ...changed }).operation).toBe("original");
    }
    expect(() => planH3ReferenceConditioning({ ...valentina, height: 1088 })).toThrow("Valentina reference dimensions changed");
    const v2 = planH3ReferenceConditioning({ ...valentina, profile: H3_V2_PROFILE,
      conditioningPreparationVersion: H3_V2_CONDITIONING_PREPARATION_VERSION });
    expect(v2.operation).toBe("original");
    expect(v2.version).toBe("canonical-front-crop-v1");
    expect(planH3ReferenceConditioning({ ...valentina, profile: H3_LEGACY_PROFILE, conditioningPreparationVersion: undefined }).operation).toBe("original");
  });

  test("v2 Diego preparation and cache bytes remain immutable; v3 is a distinct job even for the same crop", () => {
    const options = { profile: H3_V2_PROFILE, conditioningPreparationVersion: H3_V2_CONDITIONING_PREPARATION_VERSION };
    const v2Preparation = planH3ReferenceConditioning({ ...input, ...options });
    expect(v2Preparation).toEqual({ version: "canonical-front-crop-v1", rawSha256: DIEGO_CANONICAL_REFERENCE_SHA256,
      operation: "crop", sourceWidth: 1402, sourceHeight: 1122, crop: { x: 80, y: 10, width: 320, height: 615 },
      ffmpegFilter: "crop=320:615:80:10:exact=1" });
    const v3Preparation = planH3ReferenceConditioning(input);
    expect(v3Preparation.crop).toEqual(v2Preparation.crop);
    expect(v3Preparation.ffmpegFilter).toBe(v2Preparation.ffmpegFilter);
    const { saved, request } = h3ProjectFixture();
    const oldJob = materializeH3Job("github-test", saved, request, "studio", options);
    const expected = `h3-${createHash("sha256").update(JSON.stringify(["h3-ref2va-int8-v2", "github-test", request, oldJob.references, "canonical-front-crop-v1"])).digest("hex")}`;
    expect(oldJob.id).toBe(expected);
    expect(buildH3Workflow(oldJob, ["diego-front.png", "club.png"]).prompt).toContain("<Subject 1> is Diego");
    const current = materializeH3Job("github-test", saved, request, "studio");
    expect(current.profile).toBe("h3-ref2va-int8-v3");
    expect(current.conditioningPreparationVersion).toBe("canonical-front-crops-v2");
    expect(current.id).not.toBe(oldJob.id);
    expect(() => h3GenerationJobId("github-test", request, oldJob.references, { ...options, conditioningPreparationVersion: H3_CONDITIONING_PREPARATION_VERSION })).toThrow("Unsupported");
    expect(() => h3GenerationJobId("github-test", request, oldJob.references, { profile: H3_PROFILE, conditioningPreparationVersion: H3_V2_CONDITIONING_PREPARATION_VERSION })).toThrow("Unsupported");
  });

  test("v3 native wrapper declares Valentina exactly once against its actual conditioning picture", () => {
    const { saved, request } = h3ProjectFixture();
    saved.draft.referenceAssets![0] = { ...saved.draft.referenceAssets![0], id: "valentina", role: "character-2", displayName: "Valentina" };
    const job = materializeH3Job("github-test", saved, { ...request, referenceAssetIds: ["valentina", "club"],
      prompt: "[Static] Medium close-up. Valentina makes a small screen-right eye movement." }, "studio");
    const built = buildH3Workflow(job, ["valentina-front.png", "club.png"]);
    const graph = built.workflow as Record<string, { inputs: Record<string, unknown> }>;
    expect(built.prompt.match(/<Subject \d+> is Valentina/g)).toHaveLength(1);
    expect(built.prompt).toContain("Valentina from <Picture 1>");
    expect(graph.reference_0.inputs.image).toBe("valentina-front.png");
    expect(graph.cond.inputs["ref_images.ref_image_0"]).toEqual(["reference_0", 0]);
  });
});
