import { expect, test } from "bun:test";
import { replacementBatchRequests } from "@/components/studio/replacementBatch";
import { replacementTargets, applyReplacementOperation } from "@/components/studio/replacementReview";
import { parseH3DraftBatch } from "@/components/studio/h3DraftPlan";
import type { EditPlanPreviewSegment } from "@/components/studio/musicVideoProject";

const segments: EditPlanPreviewSegment[] = [0, 1].map(index => ({ kind: "gap", videoUrl: "", startTime: 0, endTime: 2,
  musicStart: index * 2, musicEnd: index * 2 + 2, sectionId: "verse", label: `A00${index + 1}`,
  timelineItemId: `animatic:A00${index + 1}`, planSignature: "plan", storyDirection: "The room lights move.",
  animaticShotId: `A00${index + 1}`, animaticReferenceAssetIds: ["room"],
  animaticMotion: { shotId: `A00${index + 1}`, bindingSha256: "binding", reviewBindingSha256: "review", imageSha256: "image" } }));
const targets = replacementTargets("project", segments);
const snapshot = { projectId: "project", revision: '"marks-1"', targets,
  marks: applyReplacementOperation([], targets, { action: "mark", keys: targets.map(target => target.key) }, "2026-11-12T00:00:00Z") };

test("replacement preparation preserves exact whole shots and never opts into selection or changes inputs", () => {
  const before = JSON.stringify({ snapshot, segments });
  const requests = replacementBatchRequests("project", snapshot, segments, []);
  expect(requests.map(request => [request.songStart, request.songEnd])).toEqual([[0, 2], [2, 4]]);
  expect(requests.every(request => request.draftRevision === undefined)).toBe(true);
  expect(requests[0].animaticMotion).toEqual(segments[0].animaticMotion);
  expect(JSON.stringify({ snapshot, segments })).toBe(before);
  const batch = { version: 1, projectId: "project", planSignature: "plan", requests, paused: true,
    replacementReview: { revision: snapshot.revision, keys: targets.map(target => target.key) } };
  expect(parseH3DraftBatch(JSON.stringify(batch), "project")?.replacementReview).toEqual(batch.replacementReview);
  expect(parseH3DraftBatch(JSON.stringify({ ...batch, requests: requests.map(request => ({ ...request, draftRevision: 1 })) }), "project")).toBeNull();
});

test("stale project/image/review/shot and ambiguous destinations fail the entire batch without silently dropping marks", () => {
  expect(() => replacementBatchRequests("other", snapshot, segments, [])).toThrow("Refresh");
  for (const changed of [[], segments.slice(1), [...segments, segments[0]], segments.map(segment => ({ ...segment, animaticMotion: { ...segment.animaticMotion!, imageSha256: "changed" } }))]) {
    expect(() => replacementBatchRequests("project", snapshot, changed, [])).toThrow();
  }
  const retained = [{ ...segments[0], animaticRetainedSource: true }, segments[1]];
  expect(() => replacementBatchRequests("project", snapshot, retained, [])).toThrow("retained");
});
