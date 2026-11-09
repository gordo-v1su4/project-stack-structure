import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

let userId: string | null = "github-owner";
let legacyOwned = false;
const legacyRead = mock(async () => legacyOwned);
mock.module("@/lib/session", () => ({
  getSessionUser: async () => userId ? { id: userId } : null,
  unauthorizedResponse: () => Response.json({ error: "Sign in" }, { status: 401 }),
}));
mock.module("@/lib/studioMediaAccess", () => ({ canReadMediaObject: legacyRead }));
const { GET: downloadUrl } = await import("@/app/api/storage/download-url/route");
const { GET: streamMedia } = await import("@/app/api/storage/media/route");

const originalFetch = globalThis.fetch;
const savedEnv = { ...process.env };
const key = "media-uploads/projects/github-owner/id/project.json";
function request(objectKey = key, bucket = "stack-structure", headers?: HeadersInit) {
  return new Request(`http://localhost/api/storage/media?${new URLSearchParams({ bucket, objectKey })}`, { headers });
}

beforeEach(() => {
  userId = "github-owner"; legacyOwned = false; legacyRead.mockClear();
  process.env.MEDIA_GATEWAY_URL = "https://gateway.test";
  process.env.MEDIA_GATEWAY_TOKEN = "server-test-token";
  process.env.MEDIA_GATEWAY_BUCKET = "stack-structure";
  process.env.RUSTFS_BUCKET = "stack-structure";
});
afterEach(() => { globalThis.fetch = originalFetch; process.env = { ...savedEnv }; });

describe("canonical metadata download authorization", () => {
  test("rejects missing sessions, bucket tampering, traversal and foreign metadata before transport", async () => {
    const upstream = mock(async () => new Response("{}")); globalThis.fetch = upstream as unknown as typeof fetch;
    userId = null;
    for (const route of [downloadUrl, streamMedia]) expect((await route(request())).status).toBe(401);
    userId = "github-owner";
    for (const route of [downloadUrl, streamMedia]) {
      expect((await route(request(key, "pindeck"))).status).toBe(400);
      for (const bad of ["media-uploads/github-owner/../projects/other/id/project.json",
        "media-uploads/github-owner/..\\projects/other/id/project.json", "media-uploads/github-owner/ref\u0000.json"]) {
        expect((await route(request(bad))).status).toBe(400);
      }
      legacyOwned = true; // A caller-saved reference cannot confer foreign metadata ownership.
      expect((await route(request(key.replace("github-owner", "other")))).status).toBe(403);
      expect((await route(request("media-uploads/studio-drafts/other.json"))).status).toBe(403);
    }
    expect(upstream).toHaveBeenCalledTimes(0);
    expect(legacyRead).toHaveBeenCalledTimes(0);
  });

  test("returns session-owned proxy URLs for canonical project/index/draft/job metadata without bearer", async () => {
    for (const objectKey of [key, "media-uploads/projects/github-owner/index.json",
      "media-uploads/projects/github-owner/still-jobs/id/job.json",
      "media-uploads/studio-drafts/github-owner.json", "media-uploads/studio-drafts/123-github-owner.json"]) {
      const response = await downloadUrl(request(objectKey));
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.fileUrl).toBe(`/api/storage/media?${new URLSearchParams({ bucket: "stack-structure", objectKey })}`);
      expect(JSON.stringify(payload)).not.toContain("server-test-token");
      expect(JSON.stringify(payload)).not.toContain("gateway.test");
    }
  });

  test("streams signed gateway metadata with server bearer, manual redirects, ranges and safe response headers", async () => {
    const upstream = mock(async (_url: string, _init?: RequestInit) => { void _url; void _init; return new Response("{}", { status: 206, headers: {
      "content-type": "application/json", "content-range": "bytes 0-1/10", "content-length": "2", etag: "version",
      location: "https://private-storage.test/object", authorization: "should-not-leak",
    } }); });
    globalThis.fetch = upstream as unknown as typeof fetch;
    const response = await streamMedia(request(key, "stack-structure", { authorization: "Bearer attacker", range: "bytes=0-1" }));
    expect(response.status).toBe(206); expect(await response.text()).toBe("{}");
    expect(upstream.mock.calls[0][1]?.headers).toEqual({ Authorization: "Bearer server-test-token", range: "bytes=0-1" });
    expect(upstream.mock.calls[0][1]?.redirect).toBe("manual");
    expect(response.headers.get("content-range")).toBe("bytes 0-1/10");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("location")).toBe(null); expect(response.headers.get("authorization")).toBe(null);
  });

  test("fails closed on unsigned redirect and hides storage error bodies", async () => {
    for (const status of [302, 403, 404, 500]) {
      globalThis.fetch = mock(async () => new Response("private key or credential", { status, headers: { location: "https://private.test" } })) as unknown as typeof fetch;
      const response = await streamMedia(request());
      expect(response.status).toBe(status === 302 ? 502 : status);
      expect(response.headers.get("location")).toBe(null);
      expect(await response.text()).not.toContain("private");
    }
    globalThis.fetch = mock(async () => { throw new Error("server-test-token private-host"); }) as unknown as typeof fetch;
    const response = await streamMedia(request());
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("server-test-token");
  });

  test("retains public media/conditioning URLs and public-media range streaming", async () => {
    for (const objectKey of ["media-uploads/projects/github-owner/generated/id/shot.mp4",
      "media-uploads/projects/github-owner/generation-conditioning/id/ref.png", "media-uploads/video-source/legacy.mp4"]) {
      expect((await (await downloadUrl(request(objectKey))).json()).fileUrl)
        .toBe(`https://gateway.test/files/stack-structure/${objectKey}`);
    }
    const upstream = mock(async (_url: string, _init?: RequestInit) => { void _url; void _init; return new Response("frame", { status: 206, headers: { "content-range": "bytes 0-4/100", "accept-ranges": "bytes" } }); });
    globalThis.fetch = upstream as unknown as typeof fetch;
    const response = await streamMedia(request("media-uploads/github-owner/video-source/source.mp4", "stack-structure", { range: "bytes=0-4" }));
    expect(response.status).toBe(206); expect(await response.text()).toBe("frame");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(upstream.mock.calls[0][1]?.redirect).toBe("follow");
    expect(upstream.mock.calls[0][1]?.headers).toEqual({ Authorization: "Bearer server-test-token", range: "bytes=0-4" });
  });
});
