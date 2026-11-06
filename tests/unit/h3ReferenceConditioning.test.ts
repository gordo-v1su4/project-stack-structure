import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { H3_CONDITIONING_PREPARATION_VERSION, H3_LEGACY_PROFILE, H3_PROFILE } from "@/components/studio/h3Generation";
import { h3GenerationJobId, materializeH3Job } from "@/lib/h3GenerationServer";
import { DIEGO_CANONICAL_REFERENCE_SHA256, planH3ReferenceConditioning } from "@/lib/h3ReferenceConditioning";
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
});
