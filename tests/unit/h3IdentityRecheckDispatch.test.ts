import { describe, expect, mock, test } from "bun:test";
import type { H3GenerationJob } from "@/components/studio/h3Generation";

let owner: string | null = "owner-a";
const sends: Array<{ task: string; payload: Record<string, unknown>; options: Record<string, unknown> }> = [];
const keys: unknown[] = [];
// The test runner executes this SDK-mocking file in its own process.
process.env.TRIGGER_API_URL = "https://trigger.test";
process.env.TRIGGER_SECRET_KEY = "synthetic-test-only";
mock.module("@/auth", () => ({ auth: async () => owner ? { user: { id: owner } } : null }));
mock.module("@trigger.dev/sdk", () => ({ idempotencyKeys: { create: async (key: unknown) => { keys.push(key); return key; } }, runs: {},
  tasks: { trigger: async (task: string, payload: Record<string, unknown>, options: Record<string, unknown>) => {
    sends.push({ task, payload, options }); return { id: "recheck-run" };
  } } }));
const { triggerH3IdentityRecheck } = await import("@/lib/triggerOrchestration");
const job = { id: `h3-${"a".repeat(64)}`, ownerId: "owner-a", projectId: "project-a", request: { prompt: "Saved shot" } } as H3GenerationJob;
const intent = "00000000-0000-4000-8000-000000000001";

describe("CPU identity recheck dispatch", () => {
  test("dispatches existing bytes mode under a distinct deliberate intent", async () => {
    owner = "owner-a"; sends.length = 0; keys.length = 0;
    await triggerH3IdentityRecheck(job, intent);
    expect(keys).toEqual([`h3-identity-${job.id}-${intent}`]);
    expect(sends[0].task).toBe("local-ai-generation");
    expect(sends[0].payload.h3Job).toEqual({ ownerId: "owner-a", projectId: "project-a", jobId: job.id, mode: "identity-recheck" });
    expect(sends[0].options.maxAttempts).toBe(1);
    expect(sends[0].options.tags).toContain("user:owner-a");
  });
  test("rejects anonymous and foreign-owner requests without dispatch", async () => {
    sends.length = 0; owner = null;
    await expect(triggerH3IdentityRecheck(job, intent)).rejects.toThrow("Sign in");
    owner = "owner-b";
    await expect(triggerH3IdentityRecheck(job, intent)).rejects.toThrow("another user");
    expect(sends).toHaveLength(0);
  });
  test("requires an explicit new intent rather than reusing generation idempotency", async () => {
    owner = "owner-a"; sends.length = 0;
    await expect(triggerH3IdentityRecheck(job, "")).rejects.toThrow("intent UUID");
    expect(sends).toHaveLength(0);
  });
});
