import { describe, expect, test } from "bun:test";

import { isOwnedDraftStoragePath, studioDraftLocalCacheEnabled } from "@/app/api/studio/draft/route";
import { studioProjectLocalCacheEnabled, studioProjectReadSources } from "@/lib/studioProjectStore";

describe("studio project store source ordering", () => {
  test("uses RustFS as the only production read source so stale serverless tmp state cannot hide projects", () => {
    expect(studioProjectReadSources({ NODE_ENV: "production" })).toEqual(["remote"]);
  });

  test("keeps the local-first cache for development", () => {
    expect(studioProjectReadSources({ NODE_ENV: "development" })).toEqual(["local", "remote"]);
  });

  test("never writes Studio caches into Vercel's read-only production bundle", () => {
    const env = { NODE_ENV: "production" };
    expect(studioProjectLocalCacheEnabled(env)).toBe(false);
    expect(studioDraftLocalCacheEnabled(env)).toBe(false);
  });

  test("keeps filesystem caches available for local development", () => {
    const env = { NODE_ENV: "development" };
    expect(studioProjectLocalCacheEnabled(env)).toBe(true);
    expect(studioDraftLocalCacheEnabled(env)).toBe(true);
  });

  test("accepts the timestamped draft path returned by the RustFS upload gateway", () => {
    expect(isOwnedDraftStoragePath(
      "media-uploads/studio-drafts/1787989852482-github-179914528.json",
      "github-179914528",
    )).toBe(true);
  });

  test("rejects draft pointers outside the authenticated user's draft object", () => {
    expect(isOwnedDraftStoragePath(
      "media-uploads/studio-drafts/1787989852482-github-someone-else.json",
      "github-179914528",
    )).toBe(false);
    expect(isOwnedDraftStoragePath(
      "media-uploads/projects/github-179914528/index.json",
      "github-179914528",
    )).toBe(false);
  });
});
