import { afterEach, describe, expect, mock, test } from "bun:test";
import type { H3GenerationJob } from "@/components/studio/h3Generation";
import type { ProbedMediaFile } from "@/components/studio/mediaProbe";
import { materializeH3Job } from "@/lib/h3GenerationServer";
import { h3ProjectFixture } from "../helpers/h3Project";
import { FakeSwarmSocket } from "../helpers/fakeSwarmSocket";
import { H3_FIRST_FRAME_PROFILE, H3_FIRST_FRAME_PREPARATION, h3FirstFrameBinding } from "@/components/studio/h3FirstFrame";
import { firstFrameArtifactFixture, firstFrameAssessmentFixture } from "../helpers/h3FirstFrame";
import { issuedPolicyFixture } from "../helpers/issuedIdentityPolicy";
import { identityPolicySha256 } from "@/components/studio/issuedIdentityPolicy";

const fixture = h3ProjectFixture();
let job: H3GenerationJob;
const originalFetch = globalThis.fetch;
const originalWebSocket = globalThis.WebSocket;
const originalNow = Date.now;
const originalAbortTimeout = AbortSignal.timeout;
const sockets: FakeSwarmSocket[] = [];
let registrationMode: "normal" | "error" | "close-before-post" | "delayed" = "normal";
let failPromptIdSaveOnce = false;
const previousSwarm = process.env.SWARMUI_URL;
const previousLocal = process.env.LOCAL_SWARMUI_URL;
const uploads: string[] = [];
let persisted = 0;
let preflightCalls = 0;
let allowPolicyPreflight=false,allowStillPreflight=false,stillPreflightCalls=0;
mock.module("@/lib/h3DraftPolicyPreparation", () => ({ prepareH3IdentityPolicy: async () => {
  preflightCalls++;
  if(allowPolicyPreflight){const f=issuedPolicyFixture(job);f.policy.body.generationModel=H3_FIRST_FRAME_PROFILE;f.policy.body.firstFrame=h3FirstFrameBinding(job.firstFrame!);f.policy.sha256=identityPolicySha256(f.policy.body);f.policy.id=`h3-policy-${f.policy.sha256}`;
    return{policy:f.policy,references:f.references.map(raw=>({raw,imagePath:"trusted-local",mime:"image/png",bytes:new Uint8Array([1])}))};}
  throw new Error("Reference preflight needs a clear coherent frontal authority; no GPU render was submitted.");
} }));
mock.module("@/lib/h3FirstFramePreflight",()=>({prepareH3FirstFrame:async(_job:H3GenerationJob,policy:ReturnType<typeof issuedPolicyFixture>["policy"])=>{
  stillPreflightCalls++;if(!allowStillPreflight)throw new Error("The first-frame spatial similarity screen did not pass. No GPU video was submitted.");
  return{artifact:job.firstFrame!,assessment:firstFrameAssessmentFixture(job.firstFrame!,policy),bytes:new Uint8Array([9,8,7])};}}));
const videoProbe = { duration: 124 / 24, primaryVideoStream: { codecName: "h264", width: 1344, height: 768, frameRate: 24 } } as ProbedMediaFile;

mock.module("@/lib/h3JobStore", () => ({
  pinH3JobReferences: async (candidate: H3GenerationJob) => candidate.profile===H3_FIRST_FRAME_PROFILE?{...candidate,references:job.references,id:job.id}:candidate,
  downloadH3ReferenceImage: async () => ({ bytes: new Uint8Array([1, 2, 3]).buffer, mime: "image/png" }),
  readH3Job: async () => structuredClone(job),
  updateH3Job: async (_owner: string, _project: string, _id: string, change: (job: H3GenerationJob) => H3GenerationJob) => {
    const next = change(structuredClone(job));
    if (next.promptId && next.state === "rendering" && failPromptIdSaveOnce) {
      expect(sockets.at(-1)!.closeCalls).toBe(0); failPromptIdSaveOnce = false;
      throw new Error("Durable prompt ID save response lost");
    }
    const newlyPinned = next.promptId && next.promptId !== job.promptId;
    job = next;
    if (newlyPinned && job.state === "rendering" && sockets.length) expect(sockets.at(-1)!.closeCalls).toBe(0);
    if (job.state === "submitting" && registrationMode === "close-before-post") sockets.at(-1)!.disconnect();
    return structuredClone(job);
  },
}));
mock.module("@/lib/studioProjectStore", () => ({ readStudioProject: async () => fixture.saved }));
mock.module("@/lib/mediaGateway", () => ({
  getMediaGatewayConfig: () => ({ bucket: "studio" }),
  downloadMediaGatewayFile: async () => ({ bytes: new Uint8Array([1, 2, 3]).buffer, mime: "image/png" }),
  uploadFileToMediaGateway: async () => {
    persisted++;
    return { bucket: "studio", objectKey: "owned/shot.mp4", storagePath: "owned/shot.mp4", publicUrl: "https://media.example/shot.mp4", mime: "video/mp4" };
  },
}));
mock.module("@/components/studio/mediaProbe", () => ({
  probeMediaFile: async (file: string) => file.endsWith("shot.mp4") ? videoProbe : { primaryVideoStream: { width: 2048, height: 2048 } },
}));
mock.module("@/lib/h3IdentityVerification", () => ({ assessH3Identity: async ({ asset }: { asset: unknown }) => asset }));
const { runH3Generation, findH3ProviderPrompt, validateH3VideoProbe, h3OutputSubfolder } = await import("@/lib/h3GenerationRunner");

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.WebSocket = originalWebSocket;
  Date.now = originalNow;
  AbortSignal.timeout = originalAbortTimeout;
  if (previousSwarm === undefined) delete process.env.SWARMUI_URL; else process.env.SWARMUI_URL = previousSwarm;
  if (previousLocal === undefined) delete process.env.LOCAL_SWARMUI_URL; else process.env.LOCAL_SWARMUI_URL = previousLocal;
});

function setup() {
  job = materializeH3Job("github-test", fixture.saved, structuredClone(fixture.request), "studio");
  process.env.SWARMUI_URL = "http://swarm.test:7861";
  delete process.env.LOCAL_SWARMUI_URL;
  uploads.length = 0; persisted = 0; preflightCalls = 0;
  allowPolicyPreflight=allowStillPreflight=false;stillPreflightCalls=0;
  sockets.length = 0; registrationMode = "normal"; failPromptIdSaveOnce = false;
  globalThis.WebSocket = class extends FakeSwarmSocket {
    constructor(url: string | URL) {
      super(); expect(String(url)).toBe("ws://swarm.test:7861/ComfyBackendDirect/ws"); sockets.push(this);
      queueMicrotask(() => { if (registrationMode !== "delayed") { if (registrationMode === "error") this.error(); else this.register(); } });
    }
  } as unknown as typeof WebSocket;
}
function json(value: unknown) { return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } }); }
function providerFetch(failAfterSubmission = false, providerError = false, acknowledgement: "normal" | "missing" | "diagnostics" = "normal", closeBeforeAck = false) {
  let submissions = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    expect(url.startsWith("http://swarm.test:7861/ComfyBackendDirect/")).toBe(true);
    if (url.endsWith("system_stats")) return json({ system: { comfyui_version: "test" } });
    if (url.endsWith("object_info/MiniMaxH3ReferenceToVideo")) return json({ MiniMaxH3ReferenceToVideo: {} });
    if (url.endsWith("object_info/MiniMaxH3ImageToVideo")) return json({ MiniMaxH3ImageToVideo: {} });
    if (url.endsWith("upload/image")) {
      const form = init!.body as FormData;
      const image = form.get("image") as File;
      uploads.push(`${form.get("subfolder")}/${image.name}`);
      return json({ subfolder: form.get("subfolder"), name: image.name });
    }
    if (url.endsWith("/prompt")) {
      submissions++;
      const submitted = JSON.parse(init!.body as string);
      expect(submitted.client_id).toBe("registered-swarmed-client");
      expect(sockets.at(-1)!.readyState).toBe(1);
      expect(sockets.at(-1)!.closeCalls).toBe(0);
      expect(submitted.extra_data.stack_structure_h3_job).toBe(job.id);
      expect(submitted.prompt.cond.inputs[job.profile===H3_FIRST_FRAME_PROFILE?"first_frame":"ref_images.ref_image_0"]).toEqual(["reference_0", 0]);
      if (closeBeforeAck) sockets.at(-1)!.disconnect();
      if (failAfterSubmission) throw new Error("Connection closed after submission");
      if (acknowledgement === "missing") return json({});
      return json({ prompt_id: "provider-1", ...(acknowledgement === "diagnostics" ? { node_errors: { unused: { message: "unused branch diagnostic" } } } : {}) });
    }
    if (url.includes("history/provider-1")) return json({ "provider-1": { status: { status_str: providerError ? "error" : "success", completed: true }, outputs: { save: { gifs: [{ filename: "shot_00001.mp4", subfolder: `stack-structure\\${job.id}`, type: "output" }] } } } });
    if (url.includes("view?")) return new Response(new Uint8Array([4, 5, 6]), { headers: { "content-type": "video/mp4" } });
    if (url.endsWith("/queue")) return json({ queue_running: [], queue_pending: [] });
    if (url.includes("history?")) return json({});
    throw new Error(`Unexpected provider request ${url}`);
  }) as typeof fetch;
  return () => submissions;
}

describe("durable native H3 execution", () => {
  function setupFirstFrame(){
    setup();job.request.identityPolicyFamily="sface-yunet-foreground-frontal-v2";
    job.firstFrame=firstFrameArtifactFixture(job);job.references=job.firstFrame.body.references;job.profile=H3_FIRST_FRAME_PROFILE;job.conditioningPreparationVersion=H3_FIRST_FRAME_PREPARATION;
    job.request.conditioning={kind:"first-frame",artifactId:job.firstFrame.id,expectedSha256:job.firstFrame.body.pngSha256};allowPolicyPreflight=true;
  }
  test("a failed first-frame screen opens no socket and makes zero provider requests",async()=>{
    setupFirstFrame();let calls=0;globalThis.fetch=(async()=>{calls++;throw new Error("Unexpected provider request");}) as typeof fetch;
    await expect(runH3Generation({ownerId:job.ownerId,projectId:job.projectId,jobId:job.id},"run-1",{wait:async()=>{},stage:()=>{}})).rejects.toThrow("No GPU video");
    expect(stillPreflightCalls).toBe(1);expect(calls).toBe(0);expect(sockets).toHaveLength(0);expect(job.state).toBe("failed");
  });
  test("only a screened native PNG is uploaded for I2VA while raw authority hashes remain separate",async()=>{
    setupFirstFrame();allowStillPreflight=true;const count=providerFetch();
    await runH3Generation({ownerId:job.ownerId,projectId:job.projectId,jobId:job.id},"run-1",{wait:async()=>{},stage:()=>{}});
    expect(count()).toBe(1);expect(uploads).toHaveLength(1);expect(job.conditioningReferenceHashes).toEqual([job.firstFrame!.body.pngSha256]);expect(job.referenceHashes).toHaveLength(2);
    expect(job.firstFrameAssessment?.kind).toBe("single-image");expect(job.compiledPrompt).toContain("integrated_multimodal_description:");expect(job.conditioningPreparations).toBe(undefined);
    expect(sockets[0].closeCalls).toBe(1);expect(job.state).toBe("ready");
  });
  test("unsuitable opted-in references stop before any Swarm request or GPU submission", async () => {
    setup(); job.request.identityPolicyFamily = "sface-yunet-foreground-frontal-v1";
    const originalId = job.id;
    // The in-memory store represents the same explicitly opted-in canonical request.
    const candidate = materializeH3Job(job.ownerId, fixture.saved, job.request, "studio");
    job.id = candidate.id;
    let requests = 0; globalThis.fetch = (async () => { requests++; throw new Error("Provider must not be reached"); }) as typeof fetch;
    await expect(runH3Generation({ ownerId: job.ownerId, projectId: job.projectId, jobId: job.id }, "preflight-run", { wait: async () => {}, stage: () => {} })).rejects.toThrow("no GPU render");
    expect(job.id).not.toBe(originalId); expect(preflightCalls).toBe(1); expect(requests).toBe(0);
    expect(job.state).toBe("failed"); expect(persisted).toBe(0);
  });
  test("hydrates owned images through Swarm, records provider ID, probes and persists a target-bound pending candidate", async () => {
    setup(); const count = providerFetch();
    const result = await runH3Generation({ ownerId: job.ownerId, projectId: job.projectId, jobId: job.id }, "run-1", { wait: async () => {}, stage: () => {} });
    expect(count()).toBe(1);
    expect(uploads).toHaveLength(2);
    expect(persisted).toBe(1);
    expect(job.state).toBe("ready");
    expect(job.promptId).toBe("provider-1");
    expect(job.referenceHashes).toHaveLength(2);
    expect(result.generatedAsset?.reviewStatus).toBe("pending");
    expect(result.generatedAsset?.target).toEqual(job.target);
    expect(sockets).toHaveLength(1); expect(sockets[0].closeCalls).toBe(1);
    // Reattaching to a completed durable job creates neither provider work nor storage duplicates.
    await runH3Generation({ ownerId: job.ownerId, projectId: job.projectId, jobId: job.id }, "run-1", { wait: async () => {}, stage: () => {} });
    expect(count()).toBe(1); expect(persisted).toBe(1);
    expect(sockets).toHaveLength(1);
  });

  test("lost submission response remains unknown and is not automatically repeated", async () => {
    setup(); const count = providerFetch(true);
    const reference = { ownerId: job.ownerId, projectId: job.projectId, jobId: job.id };
    await expect(runH3Generation(reference, "run-1", { wait: async () => {}, stage: () => {} })).rejects.toThrow("Connection closed");
    expect(job.state).toBe("submission_unknown");
    await expect(runH3Generation(reference, "run-1", { wait: async () => {}, stage: () => {} })).rejects.toThrow("not repeated");
    expect(count()).toBe(1); expect(persisted).toBe(0);
    expect(sockets).toHaveLength(1); expect(sockets[0].closeCalls).toBe(1);
  });

  test("registration failure before submitting or a close before POST submits zero and stays a known failure", async () => {
    for (const failure of ["error", "close-before-post"] as const) {
      setup(); registrationMode = failure; const count = providerFetch();
      await expect(runH3Generation({ ownerId: job.ownerId, projectId: job.projectId, jobId: job.id }, "run-1", { wait: async () => {}, stage: () => {} })).rejects.toThrow("no prompt was submitted");
      expect(count()).toBe(0); expect(job.state).toBe("failed"); expect(job.promptId).toBe(undefined); expect(persisted).toBe(0);
      expect(sockets).toHaveLength(1); expect(sockets[0].closeCalls).toBe(1);
    }
  });

  test("no prompt POST occurs while registration is delayed", async () => {
    setup(); registrationMode = "delayed"; const count = providerFetch();
    const run = runH3Generation({ ownerId: job.ownerId, projectId: job.projectId, jobId: job.id }, "run-1", { wait: async () => {}, stage: () => {} });
    const deadline = Date.now() + 1000;
    while (!sockets.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 1));
    expect(sockets).toHaveLength(1); expect(count()).toBe(0); expect(job.state).toBe("preparing");
    sockets[0].register(); await run;
    expect(count()).toBe(1); expect(job.state).toBe("ready");
  });

  test("lost durable ID save closes registration but never repeats the accepted provider submission", async () => {
    setup(); failPromptIdSaveOnce = true; const count = providerFetch();
    const ref = { ownerId: job.ownerId, projectId: job.projectId, jobId: job.id };
    await expect(runH3Generation(ref, "run-1", { wait: async () => {}, stage: () => {} })).rejects.toThrow("ID save response lost");
    expect(job.state).toBe("submission_unknown"); expect(count()).toBe(1); expect(sockets[0].closeCalls).toBe(1);
    await expect(runH3Generation(ref, "run-1", { wait: async () => {}, stage: () => {} })).rejects.toThrow("not repeated");
    expect(count()).toBe(1); expect(sockets).toHaveLength(1);
  });

  test("a valid HTTP acknowledgement remains authoritative if the websocket closes during POST", async () => {
    setup(); const count = providerFetch(false, false, "normal", true);
    await runH3Generation({ ownerId: job.ownerId, projectId: job.projectId, jobId: job.id }, "run-1", { wait: async () => {}, stage: () => {} });
    expect(job.state).toBe("ready"); expect(job.promptId).toBe("provider-1"); expect(count()).toBe(1); expect(sockets[0].closeCalls).toBe(1);
  });

  test("a rendering job resumes by real prompt ID using HTTP without websocket registration or another POST", async () => {
    setup(); const count = providerFetch(); job = { ...job, promptId: "provider-1", state: "rendering" };
    await runH3Generation({ ownerId: job.ownerId, projectId: job.projectId, jobId: job.id }, "run-1", { wait: async () => {}, stage: () => {} });
    expect(job.state).toBe("ready"); expect(count()).toBe(0); expect(sockets).toHaveLength(0);
  });

  test("provider correlation can be recovered from queue and completed history", () => {
    expect(findH3ProviderPrompt("job-a", { queue_running: [[0, "p1", {}, { stack_structure_h3_job: "job-a" }]] }, {})).toBe("p1");
    expect(findH3ProviderPrompt("job-a", {}, { p2: { prompt: [0, "p2", {}, { stack_structure_h3_job: "job-a" }] } })).toBe("p2");
    expect(findH3ProviderPrompt("job-b", {}, { p2: { prompt: [0, "p2", {}, { stack_structure_h3_job: "job-a" }] } })).toBe(undefined);
  });

  test("incompatible returned dimensions or insufficient duration cannot become ready", () => {
    validateH3VideoProbe(videoProbe, 124, 5);
    expect(() => validateH3VideoProbe({ ...videoProbe, duration: 1 }, 124, 5)).toThrow("contract");
    expect(() => validateH3VideoProbe({ ...videoProbe, primaryVideoStream: { ...videoProbe.primaryVideoStream!, width: 832 } }, 124, 5)).toThrow("contract");
  });

  test("Windows output separators normalize only inside the exact job namespace", () => {
    expect(h3OutputSubfolder("stack-structure\\h3-test", "h3-test")).toBe("stack-structure/h3-test");
    for (const unsafe of ["/stack-structure/h3-test", "C:\\stack-structure\\h3-test", "stack-structure/../h3-test", "stack-structure/another-job", "\\\\server\\share"]) {
      expect(() => h3OutputSubfolder(unsafe, "h3-test")).toThrow("invalid output reference");
    }
  });

  test("a dead cancellation worker resumes safely and discards successful or failed provider results", async () => {
    for (const providerError of [false, true]) {
      setup(); const count = providerFetch(false, providerError);
      job = { ...job, state: "cancel_requested", cancelRequestedAt: new Date().toISOString(), promptId: "provider-1" };
      await expect(runH3Generation({ ownerId: job.ownerId, projectId: job.projectId, jobId: job.id }, "cancel-run", { wait: async () => {}, stage: () => {} })).rejects.toThrow("cancellation finalized");
      expect(job.state).toBe("cancelled"); expect(count()).toBe(0); expect(persisted).toBe(0);
    }
  });

  test("cancelling an unknown submission can finish without inventing replacement work", async () => {
    setup(); const count = providerFetch();
    job = { ...job, state: "submission_unknown", cancelRequestedAt: new Date().toISOString() };
    await expect(runH3Generation({ ownerId: job.ownerId, projectId: job.projectId, jobId: job.id }, "cancel-run", { wait: async () => {}, stage: () => {} })).rejects.toThrow("no replacement");
    expect(job.state).toBe("cancelled"); expect(count()).toBe(0);
  });

  test("HTTP 200 without a prompt ID remains unknown and never becomes automatic rerender eligibility", async () => {
    setup(); const count = providerFetch(false, false, "missing");
    const ref = { ownerId: job.ownerId, projectId: job.projectId, jobId: job.id };
    await expect(runH3Generation(ref, "run-1", { wait: async () => {}, stage: () => {} })).rejects.toThrow("without a prompt ID");
    expect(job.state).toBe("submission_unknown");
    await expect(runH3Generation(ref, "run-1", { wait: async () => {}, stage: () => {} })).rejects.toThrow("not repeated");
    expect(count()).toBe(1);
    expect(sockets).toHaveLength(1); expect(sockets[0].closeCalls).toBe(1);
  });

  test("an acknowledged provider ID survives accompanying node diagnostics and is reconciled once", async () => {
    setup(); const count = providerFetch(false, false, "diagnostics");
    await runH3Generation({ ownerId: job.ownerId, projectId: job.projectId, jobId: job.id }, "run-1", { wait: async () => {}, stage: () => {} });
    expect(job.promptId).toBe("provider-1"); expect(job.state).toBe("ready"); expect(count()).toBe(1);
  });

  test("history header/body timeouts and HTTP 503 recover with durable waits and only one prompt POST", async () => {
    for (const failure of ["fetch-timeout", "body-timeout", "http-503"] as const) {
      setup(); const count = providerFetch(), provider = globalThis.fetch, waits: number[] = []; let reads = 0;
      globalThis.fetch = (async (input, init) => {
        if (String(input).includes("history/provider-1") && ++reads === 1) {
          if (failure === "fetch-timeout") throw new DOMException("Timed out", "TimeoutError");
          if (failure === "body-timeout") return { ok: true, json: async () => { throw new DOMException("Timed out", "TimeoutError"); } } as unknown as Response;
          return new Response("temporarily unavailable", { status: 503 });
        }
        return provider(input, init);
      }) as typeof fetch;
      await runH3Generation({ ownerId: job.ownerId, projectId: job.projectId, jobId: job.id }, "run-1", { wait: async seconds => { waits.push(seconds); }, stage: () => {} });
      expect(reads).toBe(2); expect(waits).toEqual([3]); expect(count()).toBe(1); expect(job.state).toBe("ready"); expect(persisted).toBe(1);
    }
  });

  test("persistent status transport failure is bounded and leaves the original submission unknown", async () => {
    setup(); const count = providerFetch(), provider = globalThis.fetch, waits: number[] = []; let reads = 0;
    globalThis.fetch = (async (input, init) => {
      if (String(input).includes("history/provider-1")) { reads++; throw new TypeError("fetch failed"); }
      return provider(input, init);
    }) as typeof fetch;
    await expect(runH3Generation({ ownerId: job.ownerId, projectId: job.projectId, jobId: job.id }, "run-1", { wait: async seconds => { waits.push(seconds); }, stage: () => {} })).rejects.toThrow("temporarily unavailable");
    expect(reads).toBe(5); expect(waits).toEqual([3, 6, 12, 24]); expect(count()).toBe(1);
    expect(job.promptId).toBe("provider-1"); expect(job.state).toBe("submission_unknown"); expect(persisted).toBe(0);
  });

  test("read retries retain the overall render deadline and cap each request to remaining time", async () => {
    setup(); const count = providerFetch(), provider = globalThis.fetch, waits: number[] = [], timeouts: number[] = [], historyTimeouts: number[] = []; let reads = 0, clock = 1000;
    Date.now = () => clock;
    AbortSignal.timeout = milliseconds => { timeouts.push(milliseconds); return originalAbortTimeout(milliseconds); };
    globalThis.fetch = (async (input, init) => {
      if (String(input).includes("history/provider-1")) { reads++; historyTimeouts.push(timeouts.at(-1)!); expect(init?.signal).not.toBe(undefined); throw new DOMException("Timed out", "TimeoutError"); }
      return provider(input, init);
    }) as typeof fetch;
    await expect(runH3Generation({ ownerId: job.ownerId, projectId: job.projectId, jobId: job.id }, "run-1", {
      timeoutSeconds: 10, wait: async seconds => { waits.push(seconds); clock += seconds * 1000; }, stage: () => {},
    })).rejects.toThrow("completion is unknown");
    expect(reads).toBe(3); expect(waits).toEqual([3, 6, 1]); expect(count()).toBe(1); expect(job.state).toBe("submission_unknown");
    expect(historyTimeouts).toEqual([10000, 7000, 1000]);
  });

  test("a cancellation or new run owner during a read backoff cannot accept the recovered output", async () => {
    for (const transition of ["cancel", "new-owner"] as const) {
      setup(); const count = providerFetch(), provider = globalThis.fetch; let reads = 0;
      globalThis.fetch = (async (input, init) => {
        if (String(input).includes("history/provider-1") && ++reads === 1) throw new DOMException("Timed out", "TimeoutError");
        return provider(input, init);
      }) as typeof fetch;
      await expect(runH3Generation({ ownerId: job.ownerId, projectId: job.projectId, jobId: job.id }, "run-1", {
        wait: async () => { if (transition === "cancel") { job.cancelRequestedAt = new Date().toISOString(); job.state = "cancel_requested"; } else job.runId = "new-owner"; }, stage: () => {},
      })).rejects.toThrow(transition === "cancel" ? "cancellation finalized" : "no longer owns");
      expect(count()).toBe(1); expect(persisted).toBe(0); expect(job.state).toBe(transition === "cancel" ? "cancelled" : "rendering");
    }
  });

  test("HTTP 4xx status and malformed JSON fail without read retries", async () => {
    for (const failure of ["http", "json"] as const) {
      setup(); const count = providerFetch(), provider = globalThis.fetch; let reads = 0, waits = 0;
      globalThis.fetch = (async (input, init) => {
        if (String(input).includes("history/provider-1")) { reads++; return new Response(failure === "json" ? "{" : "no access", { status: failure === "json" ? 200 : 401 }); }
        return provider(input, init);
      }) as typeof fetch;
      await expect(runH3Generation({ ownerId: job.ownerId, projectId: job.projectId, jobId: job.id }, "run-1", { wait: async () => { waits++; }, stage: () => {} })).rejects.toThrow();
      expect(reads).toBe(1); expect(waits).toBe(0); expect(count()).toBe(1); expect(job.state).toBe("submission_unknown");
    }
  });

  test("prompt POST transport timeout or HTTP 503 is never retried", async () => {
    for (const failure of ["timeout", "http"] as const) {
      setup(); providerFetch(); const provider = globalThis.fetch; let posts = 0, waits = 0;
      globalThis.fetch = (async (input, init) => {
        if (String(input).endsWith("/prompt")) { posts++; if (failure === "timeout") throw new DOMException("Timed out", "TimeoutError"); return new Response("unavailable", { status: 503 }); }
        return provider(input, init);
      }) as typeof fetch;
      await expect(runH3Generation({ ownerId: job.ownerId, projectId: job.projectId, jobId: job.id }, "run-1", { wait: async () => { waits++; }, stage: () => {} })).rejects.toThrow();
      expect(posts).toBe(1); expect(waits).toBe(0); expect(job.state).toBe("submission_unknown"); expect(persisted).toBe(0);
    }
  });

  test("empty successful history remains unknown through the original deadline, never a failed render", async () => {
    setup(); const count = providerFetch(), provider = globalThis.fetch; let clock = 1000, reads = 0;
    Date.now = () => clock;
    globalThis.fetch = (async (input, init) => {
      if (String(input).includes("history/provider-1")) { reads++; return json({}); }
      return provider(input, init);
    }) as typeof fetch;
    await expect(runH3Generation({ ownerId: job.ownerId, projectId: job.projectId, jobId: job.id }, "run-1", { timeoutSeconds: 7,
      wait: async seconds => { clock += seconds * 1000; }, stage: () => {} })).rejects.toThrow("completion is unknown");
    expect(reads).toBe(3); expect(job.state).toBe("submission_unknown"); expect(count()).toBe(1); expect(persisted).toBe(0);
  });

  test("empty history plus complete empty queues finalizes cancellation without accepting output", async () => {
    setup(); const count = providerFetch(), provider = globalThis.fetch;
    job = { ...job, promptId: "provider-1", state: "cancel_requested", cancelRequestedAt: new Date().toISOString() };
    globalThis.fetch = (async (input, init) => String(input).includes("history/provider-1") ? json({}) : provider(input, init)) as typeof fetch;
    await expect(runH3Generation({ ownerId: job.ownerId, projectId: job.projectId, jobId: job.id }, "cancel-run", { wait: async () => { throw new Error("Should finish cancellation"); }, stage: () => {} })).rejects.toThrow("without accepting output");
    expect(job.state).toBe("cancelled"); expect(count()).toBe(0); expect(persisted).toBe(0);
  });

  test("cancellation read failures and present running prompt never count as provider absence", async () => {
    for (const failure of ["history-timeout", "queue-503", "running", "malformed-queue"] as const) {
      setup(); const count = providerFetch(), provider = globalThis.fetch; let waits = 0, clock = 1000;
      job = { ...job, promptId: "provider-1", state: "cancel_requested", cancelRequestedAt: new Date().toISOString() }; Date.now = () => clock;
      globalThis.fetch = (async (input, init) => {
        if (String(input).includes("history/provider-1")) { if (failure === "history-timeout") throw new DOMException("Timed out", "TimeoutError"); return json({}); }
        if (String(input).endsWith("/queue")) {
          if (failure === "queue-503") return new Response("unavailable", { status: 503 });
          return json(failure === "malformed-queue" ? {} : { queue_pending: [], queue_running: [[0, "provider-1"]] });
        }
        return provider(input, init);
      }) as typeof fetch;
      await expect(runH3Generation({ ownerId: job.ownerId, projectId: job.projectId, jobId: job.id }, "cancel-run", { timeoutSeconds: 1,
        wait: async seconds => { waits++; clock += seconds * 1000; }, stage: () => {} })).rejects.toThrow("completion is unknown");
      expect(waits).toBe(1); expect(job.state).toBe("cancel_requested"); expect(count()).toBe(0); expect(persisted).toBe(0);
    }
  });
});
