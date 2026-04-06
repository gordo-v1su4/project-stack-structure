import { describe, expect, test } from "bun:test";

import { buildMediaProbeManifest, probeFixtureInventory, probeMediaFile } from "../../src/components/studio/mediaProbe";
import { listMediaFixtures } from "../helpers/mediaFixtures";

describe("mediaProbe integration", () => {
  test("probes a real audio fixture", async () => {
    const inventory = listMediaFixtures();
    const result = await probeMediaFile(inventory.audio[0]!);

    expect(result.hasAudio).toBe(true);
    expect(result.hasVideo).toBe(false);
    expect(result.duration).toBeGreaterThan(0);
    expect(result.primaryAudioStream?.codecType).toBe("audio");
  });

  test("probes a real video fixture", async () => {
    const inventory = listMediaFixtures();
    const result = await probeMediaFile(inventory.video[0]!);

    expect(result.hasVideo).toBe(true);
    expect(result.duration).toBeGreaterThan(0);
    expect(result.primaryVideoStream?.width).toBeGreaterThan(0);
    expect(result.primaryVideoStream?.height).toBeGreaterThan(0);
  });

  test("builds a canonical manifest from the local fixture inventory", async () => {
    const { files, inventory } = await probeFixtureInventory();
    const manifest = buildMediaProbeManifest(files, inventory.rootDir);

    expect(manifest.rootDir).toBe(inventory.rootDir);
    expect(manifest.itemCount).toBe(files.length);
    expect(manifest.totalDuration).toBeGreaterThan(0);
    expect(manifest.items.some((item) => item.hasAudio)).toBe(true);
    expect(manifest.items.some((item) => item.hasVideo)).toBe(true);
  });

  test("attaches placeholder motion descriptors to probed video files", async () => {
    const inventory = listMediaFixtures();
    const result = await probeMediaFile(inventory.video[0]!);

    expect(result.motionDescriptor?.targetKind).toBe("file");
    expect(result.motionDescriptor?.provenance.kind).toBe("placeholder");
    expect(result.motionDescriptor?.confidence.overall).toBe(0.1);
  });
});
