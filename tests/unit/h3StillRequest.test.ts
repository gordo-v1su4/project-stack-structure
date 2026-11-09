import { describe, expect, test } from "bun:test";
import { h3ProjectFixture } from "../helpers/h3Project";
import { H3RequestError, materializeH3Job, parseH3Request } from "@/lib/h3GenerationServer";
import { buildH3StillDescriptor, parseH3StillRequest } from "@/lib/h3StillRequest";
import { compileH3Prompt } from "@/lib/h3Workflow";

function fixture() {
  const f = h3ProjectFixture();
  const shot = parseH3Request({ ...f.request, attempt: 2, seed: 77 });
  const job = materializeH3Job(f.saved.project.ownerId, f.saved, shot, "studio");
  job.references.forEach((reference, index) => { reference.etag = `etag-${index}`; });
  const receipts = job.references.map((reference, index) => ({ assetId: reference.assetId, etag: reference.etag!, rawSha256: String(index + 1).repeat(64) }));
  const request = { shot, creativePrompt: "[Static] Medium shot. Diego stands beside the CLUB_MAIN doorway.", seed: 4102,
    requestIntentId: "a0c4aba6-2c57-4cc8-a510-2cb7f9bf5fae", attempt: 0 };
  return { ...f, shot, job, receipts, request };
}

describe("canonical H3 still request admission", () => {
  test("still prose uses the actual five-frame conditioning budget without changing the future video", () => {
    const f = fixture(), before = structuredClone(f.job);
    const creativePrompt = "[Static] Medium shot. Diego stands beside CLUB_MAIN as amber reflections cross the doorway and distant warm light illuminates the stone floor and hanging fixtures beside the raised platform while colorful beams reveal the surrounding columns and open passage toward the rear wall.";
    const parsed = parseH3StillRequest({ ...f.request, creativePrompt });
    expect(() => compileH3Prompt({ ...f.job, request: { ...f.job.request, prompt: creativePrompt } })).not.toThrow();
    expect(() => buildH3StillDescriptor(parsed, f.job, f.receipts)).toThrow("still entry scene failed");
    expect(f.job).toEqual(before);
  });
  test("preserves frozen video intent and derives official still prose, ordered raw references and canonical target", () => {
    const f = fixture(), before = structuredClone(f.job);
    const parsed = parseH3StillRequest(f.request), descriptor = buildH3StillDescriptor(parsed, f.job, f.receipts);
    expect(descriptor.body.prompt).toBe(compileH3Prompt({ ...f.job, request: { ...f.job.request, prompt: f.request.creativePrompt } }).prompt);
    expect(descriptor.body.prompt).toContain("Diego from <Picture 1>");
    expect(descriptor.body.prompt).toContain("CLUB_MAIN from <Picture 2>");
    expect(descriptor.body.references.map(reference => [reference.assetId, reference.version, reference.etag, reference.rawSha256]))
      .toEqual(f.job.references.map((reference, i) => [reference.assetId, reference.version, reference.etag, f.receipts[i].rawSha256]));
    expect(descriptor.body.target).toEqual({ timelineItemId: f.job.target.timelineItemId, sectionId: f.job.target.sectionId,
      songStart: f.job.target.songStart, songEnd: f.job.target.songEnd });
    expect(descriptor.body.seed).toBe(4102); expect(parsed.shot.seed).toBe(77);
    expect(parsed.attempt).toBe(0); expect(parsed.shot.attempt).toBe(2);
    expect(parsed.requestIntentId).not.toBe(parsed.shot.requestIntentId);
    expect(f.job).toEqual(before);
    f.request.shot.referenceAssetIds.reverse(); expect(parsed.shot.referenceAssetIds).toEqual(["diego", "club"]);
  });

  test("rejects browser workflow/path fields, conditioning and noncanonical intent/budget values", () => {
    const changes = [
      (value: Record<string, unknown>) => { value.workflow = {}; },
      (value: Record<string, unknown>) => { value.providerPath = "local.png"; },
      (value: Record<string, unknown>) => { (value.shot as Record<string, unknown>).workflow = {}; },
      (value: Record<string, unknown>) => { (value.shot as Record<string, unknown>).conditioning = undefined; },
      (value: Record<string, unknown>) => { value.creativePrompt = "😀".repeat(1501); },
      (value: Record<string, unknown>) => { value.creativePrompt = " Prompt "; },
      (value: Record<string, unknown>) => { value.creativePrompt = "[Shot 1] Diego stands."; },
      (value: Record<string, unknown>) => { value.creativePrompt = "Diego\0stands"; },
      (value: Record<string, unknown>) => { value.requestIntentId = "A0C4ABA6-2C57-4CC8-A510-2CB7F9BF5FAE"; },
      (value: Record<string, unknown>) => { value.seed = 0x100000000; },
      (value: Record<string, unknown>) => { value.seed = -1; },
      (value: Record<string, unknown>) => { value.attempt = 3; },
      (value: Record<string, unknown>) => { value.attempt = true; },
    ];
    for (const change of changes) {
      const value = structuredClone(fixture().request) as unknown as Record<string, unknown>; change(value);
      expect(() => parseH3StillRequest(value)).toThrow();
    }
  });

  test("rejects changed future video authority, reference order, etag, digest and target", () => {
    const f = fixture(), parsed = parseH3StillRequest(f.request);
    for (const change of [
      (job: typeof f.job) => { job.request.prompt += " Another video action."; },
      (job: typeof f.job) => { job.request.attempt = 1; },
      (job: typeof f.job) => { job.request.requestIntentId = f.request.requestIntentId; },
      (job: typeof f.job) => { job.target.songEnd = 4; },
      (job: typeof f.job) => { job.references.reverse(); },
      (job: typeof f.job) => { job.references[0].etag = "changed"; },
      (job: typeof f.job) => { job.references[0].version = ""; },
      (job: typeof f.job) => { job.referenceHashes = ["a".repeat(64), "b".repeat(64)]; },
      (job: typeof f.job) => { job.referenceHashes = [...f.receipts.map(receipt => receipt.rawSha256), "a".repeat(64)]; },
    ]) { const job = structuredClone(f.job); change(job); expect(() => buildH3StillDescriptor(parsed, job, f.receipts)).toThrow(); }
    const wrong = structuredClone(f.receipts); wrong[0].rawSha256 = "invalid";
    expect(() => buildH3StillDescriptor(parsed, f.job, wrong)).toThrow();
    expect(() => buildH3StillDescriptor(parsed, f.job, f.receipts.slice(1))).toThrow();
  });

  test("keeps native names and aesthetic restrictions and fails positive prose admission", () => {
    const f = fixture();
    f.job.references[1].aesthetic = { purpose: "style", guidance: "Use warm amber lighting.", originalSha256: "c".repeat(64) };
    const descriptor = buildH3StillDescriptor(parseH3StillRequest(f.request), f.job, f.receipts);
    expect(descriptor.body.prompt).toContain("lighting, lens response, color and atmosphere only");
    expect(descriptor.body.prompt).toContain("Do not transfer people, identity, wardrobe, props or architecture");
    expect(descriptor.body.prompt).toContain("Guidance: Use warm amber lighting.");
    for (const creativePrompt of ["[Static] Medium shot. The man stands beside CLUB_MAIN.",
      "[Static] Medium shot. Diego stands without moving beside CLUB_MAIN."]) {
      expect(() => buildH3StillDescriptor(parseH3StillRequest({ ...f.request, creativePrompt }), f.job, f.receipts)).toThrow();
    }
  });

  test("still retries have independent counters and reuse identical image descriptor without consuming video revisions", () => {
    const f = fixture(), first = buildH3StillDescriptor(parseH3StillRequest(f.request), f.job, f.receipts);
    const retry = parseH3StillRequest({ ...f.request, attempt: 2 });
    expect(buildH3StillDescriptor(retry, f.job, f.receipts)).toEqual(first);
    expect(retry.shot.attempt).toBe(2); expect(f.job.request.attempt).toBe(2);
    const changedSeed = parseH3StillRequest({ ...f.request, seed: 4103 });
    expect(buildH3StillDescriptor(changedSeed, f.job, f.receipts).sha256).not.toBe(first.sha256);
  });

  test("actual JSON serialization replays optional video fields exactly and returns only classified safe admission errors", () => {
    const f = fixture(), parsed = parseH3StillRequest(f.request);
    expect(Object.prototype.hasOwnProperty.call(f.job.request, "requirementId")).toBe(true);
    expect(f.job.request.requirementId).toBe(undefined);
    const replay = parseH3StillRequest(JSON.parse(JSON.stringify(parsed)));
    expect(buildH3StillDescriptor(replay, f.job, JSON.parse(JSON.stringify(f.receipts))))
      .toEqual(buildH3StillDescriptor(parsed, f.job, f.receipts));
    for (const [operation, status] of [
      [() => parseH3StillRequest({ ...f.request, provider: "bad" }), 400],
      [() => buildH3StillDescriptor(parsed, f.job, []), 409],
      [() => buildH3StillDescriptor(parseH3StillRequest({ ...f.request, creativePrompt: "[Static] Medium shot. Diego stands without moving beside CLUB_MAIN." }), f.job, f.receipts), 422],
    ] as const) {
      try { operation(); throw new Error("Expected rejection"); }
      catch (error) { expect(error instanceof H3RequestError).toBe(true); expect((error as H3RequestError).status).toBe(status); }
    }
  });
});
