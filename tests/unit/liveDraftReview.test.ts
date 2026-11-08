import { expect, test } from "bun:test";
import { buildLiveDraftTakes, completeH3ReviewRequest, queueH3ReviewRevision } from "@/components/studio/liveDraftReview";
import { parseH3DraftBatch, type H3DraftBatch } from "@/components/studio/h3DraftPlan";
import type { GeneratedStudioAsset } from "@/components/studio/generatedAssets";
import type { H3GenerationJob } from "@/components/studio/h3Generation";
import { h3ProjectFixture } from "../helpers/h3Project";
import { materializeH3Job } from "@/lib/h3GenerationServer";
import { h3ReviewNotesStorageKey, parseH3ReviewNotes, readH3ReviewNotes, writeH3ReviewNotes } from "@/components/studio/liveDraftReview";

test("an arriving ready take is playable during rendering without selecting or approving it", () => {
  const { saved, request } = h3ProjectFixture();
  const job = materializeH3Job("github-test", saved, request, "studio");
  const asset: GeneratedStudioAsset = { id: "arrived", provider: "swarmui", model: "MiniMax H3", prompt: "A shot",
    createdAt: job.createdAt, status: "completed", mediaKind: "video", resultUrl: "/fixture.mp4", reviewStatus: "pending" };
  const ready = { ...job, state: "ready", result: { asset } } as H3GenerationJob;
  const before = JSON.stringify({ ready, asset });
  expect(buildLiveDraftTakes([], [job], [asset.id])).toEqual([]);
  const takes = buildLiveDraftTakes([], [ready, { ...job, id: "rendering", state: "rendering" }], []);
  expect(takes).toHaveLength(1);
  expect(takes[0]).toMatchObject({ selected: false, playbackUrl: "/fixture.mp4", asset: { reviewStatus: "pending" } });
  expect(JSON.stringify({ ready, asset })).toBe(before);
  expect(buildLiveDraftTakes([{ ...asset, reviewStatus: "rejected" }], [ready], [asset.id])[0].asset.reviewStatus).toBe("rejected");
});

test("pause survives current completion and reload without changing any pending request", () => {
  const { request } = h3ProjectFixture();
  const next = { ...request, requestIntentId: "next", songStart: 3, songEnd: 6 };
  const batch: H3DraftBatch = { version: 1, projectId: request.projectId, planSignature: request.planSignature,
    paused: true, requests: [request, next] };
  const completed = completeH3ReviewRequest(batch);
  expect(completed?.paused).toBe(true);
  expect(parseH3DraftBatch(JSON.stringify(completed), request.projectId)?.requests).toEqual([next]);
  expect(batch.requests).toEqual([request, next]);
});

test("a reviewed revision preserves queued requests and pauses after only the explicit revision", () => {
  const { request } = h3ProjectFixture();
  const next = { ...request, requestIntentId: "next", songStart: 3, songEnd: 6 };
  const batch: H3DraftBatch = { version: 1, projectId: request.projectId, planSignature: request.planSignature,
    paused: true, requests: [next] };
  const revision = { ...request, attempt: 1, prompt: "Revised visible action" };
  const queued = queueH3ReviewRevision(batch, revision);
  const restored = parseH3DraftBatch(JSON.stringify(queued), request.projectId)!;
  expect(restored.requests).toEqual([revision, next]);
  expect(restored.paused).toBe(false);
  expect(completeH3ReviewRequest(restored)).toMatchObject({ paused: true, requests: [next] });
  expect(() => queueH3ReviewRevision({ ...batch, paused: false }, revision)).toThrow(/pause/i);
  expect(() => queueH3ReviewRevision(batch, { ...revision, projectId: "other" })).toThrow(/project|plan/i);
});

test("revision reload preserves its one-request stop and malformed stop markers fail closed", () => {
  const { request } = h3ProjectFixture();
  const queued = queueH3ReviewRevision(null, request);
  expect(parseH3DraftBatch(JSON.stringify(queued), request.projectId)?.pauseAfterRequest).toBe(queued.pauseAfterRequest);
  expect(completeH3ReviewRequest(queued)).toBeNull();
  expect(parseH3DraftBatch(JSON.stringify({ ...queued, pauseAfterRequest: "other:2" }), request.projectId)).toBeNull();
});

test("project-scoped notes reload safely without becoming generation requests", () => {
  expect(h3ReviewNotesStorageKey("one")).not.toBe(h3ReviewNotesStorageKey("two"));
  expect(parseH3ReviewNotes(JSON.stringify({ take: "Keep the opening pose", bad: 42, huge: "a".repeat(6001) })))
    .toEqual({ take: "Keep the opening pose" });
  expect(parseH3ReviewNotes("invalid")).toEqual({});
  const saved = new Map<string, string>();
  const storage = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => { saved.set(key, value); } };
  writeH3ReviewNotes(storage, "one", { take: "Keep the opening pose" });
  expect(readH3ReviewNotes(storage, "one")).toEqual({ take: "Keep the opening pose" });
  expect(readH3ReviewNotes(storage, "two")).toEqual({});
});
