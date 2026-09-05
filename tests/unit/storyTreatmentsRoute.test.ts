import { describe, expect, test } from "bun:test";

import { handleStoryTreatmentsPost } from "@/app/api/story/treatments/route";

const body = {
  brief: "Two strangers search an underground maze.",
  song: { sections: [{ label: "Intro", start: 0, end: 8 }] },
  footage: { captionClusters: ["dancers"], sourceCount: 2, momentCount: 8 },
};

describe("POST /api/story/treatments", () => {
  test("rejects an unauthenticated caller before checking configuration", async () => {
    const response = await handleStoryTreatmentsPost(request(body), { getUser: async () => null, apiKey: null });
    expect(response.status).toBe(401);
  });

  test("returns 503 when the server key is absent", async () => {
    const response = await handleStoryTreatmentsPost(request(body), { getUser: user, apiKey: null });
    expect(response.status).toBe(503);
  });

  test("rejects invalid derived context", async () => {
    const response = await handleStoryTreatmentsPost(request({ song: null, footage: null }), { getUser: user, apiKey: "test-key" });
    expect(response.status).toBe(400);
  });

  test("maps provider failure to a recoverable gateway error", async () => {
    const response = await handleStoryTreatmentsPost(request(body), {
      getUser: user,
      apiKey: "test-key",
      generate: async () => { throw new Error("Story treatment generation failed after validation retry: malformed"); },
    });
    expect(response.status).toBe(502);
  });

  test("returns exactly three generated treatments", async () => {
    const result = { treatments: [{ id: "a" }, { id: "b" }, { id: "c" }] as never, meta: { model: "gpt-5.4-mini", generatedAt: "2026-09-02T00:00:00.000Z" } };
    const response = await handleStoryTreatmentsPost(request(body), {
      getUser: user,
      apiKey: "test-key",
      generate: async () => result,
    });
    const payload = await response.json() as { success?: boolean; treatments?: unknown[] };
    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.treatments).toHaveLength(3);
  });
});

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
