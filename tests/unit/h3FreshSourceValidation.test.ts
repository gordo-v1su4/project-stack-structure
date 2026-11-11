import { afterEach, expect, mock, test } from "bun:test";
import type { H3GenerationJob } from "@/components/studio/h3Generation";
import type { SavedStudioProject } from "@/lib/studioProjectStore";
import { h3ProjectFixture } from "../helpers/h3Project";
import { FakeSwarmSocket } from "../helpers/fakeSwarmSocket";

const fixture = h3ProjectFixture();
const authorized = new WeakSet<SavedStudioProject>();
const reads: SavedStudioProject[] = [], validations: SavedStudioProject[] = [];
const sockets: FakeSwarmSocket[] = [];
let job: H3GenerationJob, changedDuringPreparation = false, changeAfterUpload = false, submissions = 0;
const originalFetch = globalThis.fetch, originalSocket = globalThis.WebSocket;
const originalSetTimeout = globalThis.setTimeout;
let stalledProjectRead = 0;
let releaseProjectRead: (() => void) | undefined;
const previousSwarm = process.env.SWARMUI_URL, previousLocal = process.env.LOCAL_SWARMUI_URL;
const originalScopeModule = await import("@/lib/generationScopeServer");
const originalMediaModule = await import("@/lib/mediaGateway");

class SourceConfirmationError extends Error { readonly status = 409; }
function requireAuthorization(saved: SavedStudioProject) {
  if (!authorized.has(saved)) throw new SourceConfirmationError("Validate the canonical source confirmation before generation.");
  return fixture.request.planSignature;
}
// Model the object-scoped authorization used by issued source confirmations.
// The animatic still gate materializes from the exact snapshot supplied to it.
mock.module("@/lib/generationScopeServer", () => ({
  ...originalScopeModule,
  SourceConfirmationError,
  assertMaterializationGenerationScope: requireAuthorization,
  validateSavedGenerationScope: async (_owner: string, saved: SavedStudioProject) => {
    validations.push(saved);
    if (changedDuringPreparation) throw new SourceConfirmationError("The canonical source confirmation changed during preparation.");
    authorized.add(saved);
    return fixture.request.planSignature;
  },
}));
mock.module("@/lib/h3SceneProofServer", () => ({
  assertH3SceneProofsApproved: async (_owner: string, saved: SavedStudioProject) => { requireAuthorization(saved); },
}));
mock.module("@/lib/studioProjectStore", () => ({ readStudioProject: async () => {
  const saved = structuredClone(fixture.saved); reads.push(saved);
  if (reads.length === stalledProjectRead) await new Promise<void>(resolve => { releaseProjectRead = resolve; });
  return saved;
} }));
mock.module("@/lib/h3JobStore", () => ({
  pinH3JobReferences: async (candidate: H3GenerationJob) => candidate,
  downloadH3ReferenceImage: async () => ({ bytes: new Uint8Array([1, 2, 3]).buffer, mime: "image/png" }),
  readH3Job: async () => structuredClone(job),
  updateH3Job: async (_owner: string, _project: string, _id: string, update: (current: H3GenerationJob) => H3GenerationJob) => {
    job = update(structuredClone(job)); return structuredClone(job);
  },
}));
mock.module("@/lib/mediaGateway", () => ({
  ...originalMediaModule,
  getMediaGatewayConfig: () => ({ bucket: "studio" }),
  downloadMediaGatewayFile: async () => ({ bytes: new Uint8Array([1, 2, 3]).buffer, mime: "image/png" }),
  uploadFileToMediaGateway: async () => ({ bucket: "studio", objectKey: "owned/shot.mp4", publicUrl: "https://media.example/shot.mp4", mime: "video/mp4" }),
}));
mock.module("@/components/studio/mediaProbe", () => ({ probeMediaFile: async (file: string) => file.endsWith("shot.mp4")
  ? { duration: 124 / 24, primaryVideoStream: { codecName: "h264", width: 1344, height: 768, frameRate: 24 } }
  : { primaryVideoStream: { width: 2048, height: 2048 } } }));
mock.module("@/lib/h3IdentityVerification", () => ({ assessH3Identity: async ({ asset }: { asset: unknown }) => asset }));
const { materializeH3Job } = await import("@/lib/h3GenerationServer");
const { runH3Generation } = await import("@/lib/h3GenerationRunner");

afterEach(() => {
  globalThis.fetch = originalFetch; globalThis.WebSocket = originalSocket;
  globalThis.setTimeout = originalSetTimeout;
  releaseProjectRead?.(); releaseProjectRead = undefined;
  if (previousSwarm === undefined) delete process.env.SWARMUI_URL; else process.env.SWARMUI_URL = previousSwarm;
  if (previousLocal === undefined) delete process.env.LOCAL_SWARMUI_URL; else process.env.LOCAL_SWARMUI_URL = previousLocal;
});
const json = (value: unknown) => Response.json(value);
function setup(changeSource = false) {
  reads.length = 0; validations.length = 0; sockets.length = 0; submissions = 0;
  stalledProjectRead = 0; releaseProjectRead = undefined;
  changedDuringPreparation = false; changeAfterUpload = changeSource;
  authorized.add(fixture.saved);
  job = materializeH3Job("github-test", fixture.saved, structuredClone(fixture.request), "studio");
  process.env.SWARMUI_URL = "http://swarm.test:7861"; delete process.env.LOCAL_SWARMUI_URL;
  globalThis.WebSocket = class extends FakeSwarmSocket {
    constructor() { super(); sockets.push(this); queueMicrotask(() => this.register()); }
  } as unknown as typeof WebSocket;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    expect(url.startsWith("http://swarm.test:7861/ComfyBackendDirect/")).toBe(true);
    if (url.endsWith("system_stats")) return json({});
    if (url.endsWith("object_info/MiniMaxH3ReferenceToVideo")) return json({ MiniMaxH3ReferenceToVideo: {} });
    if (url.endsWith("upload/image")) {
      const form = init!.body as FormData, image = form.get("image") as File;
      if (changeAfterUpload) changedDuringPreparation = true;
      return json({ subfolder: form.get("subfolder"), name: image.name });
    }
    if (url.endsWith("/prompt")) { submissions++; return json({ prompt_id: "video-1" }); }
    if (url.includes("history/video-1")) return json({ "video-1": { status: { status_str: "success", completed: true },
      outputs: { save: { gifs: [{ filename: "shot.mp4", subfolder: `stack-structure/${job.id}`, type: "output" }] } } } });
    if (url.includes("view?")) return new Response(new Uint8Array([4, 5, 6]));
    throw new Error(`Unexpected provider request ${url}`);
  }) as typeof fetch;
}

test("fresh project reread is independently authorized before the final motion/still gate and the single GPU POST", async () => {
  setup();
  await runH3Generation({ ownerId: job.ownerId, projectId: job.projectId, jobId: job.id }, "run-1", { wait: async () => {}, stage: () => {} });
  expect(reads).toHaveLength(2); expect(reads[0]).not.toBe(reads[1]);
  expect(validations).toHaveLength(2); expect(validations[0]).toBe(reads[0]); expect(validations[1]).toBe(reads[1]);
  expect(submissions).toBe(1); expect(job.state).toBe("ready"); expect(sockets[0].closeCalls).toBe(1);
});

test("a canonical source change during uploads blocks GPU submission and closes the registered client", async () => {
  setup(true);
  await expect(runH3Generation({ ownerId: job.ownerId, projectId: job.projectId, jobId: job.id }, "run-1",
    { wait: async () => {}, stage: () => {} })).rejects.toThrow("canonical source confirmation changed during preparation");
  expect(validations).toHaveLength(2); expect(submissions).toBe(0);
  expect(job.promptId).toBe(undefined); expect(job.state).toBe("failed"); expect(sockets[0].closeCalls).toBe(1);
});

for (const readNumber of [1, 2]) {
  test(`a stalled project read ${readNumber} releases the worker without a GPU POST, including after late resolution`, async () => {
    setup(); stalledProjectRead = readNumber;
    globalThis.setTimeout = ((handler: Parameters<typeof setTimeout>[0], delay?: number, ...args: unknown[]) =>
      originalSetTimeout(handler, delay === 120_000 ? 5 : delay, ...args)) as typeof setTimeout;
    const stages: string[] = [];
    await expect(runH3Generation({ ownerId: job.ownerId, projectId: job.projectId, jobId: job.id }, "run-1",
      { wait: async () => {}, stage: label => { stages.push(label); } })).rejects.toThrow("H3 preparation read timed out");
    expect(submissions).toBe(0);
    expect(job.promptId).toBe(undefined); expect(job.compiledPrompt).toBe(undefined);
    expect(job.state).toBe(readNumber === 1 ? "queued" : "preparing");
    expect(stages).toContain(readNumber === 1 ? "Reading the saved project before H3 generation" : "Re-reading the project before H3 submission");
    if (readNumber === 2) expect(sockets[0].closeCalls).toBe(1);
    releaseProjectRead!();
    await new Promise(resolve => originalSetTimeout(resolve, 10));
    expect(submissions).toBe(0);
  });
}
