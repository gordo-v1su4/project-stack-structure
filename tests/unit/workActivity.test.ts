import { describe, expect, test } from "bun:test";

import {
  groupActivityRuns,
  recentActivityRuns,
  summarizeActivityRuns,
  workActivityReconnectDelay,
  workActivityTokenRefreshDelay,
  WORK_ACTIVITY_RETRY_MS,
} from "@/lib/workActivity";
import { workActivityReadScopeForUser, workActivityTagForUser } from "@/lib/workActivityAuth";

describe("work activity", () => {
  test("recent history never buries old running, queued or active child work", () => {
    const items = groupActivityRuns([
      ...Array.from({ length: 40 }, (_, i) => ({ id: `done-${i}`, taskIdentifier: "local-ai-generation", status: i === 39 ? "FAILED" : "COMPLETED", createdAt: new Date(10_000 + i * 1000) })),
      { id: "old-running", taskIdentifier: "local-ai-generation", status: "EXECUTING", createdAt: new Date(1000) },
      { id: "old-queued", taskIdentifier: "local-ai-generation", status: "QUEUED", createdAt: new Date(2000) },
      { id: "parent", taskIdentifier: "media-video-pipeline", status: "COMPLETED", createdAt: new Date(3000) },
      { id: "child", taskIdentifier: "qwen-scene-caption-batch", status: "EXECUTING", metadata: { parentRunId: "parent" }, createdAt: new Date(4000) },
    ]);
    const before = JSON.stringify(items);
    const recent = recentActivityRuns(items);
    expect(recent.visible.map((item) => item.id)).toEqual(["parent", "old-running", "old-queued", "done-39", "done-38", "done-37"]);
    expect(recent.visible[0]?.children[0]?.id).toBe("child");
    expect(recent.visible[3]?.failed).toBe(true);
    expect(recent.hiddenCount).toBe(37);
    expect(items).toHaveLength(43);
    expect(JSON.stringify(items)).toBe(before);
  });
  test("an 80-shot waiting batch cannot bury the current render and next waiting shot", () => {
    const items = groupActivityRuns([
      ...Array.from({ length: 80 }, (_, index) => ({ id: `waiting-${index}`, taskIdentifier: "local-ai-generation",
        status: "QUEUED", createdAt: new Date(2000 + index * 1000) })),
      { id: "rendering", taskIdentifier: "local-ai-generation", status: "EXECUTING", createdAt: new Date(1000) },
    ]);
    const recent = recentActivityRuns(items);
    expect(recent.visible.slice(0, 3).map(item => item.id)).toEqual(["rendering", "waiting-0", "waiting-1"]);
    expect(recent.visible).toHaveLength(81);
    expect(recent.hiddenCount).toBe(0);
  });
  test("scopes realtime reads to exactly the authenticated user tag", () => {
    expect(workActivityTagForUser("github-123")).toBe("user:github-123");
    expect(workActivityReadScopeForUser("github-123")).toEqual({
      read: { tags: ["user:github-123"] },
    });
  });

  test("refreshes a 15 minute credential before it expires", () => {
    expect(workActivityTokenRefreshDelay(15 * 60_000, 0)).toBe(13.5 * 60_000);
  });

  test("backs off authentication failures instead of creating a zero-delay token loop", () => {
    expect(workActivityReconnectDelay("Request failed with status 401")).toBe(WORK_ACTIVITY_RETRY_MS);
    expect(workActivityReconnectDelay("Public access token is invalid")).toBe(WORK_ACTIVITY_RETRY_MS);
  });

  test("groups queued children below their media parent and measures progress", () => {
    const now = Date.parse("2026-07-13T12:10:00Z");
    const items = groupActivityRuns([
      {
        id: "run_parent",
        taskIdentifier: "media-video-pipeline",
        status: "EXECUTING",
        createdAt: "2026-07-13T12:00:00Z",
        startedAt: "2026-07-13T12:01:00Z",
        metadata: { completedItems: 2, totalItems: 4, stageLabel: "Captioning scene batches" },
      },
      {
        id: "run_child",
        taskIdentifier: "qwen-scene-caption-batch",
        status: "COMPLETED",
        createdAt: "2026-07-13T12:02:00Z",
        startedAt: "2026-07-13T12:03:00Z",
        completedAt: "2026-07-13T12:04:00Z",
        metadata: { parentRunId: "run_parent", completedItems: 6, totalItems: 6 },
      },
    ], now);

    expect(items).toHaveLength(1);
    expect(items[0]?.progressPercent).toBe(50);
    expect(items[0]?.queuedMs).toBe(60_000);
    expect(items[0]?.children.map((child) => child.id)).toEqual(["run_child"]);
    expect(items[0]?.children[0]?.progressPercent).toBe(100);
  });

  test("summarizes root runs into complete, active, queued, and failed counts", () => {
    const items = groupActivityRuns([
      { id: "complete", taskIdentifier: "media-video-pipeline", status: "COMPLETED" },
      { id: "active", taskIdentifier: "media-video-pipeline", status: "EXECUTING" },
      { id: "queued", taskIdentifier: "media-video-pipeline", status: "QUEUED" },
      {
        id: "failed",
        taskIdentifier: "media-video-pipeline",
        status: "FAILED",
        metadata: { providerStatus: "running" },
      },
      { id: "canceled", taskIdentifier: "media-video-pipeline", status: "CANCELED" },
      {
        id: "child",
        taskIdentifier: "media-video-scene-detect",
        status: "COMPLETED",
        metadata: { parentRunId: "active" },
      },
    ]);

    expect(summarizeActivityRuns(items)).toEqual({
      completed: 1,
      active: 1,
      queued: 1,
      failed: 2,
      total: 5,
    });
    expect(items.find((item) => item.id === "failed")?.providerStatus).toBe(undefined);
    expect(items.find((item) => item.id === "canceled")?.failed).toBe(true);
  });
});
