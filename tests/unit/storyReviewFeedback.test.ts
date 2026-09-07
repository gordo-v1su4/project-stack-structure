import { expect, test } from "bun:test";
import { safeStoryReviewFailureMessage, STORY_DUPLICATE_PITCH_REVIEW_FAILED } from "../../src/lib/storyLoglineReview";
import { storyValidationFeedback } from "../../src/components/studio/storyTreatments";

test("a gateway duplicate-pitch rejection reaches the corrective authoring prompt", () => {
  const message = safeStoryReviewFailureMessage("Story logline review failed: bold repeats an earlier pitch; develop a different logline, synopsis and visualThesis while preserving the brief");
  expect(message).toBe(STORY_DUPLICATE_PITCH_REVIEW_FAILED);
  const feedback = storyValidationFeedback(new Error(message));
  expect(feedback).toContain("duplicated treatment pitches");
  expect(feedback).toContain("chronology and constraints");
});

test("unknown or extended gateway diagnostics never reach the browser or retry prompt", () => {
  for (const detail of [
    "Story logline review failed: provider credentials secret-value",
    "Story logline review failed: bold repeats an earlier pitch; develop a different logline, synopsis and visualThesis while preserving the brief secret-value",
  ]) {
    const message = safeStoryReviewFailureMessage(detail);
    expect(message).not.toContain("secret-value");
    expect(message).not.toBe(STORY_DUPLICATE_PITCH_REVIEW_FAILED);
    const feedback = storyValidationFeedback(new Error(message));
    expect(feedback).toContain("inciting incident");
    expect(feedback).not.toContain("secret-value");
  }
});
