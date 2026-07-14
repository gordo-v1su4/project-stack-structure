import { describe, expect, test } from "bun:test";

import { POST } from "@/app/api/export/final/route";

describe("POST /api/export/final", () => {
  test("rejects an incomplete export before dispatching Trigger.dev", async () => {
    const form = new FormData();
    form.set("requestKey", "route-final-export-validation-test");
    form.set("segments", JSON.stringify([{ sourceIndex: 0, startTime: 0, endTime: 1 }]));

    const response = await POST(new Request("http://localhost/api/export/final", { method: "POST", body: form }));
    const payload = await response.json() as { success?: boolean; error?: string };

    expect(response.status).toBe(400);
    expect(payload.success).toBe(false);
    expect(payload.error).toMatch(/audio|required/i);
  });
});
