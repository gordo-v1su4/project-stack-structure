import { expect, test } from "bun:test";
import { readReviewPreviewContext, reviewPreviewHref, studioReviewHref, readStudioReviewContext, restoredReviewTab } from "@/components/studio/reviewPreviewContext";

test("Preview links carry the focused shot and disjoint song ranges without autoplay or edit instructions", () => {
  const href = reviewPreviewHref("project-1", { shotId: "A013", ranges: [{ start: 30, end: 40 }, { start: 10, end: 20 }] });
  expect(href.startsWith("/preview/project-1?")).toBe(true);
  expect(readReviewPreviewContext(href.slice(href.indexOf("?")))).toEqual({ shotId: "A013", ranges: [{ start: 10, end: 20 }, { start: 30, end: 40 }] });
  expect(href).not.toContain("autoplay");
});

test("return links preserve the exact project, stage and viewing selection without enabling playback or edits", () => {
  const href = studioReviewHref("project-1", { stage: "draft", shotId: "A013", ranges: [{ start: 30, end: 40 }] });
  expect(readStudioReviewContext(href.slice(1))).toEqual({ projectId: "project-1", stage: "draft", shotId: "A013", ranges: [{ start: 30, end: 40 }] });
  expect(href).not.toContain("autoplay");
  expect(readStudioReviewContext("?reviewProject=../../private&stage=draft")).toBe(null);
  expect(readStudioReviewContext("?reviewProject=project-1&stage=export")?.stage).toBe("story");
});

test("invalid and excessive URL ranges cannot become arbitrary media or an unbounded selection", () => {
  expect(readReviewPreviewContext("?shot=../../private&ranges=-1-4,20-10,0-9999,NaN-3,2-4")).toEqual({ shotId: undefined, ranges: [{ start: 2, end: 4 }] });
  const many = Array.from({ length: 50 }, (_, i) => `${i * 3}-${i * 3 + 1}`).join(",");
  expect(readReviewPreviewContext(`?ranges=${many}`).ranges).toHaveLength(32);
  expect(reviewPreviewHref("a/b")).toBe("/preview/a%2Fb");
});

test("explicit return stage survives persisted workflow restore without changing another project", () => {
  expect(restoredReviewTab("project-1", "story", "?reviewProject=project-1&stage=draft")).toBe("generate");
  expect(restoredReviewTab("project-1", "generate", "?reviewProject=project-1&stage=story")).toBe("story");
  expect(restoredReviewTab("other", "review", "?reviewProject=project-1&stage=draft")).toBe("review");
  expect(restoredReviewTab("project-1", "join", "")).toBe("join");
});

test("the exact viewing viewport survives both routes independently from disjoint selection", () => {
  const context = { shotId: "A013", ranges: [{ start: 10, end: 20 }, { start: 40, end: 50 }], viewport: { start: 29.75, end: 43.5 } };
  const href = reviewPreviewHref("project-1", context);
  expect(readReviewPreviewContext(href.slice(href.indexOf("?")))).toEqual(context);
  expect(readStudioReviewContext(studioReviewHref("project-1", context).slice(1))?.viewport).toEqual(context.viewport);
  expect(readReviewPreviewContext("?view=9-2").viewport).toBe(undefined);
  expect(readReviewPreviewContext("?view=0-99999").viewport).toBe(undefined);
});
