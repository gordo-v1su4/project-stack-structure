import { describe, expect, test as it } from "bun:test";
import { analyzeStudioAudio, normalizeStudioAudio, resampleEnergy } from "@/lib/essentiaStudio";

function analysis() {
  return {
    schema_version: "studio-audio-v1", duration: 4, bpm: 120, beats: [0.5, 1, 1.5, 2, 2.5, 3, 3.5], onsets: [0.5, 2],
    energy: { curve: [0, 0.1, 0.2, 0.1, 1, 0.1, 0.2, 0.1, 0], sample_rate_hz: 2, start_time_s: 0 },
    structure: { source: "allin1", analyzed_duration_s: 4,
      provenance: { status: "detected", method: "allin1:dinat", device: "cuda" },
      sections: [{ start: 0, end: 2, label: "intro" }, { start: 2, end: 4, label: "verse" }] },
  };
}

describe("dedicated Studio audio contract", () => {
  it("retains model provenance and puts energy peaks on the correct editor time bin", () => {
    const result = normalizeStudioAudio(analysis(), "master.wav", 5);
    expect(result.energy).toEqual([0.1, 0.2, 1, 0.2, 0]);
    expect(result.energyTiming).toEqual({ start: 0, step: 1 });
    expect(result.sections[0].provenance).toMatchObject({ status: "detected", method: "allin1:dinat" });
    expect(result.bpm).toBe(120);
    expect(result.boundaries).toEqual([0, 2, 4]);
  });
  it("rejects partial structure and the old generic analysis contract", () => {
    const value = analysis();
    value.structure.analyzed_duration_s = 2;
    expect(() => normalizeStudioAudio(value, "master")).toThrow("duration");
    value.structure.source = "sbic";
    expect(() => normalizeStudioAudio(value, "master")).toThrow("All-In-One");
    expect(() => normalizeStudioAudio({}, "master")).toThrow("contract");
  });
  it("rejects overlapping sections, unsorted events and truncated energy", () => {
    const overlap = analysis(); overlap.structure.sections[1].start = 1;
    expect(() => normalizeStudioAudio(overlap, "master")).toThrow("timing");
    const events = analysis(); events.beats = [1, 0.5];
    expect(() => normalizeStudioAudio(events, "master")).toThrow("beats timing");
    const energy = analysis(); energy.energy.curve = [0, 1];
    expect(() => normalizeStudioAudio(energy, "master")).toThrow("cover");
  });
  it("uses frame timestamps instead of stretching a shortened frame grid", () => {
    expect(resampleEnergy([0, 0, 1, 0, 0], 2, 0, 2.2, 3)).toEqual([1, 0, 0]);
  });
  it("requires detected CUDA inference and rejects contradictory fallback reports", () => {
    for (const provenance of [undefined, { status: "detected", method: "allin1:dinat", device: "cpu" },
      { status: "estimated", method: "allin1:dinat", device: "cuda" },
      { status: "detected", method: "sbic", device: "cuda" }]) {
      const value = analysis();
      expect(() => normalizeStudioAudio({ ...value, structure: { ...value.structure, provenance } }, "master")).toThrow("CUDA");
    }
    for (const report of [{ used_fallback: true }, { fallback: true }, { algorithm: "duration-fallback" }]) {
      const value = analysis();
      expect(() => normalizeStudioAudio({ ...value, structure: { ...value.structure, ...report } }, "master")).toThrow("fallback");
    }
  });
  it("permits quarter-second edge rounding but rejects interior gaps or overlaps", () => {
    const rounded = analysis();
    rounded.structure.sections[0].start = 0.25;
    rounded.structure.sections[1].end = 4.25;
    rounded.structure.analyzed_duration_s = 4.25;
    expect(normalizeStudioAudio(rounded, "master").boundaries).toEqual([0.25, 2, 4.25]);
    for (const start of [2.00001, 1.99999, 2.75]) {
      const value = analysis(); value.structure.sections[1].start = start;
      expect(() => normalizeStudioAudio(value, "master")).toThrow("timing");
    }
    const tooLate = analysis(); tooLate.structure.sections[0].start = 0.251;
    expect(() => normalizeStudioAudio(tooLate, "master")).toThrow("timing");
    const tooShort = analysis(); tooShort.structure.sections[1].end = 3.749;
    expect(() => normalizeStudioAudio(tooShort, "master")).toThrow("cover");
    const partial = analysis(); partial.structure.analyzed_duration_s = 3.749;
    expect(() => normalizeStudioAudio(partial, "master")).toThrow("duration");
  });
  it("retains actual RMS peak timing on a full-length 1200-point editor grid", () => {
    const duration = 246.7, sampleRate = 44100 / 512;
    const curve = Array<number>(Math.floor(duration * sampleRate) + 1).fill(0);
    const sample = Math.round(123.45 * sampleRate);
    curve[sample] = 1;
    const result = resampleEnergy(curve, sampleRate, 0, duration, 1200);
    const time = sample / sampleRate;
    expect(result[Math.floor(time / duration * (result.length - 1))]).toBe(1);
    expect(result.filter((value) => value === 1)).toHaveLength(1);
    expect(Math.abs(result.indexOf(1) * duration / (result.length - 1) - time)).toBeLessThan(duration / 1199);
  });
});

describe("Studio audio job polling", () => {
  const file = new File(["audio"], "song.wav", { type: "audio/wav" });
  const args = { apiUrl: "https://audio.example", apiKey: "test-only", file, idempotencyKey: "run-1", sleep: async () => {} };
  it("submits once, reports stages, tolerates transient polling failures and returns the result", async () => {
    const requests: Array<{ url: string; method?: string; key: string | null }> = [];
    const stages: string[] = [];
    const responses = [
      Response.json({ id: "job-1", status: "queued", stage: "queued" }, { status: 202 }),
      new Response("edge failure", { status: 524 }),
      Response.json({ id: "job-1", status: "running", stage: "structure" }),
      Response.json({ id: "job-1", status: "completed", stage: "completed", result: analysis() }),
    ];
    const result = await analyzeStudioAudio({ ...args, onStage: (stage) => stages.push(stage), fetcher: (async (url, init) => {
      requests.push({ url: String(url), method: init?.method, key: new Headers(init?.headers).get("Idempotency-Key") });
      return responses.shift()!;
    }) as typeof fetch });
    expect(result).toEqual(analysis());
    expect(requests.filter((request) => request.method === "POST")).toHaveLength(1);
    expect(requests[0].key).toBe("run-1");
    expect(requests.slice(1).every((request) => request.url.endsWith("/jobs/job-1"))).toBe(true);
    expect(stages).toEqual(["queued", "structure", "completed"]);
  });
  it("surfaces terminal analysis errors without retrying inference", async () => {
    let calls = 0;
    await expect(analyzeStudioAudio({ ...args, fetcher: (async () => {
      calls++;
      return Response.json({ id: "job-1", status: "failed", stage: "structure", error: { code: "structure_failed", message: "No functional segments" } });
    }) as typeof fetch })).rejects.toThrow("No functional segments");
    expect(calls).toBe(1);
  });
  it("fails closed on auth or another job's response", async () => {
    await expect(analyzeStudioAudio({ ...args, fetcher: (async () => new Response("private", { status: 401 })) as typeof fetch })).rejects.toThrow("401");
    let calls = 0;
    await expect(analyzeStudioAudio({ ...args, fetcher: (async () => Response.json({ id: ++calls === 1 ? "job-1" : "job-other", status: "running", stage: "rhythm" })) as typeof fetch })).rejects.toThrow("another job");
  });
});
