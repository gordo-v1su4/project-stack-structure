import { describe, expect, test } from "bun:test";

import { applyApprovedGeneratedAssets, buildGeneratedAssetContextPreview, buildGeneratedAssetPlaybackUrl, type GeneratedStudioAsset } from "@/components/studio/generatedAssets";
import type { EditPlanPreviewSegment } from "@/components/studio/musicVideoProject";

const sourceSegments: EditPlanPreviewSegment[] = [
  {
    videoUrl: "https://media.example/source.mp4",
    startTime: 10,
    endTime: 13,
    label: "Hallway pass 1",
    sectionId: "chorus-3",
    musicStart: 200,
    musicEnd: 203,
    momentId: "hallway-scene",
    sourceClipId: 15,
    sourceRefLabel: "S16",
  },
  {
    videoUrl: "https://media.example/source.mp4",
    startTime: 13,
    endTime: 15.9,
    label: "Hallway pass 2",
    sectionId: "chorus-3",
    musicStart: 212.06,
    musicEnd: 214.99,
    momentId: "hallway-scene",
    sourceClipId: 15,
    sourceRefLabel: "S16",
  },
];

function generatedAsset(overrides: Partial<GeneratedStudioAsset>): GeneratedStudioAsset {
  return {
    id: "generated-1",
    provider: "higgsfield",
    model: "seedance_2_5",
    prompt: "Continuation",
    createdAt: "2026-08-27T18:58:32.000Z",
    status: "completed",
    mediaKind: "video",
    durationSeconds: 15.04,
    reviewStatus: "approved",
    resultUrl: "https://media.example/seedance-2.5.mp4",
    target: {
      timelineItemId: "chorus-3-item",
      sectionId: "chorus-3",
      sectionLabel: "Chorus 3",
      parentMomentId: "hallway-scene",
      songStart: 212.06,
      songEnd: 214.99,
    },
    ...overrides,
  };
}

describe("generated clip approval", () => {
  test("replaces only the exact approved song slot when a source scene repeats", () => {
    const resolved = applyApprovedGeneratedAssets(sourceSegments, [generatedAsset({ trimStart: 1.5 })]);

    expect(resolved[0]).toEqual(sourceSegments[0]);
    expect(resolved[1]).toMatchObject({
      videoUrl: "https://media.example/seedance-2.5.mp4",
      startTime: 1.5,
      label: "seedance_2_5 generated replacement",
      sourceRefLabel: "GEN · seedance_2_5",
      momentId: undefined,
      sourceClipId: undefined,
    });
    expect(resolved[1]?.endTime).toBeCloseTo(4.43, 5);
  });

  test("keeps rejected candidates out and lets the latest approved candidate win", () => {
    const rejected = generatedAsset({
      id: "seedance-2.0",
      model: "seedance_2_0",
      resultUrl: "https://media.example/seedance-2.0.mp4",
      reviewStatus: "rejected",
    });
    const latest = generatedAsset({
      id: "seedance-2.5-latest",
      resultUrl: "https://media.example/seedance-2.5-latest.mp4",
      createdAt: "2026-08-27T19:00:00.000Z",
    });

    const resolved = applyApprovedGeneratedAssets(sourceSegments, [rejected, generatedAsset({}), latest]);

    expect(resolved[1]?.videoUrl).toBe("https://media.example/seedance-2.5-latest.mp4");
  });

  test("auditions a pending candidate in context without approving or mutating the edit", () => {
    const pending = generatedAsset({ reviewStatus: "pending", trimStart: 4.25 });
    const preview = buildGeneratedAssetContextPreview(sourceSegments, pending, 2);

    expect(preview).not.toBeNull();
    expect(preview?.startIndex).toBe(0);
    expect(preview?.endIndex).toBe(1);
    expect(preview?.targetIndex).toBe(1);
    expect(preview?.segments[0]).toEqual(sourceSegments[0]);
    expect(preview?.segments[1]).toMatchObject({
      videoUrl: "https://media.example/seedance-2.5.mp4",
      startTime: 4.25,
      label: "GENERATED CANDIDATE · seedance_2_5 · Chorus 3",
      sourceRefLabel: "PREVIEW GEN · seedance_2_5",
    });
    expect(preview?.segments[1]?.endTime).toBeCloseTo(7.18, 5);
    expect(sourceSegments[1]?.videoUrl).toBe("https://media.example/source.mp4");
  });

  test("clamps an audition trim window to the available generated source", () => {
    const preview = buildGeneratedAssetContextPreview(sourceSegments, generatedAsset({ trimStart: 99 }), 0);

    expect(preview?.segments).toHaveLength(1);
    expect(preview?.segments[0]?.startTime).toBeCloseTo(12.11, 5);
    expect(preview?.segments[0]?.endTime).toBeCloseTo(15.04, 5);
  });

  test("uses the authenticated same-origin media stream for durable generated clips", () => {
    const asset = generatedAsset({
      fullStorage: {
        bucket: "stack-structure",
        objectKey: "media-uploads/github-123/generated/bridge clip.mp4",
        storagePath: "media-uploads/github-123/generated/bridge clip.mp4",
        publicUrl: "https://media.example/bridge.mp4",
        mediaUrl: "https://media.example/files/bridge.mp4",
        mime: "video/mp4",
      },
    });

    expect(buildGeneratedAssetPlaybackUrl(asset)).toBe(
      "/api/storage/media?bucket=stack-structure&objectKey=media-uploads%2Fgithub-123%2Fgenerated%2Fbridge+clip.mp4",
    );
  });
});
