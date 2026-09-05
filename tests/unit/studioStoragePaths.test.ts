import { describe, expect, test } from "bun:test";
import {
  buildProjectMediaFolder,
  buildProjectStorageFolder,
  ownerProjectsIndexPath,
  slugifyStorageSegment,
} from "@/lib/studioStoragePaths";

describe("studioStoragePaths", () => {
  test("builds human-readable project folders with a short id suffix", () => {
    expect(buildProjectStorageFolder("github-179914528", "718023bc-8193-4e8c-bf62-173e4e79e709", "Pocock Test Run"))
      .toBe("media-uploads/projects/github-179914528/pocock-test-run--718023bc");
  });

  test("scopes media subfolders under the project folder", () => {
    expect(buildProjectMediaFolder("github-179914528", "718023bc-8193-4e8c-bf62-173e4e79e709", "Pocock Test Run", "clips"))
      .toBe("media-uploads/projects/github-179914528/pocock-test-run--718023bc/clips");
  });

  test("keeps owner index under media-uploads/projects", () => {
    expect(ownerProjectsIndexPath("github-179914528"))
      .toBe("media-uploads/projects/github-179914528/index.json");
  });

  test("slugifies project names for storage segments", () => {
    expect(slugifyStorageSegment("  My Cool MV!! ")).toBe("my-cool-mv");
  });
});
