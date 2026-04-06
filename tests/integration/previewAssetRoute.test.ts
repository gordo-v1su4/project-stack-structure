import { describe, expect, test } from "bun:test";

import { GET } from "../../src/app/api/preview/asset/route";
import { createTempPreviewPath, generateSectionPreview } from "../../src/components/studio/previewGeneration";
import { listMediaFixtures } from "../helpers/mediaFixtures";

describe("preview asset route", () => {
  test("serves a generated preview asset from the allowed preview directory", async () => {
    const inventory = listMediaFixtures();
    const inputPath = inventory.video[0];
    expect(Boolean(inputPath)).toBe(true);

    const asset = await generateSectionPreview({
      inputPath: inputPath!,
      requestKey: `preview-route-${Date.now()}`,
      startTime: 0,
      endTime: 1,
      outputPath: createTempPreviewPath("preview-route"),
    });

    const response = await GET(new Request(`http://localhost/api/preview/asset?assetKey=${encodeURIComponent(asset.assetKey)}`));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  test("rejects asset paths outside the preview output directory", async () => {
    const response = await GET(new Request(`http://localhost/api/preview/asset?assetKey=${encodeURIComponent("/tmp/not-allowed.mp4")}`));
    const payload = (await response.json()) as { success: boolean; error: string };

    expect(response.status).toBe(400);
    expect(payload).toMatchObject({
      success: false,
      error: "Preview asset path is not allowed.",
    });
  });
});
