import { describe, expect, test } from "bun:test";

import {
  buildGenerationReferenceInputs,
  getOrderedSelectedReferenceIds,
  sanitizeReferenceAssetForStorage,
  type ReferenceAsset,
} from "@/components/studio/referenceAssets";

const baseAsset = {
  fileName: "ref.png",
  previewUrl: "https://media.local/ref.png",
  promptHint: "Keep continuity.",
  storageProvider: "rustfs" as const,
  storageBucket: "stack-structure",
  storageStatus: "uploaded" as const,
  storageError: null,
  createdAt: "2026-06-20T00:00:00.000Z",
};

function asset(overrides: Partial<ReferenceAsset> & Pick<ReferenceAsset, "id" | "role" | "displayName" | "kind" | "storagePath" | "storageUrl">): ReferenceAsset {
  return { ...baseAsset, ...overrides };
}

describe("referenceAssets", () => {
  test("builds stable Nano Banana Pro image order after the anchor frame", () => {
    const assets = [
      asset({ id: "char1", role: "character-1", kind: "character", displayName: "Milo", storagePath: "reference-assets/character-1/milo.png", storageUrl: "https://media.local/milo.png" }),
      asset({ id: "char2", role: "character-2", kind: "character", displayName: "Ari", storagePath: "reference-assets/character-2/ari.png", storageUrl: "https://media.local/ari.png" }),
      asset({ id: "env", role: "environment", kind: "environment", displayName: "Blue room", storagePath: "reference-assets/environment/room.png", storageUrl: "https://media.local/room.png" }),
      asset({ id: "crowd-a", role: "crowd", kind: "crowd", displayName: "Club crowd A", storagePath: "reference-assets/crowd/a.png", storageUrl: "https://media.local/crowd-a.png" }),
      asset({ id: "crowd-b", role: "crowd", kind: "crowd", displayName: "Club crowd B", storagePath: "reference-assets/crowd/b.png", storageUrl: "https://media.local/crowd-b.png" }),
      asset({ id: "prop", role: "custom", kind: "prop", displayName: "Gold chain", storagePath: "reference-assets/custom/chain.png", storageUrl: "https://media.local/chain.png" }),
    ];

    const plan = buildGenerationReferenceInputs({
      anchorUrl: "https://media.local/scene-first.jpg",
      assets,
      selection: { character1Id: "char1", character2Id: "char2", environmentId: "env", crowdIds: ["crowd-a", "crowd-b"], customId: "prop" },
    });

    expect(plan.errors).toEqual([]);
    expect(plan.imageUrls).toEqual([
      "https://media.local/scene-first.jpg",
      "https://media.local/milo.png",
      "https://media.local/ari.png",
      "https://media.local/room.png",
      "https://media.local/crowd-a.png",
      "https://media.local/crowd-b.png",
      "https://media.local/chain.png",
    ]);
    expect(plan.instructions.join("\n")).toContain('character "Milo"');
    expect(plan.instructions.join("\n")).toContain('environment/location "Blue room"');
    expect(plan.instructions.join("\n")).toContain('crowd/extras sheet "Club crowd A"');
    expect(plan.instructions.join("\n")).toContain("do not copy a named lead's wardrobe onto the crowd");
    expect(plan.instructions.join("\n")).toContain("Do not invent or restate visual details");
    expect(plan.instructions.join("\n")).not.toContain("preserve exact facial identity, hair, wardrobe");
  });

  test("blocks local-only selected references instead of faking generation input", () => {
    const localOnly = asset({
      id: "char1",
      role: "character-1",
      kind: "character",
      displayName: "Milo",
      storagePath: "",
      storageUrl: "",
      storageStatus: "failed",
    });

    const plan = buildGenerationReferenceInputs({
      anchorUrl: "https://media.local/scene-first.jpg",
      assets: [localOnly],
      selection: { character1Id: "char1" },
    });

    expect(plan.imageUrls).toEqual(["https://media.local/scene-first.jpg"]);
    expect(plan.errors[0]).toContain("not uploaded to RustFS");
  });

  test("keeps the crowd library unbounded while limiting a generation packet to three unique sheets", () => {
    expect(getOrderedSelectedReferenceIds({
      character1Id: "lead",
      crowdIds: ["crowd-a", "crowd-a", "crowd-b", "crowd-c", "crowd-d"],
      customId: "prop",
    })).toEqual(["lead", "crowd-a", "crowd-b", "crowd-c", "prop"]);
  });

  test("sanitizes runtime preview urls for draft storage", () => {
    const sanitized = sanitizeReferenceAssetForStorage(asset({
      id: "char1",
      role: "character-1",
      kind: "character",
      displayName: "Milo",
      previewUrl: "blob:runtime-preview",
      storagePath: "reference-assets/character-1/milo.png",
      storageUrl: "https://media.local/milo.png",
    }));

    expect(sanitized.previewUrl).toBe("https://media.local/milo.png");
  });
});
