import { expect, test } from "bun:test";
import { readReviewPreviewContext, reviewPreviewHref } from "@/components/studio/reviewPreviewContext";

test("Preview links carry the focused shot and disjoint song ranges without autoplay or edit instructions", () => {
  const href = reviewPreviewHref("project-1", { shotId: "A013", ranges: [{ start: 30, end: 40 }, { start: 10, end: 20 }] });
  expect(href.startsWith("/preview/project-1?")).toBe(true);
  expect(readReviewPreviewContext(href.slice(href.indexOf("?")))).toEqual({ shotId: "A013", ranges: [{ start: 10, end: 20 }, { start: 30, end: 40 }] });
  expect(href).not.toContain("autoplay");
});

test("invalid and excessive URL ranges cannot become arbitrary media or an unbounded selection", () => {
  expect(readReviewPreviewContext("?shot=../../private&ranges=-1-4,20-10,0-9999,NaN-3,2-4")).toEqual({ shotId: undefined, ranges: [{ start: 2, end: 4 }] });
  const many = Array.from({ length: 50 }, (_, i) => `${i * 3}-${i * 3 + 1}`).join(",");
  expect(readReviewPreviewContext(`?ranges=${many}`).ranges).toHaveLength(32);
  expect(reviewPreviewHref("a/b")).toBe("/preview/a%2Fb");
});
