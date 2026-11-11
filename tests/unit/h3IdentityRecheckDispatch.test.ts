import { describe, expect, mock, test } from "bun:test";
import type { H3GenerationJob } from "@/components/studio/h3Generation";
import { h3IdentityAssessmentFixture } from "../helpers/h3IdentityAssessment";

let owner: string | null = "owner-a";
const sends: Array<{ task: string; payload: Record<string, unknown>; options: Record<string, unknown> }> = [];
const keys: unknown[] = [];
type WorkerRun = (payload: Record<string, unknown>, context: { ctx: { run: { id: string; tags: string[] } } }) => Promise<unknown>;
const workerRuns = new Map<string, WorkerRun>();
// The test runner executes this SDK-mocking file in its own process.
process.env.TRIGGER_API_URL = "https://trigger.test";
process.env.TRIGGER_SECRET_KEY = "synthetic-test-only";
mock.module("@/auth", () => ({ auth: async () => owner ? { user: { id: owner } } : null }));
mock.module("@trigger.dev/sdk", () => ({ idempotencyKeys: { create: async (key: unknown) => { keys.push(key); return key; } }, runs: {},
  task: (definition: { id: string; run: WorkerRun }) => { workerRuns.set(definition.id, definition.run); return definition; },
  queue: (definition: unknown) => definition, metadata: { set: () => {} }, logger: { info: () => {} },
  AbortTaskRunError: class extends Error {},
  tasks: { trigger: async (task: string, payload: Record<string, unknown>, options: Record<string, unknown>) => {
    sends.push({ task, payload, options }); return { id: "recheck-run" };
  } } }));
const { triggerH3Generation, triggerH3IdentityRecheck, triggerFfmpegPreview, triggerFinalExport, triggerShaderCaptureExport } = await import("@/lib/triggerOrchestration");
const job = { id: `h3-${"a".repeat(64)}`, ownerId: "owner-a", projectId: "project-a", request: { prompt: "Saved shot" } } as H3GenerationJob;
const intent = "00000000-0000-4000-8000-000000000001";

test("H3 recovery keeps the same generation intent and opts into the bounded durable retry budget", async () => {
  owner = "owner-a"; sends.length = 0; keys.length = 0;
  await triggerH3Generation(job); await triggerH3Generation(job);
  expect(sends[0].options.maxAttempts).toBe(8);
  expect(sends[1].options.idempotencyKey).toEqual(sends[0].options.idempotencyKey);
  expect(sends[0].payload.h3Job).toEqual({ ownerId: job.ownerId, projectId: job.projectId, jobId: job.id });
  expect(sends[0].options.tags).toContain("user:owner-a");
  owner = "owner-b";
  await expect(triggerH3Generation(job)).rejects.toThrow("another user");
  expect(sends).toHaveLength(2);
});

describe("authenticated export output dispatch", () => {
  const input = { bucket: "studio", objectKey: "media-uploads/owner-a/input.mp4", fileName: "input.mp4" };
  const final = { requestKey: "final-export-owned-v1-same-export", ownerId: "forged-owner", audio: input, videos: [input],
    segments: [{ startTime: 0, endTime: 1 }] };
  const capture = { requestKey: "final-export-webgpu-owned-v1-same-export", ownerId: "forged-owner", audio: input, shaderCapture: input };
  for (const [label, dispatch] of [["final", () => triggerFinalExport(final)], ["capture", () => triggerShaderCaptureExport(capture)]] as const) {
    test(`${label} export derives owner from session and isolates idempotency across users`, async () => {
      sends.length = 0; owner = "owner-a";
      await dispatch(); await dispatch();
      expect(sends[0].payload.ownerId).toBe("owner-a");
      expect(sends[0].options.tags).toContain("user:owner-a");
      expect((sends[0].options.tags as string[]).filter(tag => tag.startsWith("user:"))).toHaveLength(1);
      expect(sends[1].options.idempotencyKey).toBe(sends[0].options.idempotencyKey);
      owner = "owner-b"; await dispatch();
      expect(sends[2].payload.ownerId).toBe("owner-b");
      expect(sends[2].options.idempotencyKey).not.toBe(sends[0].options.idempotencyKey);
      expect(sends[0].options.maxAttempts).toBe(1);
      expect(final.ownerId).toBe("forged-owner");
      expect(capture.ownerId).toBe("forged-owner");
    });
    test(`${label} export rejects anonymous dispatch`, async () => {
      sends.length = 0; owner = null;
      await expect(dispatch()).rejects.toThrow("Sign in");
      expect(sends).toHaveLength(0);
    });
  }
  test("final export rejects a project snapshot for another owner before queueing", async () => {
    owner = "owner-a"; sends.length = 0;
    await expect(triggerFinalExport({ ...final, projectSnapshot: { ownerId: "owner-b" } as never })).rejects.toThrow("another project owner");
    expect(sends).toHaveLength(0);
  });
  test("legacy or missing request protocols cannot cross into new owner-scoped dedupe keys", async () => {
    owner = "owner-a"; sends.length = 0;
    await expect(triggerFinalExport({ ...final, requestKey: "final-export-legacy-lost-ack" })).rejects.toThrow("The app was updated");
    await expect(triggerShaderCaptureExport({ ...capture, requestKey: "final-export-webgpu-legacy" })).rejects.toThrow("The app was updated");
    await expect(triggerFinalExport({ ...final, requestKey: "" })).rejects.toThrow("The app was updated");
    expect(sends).toHaveLength(0);
  });
  test("both real worker entry points reject foreign/ambiguous/absent owners before invalid inputs can be processed", async () => {
    await import("@/trigger/export");
    for (const taskId of ["ffmpeg-final-music-video-export", "ffmpeg-shader-capture-export"]) {
      const run = workerRuns.get(taskId)!;
      expect(typeof run).toBe("function");
      for (const tags of [[], ["user:foreign"], ["user:owner-a", "user:foreign"]]) {
        await expect(run({ ownerId: "owner-a" }, { ctx: { run: { id: "offline-test", tags } } })).rejects.toThrow("matching authenticated owner");
      }
      await expect(run({}, { ctx: { run: { id: "offline-test", tags: ["user:owner-a"] } } })).rejects.toThrow("authenticated dispatch owner");
      await expect(run({ ownerId: "owner-a", projectSnapshot: { ownerId: "foreign" } },
        { ctx: { run: { id: "offline-test", tags: ["user:owner-a"] } } })).rejects.toThrow("matching authenticated owner");
    }
  });
});

describe("CPU identity recheck dispatch", () => {
  test("carries the immutable range descriptor and refuses a changed range before task dispatch",async()=>{
    const f=h3IdentityAssessmentFixture();owner=f.job.ownerId;sends.length=0;
    await triggerH3IdentityRecheck(f.job,f.scope.requestIntentId,f.scope);
    expect((sends[0].payload.h3Job as {assessment:unknown}).assessment).toEqual(f.scope);
    const before=sends.length;
    await expect(triggerH3IdentityRecheck(f.job,f.scope.requestIntentId,{...f.scope,firstFrame:13})).rejects.toThrow("exact trim");
    expect(sends.length).toBe(before);
  });
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

describe("authenticated preview dispatch", () => {
  const payload = { operation: "concat" as const, requestKey: "same-preview", applicationUserId: "forged-owner",
    inputFiles: [{ bucket: "stack-structure", objectKey: "media-uploads/owner-a/video-source/input.mp4", fileName: "input.mp4" }] };
  test("overrides payload owner claims and keeps idempotency separate across accounts", async () => {
    owner = "owner-a"; sends.length = 0;
    await triggerFfmpegPreview(payload);
    expect(sends[0].payload.applicationUserId).toBe("owner-a");
    expect(sends[0].options.tags).toContain("user:owner-a");
    owner = "owner-b";
    await triggerFfmpegPreview(payload);
    expect(sends[1].payload.applicationUserId).toBe("owner-b");
    expect(sends[1].options.idempotencyKey).not.toBe(sends[0].options.idempotencyKey);
  });
  test("does not dispatch anonymous previews", async () => {
    owner = null; sends.length = 0;
    await expect(triggerFfmpegPreview(payload)).rejects.toThrow("Sign in");
    expect(sends).toHaveLength(0);
  });
});
