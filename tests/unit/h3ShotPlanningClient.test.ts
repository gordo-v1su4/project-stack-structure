import { describe, expect, test } from "bun:test";
import { requestH3ShotPlanning } from "@/components/studio/h3ShotPlanningClient";
import { buildH3ShotPlanningInput, type H3ShotPlanningResult } from "@/components/studio/h3ShotPlanning";
import { buildEditPlanPreviewSegments, createMusicVideoProject, prepareApprovedPlacements } from "@/components/studio/musicVideoProject";

function fixture() {
  const project = prepareApprovedPlacements({ project: createMusicVideoProject({ duration: 6, analysis: null,
    videoSources: [], storyDrafts: [{ id: "intro", label: "Intro", start: 0, end: 6, prompt: "Diego advances." }] }), videoSources: [] });
  const input = buildH3ShotPlanningInput({ projectId: "project-a", project,
    segments: buildEditPlanPreviewSegments({ project, videoSources: [] }), subjectNames: ["Diego"] });
  const result: H3ShotPlanningResult = { version: 1, bindingSha256: input.bindingSha256,
    directions: input.groups.flatMap(group => group.windows.map(window => ({ windowKey: window.key,
      direction: "Diego advances.", entryState: "Diego moves.", exitState: "Diego moves.", actionIndices: [] }))) };
  const ready = () => Response.json({ success: true, state: "ready", bindingSha256: input.bindingSha256, result });
  const missing = () => Response.json({ success: true, state: "missing", bindingSha256: input.bindingSha256 });
  const queued = () => Response.json({ success: true, state: "queued", bindingSha256: input.bindingSha256, runId: "run-1" }, { status: 202 });
  const status = (completed = true, success = true) => Response.json({ id: "run-1", taskIdentifier: "qwen-h3-shot-planning", status: completed ? "COMPLETED" : "EXECUTING",
    isCompleted: completed, isSuccess: completed && success, isFailed: completed && !success, isCancelled: false });
  return { input, result, ready, missing, queued, status };
}
function fetcher(responses: Array<Response | (() => Promise<Response>)>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    if (!next) throw new Error("Unexpected request");
    return typeof next === "function" ? next() : next;
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

describe("owned browser shot planning observation", () => {
  const storageFixture = () => {
    const values = new Map<string, string>();
    return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  };
  test("a new explicit action retries proven failure, survives reload, and stops after three attempts", async () => {
    const f = fixture(), storage = storageFixture();
    for (let attempt = 0; attempt < 3; attempt++) {
      const network = fetcher([...(attempt ? [f.missing(), f.status(true, false)] : []), f.queued(), f.status(true, false)]);
      await expect(requestH3ShotPlanning(f.input, { ...network, storage })).rejects.toThrow("did not succeed");
      const posts = network.calls.filter(call => call.init?.method === "POST");
      expect(posts).toHaveLength(1);
      expect(JSON.parse(posts[0].init!.body as string)).toMatchObject(attempt ? { attempt, previousRunId: "run-1" } : { projectId: "project-a" });
    }
    const capped = fetcher([f.missing(), f.status(true, false)]);
    await expect(requestH3ShotPlanning(f.input, { ...capped, storage })).rejects.toThrow("three-attempt limit");
    expect(capped.calls.some(call => call.init?.method === "POST")).toBe(false);
  });

  test("reload observes pending acknowledged work without dispatch and unknown ACK replays the same attempt", async () => {
    const f = fixture(), storage = storageFixture();
    const first = fetcher([f.queued(), async () => { throw new Error("offline"); }]);
    await expect(requestH3ShotPlanning(f.input, { ...first, storage })).rejects.toThrow("offline");
    const resumed = fetcher([f.missing(), f.status(false), f.status(), f.ready()]);
    expect(await requestH3ShotPlanning(f.input, { ...resumed, storage })).toEqual(f.result);
    expect(resumed.calls.every(call => call.init?.method !== "POST")).toBe(true);
    const uncertain = storageFixture();
    const lost = fetcher([async () => { throw new Error("lost ACK"); }]);
    await expect(requestH3ShotPlanning(f.input, { ...lost, storage: uncertain })).rejects.toThrow("lost ACK");
    const replay = fetcher([f.missing(), f.queued(), f.status(), f.ready()]);
    await requestH3ShotPlanning(f.input, { ...replay, storage: uncertain });
    expect(replay.calls[1].init!.body).toBe(lost.calls[0].init!.body);
  });

  test("a late ACK cannot overwrite a newer saved attempt", async () => {
    const f = fixture(), storage = storageFixture();
    const network = fetcher([async () => {
      storage.setItem(`h3-shot-planning-v1:${f.input.projectId}:${f.input.bindingSha256}`, JSON.stringify({ attempt: 1, previousRunId: "run-1", runId: "run-2" }));
      return f.queued();
    }]);
    await expect(requestH3ShotPlanning(f.input, { ...network, storage })).rejects.toThrow("Another shot planning observation");
    expect(network.calls).toHaveLength(1);
    expect(storage.getItem(`h3-shot-planning-v1:${f.input.projectId}:${f.input.bindingSha256}`)).toContain("run-2");
  });
  test("SDK cancellation is terminal for explicit retry even when isCompleted is false", async () => {
    const f = fixture(), storage = storageFixture();
    const cancelled = () => Response.json({ id: "run-1", taskIdentifier: "qwen-h3-shot-planning", status: "CANCELED",
      isCompleted: false, isSuccess: false, isFailed: false, isCancelled: true });
    const first = fetcher([f.queued(), cancelled()]);
    await expect(requestH3ShotPlanning(f.input, { ...first, storage })).rejects.toThrow("did not succeed");
    const retry = fetcher([f.missing(), cancelled(), f.queued(), f.status(), f.ready()]);
    expect(await requestH3ShotPlanning(f.input, { ...retry, storage })).toEqual(f.result);
    expect(JSON.parse(retry.calls[2].init!.body as string)).toMatchObject({ attempt: 1, previousRunId: "run-1" });
  });
  test("durable plan recovers before failed, expired, or unavailable run status even at attempt limit", async () => {
    const f = fixture();
    for (const unavailableRun of [f.status(true, false), () => Response.json({ error: "expired" }, { status: 404 }),
      () => { throw new Error("run service unavailable"); }]) {
      const storage = storageFixture();
      storage.setItem(`h3-shot-planning-v1:${f.input.projectId}:${f.input.bindingSha256}`,
        JSON.stringify({ attempt: 2, previousRunId: "run-previous", runId: "run-1" }));
      // A worker may persist the result and then fail before Trigger acknowledges success.
      const network = fetcher([f.ready(), typeof unavailableRun === "function" ? async () => unavailableRun() : unavailableRun]);
      expect(await requestH3ShotPlanning(f.input, { ...network, storage })).toEqual(f.result);
      expect(network.calls).toHaveLength(1);
      expect(network.calls[0].init?.method).not.toBe("POST");
    }
  });

  test("missing durable result and unavailable run never authorize dispatch", async () => {
    const f = fixture(), storage = storageFixture();
    storage.setItem(`h3-shot-planning-v1:${f.input.projectId}:${f.input.bindingSha256}`,
      JSON.stringify({ attempt: 1, previousRunId: "run-previous", runId: "run-1" }));
    const network = fetcher([f.missing(), Response.json({ error: "expired" }, { status: 404 })]);
    await expect(requestH3ShotPlanning(f.input, { ...network, storage })).rejects.toThrow("failed (404)");
    expect(network.calls).toHaveLength(2);
    expect(network.calls.every(call => call.init?.method !== "POST")).toBe(true);
    const unavailable = fetcher([Response.json({ error: "storage unavailable" }, { status: 503 })]);
    await expect(requestH3ShotPlanning(f.input, { ...unavailable, storage })).rejects.toThrow("failed (503)");
    expect(unavailable.calls).toHaveLength(1);
  });
  test("cached result is strict-parsed with one dispatch and no polling", async () => {
    const f = fixture(), network = fetcher([f.ready()]);
    expect(await requestH3ShotPlanning(f.input, network)).toEqual(f.result);
    expect(network.calls).toHaveLength(1);
    expect(JSON.parse(network.calls[0].init!.body as string)).toEqual({ projectId: "project-a", planSignature: f.input.planSignature, bindingSha256: f.input.bindingSha256 });
    expect(network.calls[0].init).toMatchObject({ method: "POST", cache: "no-store", credentials: "same-origin" });
  });

  test("queued run polls existing owned status then reads durable result exactly once", async () => {
    const f = fixture(), network = fetcher([f.queued(), f.status(false), f.status(), f.ready()]);
    expect(await requestH3ShotPlanning(f.input, { ...network, pollIntervalMs: 1 })).toEqual(f.result);
    expect(network.calls.map(call => call.url.split("?")[0])).toEqual([
      "/api/generate/h3/shot-planning", "/api/orchestration/runs/run-1", "/api/orchestration/runs/run-1", "/api/generate/h3/shot-planning"]);
    expect(network.calls.filter(call => call.init?.method === "POST")).toHaveLength(1);
    const query = new URLSearchParams(network.calls.at(-1)!.url.split("?")[1]);
    expect(query.get("bindingSha256")).toBe(f.input.bindingSha256);
  });

  test("terminal failure never reads results or redispatches", async () => {
    const f = fixture(), network = fetcher([f.queued(), f.status(true, false)]);
    await expect(requestH3ShotPlanning(f.input, network)).rejects.toThrow("did not succeed");
    expect(network.calls).toHaveLength(2);
  });

  test("unknown run identity or task fails closed", async () => {
    const f = fixture();
    for (const extra of [{ id: "run-other" }, { taskIdentifier: "other-task" }]) {
      const state = await f.status().json();
      const network = fetcher([f.queued(), Response.json({ ...state, ...extra })]);
      await expect(requestH3ShotPlanning(f.input, network)).rejects.toThrow("run status");
      expect(network.calls).toHaveLength(2);
    }
  });

  test("mismatched acknowledgement and malformed final directions cannot apply", async () => {
    const f = fixture();
    const mismatch = fetcher([Response.json({ success: true, state: "queued", bindingSha256: "b".repeat(64), runId: "run-1" }, { status: 202 })]);
    await expect(requestH3ShotPlanning(f.input, mismatch)).rejects.toThrow("acknowledgment");
    expect(mismatch.calls).toHaveLength(1);
    const invalid = fetcher([Response.json({ success: true, state: "ready", bindingSha256: f.input.bindingSha256, result: { ...f.result, directions: [] } })]);
    await expect(requestH3ShotPlanning(f.input, invalid)).rejects.toThrow("exact bound input");
  });

  test("stale snapshots reject before dispatch and after an in-flight reply", async () => {
    const f = fixture(), noNetwork = fetcher([]);
    await expect(requestH3ShotPlanning(f.input, { ...noNetwork, isCurrent: () => false })).rejects.toThrow("changed");
    expect(noNetwork.calls).toHaveLength(0);
    let current = true;
    const network = fetcher([async () => { current = false; return f.ready(); }]);
    await expect(requestH3ShotPlanning(f.input, { ...network, isCurrent: () => current })).rejects.toThrow("changed");
    expect(network.calls).toHaveLength(1);
  });

  test("caller abort stops non-cooperative pending fetch without redispatch", async () => {
    const f = fixture(), controller = new AbortController();
    const network = fetcher([() => new Promise<Response>(() => {})]);
    const promise = requestH3ShotPlanning(f.input, { ...network, signal: controller.signal });
    controller.abort(new DOMException("Unmounted", "AbortError"));
    await expect(promise).rejects.toThrow("Unmounted");
    expect(network.calls).toHaveLength(1);
  });

  test("one overall timeout covers response-body reading", async () => {
    const f = fixture();
    let cancelled = false;
    const response = new Response(new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } }));
    const network = fetcher([response]);
    await expect(requestH3ShotPlanning(f.input, { ...network, timeoutMs: 10 })).rejects.toThrow("timed out");
    expect(cancelled).toBe(true);
    expect(network.calls).toHaveLength(1);
  });

  test("transport rejection is surfaced once and never redispatches", async () => {
    const f = fixture(), network = fetcher([async () => { throw new TypeError("offline"); }]);
    await expect(requestH3ShotPlanning(f.input, network)).rejects.toThrow("offline");
    expect(network.calls).toHaveLength(1);
  });

  test("mutated local input cannot start a dispatch", async () => {
    const f = fixture(), network = fetcher([]);
    f.input.subjectNames[0] = "Other";
    await expect(requestH3ShotPlanning(f.input, network)).rejects.toThrow("binding changed");
    expect(network.calls).toHaveLength(0);
  });
});
