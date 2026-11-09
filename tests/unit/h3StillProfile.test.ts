import { describe, expect, test } from "bun:test";
import evidence from "../fixtures/h3-still-accepted-graph.json";
import managedReferenceSchema from "../fixtures/h3-still-managed-reference-schema.json";
import { buildH3StillWorkflow, freezeH3Still, H3_STILL_PROFILE, H3_STILL_PROFILE_SHA256, h3StillDigest, h3StillNativePreparation, type H3StillInput } from "../../src/lib/h3StillProfile";

function input(): H3StillInput {
  return { ownerId: "github-123", projectId: "project-1", planSignature: "plan-1",
    target: { timelineItemId: "shot-1", sectionId: "intro", songStart: 0, songEnd: 4 }, seed: 4102,
    prompt: "Diego is <Picture 1>. Tunnel is <Picture 2>. Diego stands inside Tunnel.",
    references: [
      { assetId: "diego", canonicalName: "Diego", role: "identity", bucket: "studio", objectKey: "refs/diego.png", version: "v1", etag: "etag1", rawSha256: "a".repeat(64) },
      { assetId: "tunnel", canonicalName: "Tunnel", role: "environment", bucket: "studio", objectKey: "refs/tunnel.png", version: "v2", etag: "etag2", rawSha256: "b".repeat(64) },
    ] };
}
const hydrated = (v = input()) => v.references.map(r => ({ rawSha256: r.rawSha256, image: `stack-stills/${r.rawSha256}.png` }));

describe("server-owned H3 still profile", () => {
  test("emits all nine references within the captured managed autogrow capacity and rejects ten", () => {
    const [kind, options] = managedReferenceSchema.spec;
    expect(kind).toBe("COMFY_AUTOGROW_V3");
    const template = (options as { template: { prefix: string; min: number; max: number; input: { required: { ref_image: unknown[] } } } }).template;
    expect(managedReferenceSchema.sourceSha256).toBe("2b974ad9dfe2ff393a401e2afae2b028562114b18eba7fd3f2df4427016397f6");
    expect(template.prefix).toBe("ref_image_"); expect(template.min).toBe(0); expect(template.max).toBe(9);
    expect(template.input.required.ref_image[0]).toBe("IMAGE");
    const value = input();
    value.references = Array.from({ length: template.max }, (_, i) => ({ ...value.references[0], assetId: `ref-${i}`,
      canonicalName: `Reference${i}`, rawSha256: i.toString(16).repeat(64), objectKey: `refs/${i}.png` }));
    value.prompt = value.references.map((r, i) => `${r.canonicalName} is <Picture ${i + 1}>.`).join(" ");
    const { workflow } = buildH3StillWorkflow(freezeH3Still(value), hydrated(value));
    const links = Object.entries(workflow.cond.inputs).filter(([key]) => key.startsWith("ref_images."));
    expect(links.length).toBe(template.max);
    value.references.forEach((r, i) => {
      expect(workflow.cond.inputs[`ref_images.${template.prefix}${i}`]).toEqual([`reference_${i}`, 0]);
      expect(workflow[`reference_${i}`].inputs.image).toBe(`stack-stills/${r.rawSha256}.png`);
    });
    value.references.push({ ...value.references[0], assetId: "ref-9", canonicalName: "Reference9" });
    value.prompt += " Reference9 is <Picture 10>.";
    expect(() => freezeH3Still(value)).toThrow();
  });

  test("reconstructs the accepted output ancestry using only evidenced node inputs and values", () => {
    const { workflow } = buildH3StillWorkflow(freezeH3Still(input()), hydrated());
    const mapping: Record<string, number> = { model: 337, shift: 367, clip: 336, vae: 335, cond: 365, latent: 366,
      guider: 368, noise: 369, sampler: 370, sigmas: 371, sample: 372, separate: 390, upscale: 391, concat: 392,
      refineSampler: 394, refineSigmas: 393, refine: 395, decode: 396, master: 400, save: 401, reference_0: 388, reference_1: 386 };
    expect(evidence.sha256).toBe(H3_STILL_PROFILE.evidenceSha256);
    for (const [key, node] of Object.entries(workflow)) {
      const original = evidence.nodes.find(n => n.id === mapping[key]);
      expect(Boolean(original)).toBe(true); expect(node.class_type).toBe(original!.type); expect(original!.mode).toBe(0);
      for (const [name, value] of Object.entries(node.inputs)) {
        expect(original!.inputs.some(i => i.name === name)).toBe(true);
        if (Array.isArray(value)) {
          const slot = original!.inputs.findIndex(i => i.name === name);
          // Reference order is deliberately caller-bound; evidence has environment first.
          if (key === "cond" && name.startsWith("ref_images.")) continue;
          expect(evidence.links.some(link => link[1] === mapping[String(value[0])] && link[2] === value[1] && link[3] === original!.id && link[4] === slot)).toBe(true);
        } else if (!["prompt", "noise_seed", "image", "filename_prefix"].includes(name)) {
          expect(value).toEqual((original!.widgets as Record<string, unknown>)[name]);
        }
      }
    }
    expect(workflow.cond.inputs["ref_images.ref_image_0"]).toEqual(["reference_0", 0]);
    expect(workflow.cond.inputs.audio_vae).toBe(undefined);
    expect(workflow.sample.inputs.latent_image).toEqual(["latent", 0]);
    expect(workflow.concat.inputs.audio_latent).toEqual(["separate", 1]);
    expect(Object.values(workflow).some(n => /LoRA|GGUF|RefMod|VideoCombine/.test(n.class_type))).toBe(false);
  });

  test("freezes target, prompt, reference order/content/version, seed and profile into deterministic hashes", () => {
    const v = input(), frozen = freezeH3Still(v);
    expect(frozen.body.profileSha256).toBe(H3_STILL_PROFILE_SHA256);
    expect(freezeH3Still(structuredClone(v))).toEqual(frozen);
    const mutations: ((v: H3StillInput) => void)[] = [x => { x.ownerId += "x"; }, x => { x.projectId += "x"; }, x => { x.planSignature += "x"; },
      x => { x.target.songEnd += 1; }, x => { x.prompt += " A new view."; }, x => { x.seed++; },
      x => { x.references[0].rawSha256 = "c".repeat(64); }, x => { x.references[0].version += "x"; }, x => { x.references[0].etag += "x"; },
      x => { x.references.reverse(); }];
    for (const mutate of mutations) { const copy = structuredClone(v); mutate(copy); expect(freezeH3Still(copy).sha256).not.toBe(frozen.sha256); }
    v.references[0].canonicalName = "Changed";
    expect(frozen.body.references[0].canonicalName).toBe("Diego");
  });

  test("rejects modified frozen descriptors and hydration mismatches rather than falling back", () => {
    const frozen = freezeH3Still(input());
    for (const mutate of [
      (x: typeof frozen) => { x.body.profileSha256 = "c".repeat(64); },
      (x: typeof frozen) => { x.body.prompt += " altered"; },
      (x: typeof frozen) => { x.sha256 = "c".repeat(64); },
    ]) { const copy = structuredClone(frozen); mutate(copy); expect(() => buildH3StillWorkflow(copy, hydrated())).toThrow(); }
    const wrong = hydrated(); wrong[0].image = "../../outside.png";
    expect(() => buildH3StillWorkflow(frozen, wrong)).toThrow();
    expect(() => buildH3StillWorkflow(frozen, hydrated().reverse())).toThrow();
    expect(() => buildH3StillWorkflow(frozen, [])).toThrow();
  });

  test("bounds text, names, hashes, references, target and seed", () => {
    const bad: ((v: H3StillInput) => void)[] = [x => { x.prompt = "💥".repeat(5000); }, x => { x.prompt += "\0"; },
      x => { x.references[0].canonicalName = "Valentina"; }, x => { x.prompt = x.prompt.replace("<Picture 2>", "missing"); },
      x => { x.references[0].rawSha256 = "invalid"; }, x => { x.references[0].objectKey = "refs/../bad"; },
      x => { x.references[0].role = "bad" as "identity"; }, x => { x.references.push(x.references[0]); },
      x => { x.references = []; }, x => { x.references = Array(10).fill(x.references[0]); },
      x => { x.target.songEnd = 0; }, x => { x.target.songEnd = 13; }, x => { x.target.songStart = NaN; },
      x => { x.seed = -1; }, x => { x.seed = Infinity; }, x => { x.ownerId = "../owner"; }];
    for (const mutate of bad) { const copy = input(); mutate(copy); expect(() => freezeH3Still(copy)).toThrow(); }
  });

  test("keeps the master separate from aspect-preserving native input and binds actual master bytes", () => {
    const prep = h3StillNativePreparation("a".repeat(64));
    expect(prep.body.source).toEqual({ width: 2048, height: 1152 });
    expect(prep.body.output).toEqual({ width: 1344, height: 768 });
    expect(prep.body.resized.width / prep.body.resized.height).toBe(16 / 9);
    expect(prep.body.resized.height + prep.body.padding.top + prep.body.padding.bottom).toBe(768);
    expect(prep.body.identityAssessment).toBe("required-on-final-pixels");
    expect(prep.sha256).toBe(h3StillDigest(prep.body));
    expect(h3StillNativePreparation("b".repeat(64)).sha256).not.toBe(prep.sha256);
    expect(() => h3StillNativePreparation("bad")).toThrow();
  });
});
