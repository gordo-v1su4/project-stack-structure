import { afterEach, describe, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import { generationScopeSha256 } from "@/components/studio/generationScope";
import type { PersistedStudioProjectDraft } from "@/components/studio/projectPersistence";
const audio = new Uint8Array([1, 2, 3]), video = new Uint8Array([4, 5, 6, 7]);
const keys = ["media-uploads/github-test/master.wav", "media-uploads/github-test/video.mp4"];
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const certificate = { ownerId: "github-test", projectId: "project-1", objects: keys.map((key, index) => ({ id: index ? "video:0" : "master",
  keySha256: generationScopeSha256(["studio", key]), byteLength: index ? video.length : audio.length, sha256: hash(index ? video : audio) })) };
mock.module("../../config/r31-source-media-bootstrap.json", () => ({ default: certificate }));
let objects = new Map(keys.map((key, index) => [key, { bytes: index ? video : audio, etag: '"original"' }]));
let mode = "normal", calls: Record<string, unknown>[] = [], transient = 0;
class GetObjectCommand { constructor(public input: Record<string, unknown>) {} }
const failure = (code: number, name = "SyntheticStorageError") => Object.assign(new Error("Synthetic storage rejection"), { name, $metadata: { httpStatusCode: code } });
class S3Client {
  destroy() {}
  async send(command: GetObjectCommand) {
    const input = command.input; calls.push({ ...input });
    if (mode === "signature" && transient++ === 0) throw failure(403, "SignatureDoesNotMatch");
    if (mode === "unrelated403") throw failure(403, "AccessDenied");
    const object = objects.get(String(input.Key)); if (!object) throw failure(404);
    if (input.IfMatch && input.IfMatch !== object.etag) throw failure(412);
    if (input.Range) return { $metadata: { httpStatusCode: mode === "ignored range" ? 200 : 206 }, ETag: mode === "returned ETag" ? '"wrong"' : object.etag,
      ContentRange: mode === "wrong ContentRange" ? `bytes 1-1/${object.bytes.length}` : `bytes 0-0/${object.bytes.length}`,
      ContentLength: mode === "wrong ContentLength" ? 2 : 1,
      Body: { transformToByteArray: async () => mode === "short metadata body" ? new Uint8Array() : object.bytes.slice(0, 1), destroy() {} } };
    let bytes = object.bytes;
    if (mode === "wrong full SHA") bytes = new Uint8Array(bytes.length).fill(99);
    if (mode === "short full body") bytes = bytes.slice(0, -1);
    if (mode === "overrun full body") bytes = new Uint8Array([...bytes, 88]);
    return { $metadata: { httpStatusCode: 200 }, ETag: object.etag, ContentLength: object.bytes.length,
      Body: { async *[Symbol.asyncIterator]() { yield bytes; }, destroy() {} } };
  }
}
mock.module("@aws-sdk/client-s3", () => ({ S3Client, GetObjectCommand }));
const actualMediaGateway = await import("@/lib/mediaGateway");
mock.module("@/lib/mediaGateway", () => ({ ...actualMediaGateway, getMediaGatewayConfig: () => ({ bucket: "studio" }) }));
const { bootstrapR31SourceMedia, generationScopeMediaDescriptors, pinGenerationScopeMedia, verifyGenerationScopeMedia } = await import("@/lib/generationScopeMedia");
process.env.RUSTFS_S3_ENDPOINT = "https://storage.test"; process.env.RUSTFS_ACCESS_KEY = "synthetic-access"; process.env.RUSTFS_SECRET_KEY = "synthetic-secret";
function fixture(): PersistedStudioProjectDraft {
  return { version: 3, savedAt: "fixed", analysis: { sourceLabel: "Master", duration: 1, storageBucket: "studio", storagePath: keys[0], mediaKey: "master", waveform: [], beats: [], onsets: [], energy: [], sections: [] },
    videoSources: [{ id: 0, name: "Video", size: 4, duration: 1, storageBucket: "studio", storagePath: keys[1], mediaKey: "video", thumbnailUrl: "" }], musicVideoProject: null,
    storyState: { vocalStemName: "", transcriptSummary: null, storyBeats: [], activeBeatId: "", storyGenerated: false } };
}
afterEach(() => { mode = "normal"; transient = 0; calls = []; objects = new Map(keys.map((key, index) => [key, { bytes: index ? video : audio, etag: '"original"' }])); });
describe("conditional source media version and trusted legacy byte transport", () => {
  test("new baseline pins metadata only; existing versions use exact conditional one-byte reads", async () => {
    const draft = fixture(), versions = await pinGenerationScopeMedia("github-test", draft);
    expect(calls.every(input => input.Range === "bytes=0-0" && !input.IfMatch)).toBe(true);
    calls = [];
    expect(await verifyGenerationScopeMedia("github-test", draft, versions)).toEqual(versions);
    expect(calls.every(input => input.Range === "bytes=0-0" && input.IfMatch === '"original"')).toBe(true);
  });
  test("legacy bootstrap trusts current ETags only after the exact historical complete SHA matches", async () => {
    const versions = await bootstrapR31SourceMedia("github-test", "project-1", fixture());
    expect(versions.map(value => value.sha256)).toEqual([hash(audio), hash(video)]);
    expect(calls.filter(input => !input.Range).every(input => input.IfMatch === '"original"')).toBe(true);
  });
  test("412 and unrelated403 never fall back to an unconditional read", async () => {
    const versions = await pinGenerationScopeMedia("github-test", fixture()); calls = [];
    objects.get(keys[0])!.etag = '"replacement"';
    await expect(verifyGenerationScopeMedia("github-test", fixture(), versions)).rejects.toThrow();
    expect(calls.every(input => input.IfMatch === '"original"')).toBe(true);
    mode = "unrelated403"; calls = [];
    await expect(verifyGenerationScopeMedia("github-test", fixture(), versions)).rejects.toThrow();
    expect(calls.every(input => input.IfMatch === '"original"')).toBe(true);
  });
  test("only SignatureDoesNotMatch retries the identical Range/IfMatch command once", async () => {
    const draft = fixture(); draft.videoSources = [];
    const versions = await pinGenerationScopeMedia("github-test", draft); calls = []; mode = "signature";
    await verifyGenerationScopeMedia("github-test", draft, versions);
    expect(calls.length).toBe(2); expect(calls[0]).toEqual(calls[1]);
  });
  for (const failureMode of ["ignored range", "wrong ContentRange", "wrong ContentLength", "returned ETag", "short metadata body"]) {
    test(`rejects ${failureMode} metadata`, async () => {
      const versions = await pinGenerationScopeMedia("github-test", fixture()); mode = failureMode;
      await expect(verifyGenerationScopeMedia("github-test", fixture(), versions)).rejects.toThrow();
    });
  }
  for (const failureMode of ["wrong full SHA", "short full body", "overrun full body"]) {
    test(`rejects trusted legacy ${failureMode}`, async () => {
      mode = failureMode;
      await expect(bootstrapR31SourceMedia("github-test", "project-1", fixture())).rejects.toThrow();
    });
  }
  test("ordered chunks are individually bound; changed owner, extra objects and missing version maps fail before media reads", async () => {
    const draft = fixture();
    draft.videoSources[0].uploadChunks = { size: 4, chunks: [{ bucket: "studio", objectKey: keys[1] }, { bucket: "studio", objectKey: "media-uploads/github-test/part-1" }] };
    expect(generationScopeMediaDescriptors("github-test", draft).map(value => value.id)).toEqual(["master", "video:0:chunk:0", "video:0:chunk:1"]);
    draft.videoSources[0].uploadChunks.chunks[0].objectKey = "media-uploads/another-user/video.mp4";
    expect(() => generationScopeMediaDescriptors("github-test", draft)).toThrow();
    const huge = fixture(); huge.videoSources = Array.from({ length: 128 }, (_, index) => ({ ...huge.videoSources[0], id: index }));
    expect(() => generationScopeMediaDescriptors("github-test", huge)).toThrow();
    await expect(verifyGenerationScopeMedia("github-test", fixture(), [])).rejects.toThrow();
    await expect(bootstrapR31SourceMedia("another-user", "project-1", fixture())).rejects.toThrow();
    expect(calls.length).toBe(0);
  });
});
