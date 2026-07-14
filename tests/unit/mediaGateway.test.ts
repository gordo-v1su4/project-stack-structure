import { describe, expect, test } from "bun:test";

import {
  buildStudioMediaFolder,
  downloadMediaGatewayFile,
  getMediaGatewayConfig,
  normalizeMediaGatewayUploadResult,
  uploadJsonToMediaGateway,
} from "@/lib/mediaGateway";

describe("mediaGateway", () => {
  test("uses the stack-structure RustFS bucket without duplicating the bucket prefix", () => {
    const config = getMediaGatewayConfig({
      MEDIA_GATEWAY_URL: "https://media.v1su4.dev/",
      MEDIA_GATEWAY_TOKEN: "secret-token",
      MEDIA_GATEWAY_BUCKET: "stack-structure",
      MEDIA_GATEWAY_USER_ID: "stack-structure",
      MEDIA_GATEWAY_UPLOAD_PREFIX: "stack-structure/media-uploads",
    });

    expect(config).toEqual({
      url: "https://media.v1su4.dev",
      token: "secret-token",
      userId: "stack-structure",
      bucket: "stack-structure",
      uploadPrefix: "media-uploads",
    });
  });

  test("defaults to the stack-structure bucket and media-uploads prefix", () => {
    const config = getMediaGatewayConfig({
      MEDIA_GATEWAY_URL: "https://media.v1su4.dev/",
      MEDIA_GATEWAY_TOKEN: "secret-token",
    });

    expect(config?.userId).toBe("stack-structure");
    expect(config?.bucket).toBe("stack-structure");
    expect(config?.uploadPrefix).toBe("media-uploads");
  });

  test("builds a Pindeck-style dated folder under the RustFS media prefix", () => {
    expect(buildStudioMediaFolder({ uploadPrefix: "media-uploads" }, new Date("2026-06-18T12:00:00.000Z")))
      .toBe("media-uploads/2026/06_18");
  });

  test("normalizes current and documented media gateway upload payload shapes", () => {
    expect(normalizeMediaGatewayUploadResult({
      bucket: "stack-structure",
      publicUrl: "https://s3.v1su4.dev/stack-structure/media-uploads/a.mp4",
      objectKey: "media-uploads/a.mp4",
      mime: "video/mp4",
    }, "stack-structure", "application/octet-stream")).toEqual({
      bucket: "stack-structure",
      publicUrl: "https://s3.v1su4.dev/stack-structure/media-uploads/a.mp4",
      mediaUrl: undefined,
      storagePath: "media-uploads/a.mp4",
      objectKey: "media-uploads/a.mp4",
      mime: "video/mp4",
    });

    expect(normalizeMediaGatewayUploadResult({
      publicUrl: "https://s3.v1su4.dev/stack-structure/media-uploads/b.mp4",
      path: "media-uploads/b.mp4",
    }, "stack-structure", "video/mp4").storagePath).toBe("media-uploads/b.mp4");
  });

  test("downloads a stored object through the authenticated media gateway", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const result = await downloadMediaGatewayFile({
      bucket: "stack-structure",
      objectKey: "media-uploads/source-audio/song.wav",
      env: {
        MEDIA_GATEWAY_URL: "https://media.local",
        MEDIA_GATEWAY_TOKEN: "media-token",
      },
      fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "audio/wav" },
        });
      }) as typeof fetch,
    });

    expect(calls).toEqual([{
      url: "https://media.local/files/stack-structure/media-uploads/source-audio/song.wav",
      init: {
        headers: { Authorization: "Bearer media-token" },
        redirect: "follow",
      },
    }]);
    expect(result.fileName).toBe("song.wav");
    expect(result.mime).toBe("audio/wav");
    expect(Array.from(new Uint8Array(result.bytes))).toEqual([1, 2, 3]);
  });

  test("persists JSON analysis results through the authenticated upload contract", async () => {
    const result = await uploadJsonToMediaGateway({
      data: { schema: "stack-structure.analysis.v1", duration: 12.5 },
      fileName: "song-abc.essentia.json",
      folder: "media-uploads/analysis/essentia",
      env: {
        MEDIA_GATEWAY_URL: "https://media.local",
        MEDIA_GATEWAY_TOKEN: "media-token",
      },
      fetchImpl: async (_url, init) => {
        const form = init?.body as FormData;
        const file = form.get("file") as File;
        expect(form.get("folder")).toBe("media-uploads/analysis/essentia");
        expect(file.name).toBe("song-abc.essentia.json");
        expect(file.type).toContain("application/json");
        expect(await file.text()).toContain('"schema": "stack-structure.analysis.v1"');
        return Response.json({
          bucket: "stack-structure",
          objectKey: "media-uploads/analysis/essentia/song-abc.essentia.json",
          publicUrl: "https://media.local/files/stack-structure/media-uploads/analysis/essentia/song-abc.essentia.json",
          mime: "application/json",
        });
      },
    });

    expect(result.objectKey).toBe("media-uploads/analysis/essentia/song-abc.essentia.json");
    expect(result.mime).toBe("application/json");
  });
});
