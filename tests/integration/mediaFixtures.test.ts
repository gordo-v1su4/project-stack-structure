import { describe, expect, test } from "bun:test";
import path from "node:path";
import { getMediaFixturesDir, listMediaFixtures } from "../helpers/mediaFixtures";

describe("local media fixtures", () => {
  test("uses .local-fixtures/media as the default local fixture root", () => {
    expect(getMediaFixturesDir()).toBe(path.resolve(process.cwd(), ".local-fixtures/media"));
  });

  test("discovers at least one audio and one video fixture from the local fixture lane", () => {
    const inventory = listMediaFixtures();

    expect(inventory.rootDir).toBe(path.resolve(process.cwd(), ".local-fixtures/media"));
    expect(inventory.audio.length).toBeGreaterThan(0);
    expect(inventory.video.length).toBeGreaterThan(0);
  });
});
