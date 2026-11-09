import { describe, expect, test } from "bun:test";
import { createShotPlanningHandlers } from "@/app/api/generate/h3/shot-planning/shotPlanningRoute";
import { H3ShotPlanningError, loadH3ShotPlanningContext } from "@/lib/h3ShotPlanningServer";
import { effectiveGenerationScope } from "@/components/studio/generationScope";
import type { H3ShotPlanningResult } from "@/components/studio/h3ShotPlanning";
import { h3ProjectFixture } from "../helpers/h3Project";

async function fixture() {
  const { saved } = h3ProjectFixture();
  const planSignature = effectiveGenerationScope(saved.draft.musicVideoProject!)!;
  const context = await loadH3ShotPlanningContext(saved.project.ownerId, saved.project.id, { planSignature }, {
    read: async () => saved, validate: async () => planSignature,
  });
  let loads = 0, dispatches = 0;
  let cached: H3ShotPlanningResult | null = null;
  const body = { projectId: saved.project.id, planSignature };
  const dependencies = {
    session: async () => ({ id: saved.project.ownerId }),
    load: async () => { loads++; return context; },
    read: async () => cached,
    trigger: async () => { dispatches++; return { id: "run_owned" }; },
  };
  const request = (value: unknown = body) => new Request("https://app.example/api/generate/h3/shot-planning", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value),
  });
  return { body, context, dependencies, request, counts: () => ({ loads, dispatches }), setCached: (value: H3ShotPlanningResult) => { cached = value; } };
}

describe("authenticated shot planning API", () => {
  test("anonymous calls are denied before reading malformed input or project data", async () => {
    const f = await fixture();
    const handlers = createShotPlanningHandlers({ ...f.dependencies, session: async () => null });
    const response = await handlers.POST(new Request("https://app.example/", { method: "POST", body: "bad" }));
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(f.counts()).toEqual({ loads: 0, dispatches: 0 });
  });

  test("queues only the canonical owned binding; missing GET never dispatches", async () => {
    const f = await fixture();
    const handlers = createShotPlanningHandlers(f.dependencies);
    const queued = await handlers.POST(f.request());
    expect(queued.status).toBe(202);
    expect(await queued.json()).toEqual({ success: true, state: "queued", bindingSha256: f.context.input.bindingSha256, runId: "run_owned" });
    const missing = await handlers.GET(new Request(`https://app.example/?${new URLSearchParams(f.body)}`));
    expect(await missing.json()).toEqual({ success: true, state: "missing", bindingSha256: f.context.input.bindingSha256 });
    expect(f.counts().dispatches).toBe(1);
  });

  test("existing results are read without another dispatch", async () => {
    const f = await fixture();
    f.setCached({ version: 1, bindingSha256: f.context.input.bindingSha256, directions: [] });
    const response = await createShotPlanningHandlers(f.dependencies).POST(f.request());
    expect(response.status).toBe(200);
    expect((await response.json()).state).toBe("ready");
    expect(f.counts().dispatches).toBe(0);
  });

  test("oversized, forged fields and unbounded attempts fail before source reads", async () => {
    const f = await fixture();
    const handlers = createShotPlanningHandlers(f.dependencies);
    expect((await handlers.POST(f.request({ ...f.body, ownerId: "foreign" }))).status).toBe(400);
    expect((await handlers.POST(f.request({ ...f.body, attempt: 3 }))).status).toBe(400);
    expect((await handlers.POST(f.request({ ...f.body, planSignature: "x".repeat(5000) }))).status).toBe(413);
    expect(f.counts()).toEqual({ loads: 0, dispatches: 0 });
  });

  test("canonical conflicts do not dispatch and unexpected errors expose no provider detail", async () => {
    const f = await fixture();
    const conflict = createShotPlanningHandlers({ ...f.dependencies, load: async () => { throw new H3ShotPlanningError("The confirmed cut plan changed."); } });
    expect((await conflict.POST(f.request())).status).toBe(409);
    const failure = createShotPlanningHandlers({ ...f.dependencies, trigger: async () => { throw new Error("PRIVATE_PROVIDER_SENTINEL"); } });
    const response = await failure.POST(f.request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("PRIVATE_PROVIDER_SENTINEL");
    expect(f.counts().dispatches).toBe(0);
  });
});
