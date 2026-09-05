import { describe, expect, test } from "bun:test";

import { formatSceneCaptionGatewayError, resolveSceneCaptionGatewayAuth } from "@/lib/sceneCaptionGateway";

describe("resolveSceneCaptionGatewayAuth", () => {
  test("prefers the internal URL for VM100 Trigger workers", () => {
    const auth = resolveSceneCaptionGatewayAuth({
      SCENE_CAPTION_SMART_GATEWAY_INTERNAL_URL: "http://192.168.8.222:18091",
      SCENE_CAPTION_SMART_GATEWAY_URL: "https://caption.v1su4.dev",
      SCENE_CAPTION_SMART_GATEWAY_TOKEN: "token",
    });
    expect(auth.gatewayUrl).toBe("http://192.168.8.222:18091");
    expect(auth.token).toBe("token");
  });

  test("keeps bearer auth for public gateway callers", () => {
    const auth = resolveSceneCaptionGatewayAuth({
      SCENE_CAPTION_SMART_GATEWAY_URL: "https://caption.v1su4.dev",
      SCENE_CAPTION_SMART_GATEWAY_TOKEN: "token",
    });
    expect(auth.gatewayUrl).toBe("https://caption.v1su4.dev");
    expect(auth.token).toBe("token");
  });
});

describe("formatSceneCaptionGatewayError", () => {
  test("explains Cloudflare HTML failures clearly", () => {
    const message = formatSceneCaptionGatewayError(502, {
      error: "<!DOCTYPE html><title>v1su4.dev | 502: Bad gateway</title>",
    }, "/story/treatments");
    expect(message).toContain("Cloudflare HTML");
    expect(message).toContain("/story/treatments");
  });
});
