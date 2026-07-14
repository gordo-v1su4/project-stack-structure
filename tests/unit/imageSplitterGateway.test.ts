import { describe, expect, test } from "bun:test";

import { normalizeImageSplitResponse, uploadImageSplitPanelsToMediaGateway } from "@/lib/imageSplitterGateway";

const splitPayload = {
  manifest: {
    split_id: "split-abc",
    source_filename: "Krea Hero Grid 00023.png",
    width: 1800,
    height: 1200,
    mode: "fixed",
    rows: 2,
    cols: 2,
    gutter_px: 0,
    panels: [
      { index: 1, asset_path: "panels/panel-001.png" },
      { index: 2, asset_path: "panels/panel-002.png" },
      { index: 3, asset_path: "panels/panel-003.png" },
      { index: 4, asset_path: "panels/panel-004.png" },
    ],
  },
};

describe("imageSplitterGateway", () => {
  test("labels fixed-grid panels with row and column coordinates", () => {
    const split = normalizeImageSplitResponse(splitPayload);

    expect(split.manifest.panels.map((panel) => panel.label)).toEqual([
      "R1C1 · Panel 01",
      "R1C2 · Panel 02",
      "R2C1 · Panel 03",
      "R2C2 · Panel 04",
    ]);
    expect(split.manifest.panels[2]).toMatchObject({ row: 2, col: 1 });
  });

  test("uploads split panels to a source/split folder with traceable filenames", async () => {
    const split = normalizeImageSplitResponse(splitPayload);
    const uploadedObjectKeys: string[] = [];
    const uploadedMimeTypes: string[] = [];

    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href.includes("/api/image-split/split-abc/panels/")) {
        return new Response(new Blob(["png"], { type: "image/png" }), { headers: { "Content-Type": "image/png; charset=utf-8" } });
      }
      if (href === "https://media.example.test/upload") {
        const body = init?.body as FormData;
        const folder = String(body.get("folder"));
        const file = body.get("file") as File;
        const objectKey = `${folder}/${file.name}`;
        uploadedObjectKeys.push(objectKey);
        uploadedMimeTypes.push(file.type);
        return Response.json({
          bucket: "stack-structure",
          publicUrl: `https://s3.example.test/stack-structure/${objectKey}`,
          objectKey,
          mime: file.type,
        });
      }
      return Response.json({ error: "unexpected url", href }, { status: 500 });
    };

    const persisted = await uploadImageSplitPanelsToMediaGateway({
      split,
      env: {
        IMAGE_SPLITTER_URL: "https://splitter.serving.cloud",
        MEDIA_GATEWAY_URL: "https://media.example.test",
        MEDIA_GATEWAY_TOKEN: "test-token",
        MEDIA_GATEWAY_UPLOAD_PREFIX: "media-uploads",
      },
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(persisted.rustfsUploaded).toBe(true);
    expect(uploadedObjectKeys[0]).toBe("media-uploads/image-splits/krea-hero-grid-00023/split-abc/krea-hero-grid-00023__grid-2x2__r1c1__p01.png");
    expect(uploadedObjectKeys[3]).toBe("media-uploads/image-splits/krea-hero-grid-00023/split-abc/krea-hero-grid-00023__grid-2x2__r2c2__p04.png");
    expect(uploadedMimeTypes).toEqual(["image/png", "image/png", "image/png", "image/png"]);
    expect(persisted.manifest.panels[0]?.storage?.publicUrl).toContain("krea-hero-grid-00023__grid-2x2__r1c1__p01.png");
  });
});
