import { expect, test } from "bun:test";
import { animaticReviewBinding, reviewAnimatic } from "@/components/studio/animaticReview";
import type { StillAnimaticPlan } from "@/components/studio/stillAnimatic";
import { animaticShotBinding, importStillAnimatic, stillAnimaticShotRequest } from "@/components/studio/stillAnimatic";
import { reviewedScenePlanningFixture } from "../helpers/sceneProofPlanning";
import { parseH3StillRequest } from "@/lib/h3StillRequest";

function fixture(): StillAnimaticPlan {
  return { version: 1, projectId: "project-1", contextSha256: "a".repeat(64), fps: 24, masterDuration: 10, totalFrames: 240,
    shots: [0, 1].map(i => ({ id: `A00${i + 1}`, sceneId: "S01", title: "Retained shot", sourceTimelineItemId: "old",
      startFrame: i * 120, endFrame: (i + 1) * 120, prompt: "", referenceAssetIds: [], sourceFrame: {
        sourceId: i, sourceSecond: i, sourceSha256: "b".repeat(64), image: { bucket: "studio",
          objectKey: `media-uploads/github-test/${i}.png`, sha256: "c".repeat(64), byteLength: 100, width: 2048, height: 1152 } } })) };
}

test("review binds every exact current image and timing, not the review or archive bookkeeping", () => {
  const plan = fixture(), before = JSON.stringify(plan), context = plan.contextSha256;
  const binding = animaticReviewBinding(plan, context)!;
  expect(binding).toMatch(/^[a-f0-9]{64}$/);
  const next = reviewAnimatic(plan, context, binding, "approved", " Good direction ", "2026-11-10T07:00:00Z");
  expect(next.review?.note).toBe("Good direction"); expect(JSON.stringify(plan)).toBe(before);
  expect(animaticReviewBinding(next, context)).toBe(binding);
  next.priorVersions = [{ ...plan, archivedAt: new Date().toISOString() }];
  expect(animaticReviewBinding(next, context)).toBe(binding);
  const revised = reviewAnimatic(next, context, binding, "revise", "Fix the crowd");
  expect(revised.review?.status).toBe("revise");
  for (const mutate of [(p: StillAnimaticPlan) => { p.shots[0].sourceFrame!.image!.sha256 = "d".repeat(64); },
    (p: StillAnimaticPlan) => { p.shots[1].sourceFrame!.image!.objectKey += ".new"; },
    (p: StillAnimaticPlan) => { p.shots[0].endFrame++; p.shots[1].startFrame++; },
    (p: StillAnimaticPlan) => { p.shots[0].prompt = "Revised direction"; }]) {
    const changed = structuredClone(plan); mutate(changed);
    expect(animaticReviewBinding(changed, context)).not.toBe(binding);
    expect(() => reviewAnimatic(changed, context, binding, "approved", "")).toThrow("changed");
  }
});

test("missing pictures, stale context, malformed partition and invalid review input cannot approve", () => {
  const plan = fixture(), context = plan.contextSha256, binding = animaticReviewBinding(plan, context)!;
  expect(animaticReviewBinding(plan, "d".repeat(64))).toBeNull();
  delete plan.shots[1].sourceFrame!.image;
  expect(animaticReviewBinding(plan, context)).toBeNull();
  expect(() => reviewAnimatic(plan, context, binding, "approved", "")).toThrow();
  const complete = fixture(); complete.shots[1].startFrame++;
  expect(animaticReviewBinding(complete, context)).toBeNull();
  expect(() => reviewAnimatic(fixture(), context, binding, "approved", "x".repeat(2001))).toThrow();
  expect(() => reviewAnimatic(fixture(), context, binding, "approved", "", "bad-date")).toThrow();
});

test("generated images require current saved bindings and a replacement invalidates the viewed decision", () => {
  const f = reviewedScenePlanningFixture(), input = f.source();
  const plan = importStillAnimatic(input, { projectId: input.projectId, fps: 24, masterDuration: 10, totalFrames: 240,
    slots: [0, 1].map(i => ({ id: `A00${i + 1}`, sceneId: input.sceneProofPlan.scenes[i].id,
      sceneTitle: "Club", timelineItemId: input.project.editPlan.timelineItems[0].id, startFrame: i * 120, endFrame: (i + 1) * 120,
      prompt: "[Static] Medium shot. Diego looks through patrons. Dark concrete CLUB_MAIN.", referenceAssetIds: ["diego", "club"] })) });
  for (const shot of plan.shots) {
    const binding = animaticShotBinding(plan, shot), jobId = `h3-still-${"b".repeat(64)}`;
    const request = parseH3StillRequest({ shot: stillAnimaticShotRequest(input, plan, shot), creativePrompt: shot.prompt,
      animaticShot: binding, seed: 43, requestIntentId: crypto.randomUUID(), attempt: 0 });
    shot.record = { version: 1, projectId: plan.projectId, context: binding.bindingSha256, request, jobId };
    const image = fixture().shots[0].sourceFrame!.image!;
    shot.proof = { jobId, descriptorSha256: "c".repeat(64), result: { master: image, native: image,
      artifactId: `h3-frame-${"d".repeat(64)}`, artifactSha256: "d".repeat(64) } };
  }
  const context = plan.contextSha256, binding = animaticReviewBinding(plan, context)!;
  expect(binding).toMatch(/^[a-f0-9]{64}$/);
  const next = reviewAnimatic(plan, context, binding, "approved", "");
  expect(animaticReviewBinding(next, context)).toBe(binding);
  next.shots[1].record!.request.attempt = 1;
  expect(animaticReviewBinding(next, context)).toBe(binding);
  next.shots[0].proof!.descriptorSha256 = "e".repeat(64);
  expect(animaticReviewBinding(next, context)).not.toBe(binding);
  next.shots[0].record!.context = "f".repeat(64);
  expect(animaticReviewBinding(next, context)).toBeNull();
});
