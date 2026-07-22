import { describe, expect, test } from "bun:test";

import { studioProjectReadSources } from "@/lib/studioProjectStore";

describe("studio project store source ordering", () => {
  test("uses RustFS as the only production read source so stale serverless tmp state cannot hide projects", () => {
    expect(studioProjectReadSources({ NODE_ENV: "production" })).toEqual(["remote"]);
  });

  test("keeps the local-first cache for development", () => {
    expect(studioProjectReadSources({ NODE_ENV: "development" })).toEqual(["local", "remote"]);
  });
});
