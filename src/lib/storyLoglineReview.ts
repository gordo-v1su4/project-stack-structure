export const STORY_LOGLINE_REVIEW_REQUIRED = "The story service needs its logline-review update before new treatments can be accepted. Your saved stories are unchanged.";

/** Version marker comes from the authenticated gateway after its separate review. */
export function assertStoryLoglineReview(value: unknown): asserts value is { version: 1; status: "passed" } {
  if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1 || !("status" in value) || value.status !== "passed") {
    throw new Error(STORY_LOGLINE_REVIEW_REQUIRED);
  }
}

export function isStoryReviewDeploymentError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(STORY_LOGLINE_REVIEW_REQUIRED);
}
