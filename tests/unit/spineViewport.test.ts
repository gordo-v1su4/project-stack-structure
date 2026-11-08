import { describe, expect, test } from "bun:test";
import { clipSpineRange, getSpineViewport } from "../../src/components/studio/shell/spineViewport";

describe("song-time timeline focus", () => {
  const section = { start: 60, end: 90 };
  const selected = { start: 72, end: 74 };

  test("fit restores the whole song without changing selection or cut boundaries", () => {
    const frozen = Object.freeze({ ...selected });
    expect(getSpineViewport(180, "selected", section, frozen)).toEqual({ start: 71, end: 75 });
    expect(getSpineViewport(180, "fit", section, frozen)).toEqual({ start: 0, end: 180 });
    expect(frozen).toEqual(selected);
  });

  test("section focus shows its exact musical boundaries", () => {
    expect(getSpineViewport(180, "section", section, selected)).toEqual(section);
    expect(clipSpineRange(selected, section)).toEqual({ left: 40, width: 2 / 30 * 100 });
  });

  test("cut focus includes neighboring context and stays within the song", () => {
    expect(getSpineViewport(180, "selected", null, { start: 0, end: 2 })).toEqual({ start: 0, end: 3 });
    expect(getSpineViewport(180, "selected", null, { start: 178, end: 180 })).toEqual({ start: 177, end: 180 });
  });

  test("missing or invalid focus safely returns the full song", () => {
    expect(getSpineViewport(180, "selected", section)).toEqual({ start: 0, end: 180 });
    expect(getSpineViewport(180, "section", { start: 200, end: 210 })).toEqual({ start: 0, end: 180 });
    expect(getSpineViewport(0, "fit")).toEqual({ start: 0, end: 0.001 });
  });

  test("partly visible cuts clip without overlapping edges and offscreen cuts are omitted", () => {
    expect(clipSpineRange({ start: 58, end: 63 }, section)).toEqual({ left: 0, width: 10 });
    expect(clipSpineRange({ start: 87, end: 95 }, section)).toEqual({ left: 90, width: 10 });
    expect(clipSpineRange({ start: 90, end: 95 }, section)).toBeNull();
    expect(clipSpineRange({ start: 0, end: 60 }, section)).toBeNull();
  });
});
