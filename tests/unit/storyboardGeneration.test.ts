import { describe, expect, test } from "bun:test";
import { runStoryboardChecks } from "@/components/studio/storyboardChecks";

describe("storyboard review and whole-shot replacement contracts", () => {
  for (const result of runStoryboardChecks()) {
    test(result.label, () => expect(result.passed).toBe(true));
  }
});
