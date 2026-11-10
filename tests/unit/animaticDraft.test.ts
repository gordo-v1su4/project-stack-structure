import { expect, test } from "bun:test";
import { reviewedScenePlanningFixture } from "../helpers/sceneProofPlanning";
import { buildStoryDraftSegments } from "@/components/studio/animaticDraft";
import { animaticShotBinding, importStillAnimatic, stillAnimaticShotRequest } from "@/components/studio/stillAnimatic";
import { animaticReviewBinding, reviewAnimatic } from "@/components/studio/animaticReview";
import { parseH3StillRequest } from "@/lib/h3StillRequest";
import { applyApprovedGeneratedAssets, type GeneratedStudioAsset } from "@/components/studio/generatedAssets";
import { createH3PickupWindow, findH3TargetSegment, h3WindowKey, planH3DraftWindows } from "@/components/studio/h3DraftPlan";
import { selectReusedTakePlacement } from "@/components/studio/reusedTakePlacements";

function fixture() {
  const f = reviewedScenePlanningFixture(), input = f.source(), audio = { storageBucket: "studio", storagePath: "media-uploads/github-test/master.wav" };
  const audioUrl = `/api/storage/media?${new URLSearchParams({ bucket: audio.storageBucket, objectKey: audio.storagePath })}`;
  let plan = importStillAnimatic(input, { projectId: input.projectId, fps: 24, masterDuration: 10, totalFrames: 240,
    slots: [0, 1].map(i => ({ id: `A00${i + 1}`, sceneId: input.sceneProofPlan.scenes[i].id, sceneTitle: "Club",
      timelineItemId: input.project.editPlan.timelineItems[0].id, startFrame: i * 120, endFrame: (i + 1) * 120,
      prompt: "[Static] Medium shot. Diego waits inside dark CLUB_MAIN.", referenceAssetIds: ["diego", "club"] })) });
  for (const shot of plan.shots) {
    const binding = animaticShotBinding(plan, shot), jobId = `h3-still-${"b".repeat(64)}`;
    const request = parseH3StillRequest({ shot: stillAnimaticShotRequest(input, plan, shot), animaticShot: binding,
      creativePrompt: shot.prompt, seed: 43, requestIntentId: crypto.randomUUID(), attempt: 0 });
    shot.record = { version: 1, projectId: plan.projectId, context: binding.bindingSha256, request, jobId };
    const image = { bucket: "studio", objectKey: `media-uploads/github-test/${shot.id}.png`, sha256: "c".repeat(64), byteLength: 100, width: 2048, height: 1152 };
    shot.proof = { jobId, descriptorSha256: "d".repeat(64), result: { master: image, native: { ...image, width: 1344, height: 768 }, artifactId: `h3-frame-${"e".repeat(64)}`, artifactSha256: "e".repeat(64) } };
  }
  plan = reviewAnimatic(plan, plan.contextSha256, audioUrl, animaticReviewBinding(plan, plan.contextSha256, audioUrl)!, "approved", "Reviewed");
  f.saved.draft.storyState.stillAnimaticPlan = plan;
  const projection = () => buildStoryDraftSegments({ projectId: input.projectId, project: input.project, videoSources: [],
    referenceAssets: input.references, storyState: f.saved.draft.storyState, audio });
  return { ...f, plan, input, projection, audio };
}

test("Draft projects exact reviewed frame windows without mutating legacy story or claiming footage", () => {
  const f = fixture(), before = JSON.stringify(f.saved), segments = f.projection();
  expect(segments.map(s => [s.timelineItemId, s.musicStart, s.musicEnd])).toEqual([["animatic:A001", 0, 5], ["animatic:A002", 5, 10]]);
  expect(segments.every(s => s.kind === "gap" && !s.videoUrl && s.animaticMotion && s.planSignature)).toBe(true);
  expect(segments[0].animaticFirstFrame?.artifactId).toBe(f.plan.shots[0].proof!.result.artifactId);
  expect(JSON.stringify(f.saved)).toBe(before);
  expect(() => createH3PickupWindow(segments[0], 3)).toThrow("complete frame window");
  expect(createH3PickupWindow(segments[0], 5).musicEnd).toBe(5);
  expect(planH3DraftWindows(segments)).toEqual(segments);
  expect(planH3DraftWindows([{ ...segments[0], musicEnd: 13 }])).toEqual([]);
  expect(() => selectReusedTakePlacement({ planSignature: segments[0].planSignature!, revision: 1, assetIds: [] }, f.input.project,
    {} as GeneratedStudioAsset, segments[0])).toThrow("source-trim review support");
});

test("a stale review keeps every cut visible but removes generation and candidate eligibility", () => {
  const f = fixture(), original = f.projection()[0];
  f.audio.storagePath += ".changed";
  const stale = f.projection(); expect(stale).toHaveLength(2);
  expect(stale.every(s => !s.planSignature && !s.animaticMotion && !s.animaticFirstFrame)).toBe(true);
  expect(stale[0].musicEnd).toBe(original.musicEnd);
});

test("candidate overlays and recovery require the exact reviewed image binding, even for identical shot IDs/times", () => {
  const f = fixture(), segments = f.projection(), first = segments[0];
  const target = { planSignature: first.planSignature, timelineItemId: first.timelineItemId!, sectionId: first.sectionId,
    sectionLabel: first.label, songStart: first.musicStart, songEnd: first.musicEnd, animaticMotion: first.animaticMotion };
  const asset: GeneratedStudioAsset = { id: "candidate", provider: "editorial", model: "fixture", prompt: "", createdAt: new Date().toISOString(),
    status: "completed", mediaKind: "video", durationSeconds: 5, reviewStatus: "approved", target,
    fullStorage: { bucket: "studio", storagePath: "media-uploads/github-test/clip.mp4", objectKey: "media-uploads/github-test/clip.mp4", mime: "video/mp4", publicUrl: "https://media.test/clip.mp4" } };
  expect(applyApprovedGeneratedAssets(segments, [asset])[0].kind).toBe("source");
  expect(findH3TargetSegment(segments, target)?.musicEnd).toBe(5);
  const oldKey = h3WindowKey(first), changed = { ...first, animaticMotion: { ...first.animaticMotion!, imageSha256: "f".repeat(64) } };
  expect(h3WindowKey(changed)).not.toBe(oldKey);
  expect(findH3TargetSegment([changed], target)).toBeNull();
  expect(applyApprovedGeneratedAssets([changed], [asset])[0].kind).toBe("gap");
  delete asset.target!.animaticMotion;
  expect(applyApprovedGeneratedAssets(segments, [asset])[0].kind).toBe("gap");
});

test("retained stills remain explicit source-placement gaps and a project without an animatic keeps legacy windows", () => {
  const f = fixture(), shot = f.plan.shots[1], image = shot.proof!.result.master;
  delete shot.record; delete shot.proof; shot.sourceFrame = { sourceId: 1, sourceSecond: 2, sourceSha256: "a".repeat(64), image };
  delete f.plan.review;
  const segments = f.projection(); expect(segments[1].animaticRetainedSource).toBe(true); expect(segments[1].videoUrl).toBe("");
  delete f.saved.draft.storyState.stillAnimaticPlan;
  expect(f.projection().every(s => !s.animaticShotId)).toBe(true);
});
