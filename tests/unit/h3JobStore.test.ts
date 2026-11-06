import { afterEach, describe, expect, mock, test } from "bun:test";
import { materializeH3Job } from "@/lib/h3GenerationServer";
import { h3ProjectFixture } from "../helpers/h3Project";

const objects = new Map<string, { body: string; etag: string }>();
let serial = 0, conditionalFailures = 0;
let sourceEtag = "image-version-1";
const originalFetch = globalThis.fetch;
const names = ["RUSTFS_S3_ENDPOINT", "RUSTFS_ACCESS_KEY", "RUSTFS_SECRET_KEY"] as const;
const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
class GetObjectCommand { constructor(public input: Record<string, unknown>) {} }
class HeadObjectCommand { constructor(public input: Record<string, unknown>) {} }
class PutObjectCommand { constructor(public input: Record<string, unknown>) {} }
class ListObjectsV2Command { constructor(public input: Record<string, unknown>) {} }
function failure(code: number) { return Object.assign(new Error(`S3 ${code}`), { $metadata: { httpStatusCode: code } }); }
class S3Client {
  async send(command: GetObjectCommand | HeadObjectCommand | PutObjectCommand | ListObjectsV2Command) {
    const input = command.input;
    const key = String(input.Key);
    if (command instanceof HeadObjectCommand) return { ETag: sourceEtag, ContentLength: 3, ContentType: "image/png" };
    if (command instanceof GetObjectCommand) {
      if (key.endsWith(".png")) {
        if (input.IfMatch !== sourceEtag) throw failure(412);
        return { ContentType: "image/png", ContentLength: 3, Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } };
      }
      const current = objects.get(key);
      if (!current) throw failure(404);
      return { Body: { transformToString: async () => current.body }, ETag: current.etag };
    }
    if (command instanceof PutObjectCommand) {
      const current = objects.get(key);
      if ((input.IfNoneMatch === "*" && current) || (input.IfMatch && input.IfMatch !== current?.etag)) {
        conditionalFailures++; throw failure(412);
      }
      objects.set(key, { body: String(input.Body), etag: `v${++serial}` });
      return {};
    }
    return { Contents: [...objects.keys()].filter(key => key.startsWith(String(input.Prefix))).map(Key => ({ Key })) };
  }
}
mock.module("@aws-sdk/client-s3", () => ({ GetObjectCommand, HeadObjectCommand, PutObjectCommand, ListObjectsV2Command, S3Client }));
mock.module("@/lib/mediaGateway", () => ({ getMediaGatewayConfig: () => ({ bucket: "studio", url: "https://media.example", token: "test-only" }),
  buildMediaGatewayFileUrl: (_config: unknown, bucket: string, key: string) => `https://media.example/files/${bucket}/${key}`,
}));
const { createH3Job, readH3Job, updateH3Job, listH3Jobs, pinH3JobReferences, downloadH3ReferenceImage, claimH3GenerationIntent } = await import("@/lib/h3JobStore");

function setup() {
  objects.clear(); serial = 0; conditionalFailures = 0; sourceEtag = "image-version-1";
  process.env.RUSTFS_S3_ENDPOINT = "https://storage.example";
  process.env.RUSTFS_ACCESS_KEY = "test-only-access";
  process.env.RUSTFS_SECRET_KEY = "test-only-secret";
  globalThis.fetch = (async (url: string | URL | Request, options?: RequestInit) => {
    expect(String(url).startsWith("https://media.example/files/studio/media-uploads/github-test/")).toBe(true);
    expect(options?.method).toBe("HEAD");
    return new Response(null, { headers: { etag: sourceEtag, "content-length": "3", "content-type": "image/png" } });
  }) as typeof fetch;
  const { saved, request } = h3ProjectFixture();
  return materializeH3Job("github-test", saved, request, "studio");
}
afterEach(() => { globalThis.fetch = originalFetch; for (const name of names) { if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name]; } });

describe("conditional durable H3 job records", () => {
  test("identical transport replay cannot reset a rendering job to queued", async () => {
    const job = setup();
    await createH3Job(job);
    await updateH3Job(job.ownerId, job.projectId, job.id, current => ({ ...current, state: "rendering", promptId: "provider-a" }));
    const replay = await createH3Job(job);
    expect(replay.state).toBe("rendering");
    expect(replay.promptId).toBe("provider-a");
    expect(objects.size).toBe(1);
  });

  test("concurrent provider-id and dispatch writes preserve both fields with compare-and-swap", async () => {
    const job = setup(); await createH3Job(job);
    await Promise.all([
      updateH3Job(job.ownerId, job.projectId, job.id, current => ({ ...current, runId: "run-a" })),
      updateH3Job(job.ownerId, job.projectId, job.id, current => ({ ...current, promptId: "provider-a", state: "rendering" })),
    ]);
    const stored = await readH3Job(job.ownerId, job.projectId, job.id);
    expect(stored?.runId).toBe("run-a"); expect(stored?.promptId).toBe("provider-a");
    expect(conditionalFailures).toBeGreaterThan(0);
    expect((await listH3Jobs(job.ownerId, job.projectId)).map(job => job.id)).toEqual([job.id]);
    expect(await listH3Jobs("other-owner", job.projectId)).toEqual([]);
    expect(await readH3Job("other-owner", job.projectId, job.id)).toBeNull();
  });

  test("job identity cannot be changed through a state update or path traversal", async () => {
    const job = setup(); await createH3Job(job);
    await expect(updateH3Job(job.ownerId, job.projectId, job.id, current => ({ ...current, ownerId: "other" }))).rejects.toThrow("immutable");
    await expect(readH3Job(job.ownerId, job.projectId, "../../private")).rejects.toThrow("Invalid generation job");
  });

  test("reference ETags enter job identity and a queued job cannot read overwritten reference bytes", async () => {
    const initial = setup();
    const pinned = await pinH3JobReferences(initial);
    expect(pinned.id).not.toBe(initial.id);
    expect(pinned.references[0].etag).toBe(sourceEtag);
    expect((await pinH3JobReferences(initial)).id).toBe(pinned.id);
    expect((await downloadH3ReferenceImage(pinned.references[0])).bytes.byteLength).toBe(3);
    sourceEtag = "image-version-2";
    expect((await pinH3JobReferences(initial)).id).not.toBe(pinned.id);
    await expect(downloadH3ReferenceImage(pinned.references[0])).rejects.toThrow("412");
  });

  test("one intent/attempt is immutable even if the payload or pinned image changes", async () => {
    const initial = setup();
    await claimH3GenerationIntent(initial);
    await claimH3GenerationIntent(initial);
    const changed = { ...initial, id: `h3-${"a".repeat(64)}` };
    await expect(claimH3GenerationIntent(changed)).rejects.toThrow("already identifies another shot");
    const revision = { ...changed, request: { ...initial.request, attempt: 1 } };
    await expect(claimH3GenerationIntent(revision)).rejects.toThrow("preceding attempt");
    await createH3Job(initial);
    await expect(claimH3GenerationIntent(revision)).rejects.toThrow("preceding attempt");
    await updateH3Job(initial.ownerId, initial.projectId, initial.id, current => ({ ...current, state: "failed" }));
    await claimH3GenerationIntent(revision);
    expect(objects.size).toBe(3); // two intent claims and one original job
  });
});
