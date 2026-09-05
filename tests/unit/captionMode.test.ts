import { describe, expect, test } from "bun:test";
import { resolveCaptionMode } from "../../src/components/studio/constants";

// `FAST_CAPTIONS_ENABLED` is read from the environment at import time, so each
// branch loads a fresh copy of the module under its own env value.
async function loadResolver(flag: "0" | "1") {
  const previous = process.env.NEXT_PUBLIC_ENABLE_FAST_CAPTIONS;
  process.env.NEXT_PUBLIC_ENABLE_FAST_CAPTIONS = flag;
  try {
    const mod = await import(`../../src/components/studio/constants?fast=${flag}`);
    return mod.resolveCaptionMode as typeof resolveCaptionMode;
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_ENABLE_FAST_CAPTIONS;
    else process.env.NEXT_PUBLIC_ENABLE_FAST_CAPTIONS = previous;
  }
}

describe("resolveCaptionMode", () => {
  test("defaults to smart when nothing was saved", () => {
    expect(resolveCaptionMode(undefined)).toBe("smart");
  });

  test("keeps smart", () => {
    expect(resolveCaptionMode("smart")).toBe("smart");
  });

  test("drops a restored fast mode when the Fast lane is disabled", async () => {
    const resolve = await loadResolver("0");
    expect(resolve("fast")).toBe("smart");
  });

  test("keeps a restored fast mode when the Fast lane is enabled", async () => {
    const resolve = await loadResolver("1");
    expect(resolve("fast")).toBe("fast");
  });
});
