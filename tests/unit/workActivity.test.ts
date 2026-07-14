import { describe, expect, test } from "bun:test";

import { groupActivityRuns, workActivityTokenRefreshDelay } from "@/lib/workActivity";
import { workActivityReadScopeForUser, workActivityTagForUser } from "@/lib/workActivityAuth";

describe("work activity", () => {
  test("scopes realtime reads to exactly the authenticated user tag", () => {
    expect(workActivityTagForUser("github-123")).toBe("user:github-123");
    expect(workActivityReadScopeForUser("github-123")).toEqual({
      read: { tags: ["user:github-123"] },
    });
  });

  test("refreshes a 15 minute credential before it expires", () => {
    expect(workActivityTokenRefreshDelay(15 * 60_000, 0)).toBe(13.5 * 60_000);
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
});
