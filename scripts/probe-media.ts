import { getMediaFixturesDir, probeFixtureInventory } from "../src/components/studio/mediaProbe";

const rootDir = process.argv[2] ? process.argv[2] : getMediaFixturesDir();
const { inventory, manifest } = await probeFixtureInventory(rootDir);

console.log(
  JSON.stringify(
    {
      rootDir: inventory.rootDir,
      audioCount: inventory.audio.length,
      videoCount: inventory.video.length,
      otherCount: inventory.other.length,
      manifest,
    },
    null,
    2,
  ),
);
