import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { H3_FIRST_FRAME_PREPARATION, type H3FirstFrameArtifact, type H3FirstFrameBody } from "@/components/studio/h3FirstFrame";
import { createH3StillJob, updateH3StillJob } from "@/lib/h3StillJobStore";
import { prepareH3StillImage } from "@/lib/h3StillImagePreparation";
import { persistH3StillResult, type H3StillByteStore } from "@/lib/h3StillResultStore";
import { h3StillDigest } from "@/lib/h3StillProfile";
import { StudioProjectConflictError } from "@/lib/studioProjectObjectStore";
import { h3StillJobFixture } from "../helpers/h3StillJob";

const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
let preparation: Promise<Awaited<ReturnType<typeof prepareH3StillImage>>> | undefined;
function prepared() {
  preparation ??= (async () => {
    // Synthetic solid image exercises real decoding/preparation only; no character or generation acceptance.
    const master = await sharp({ create: { width: 2048, height: 1152, channels: 3, background: { r: 140, g: 40, b: 20 } } }).png().toBuffer();
    return prepareH3StillImage(master, digest(master));
  })();
  return preparation.then(value => structuredClone(value));
}
async function fixture() {
  const f = h3StillJobFixture(), first = await createH3StillJob(f.input, f.objects);
  await updateH3StillJob(first.ownerId, first.projectId, first.id, "run-1", current => ({ ...current, state: "preparing" }), f.objects);
  await updateH3StillJob(first.ownerId, first.projectId, first.id, "run-1", current => ({ ...current, state: "submitting", workflowSha256: "f".repeat(64) }), f.objects);
  await updateH3StillJob(first.ownerId, first.projectId, first.id, "run-1", current => ({ ...current, state: "rendering", promptId: "provider-prompt" }), f.objects);
  const job = await updateH3StillJob(first.ownerId, first.projectId, first.id, "run-1", current => ({ ...current, state: "persisting" }), f.objects);
  const rows = new Map<string, Uint8Array>(); let puts = 0, reads = 0, registrations = 0;
  const bytes: H3StillByteStore = { bucket: "studio", async read(key, max) { reads++; const value = rows.get(key); if (value && value.byteLength > max) throw new Error("Too large"); return value ? new Uint8Array(value) : null; },
    async put(key, value) { puts++; if (rows.has(key)) throw new StudioProjectConflictError(); rows.set(key, new Uint8Array(value)); } };
  const register = async (template: typeof job.template, upload: { bucket: string; objectKey: string }, hash: string): Promise<H3FirstFrameArtifact> => {
    registrations++;
    const value = rows.get(upload.objectKey)!;
    if (digest(value) !== hash || upload.bucket !== bytes.bucket) throw new Error("Wrong registered pixels");
    const body: H3FirstFrameBody = { version: 1, ownerId: template.ownerId, projectId: template.projectId, planSignature: template.request.planSignature,
      target: job.descriptor.body.target, references: template.references, pngSha256: hash, byteCount: value.byteLength,
      width: 1344, height: 768, preparationVersion: H3_FIRST_FRAME_PREPARATION };
    const sha256 = h3StillDigest(body); return { version: 1, id: `h3-frame-${sha256}`, sha256, body };
  };
  return { job, rows, bytes, register, puts: () => puts, reads: () => reads, registrations: () => registrations };
}

describe("immutable generated H3 still results", () => {
  test("preserves master bytes, stores deterministic native/receipt and binds artifact to final native pixels", async () => {
    const f = await fixture(), image = await prepared(), masterBefore = new Uint8Array(image.master.bytes);
    const result = await persistH3StillResult(f.job, f.job.template, image, { bytes: f.bytes, register: f.register });
    expect(f.rows.get(result.master.objectKey)).toEqual(masterBefore); expect(image.master.bytes).toEqual(masterBefore);
    expect(result.master.sha256).toBe(digest(masterBefore)); expect(result.native.sha256).toBe(image.native.pngSha256);
    const record = JSON.parse(Buffer.from(f.rows.get(result.native.objectKey.replace("native.png", "preparation.json"))!).toString());
    expect(record.body.purpose).toBe("generated-h3-still"); expect(record.sha256).toBe(h3StillDigest(record.body));
    expect(record.body.preparation).toEqual(image.preparation); expect(result.artifactId).toBe(`h3-frame-${result.artifactSha256}`);
    expect(f.puts()).toBe(3); expect(f.registrations()).toBe(1);
    expect(await persistH3StillResult(f.job, f.job.template, image, { bytes: f.bytes, register: f.register })).toEqual(result);
    expect(f.puts()).toBe(3);
  });
  test("lost acknowledgments reconcile exact bytes without repeated PUTs", async () => {
    const f = await fixture(), image = await prepared();
    const uncertain: H3StillByteStore = { ...f.bytes, async put(key, value, type) { await f.bytes.put(key, value, type); throw new Error("Response lost"); } };
    const result = await persistH3StillResult(f.job, f.job.template, image, { bytes: uncertain, register: f.register });
    expect(f.puts()).toBe(3); expect(f.rows.size).toBe(3); expect(f.rows.get(result.master.objectKey)).toEqual(image.master.bytes);
  });
  test("existing different objects cannot be overwritten or accepted", async () => {
    const f = await fixture(), image = await prepared();
    const key = `media-uploads/projects/${f.job.ownerId}/still-results/${f.job.projectId}/${f.job.id}/master.png`;
    f.rows.set(key, new Uint8Array([1, 2, 3]));
    await expect(persistH3StillResult(f.job, f.job.template, image, { bytes: f.bytes, register: f.register })).rejects.toThrow("different immutable");
    expect(f.rows.get(key)).toEqual(new Uint8Array([1, 2, 3])); expect(f.puts()).toBe(0); expect(f.registrations()).toBe(0);
  });
  test("foreign template, altered refs/shot, wrong bucket and changed bytes fail before any writes", async () => {
    const mutations: Array<(f: Awaited<ReturnType<typeof fixture>>) => void> = [
      f => { f.job.template.ownerId = "other"; }, f => { f.job.template.references[0].etag = "replaced"; },
      f => { f.job.template.request.prompt = "Diego waits inside CLUB_MAIN."; }, f => { f.bytes.bucket = "other"; },
    ];
    for (const change of mutations) {
      const f = await fixture(); change(f);
      await expect(persistH3StillResult(f.job, f.job.template, await prepared(), { bytes: f.bytes, register: f.register })).rejects.toThrow();
      expect(f.puts()).toBe(0); expect(f.registrations()).toBe(0);
    }
    const f = await fixture(), image = await prepared(); image.master.bytes[50] ^= 1;
    await expect(persistH3StillResult(f.job, f.job.template, image, { bytes: f.bytes, register: f.register })).rejects.toThrow("bytes differ");
    expect(f.puts()).toBe(0);
  });
  test("artifact mismatch or interrupted persistence cannot return ready metadata", async () => {
    const f = await fixture(), image = await prepared();
    await expect(persistH3StillResult(f.job, f.job.template, image, { bytes: f.bytes, register: async (...args) => {
      const artifact = await f.register(...args); artifact.body.pngSha256 = "0".repeat(64); return artifact;
    } })).rejects.toThrow("Registered still artifact differs");
    const g = await fixture(); let calls = 0;
    const unknown: H3StillByteStore = { ...g.bytes, async put() { calls++; throw new Error("Unknown write"); } };
    await expect(persistH3StillResult(g.job, g.job.template, image, { bytes: unknown, register: g.register })).rejects.toThrow("Unknown write");
    expect(calls).toBe(1); expect(g.registrations()).toBe(0);
  });
});
