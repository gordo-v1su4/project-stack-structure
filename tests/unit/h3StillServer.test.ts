import { createHash } from "node:crypto";
import { expect, test } from "bun:test";
import { h3ProjectFixture } from "../helpers/h3Project";
import { prepareH3StillJob, validateH3StillJobContext } from "@/lib/h3StillServer";
import { createH3StillJob } from "@/lib/h3StillJobStore";
import type { StudioJsonObjectStore } from "@/lib/studioProjectObjectStore";
import { H3RequestError } from "@/lib/h3GenerationServer";

type Dependencies = NonNullable<Parameters<typeof prepareH3StillJob>[2]>;
function fixture() {
  const f = h3ProjectFixture(), before = JSON.stringify(f.saved), calls: string[] = [];
  const rows = new Map<string, unknown>();
  const objects: StudioJsonObjectStore = {
    read: async <T>(key: string) => rows.has(key) ? { value: rows.get(key) as T, revision: "etag" } : null,
    write: async (key, value) => { rows.set(key, structuredClone(value)); return "etag"; },
  };
  const bytes = new TextEncoder().encode("actual conditional reference bytes");
  const deps: Dependencies = {
    read: async owner => { expect(owner).toBe("github-test"); calls.push("read"); return f.saved; },
    config: () => ({ bucket: "studio" }) as never,
    validate: async () => { calls.push("validate"); return undefined; },
    baseline: async () => { calls.push("baseline"); },
    pin: async job => { calls.push("pin"); return { ...job, references: job.references.map((ref, i) => ({ ...ref, etag: `etag-${i}` })) }; },
    download: async ref => { calls.push(`download:${ref.assetId}`); return { bytes: bytes.buffer, mime: "image/png", etag: ref.etag! }; },
    create: async input => { calls.push("create"); return createH3StillJob(input, objects); },
  };
  const input = { shot: f.request, creativePrompt: "[Static] Medium shot. Diego stands beside the CLUB_MAIN doorway.", seed: 123,
    requestIntentId: "a0c4aba6-2c57-4cc8-a510-2cb7f9bf5fae", attempt: 0 };
  return { ...f, before, calls, deps, input, bytes };
}
test("canonical still preparation binds actual reference bytes, future shot and saved target without editing project", async () => {
  const f = fixture(), job = await prepareH3StillJob("github-test", f.input, f.deps);
  expect(job.shotRequest).toMatchObject(f.request);
  expect(job.descriptor.body.references.every(ref => ref.rawSha256 === createHash("sha256").update(f.bytes).digest("hex"))).toBe(true);
  expect(job.descriptor.body.prompt).toContain("Diego from <Picture 1>");
  expect(f.calls.slice(-4)).toEqual(["read", "validate", "baseline", "create"]);
  expect(JSON.stringify(f.saved)).toBe(f.before);
  expect((await validateH3StillJobContext(job, f.deps)).references).toEqual(job.template.references);
});
test("a changed project during conditional reference reads rejects before claim or dispatch", async () => {
  const f = fixture(); let reads = 0;
  f.deps.read = async () => ++reads === 1 ? structuredClone(f.saved) : { ...f.saved, project: { ...f.saved.project, name: "changed" } };
  await expect(prepareH3StillJob("github-test", f.input, f.deps)).rejects.toThrow("saved project changed");
  expect(f.calls).not.toContain("create"); expect(f.calls).not.toContain("baseline");
});
test("unselected named identities in still prose and changed raw etags fail before durable job creation", async () => {
  const f = fixture();
  f.saved.draft.referenceAssets!.push({ ...f.saved.draft.referenceAssets![0], id: "valentina", displayName: "Valentina" });
  await expect(prepareH3StillJob("github-test", { ...f.input, creativePrompt: "Diego faces Valentina." }, f.deps)).rejects.toThrow("Attach the named identity");
  f.deps.download = async () => ({ bytes: f.bytes.buffer, mime: "image/png", etag: "changed" });
  await expect(prepareH3StillJob("github-test", f.input, f.deps)).rejects.toThrow("raw reference package changed");
  expect(f.calls).not.toContain("create");
});
test("worker currentness rejects relabelled reference before touching provider", async () => {
  const f = fixture(), job = await prepareH3StillJob("github-test", f.input, f.deps);
  f.saved.draft.referenceAssets![1].createdAt = "2026-11-07T00:00:00Z";
  await expect(validateH3StillJobContext(job, f.deps)).rejects.toThrow("reference versions changed");
});

test("aesthetic continuation is rejected before raw reads, durable claims or GPU dispatch", async () => {
  const f = fixture(), originalPin = f.deps.pin;
  f.deps.pin = async job => {
    const pinned = await originalPin(job);
    pinned.references[0].aesthetic = { purpose: "style", guidance: "Use warm amber light.", originalSha256: "a".repeat(64) };
    return pinned;
  };
  try { await prepareH3StillJob("github-test", f.input, f.deps); throw new Error("Expected aesthetic rejection"); }
  catch (error) { expect(error instanceof H3RequestError).toBe(true); expect((error as H3RequestError).status).toBe(422); }
  expect(f.calls.some(call => call.startsWith("download:"))).toBe(false);
  expect(f.calls).not.toContain("baseline"); expect(f.calls).not.toContain("create");
});
