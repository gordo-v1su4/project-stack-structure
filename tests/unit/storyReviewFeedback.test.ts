import { expect, test } from "bun:test";
import { safeStoryReviewFailureMessage, STORY_DUPLICATE_PITCH_REVIEW_FAILED } from "../../src/lib/storyLoglineReview";
import { storyValidationFeedback } from "../../src/components/studio/storyTreatments";

test("specific supported review failures reach both the UI and corrective retry", () => {
  for (const field of ["incident", "protagonist", "goal", "opposition", "stakes"]) {
    for (const verdict of ["contradicted", "unclear"]) {
      const message = safeStoryReviewFailureMessage(`Story logline review failed: treatment 1 ${field} needs expression in the logline and story support (verdict: ${verdict})`);
      expect(message).toContain(`${field} is ${verdict}`);
      expect(storyValidationFeedback(new Error(message))).toContain(`${field} was ${verdict}`);
    }
  }
  expect(safeStoryReviewFailureMessage("Story logline review failed: treatment 1 must avoid revealing its resolution")).toContain("resolution is revealed or unclear");
});

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
    "Story logline review failed: treatment 1 stakes needs expression in the logline and story support (verdict: unclear) secret-value",
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
