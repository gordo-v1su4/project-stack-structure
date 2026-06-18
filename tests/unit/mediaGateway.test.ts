import { describe, expect, test } from "bun:test";

import {
  buildStudioMediaFolder,
  getMediaGatewayConfig,
  normalizeMediaGatewayUploadResult,
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
});
