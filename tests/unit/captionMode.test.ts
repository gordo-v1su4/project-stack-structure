import { describe, expect, test } from "bun:test";
import { FAST_CAPTIONS_ENABLED, resolveCaptionMode } from "../../src/components/studio/constants";

describe("resolveCaptionMode", () => {
  test("defaults to smart when nothing was saved", () => {
    expect(resolveCaptionMode(undefined)).toBe("smart");
  });

  test("keeps smart", () => {
    expect(resolveCaptionMode("smart")).toBe("smart");
  });

  test("only keeps a restored fast mode when the Fast lane is enabled", () => {
    expect(resolveCaptionMode("fast")).toBe(FAST_CAPTIONS_ENABLED ? "fast" : "smart");
  });
});
