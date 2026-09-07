export const STORY_LOGLINE_REVIEW_REQUIRED = "The story service needs its logline-review update before new treatments can be accepted. Your saved stories are unchanged.";
export const STORY_DUPLICATE_PITCH_REVIEW_FAILED = "Story logline review failed: treatment pitches must be distinct; develop different loglines, synopses and visual approaches while preserving the brief.";
const STORY_GENERIC_REVIEW_FAILED = "Story logline review failed: the pitch needs a supported incident, protagonist, goal, opposition and stakes, without revealing the resolution.";

/** Map known gateway diagnostics to fixed public text; never forward provider details. */
export function safeStoryReviewFailureMessage(detail: string): string {
  if (/^Story logline review failed: (faithful|bold|wildcard) repeats an earlier pitch; develop a different logline, synopsis and visualThesis while preserving the brief$/.test(detail)) {
    return STORY_DUPLICATE_PITCH_REVIEW_FAILED;
  }
  return STORY_GENERIC_REVIEW_FAILED;
}

/** Version marker comes from the authenticated gateway after its separate review. */
export function assertStoryLoglineReview(value: unknown): asserts value is { version: 1; status: "passed" } {
  if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1 || !("status" in value) || value.status !== "passed") {
    throw new Error(STORY_LOGLINE_REVIEW_REQUIRED);
  }
}

export function isStoryReviewDeploymentError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(STORY_LOGLINE_REVIEW_REQUIRED);
}
