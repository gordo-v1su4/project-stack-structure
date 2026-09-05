import { describe, expect, test } from "bun:test";

import { handleStoryTreatmentsPost } from "@/app/api/story/treatments/route";

const body = {
  brief: "Two strangers search an underground maze.",
  song: { sections: [{ label: "Intro", start: 0, end: 8 }] },
  footage: { captionClusters: ["dancers"], sourceCount: 2, momentCount: 8 },
};

describe("POST /api/story/treatments", () => {
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

function request(payload: unknown) {
  return new Request("http://localhost/api/story/treatments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function user() {
  return { id: "github-story-user" };
}
