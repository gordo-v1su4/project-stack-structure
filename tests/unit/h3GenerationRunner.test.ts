import { afterEach, describe, expect, mock, test } from "bun:test";
import type { H3GenerationJob } from "@/components/studio/h3Generation";
import type { ProbedMediaFile } from "@/components/studio/mediaProbe";
import { materializeH3Job } from "@/lib/h3GenerationServer";
import { h3ProjectFixture } from "../helpers/h3Project";

const fixture = h3ProjectFixture();
let job: H3GenerationJob;
const originalFetch = globalThis.fetch;
const previousSwarm = process.env.SWARMUI_URL;
const previousLocal = process.env.LOCAL_SWARMUI_URL;
const uploads: string[] = [];
let persisted = 0;
const videoProbe = { duration: 124 / 24, primaryVideoStream: { codecName: "h264", width: 1344, height: 768, frameRate: 24 } } as ProbedMediaFile;

mock.module("@/lib/h3JobStore", () => ({
  pinH3JobReferences: async (job: H3GenerationJob) => job,
  downloadH3ReferenceImage: async () => ({ bytes: new Uint8Array([1, 2, 3]).buffer, mime: "image/png" }),
  readH3Job: async () => structuredClone(job),
  updateH3Job: async (_owner: string, _project: string, _id: string, change: (job: H3GenerationJob) => H3GenerationJob) => {
    job = change(structuredClone(job));
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
  if (previousSwarm === undefined) delete process.env.SWARMUI_URL; else process.env.SWARMUI_URL = previousSwarm;
  if (previousLocal === undefined) delete process.env.LOCAL_SWARMUI_URL; else process.env.LOCAL_SWARMUI_URL = previousLocal;
});

function setup() {
  job = materializeH3Job("github-test", fixture.saved, fixture.request, "studio");
  process.env.SWARMUI_URL = "http://swarm.test:7861";
  delete process.env.LOCAL_SWARMUI_URL;
  uploads.length = 0; persisted = 0;
}
function json(value: unknown) { return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } }); }
function providerFetch(failAfterSubmission = false, providerError = false, acknowledgement: "normal" | "missing" | "diagnostics" = "normal") {
  let submissions = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    expect(url.startsWith("http://swarm.test:7861/ComfyBackendDirect/")).toBe(true);
    if (url.endsWith("system_stats")) return json({ system: { comfyui_version: "test" } });
    if (url.endsWith("object_info/MiniMaxH3ReferenceToVideo")) return json({ MiniMaxH3ReferenceToVideo: {} });
    if (url.endsWith("upload/image")) {
      const form = init!.body as FormData;
      const image = form.get("image") as File;
      uploads.push(`${form.get("subfolder")}/${image.name}`);
      return json({ subfolder: form.get("subfolder"), name: image.name });
    }
    if (url.endsWith("/prompt")) {
      submissions++;
      const submitted = JSON.parse(init!.body as string);
      expect(submitted.extra_data.stack_structure_h3_job).toBe(job.id);
      expect(submitted.prompt.cond.inputs["ref_images.ref_image_0"]).toEqual(["reference_0", 0]);
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
    // Reattaching to a completed durable job creates neither provider work nor storage duplicates.
    await runH3Generation({ ownerId: job.ownerId, projectId: job.projectId, jobId: job.id }, "run-1", { wait: async () => {}, stage: () => {} });
    expect(count()).toBe(1); expect(persisted).toBe(1);
  });

  test("lost submission response remains unknown and is not automatically repeated", async () => {
    setup(); const count = providerFetch(true);
    const reference = { ownerId: job.ownerId, projectId: job.projectId, jobId: job.id };
    await expect(runH3Generation(reference, "run-1", { wait: async () => {}, stage: () => {} })).rejects.toThrow("Connection closed");
    expect(job.state).toBe("submission_unknown");
    await expect(runH3Generation(reference, "run-1", { wait: async () => {}, stage: () => {} })).rejects.toThrow("not repeated");
    expect(count()).toBe(1); expect(persisted).toBe(0);
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
  });

  test("an acknowledged provider ID survives accompanying node diagnostics and is reconciled once", async () => {
    setup(); const count = providerFetch(false, false, "diagnostics");
    await runH3Generation({ ownerId: job.ownerId, projectId: job.projectId, jobId: job.id }, "run-1", { wait: async () => {}, stage: () => {} });
    expect(job.promptId).toBe("provider-1"); expect(job.state).toBe("ready"); expect(count()).toBe(1);
  });
});
