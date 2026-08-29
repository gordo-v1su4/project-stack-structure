import { describe, expect, test } from "bun:test";

import { resolveRangePointerRatio } from "@/components/studio/rangePointer";

describe("range pointer mapping", () => {
  test("maps the entire visible rail and clamps pointer movement outside it", () => {
    expect(resolveRangePointerRatio({ clientX: 100, left: 100, width: 400 })).toBe(0);
    expect(resolveRangePointerRatio({ clientX: 300, left: 100, width: 400 })).toBe(0.5);
    expect(resolveRangePointerRatio({ clientX: 500, left: 100, width: 400 })).toBe(1);
    expect(resolveRangePointerRatio({ clientX: 40, left: 100, width: 400 })).toBe(0);
    expect(resolveRangePointerRatio({ clientX: 700, left: 100, width: 400 })).toBe(1);
  });

  test("fails safely when the control has no measurable width", () => {
    expect(resolveRangePointerRatio({ clientX: 200, left: 100, width: 0 })).toBe(0);
  });
});
