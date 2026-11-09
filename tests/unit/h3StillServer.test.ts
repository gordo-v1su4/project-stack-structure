import { createHash } from "node:crypto";
import { expect, test } from "bun:test";
import { h3ProjectFixture } from "../helpers/h3Project";
import { H3StillAdmissionError, prepareH3StillJob, validateH3StillJobContext } from "@/lib/h3StillServer";
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
    rejectIntent: async () => true,
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
test("pre-create conflicts release only an absent intent; reserved jobs and storage uncertainty remain recoverable", async () => {
  for (const prior of ["absent", "existing", "unconfirmed"] as const) {
    const f = fixture(); let reads = 0;
    f.deps.read = async () => ++reads === 1 ? structuredClone(f.saved) : { ...f.saved, project: { ...f.saved.project, name: "changed" } };
    f.deps.rejectIntent = async () => {
      if (prior === "unconfirmed") throw new Error("reserved intent, missing job or read failure");
      return prior === "absent";
    };
    let failure: unknown;
    try { await prepareH3StillJob("github-test", f.input, f.deps); } catch (error) { failure = error; }
    expect(failure instanceof H3StillAdmissionError).toBe(prior === "absent");
    expect((failure as H3RequestError).status).toBe(409);
    expect(f.calls).not.toContain("create");
  }
});

test("a create failure after a durable claim never reports safe admission rejection", async () => {
  const f = fixture();
  f.deps.create = async () => { throw new H3RequestError("Durable create acknowledgement uncertain.", 409); };
  let failure: unknown;
  try { await prepareH3StillJob("github-test", f.input, f.deps); } catch (error) { failure = error; }
  expect(failure instanceof H3StillAdmissionError).toBe(false);
  expect((failure as H3RequestError).status).toBe(409);
});

test("invalid creative grammar with a valid intent is durably rejected before project reads", async () => {
  const f = fixture(); let fenced = false;
  f.deps.rejectIntent = async (owner, project, intent, attempt) => {
    expect([owner, project, intent, attempt]).toEqual(["github-test", f.input.shot.projectId, f.input.requestIntentId, 0]);
    fenced = true; return true;
  };
  await expect(prepareH3StillJob("github-test", { ...f.input, creativePrompt: "[Shot 1] Diego stands in CLUB_MAIN." }, f.deps)).rejects.toBeInstanceOf(H3StillAdmissionError);
  expect(fenced).toBe(true); expect(f.calls).toEqual([]);
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
