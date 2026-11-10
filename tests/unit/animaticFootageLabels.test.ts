import { expect, test } from "bun:test";
import { animaticFootageSongTime } from "@/components/studio/shell/AnimaticFootageLabels";
import { animaticShotColor } from "@/components/studio/AnimaticShotIdentity";
test("footage labels map a mid-song selection's local clock back to original song time", () => {
  const segments = [{ videoUrl: "a", label: "A", startTime: 20, endTime: 23, musicStart: 90 },
    { videoUrl: "b", label: "B", startTime: 7, endTime: 11, musicStart: 93 }];
  expect(animaticFootageSongTime(segments, 0, 1.5)).toBe(91.5);
  expect(animaticFootageSongTime(segments, 1, 4)).toBe(94);
  expect(animaticFootageSongTime(segments, 1, 7)).toBe(97);
  expect(animaticFootageSongTime([{ ...segments[0], musicStart: undefined }], 0, 1)).toBeNull();
});
test("shot colors are stable when other shots complete or order changes", () => {
  expect(animaticShotColor("A001")).toBe("hsl(155.5 58% 24%)");
  expect(animaticShotColor("A002")).not.toBe(animaticShotColor("A001"));
});
