import { describe, expect, test } from "bun:test";

import { formatSourceFrameReadout, getSourcePreviewImage } from "@/components/studio/SourceVideoLibrary";
import type { UploadedVideoSource } from "@/components/studio/types";
import { assignVideoSourceIds, getNextVideoSourceId, removeVideoSourceById } from "@/components/studio/videoSourceIdentity";

function source(id: number, name = `source-${id}.mp4`): UploadedVideoSource {
  return {
    id,
    name,
    size: 100,
    duration: 10,
    videoUrl: `blob:${id}`,
    thumbnailUrl: "",
    sceneStatus: "ready",
    captionStatus: "ready",
    storageStatus: "uploaded",
  };
}

describe("stable video source identity", () => {
  test("removing a source never renumbers the survivors", () => {
    const next = removeVideoSourceById([source(0), source(1), source(2)], 1);

    expect(next.map((item) => item.id)).toEqual([0, 2]);
    expect(getNextVideoSourceId(next)).toBe(3);
  });

  test("appended sources begin after the highest source id and remap their scenes", () => {
    const prepared = [{
      ...source(0, "new.mp4"),
      scenes: [{ id: 1, sourceClipId: 0, label: "Scene 1", start: 0, end: 1, duration: 1, detector: "pyscenedetect-adaptive" as const }],
    }];

    const [assigned] = assignVideoSourceIds(prepared, getNextVideoSourceId([source(0), source(2)]));

    expect(assigned?.id).toBe(3);
    expect(assigned?.scenes?.[0]?.sourceClipId).toBe(3);
  });
});

describe("source preview helpers", () => {
  test("uses a detected scene frame when a source thumbnail is missing", () => {
    const item = {
      ...source(4),
      scenes: [{ id: 1, sourceClipId: 4, label: "Scene 1", start: 0, end: 1, duration: 1, detector: "pyscenedetect-adaptive" as const, firstFrameUrl: "https://example.test/frame.jpg" }],
    };

    expect(getSourcePreviewImage(item)).toBe("https://example.test/frame.jpg");
  });

  test("reports seconds and the 24 fps frame position", () => {
    expect(formatSourceFrameReadout(2.5, 10)).toEqual({
      time: "2.50s / 10.00s",
      frame: "Frame 60 / 240 · 24 fps",
    });
  });
});
