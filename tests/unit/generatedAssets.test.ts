import { describe, expect, test } from "bun:test";

import { approvedGeneratedAssetsCoverPreviewSegment, applyApprovedGeneratedAssets, buildGeneratedAssetContextPreview, buildGeneratedAssetPlaybackUrl, resolveGeneratedAssetTrimFrameControl, resolveGeneratedAssetTrimWindow, type GeneratedStudioAsset } from "@/components/studio/generatedAssets";
import { buildEditPlanPreviewSegments, isPlacementPlanCurrent, prepareApprovedPlacements, type MusicVideoProject, type EditPlanPreviewSegment } from "@/components/studio/musicVideoProject";

const sourceSegments: EditPlanPreviewSegment[] = [
  {
    videoUrl: "https://media.example/source.mp4",
    startTime: 10,
    endTime: 13,
    label: "Hallway pass 1",
    sectionId: "chorus-3",
    planSignature: "plan-v1",
    timelineItemId: "chorus-3-item",
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
    planSignature: "plan-v1",
    timelineItemId: "chorus-3-item",
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
      planSignature: "plan-v1",
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
  test("moves a fixed-duration generated source window and clamps both edges", () => {
    expect(resolveGeneratedAssetTrimWindow({
      trimStart: 4.25,
      sourceDuration: 15.04,
      requiredDuration: 2.93,
    })).toMatchObject({
      sourceDuration: 15.04,
      requiredDuration: 2.93,
      maxTrimStart: 12.11,
      trimStart: 4.25,
      trimEnd: 7.18,
    });

    expect(resolveGeneratedAssetTrimWindow({
      trimStart: 99,
      sourceDuration: 15.04,
      requiredDuration: 2.93,
    })).toMatchObject({
      trimStart: 12.11,
      trimEnd: 15.04,
    });
  });

  test("uses integer frame values so keyboard nudges never stall on rounded seconds", () => {
    expect(resolveGeneratedAssetTrimFrameControl({
      trimStart: 0.767,
      maxTrimStart: 12.11,
    })).toEqual({
      framesPerSecond: 30,
      maxFrame: 363,
      valueFrame: 23,
    });

    expect(resolveGeneratedAssetTrimFrameControl({
      trimStart: 99,
      maxTrimStart: 12.11,
    }).valueFrame).toBe(363);
  });

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

  test("retains legacy or stale returns without applying them to a different story", () => {
    const asset = generatedAsset({});
    for (const planSignature of [undefined, "older-plan"]) {
      const stale = { ...asset, target: { ...asset.target!, planSignature } };
      expect(applyApprovedGeneratedAssets(sourceSegments, [stale])).toEqual(sourceSegments);
      expect(buildGeneratedAssetContextPreview(sourceSegments, stale)).toBeNull();
      expect(approvedGeneratedAssetsCoverPreviewSegment([stale], sourceSegments[1]!)).toBe(false);
    }
    const bound = sourceSegments.map((segment) => ({ ...segment, requirementId: "opening" }));
    expect(applyApprovedGeneratedAssets(bound, [{ ...asset, target: { ...asset.target!, requirementId: "escape" } }])).toEqual(bound);
  });

  test("reconfirming changed reference context cannot revive a return from the old plan", () => {
    const project: MusicVideoProject = { id: "context-project", sourceContextSignature: "refs-v1", song: null, duration: 10,
      lyricChunks: [], storySections: [], videoMoments: [], reviewFindings: [],
      editPlan: { id: "edit", createdAt: "fixed", timelineItems: [{ id: "opening", requirementId: "establish", sectionId: "intro", start: 0, end: 10,
        label: "Opening", prompt: "Jungle cave entrance", lyricChunkIds: [], videoMomentId: null }] } };
    const first = prepareApprovedPlacements({ project, videoSources: [] });
    const asset = generatedAsset({ durationSeconds: 10, target: { planSignature: first.placementPlan!.inputSignature,
      timelineItemId: "opening", requirementId: "establish", sectionId: "intro", sectionLabel: "Intro", songStart: 0, songEnd: 10 } });
    const firstCuts = buildEditPlanPreviewSegments({ project: first, videoSources: [] });
    expect(applyApprovedGeneratedAssets(firstCuts, [asset]).every((segment) => segment.kind === "source")).toBe(true);
    const changed = { ...first, sourceContextSignature: "refs-v2" };
    expect(isPlacementPlanCurrent(changed)).toBe(false);
    const reconfirmed = prepareApprovedPlacements({ project: changed, videoSources: [] });
    expect(isPlacementPlanCurrent(reconfirmed)).toBe(true);
    expect(reconfirmed.placementPlan!.inputSignature).not.toBe(first.placementPlan!.inputSignature);
    const currentCuts = buildEditPlanPreviewSegments({ project: reconfirmed, videoSources: [] });
    expect(applyApprovedGeneratedAssets(currentCuts, [asset])).toEqual(currentCuts);
    expect(buildGeneratedAssetContextPreview(currentCuts, asset)).toBeNull();
  });

  test("a short return fills only its measured subwindow and preserves both remaining gaps", () => {
    const gap: EditPlanPreviewSegment = { ...sourceSegments[0]!, kind: "gap", videoUrl: "", startTime: 0, endTime: 10,
      musicStart: 0, musicEnd: 10, requirementId: "opening" };
    const asset = generatedAsset({ durationSeconds: 2, target: { ...generatedAsset({}).target!, requirementId: "opening", songStart: 3, songEnd: 7 } });
    const resolved = applyApprovedGeneratedAssets([gap], [asset]);
    expect(resolved.map((segment) => [segment.kind, segment.musicStart, segment.musicEnd])).toEqual([
      ["gap", 0, 3], ["source", 3, 5], ["gap", 5, 10],
    ]);
    expect(resolved[1]).toMatchObject({ startTime: 0, endTime: 2 });
    expect(approvedGeneratedAssetsCoverPreviewSegment([asset], gap)).toBe(false);
    expect(approvedGeneratedAssetsCoverPreviewSegment([{ ...asset, durationSeconds: 10, target: { ...asset.target!, songStart: 0, songEnd: 10 } }], gap)).toBe(true);
    expect(resolved.reduce((total, segment) => total + segment.musicEnd - segment.musicStart, 0)).toBe(10);
    expect(resolveGeneratedAssetTrimWindow({ sourceDuration: 2, requiredDuration: 4 }).sourceDuration).toBe(2);
    expect(applyApprovedGeneratedAssets([gap], [{ ...asset, durationSeconds: undefined }])).toEqual([gap]);
    expect(applyApprovedGeneratedAssets([gap], [{ ...asset, status: "failed" }])).toEqual([gap]);
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
