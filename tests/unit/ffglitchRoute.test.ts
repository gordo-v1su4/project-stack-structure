import { describe, expect, test } from "bun:test";

import { GET } from "@/app/api/ffglitch/route";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

function restoreGlobals() {
  process.env = { ...originalEnv };
  globalThis.fetch = originalFetch;
}

describe("FFglitch gateway route", () => {
  test("probes the configured gateway with POST /ffglitch/detect", async () => {
    try {
      process.env.FFMPEG_GATEWAY_URL = "https://ffmpeg-gateway.local";
      process.env.FFMPEG_GATEWAY_API_KEY = "test-key";

      globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
        expect(String(_url)).toBe("https://ffmpeg-gateway.local/ffglitch/detect");
        expect(init?.method).toBe("POST");
        expect(init?.headers).toMatchObject({ "X-API-Key": "test-key" });
        return Response.json({ available: true, ffglitch: true });
      }) as unknown as typeof fetch;

      const response = await GET();
      const payload = await response.json() as { available?: boolean; ffglitch?: boolean };

      expect(response.status).toBe(200);
      expect(payload.available).toBe(true);
      expect(payload.ffglitch).toBe(true);
    } finally {
      restoreGlobals();
    }
  });
});
