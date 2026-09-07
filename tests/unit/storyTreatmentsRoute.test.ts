import { describe, expect, test } from "bun:test";

import { handleStoryTreatmentsPost } from "@/app/api/story/treatments/route";
import { queueStoryTreatmentGeneration } from "@/lib/storyTreatmentServer";
import { buildStoryTreatmentDispatchKey } from "@/lib/triggerOrchestration";

const body = {
  brief: "Two strangers search an underground maze.",
  song: { sections: [{ label: "Intro", start: 0, end: 8 }] },
  footage: { captionClusters: ["dancers"], sourceCount: 2, momentCount: 8 },
};

describe("POST /api/story/treatments", () => {
  test("preserves gesture identity across redelivery and separates repair attempts and deliberate regeneration", async () => {
    const keys: string[] = [];
    const dependencies = { getUser: user, isConfigured: true, queue: async (input: Parameters<typeof queueStoryTreatmentGeneration>[0], options: { requestIntentId: string }) => queueStoryTreatmentGeneration(input, {
      ...options,
      trigger: async (payload, intent) => { const key = buildStoryTreatmentDispatchKey(payload, "github-story-user", intent); keys.push(key); return { id: key }; },
    }) };
    const firstId = "00000000-0000-4000-8000-000000000001";
    const nextId = "00000000-0000-4000-8000-000000000002";
    for (const [id, attempt] of [[firstId, 0], [firstId, 0], [firstId, 1], [firstId, 1], [nextId, 0]] as const) {
      const response = await handleStoryTreatmentsPost(request({ ...body, validationAttempt: attempt }, id), dependencies);
      expect(response.status).toBe(202);
    }
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).toBe(keys[3]);
    expect(keys[0]).not.toBe(keys[2]);
    expect(keys[0]).not.toBe(keys[4]);
    await handleStoryTreatmentsPost(request(body), dependencies);
    await handleStoryTreatmentsPost(request(body), dependencies);
    expect(keys[5]).not.toBe(keys[6]);
  });

  test("rejects malformed gesture ids without dispatching and preserves session authorization", async () => {
    let dispatched = false;
    const queue = async () => { dispatched = true; return { runId: "unexpected", model: "qwen" }; };
    expect((await handleStoryTreatmentsPost(request(body, "not-a-uuid"), { getUser: user, isConfigured: true, queue })).status).toBe(400);
    expect((await handleStoryTreatmentsPost(request(body, "00000000-0000-4000-8000-000000000001"), { getUser: async () => null, isConfigured: true, queue })).status).toBe(401);
    expect(dispatched).toBe(false);
  });
  test("rejects an unauthenticated caller before checking configuration", async () => {
    const response = await handleStoryTreatmentsPost(request(body), { getUser: async () => null, isConfigured: false });
    expect(response.status).toBe(401);
  });

  test("returns 503 when story generation is not configured", async () => {
    const response = await handleStoryTreatmentsPost(request(body), { getUser: user, isConfigured: false });
    expect(response.status).toBe(503);
  });

  test("rejects invalid derived context", async () => {
    const response = await handleStoryTreatmentsPost(request({ song: null, footage: null }), { getUser: user, isConfigured: true });
    expect(response.status).toBe(400);
  });

  test("maps provider failure to a recoverable gateway error", async () => {
    const response = await handleStoryTreatmentsPost(request(body), {
      getUser: user,
      isConfigured: true,
      generate: async () => { throw new Error("Story treatment generation failed after validation retry: malformed"); },
    });
    expect(response.status).toBe(502);
  });

  test("queues Trigger and returns a run id for client polling", async () => {
    const response = await handleStoryTreatmentsPost(request(body), {
      getUser: user,
      isConfigured: true,
      queue: async () => ({ runId: "run-story-1", model: STORY_TREATMENT_MODEL }),
    });
    const payload = await response.json() as { success?: boolean; queued?: boolean; runId?: string };
    expect(response.status).toBe(202);
    expect(payload.success).toBe(true);
    expect(payload.queued).toBe(true);
    expect(payload.runId).toBe("run-story-1");
  });

  test("returns exactly three generated treatments when a sync generate dependency is injected", async () => {
    const result = { treatments: [{ id: "a" }, { id: "b" }, { id: "c" }] as never, meta: { model: STORY_TREATMENT_MODEL, generatedAt: "2026-09-02T00:00:00.000Z" } };
    const response = await handleStoryTreatmentsPost(request(body), {
      getUser: user,
      isConfigured: true,
      generate: async () => result,
    });
    const payload = await response.json() as { success?: boolean; treatments?: unknown[] };
    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.treatments).toHaveLength(3);
  });
});

const STORY_TREATMENT_MODEL = "Qwen/Qwen3-VL-4B-Instruct-GGUF:Q4_K_M";

function request(payload: unknown, requestIntentId?: string) {
  return new Request("http://localhost/api/story/treatments", {
    method: "POST",
    headers: { "content-type": "application/json", ...(requestIntentId ? { "x-story-request-id": requestIntentId } : {}) },
    body: JSON.stringify(payload),
  });
}

async function user() {
  return { id: "github-story-user" };
}
