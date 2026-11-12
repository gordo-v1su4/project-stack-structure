import { expect, test } from "bun:test";
import { reconcilePreviewSnapshot, type AnimaticPreviewSnapshot } from "@/components/studio/animaticPreviewSnapshot";
import { isProjectWorkActive } from "@/components/studio/projectWorkSnapshot";

function snapshot(projectId = "project"): AnimaticPreviewSnapshot {
  return { projectId, name: "Test", revision: "one", songLabel: "song", audioUrl: "", contextSha256: "context", plan: null,
    cut: { segments: [], fingerprint: "same-cut", selectedVideoCount: 0, availableVideoCount: 0 } };
}

test("take arrivals and approval metadata update without replacing unchanged playback segments", () => {
  const previous = snapshot(), next = snapshot();
  next.revision = "two";
  next.cut!.availableVideoCount = 1;
  next.cut!.coverage = [{ shotId: "A001", availableTakeIds: ["take-one"], selectedVideoCount: 0, approvedTakeCount: 0 }];
  const result = reconcilePreviewSnapshot(previous, next);
  expect(result.cut!.segments).toBe(previous.cut!.segments);
  expect(result.cut!.availableVideoCount).toBe(1);
  expect(result.cut!.coverage).toEqual(next.cut!.coverage);
  expect(result.revision).toBe("two");
  expect(previous.cut!.availableVideoCount).toBe(0);
  next.cut!.fingerprint = "changed-trim";
  expect(reconcilePreviewSnapshot(previous, next)).toBe(next);
  expect(reconcilePreviewSnapshot(snapshot("other-project"), next)).toBe(next);
});

test("unknown or unreadable durable receipts never imply running work", () => {
  for (const state of ["ready", "failed", "cancelled", "unavailable", "submission_unknown", "future-state"]) {
    expect(isProjectWorkActive({ state } as Parameters<typeof isProjectWorkActive>[0])).toBe(false);
  }
  for (const state of ["queued", "preparing", "submitting", "rendering", "persisting", "cancel_requested"]) {
    expect(isProjectWorkActive({ state } as Parameters<typeof isProjectWorkActive>[0])).toBe(true);
  }
});
