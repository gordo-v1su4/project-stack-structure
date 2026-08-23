import { describe, expect, mock, test } from "bun:test";

mock.module("@/auth", () => ({ auth: async () => ({ user: { id: "github-test-user" } }) }));

const { POST } = await import("@/app/api/export/shader-capture/route");

describe("POST /api/export/shader-capture", () => {
  test("rejects an incomplete capture export before dispatching Trigger.dev", async () => {
    const form = new FormData();
    form.set("requestKey", "route-shader-export-validation-test");

    const response = await POST(new Request("http://localhost/api/export/shader-capture", { method: "POST", body: form }));
    const payload = await response.json() as { success?: boolean; error?: string };

    expect(response.status).toBe(400);
    expect(payload.success).toBe(false);
    expect(payload.error).toMatch(/audio|required/i);
  });
});
