import { expect, mock, test } from "bun:test";
import { H3RecoverableReadError } from "@/lib/h3AutomaticRecovery";
import { H3PreparationReadTimeout } from "@/lib/h3PreparationRead";

type HookInput = { payload: { h3Job?: { mode?: string } }; error: unknown; ctx: { attempt: { number: number } } };
let definition: { retry: { maxAttempts: number; minTimeoutInMs: number; maxTimeoutInMs: number }; catchError: (input: HookInput) => unknown };
const stages: string[] = [];
mock.module("@trigger.dev/sdk", () => ({
  task: (value: typeof definition) => { definition = value; return value; },
  queue: (value: unknown) => value, AbortTaskRunError: class extends Error {}, logger: {}, wait: {},
}));
mock.module("@/trigger/workMetadata", () => ({ markWorkRunning: (_stage: string, label: string) => { stages.push(label); }, markWorkCompleted: () => {} }));
await import("@/trigger/localGeneration");

test("actual task retries only typed replay-safe H3 reads and preserves generic generation's one-attempt default", () => {
  expect(definition.retry).toMatchObject({ maxAttempts: 1, minTimeoutInMs: 60_000, maxTimeoutInMs: 300_000 });
  const input = { payload: { h3Job: {} }, error: new H3RecoverableReadError("offline"), ctx: { attempt: { number: 1 } } };
  expect(definition.catchError(input)).toBe(undefined);
  expect(definition.catchError({ ...input, error: new H3PreparationReadTimeout("pinned read") })).toBe(undefined);
  expect(stages.at(-1)).toContain("generation is not repeated");
  for (const error of [new Error("submission response lost"), new Error("review rejected"), new TypeError("unexpected program error")]) {
    expect(definition.catchError({ ...input, error })).toEqual({ skipRetrying: true });
  }
  expect(definition.catchError({ ...input, payload: {} })).toEqual({ skipRetrying: true });
  expect(definition.catchError({ ...input, payload: { h3Job: { mode: "identity-recheck" } } })).toEqual({ skipRetrying: true });
});
