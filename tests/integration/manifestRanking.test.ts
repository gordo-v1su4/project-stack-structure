import { describe, expect, test } from "bun:test";

import { rankManifestCandidates } from "../../src/components/studio/manifestRanking";
import { probeFixtureInventory } from "../../src/components/studio/mediaProbe";

describe("manifestRanking integration", () => {
  test("ranks a real probed manifest deterministically with synthetic music scores", async () => {
    const { manifest } = await probeFixtureInventory();
    const candidates = manifest.items
      .filter((item) => item.hasVideo)
      .slice(0, 3)
      .map((item, index) => ({
        id: item.fileName,
        segment: {
          id: item.id,
          start: 0,
          end: item.duration,
          duration: item.duration,
          sourceClipIds: [item.id],
          leadingCut: { id: `lead:${item.id}`, time: 0, kind: "tail" as const, quantized: false },
          trailingCut: { id: `tail:${item.id}`, time: item.duration, kind: "tail" as const, quantized: false },
          motionDescriptor: item.motionDescriptor,
        },
        musicalScore: 1 - index * 0.05,
        fileDescriptor: item.motionDescriptor,
        fitPenalty: 0,
      }));

    const rankedA = rankManifestCandidates({ mode: "random", candidates, randomSeed: 7 }).map((candidate) => candidate.id);
    const rankedB = rankManifestCandidates({ mode: "random", candidates, randomSeed: 7 }).map((candidate) => candidate.id);

    expect(rankedA).toEqual(rankedB);
    expect(rankedA).toHaveLength(3);
  });
});
