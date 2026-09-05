import { describe, expect, test } from "bun:test";
import { mediaUploadBelongsToOwner, scopeMediaUploadFolder } from "@/lib/essentiaUpload";

describe("essentiaUpload project paths", () => {
  const ownerId = "github-179914528";

  test("recognizes project-scoped media keys as owned", () => {
    expect(mediaUploadBelongsToOwner(
      "media-uploads/projects/github-179914528/pocock-test-run--718023bc/clips/clip.mp4",
      ownerId,
    )).toBe(true);
  });

  test("does not rewrite project-scoped upload folders", () => {
    expect(scopeMediaUploadFolder(
      "media-uploads/projects/github-179914528/pocock-test-run--718023bc/audio",
      ownerId,
    )).toBe("media-uploads/projects/github-179914528/pocock-test-run--718023bc/audio");
  });
});
