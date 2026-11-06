import { afterEach, describe, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import type { H3GenerationJob } from "@/components/studio/h3Generation";
import { materializeH3Job } from "@/lib/h3GenerationServer";
import { h3ProjectFixture } from "../helpers/h3Project";

const fixture = h3ProjectFixture();
const bytes = new Uint8Array([1, 2, 3]);
let job: H3GenerationJob, measured = 0, downloads = 0, changedBytes = false;
const previousFetch = globalThis.fetch;
mock.module("@/lib/h3JobStore", () => ({
  pinH3JobReferences: async () => { throw new Error("No generation reference pinning is permitted."); },
  downloadH3ReferenceImage: async () => { throw new Error("The verifier is isolated in this boundary test."); },
  readH3Job: async () => structuredClone(job),
  updateH3Job: async (_owner: string, _project: string, _id: string, change: (current: H3GenerationJob) => H3GenerationJob) => {
    job = change(structuredClone(job)); return structuredClone(job);
  },
}));
mock.module("@/lib/studioProjectStore", () => ({ readStudioProject: async () => fixture.saved }));
mock.module("@/lib/mediaGateway", () => ({
  getMediaGatewayConfig: () => ({ bucket: "studio" }),
  downloadMediaGatewayFile: async () => { downloads++; return { bytes: (changedBytes ? new Uint8Array([9]) : bytes).buffer }; },
  uploadFileToMediaGateway: async () => { throw new Error("A recheck must not upload or render media."); },
}));
mock.module("@/components/studio/mediaProbe", () => ({ probeMediaFile: async () => ({ duration: 124 / 24,
  primaryVideoStream: { codecName: "h264", width: 1344, height: 768, frameRate: 24 } }) }));
mock.module("@/lib/h3IdentityVerification", () => ({ assessH3Identity: async ({ asset }: { asset: object }) => {
  measured++; return { ...asset, reviewNotes: "measured-on-cpu" };
} }));
const { runH3Generation } = await import("@/lib/h3GenerationRunner");
afterEach(() => { globalThis.fetch = previousFetch; });
function setup() {
  job = materializeH3Job("github-test", fixture.saved, fixture.request, "studio");
  job.state = "ready"; job.frames = 124; job.runId = "original-render-run";
  job.result = { asset: { id: job.id, jobId: job.id, provider: "swarmui", model: job.profile,
    prompt: "fixture", createdAt: job.createdAt, status: "completed", mediaKind: "video", durationSeconds: 124 / 24,
    reviewStatus: "pending", target: job.target, mediaSha256: createHash("sha256").update(bytes).digest("hex"),
    fullStorage: { bucket: "studio", objectKey: `media-uploads/projects/github-test/generated/${job.projectId}/${job.id}/shot.mp4`,
      storagePath: `media-uploads/projects/github-test/generated/${job.projectId}/${job.id}/shot.mp4`,
      publicUrl: "https://media.example/shot.mp4", mime: "video/mp4" }, resultUrl: "https://media.example/shot.mp4" } };
  fixture.saved.draft.generatedAssets = [];
  measured = 0; downloads = 0; changedBytes = false;
  globalThis.fetch = (async () => { throw new Error("A CPU recheck must never call a generation provider."); }) as typeof fetch;
}
const options = { wait: async () => { throw new Error("No generation wait is permitted."); }, stage: () => {} };
describe("CPU-only identity reassessment", () => {
  test("rechecks the exact completed bytes without Swarm, render submission or original run changes", async () => {
    setup(); const result = await runH3Generation({ ownerId: job.ownerId, projectId: job.projectId, jobId: job.id, mode: "identity-recheck" }, "cpu-check-run", options);
    expect(measured).toBe(1); expect(downloads).toBe(1);
    expect(result.generatedAsset?.reviewNotes).toBe("measured-on-cpu");
    expect(job.runId).toBe("original-render-run"); expect(job.state).toBe("ready");
  });
  test("changed stored bytes cannot receive replacement evidence", async () => {
    setup(); changedBytes = true;
    await expect(runH3Generation({ ownerId: job.ownerId, projectId: job.projectId, jobId: job.id, mode: "identity-recheck" }, "cpu", options)).rejects.toThrow("bytes changed");
    expect(measured).toBe(0); expect(job.result?.asset.reviewNotes).toBe(undefined);
  });
  test("explicit user rejection and a foreign storage binding fail before downloading", async () => {
    setup(); fixture.saved.draft.generatedAssets = [{ ...job.result!.asset, reviewStatus: "rejected" }];
    await expect(runH3Generation({ ownerId: job.ownerId, projectId: job.projectId, jobId: job.id, mode: "identity-recheck" }, "cpu", options)).rejects.toThrow("rejected shot");
    expect(downloads).toBe(0);
    setup(); job.result!.asset.fullStorage!.objectKey = "media-uploads/projects/another-owner/generated/shot.mp4";
    await expect(runH3Generation({ ownerId: job.ownerId, projectId: job.projectId, jobId: job.id, mode: "identity-recheck" }, "cpu", options)).rejects.toThrow("owned media binding");
    expect(downloads).toBe(0);
  });
});
