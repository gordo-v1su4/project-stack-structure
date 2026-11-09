import { describe, expect, test } from "bun:test";
import { createH3StillJob, H3StillIntentRejectedError, readH3StillJobByIntent, rejectH3StillIntent } from "@/lib/h3StillJobStore";
import type { StudioJsonObjectStore } from "@/lib/studioProjectObjectStore";
import { h3StillJobFixture } from "../helpers/h3StillJob";

const reject = (f: ReturnType<typeof h3StillJobFixture>, objects = f.objects) => rejectH3StillIntent(f.input.ownerId, f.input.projectId, f.input.requestIntentId, 0, objects);
const lookup = (f: ReturnType<typeof h3StillJobFixture>) => readH3StillJobByIntent(f.input.ownerId, f.input.projectId, f.input.requestIntentId, 0, f.objects);
const gate = () => { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; };

describe("still intent rejection fence", () => {
  test("absent intent is rejected once and all subsequent lookup/create paths see the tombstone", async () => {
    const f = h3StillJobFixture();
    expect(await reject(f)).toBe(true); expect(await reject(f)).toBe(true);
    expect(f.writes()).toBe(1); expect(f.rows.size).toBe(1);
    await expect(lookup(f)).rejects.toBeInstanceOf(H3StillIntentRejectedError);
    await expect(createH3StillJob(f.input, f.objects)).rejects.toBeInstanceOf(H3StillIntentRejectedError);
    expect(f.writes()).toBe(1);
  });
  test("active claim is never rejected, including its reserved missing-job interval", async () => {
    const f = h3StillJobFixture(), job = await createH3StillJob(f.input, f.objects);
    expect(await reject(f)).toBe(false);
    const jobKey = [...f.rows.keys()].find(key => key.endsWith(`${job.id}.json`))!;
    f.rows.delete(jobKey);
    const writes = f.writes(); expect(await reject(f)).toBe(false); expect(f.writes()).toBe(writes);
    await expect(lookup(f)).rejects.toThrow("reserved but its durable job is not confirmed");
  });
  test("lost rejection write ACK reconciles exactly without a duplicate write", async () => {
    const f = h3StillJobFixture();
    const lost: StudioJsonObjectStore = { ...f.objects, async write(key, value, revision) { await f.objects.write(key, value, revision); throw new Error("ACK lost"); } };
    expect(await reject(f, lost)).toBe(true); expect(f.writes()).toBe(1);
    await expect(createH3StillJob(f.input, f.objects)).rejects.toBeInstanceOf(H3StillIntentRejectedError);
  });
  test("malformed, foreign and ambiguous stored records never authorize clearing an intent", async () => {
    const f = h3StillJobFixture(); await reject(f);
    const [key, row] = [...f.rows.entries()][0]; const original = structuredClone(row.value) as Record<string, unknown>;
    for (const malformed of [{ ...original, ownerId: "other-owner" }, { ...original, extra: true }, { ...original, state: "unknown" }, { ...original, jobId: `h3-still-${"a".repeat(64)}` }, null]) {
      f.rows.set(key, { ...row, value: malformed });
      await expect(reject(f)).rejects.toThrow(); await expect(lookup(f)).rejects.toThrow();
      await expect(createH3StillJob(f.input, f.objects)).rejects.toThrow();
    }
    expect(f.writes()).toBe(1);
    const absent = h3StillJobFixture();
    await expect(reject(absent, { ...absent.objects, async write() { throw new Error("Unknown storage result"); } })).rejects.toThrow("Unknown storage result");
    await expect(reject(absent, { ...absent.objects, async read() { throw new Error("Read unavailable"); } })).rejects.toThrow("Read unavailable");
  });
  test("slow creation that observed absence loses claim CAS to rejection and cannot create a job", async () => {
    const f = h3StillJobFixture(), observed = gate(), resume = gate(); let held = false;
    const slow: StudioJsonObjectStore = { ...f.objects, async read<T>(key: string) {
      const value = await f.objects.read<T>(key);
      if (!held && key.includes("/intent-")) { held = true; observed.release(); await resume.promise; }
      return value;
    } };
    const creation = createH3StillJob(f.input, slow); await observed.promise;
    expect(await reject(f)).toBe(true); resume.release();
    await expect(creation).rejects.toBeInstanceOf(H3StillIntentRejectedError);
    expect(f.rows.size).toBe(1);
    expect([...f.rows.values()].some(row => Object.hasOwn(row.value as object, "id"))).toBe(false);
  });
  test("rejection that observed absence loses claim CAS to an active creation and returns false", async () => {
    const f = h3StillJobFixture(), observed = gate(), resume = gate(); let held = false;
    const slow: StudioJsonObjectStore = { ...f.objects, async read<T>(key: string) {
      const value = await f.objects.read<T>(key);
      if (!held) { held = true; observed.release(); await resume.promise; } return value;
    } };
    const rejection = reject(f, slow); await observed.promise;
    const job = await createH3StillJob(f.input, f.objects); resume.release();
    expect(await rejection).toBe(false); expect(await lookup(f)).toEqual(job);
  });
});
