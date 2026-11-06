import { describe, expect, test } from "bun:test";
import { createVerificationCopy, parseVerificationOptions, verifyH3DraftFlow, type VerificationOptions } from "../../scripts/verify-h3-draft-flow";
import { h3ProjectFixture } from "../helpers/h3Project";
import type { SavedStudioProject } from "@/lib/studioProjectStore";
import type { H3GenerationJob, H3GenerationRequest } from "@/components/studio/h3Generation";
import { isPlacementPlanCurrent } from "@/components/studio/musicVideoProject";

const options: VerificationOptions = { baseUrl: "http://127.0.0.1:3000", projectId: "project-1", run: false, zeroFootage: false, limit: 1 };

function fakeApp() {
  const { saved: original } = h3ProjectFixture();
  const projects = new Map([[original.project.id, structuredClone(original)]]);
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  let job: H3GenerationJob;
  const fetcher = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    expect(new Headers(init.headers).get("cookie")).toBe("private-test-cookie");
    expect(init.redirect).toBe("error");
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: url.pathname, body });
    if (url.pathname === "/api/studio/projects" && method === "POST") {
      const saved: SavedStudioProject = { ...structuredClone(original), project: { ...original.project, id: "verification-copy", name: body.name }, draft: body.draft };
      projects.set(saved.project.id, saved);
      return Response.json({ success: true, saved }, { status: 201 });
    }
    if (url.pathname.startsWith("/api/studio/projects/")) {
      const id = url.pathname.split("/").at(-1)!;
      if (method === "PUT") projects.set(id, { ...projects.get(id)!, draft: body.draft });
      return Response.json({ success: true, saved: projects.get(id) });
    }
    if (url.pathname === "/api/generate/h3") {
      if (method === "GET" && !url.searchParams.has("jobId")) return Response.json({ success: true, jobs: [] });
      if (method === "POST") {
        const request = body as H3GenerationRequest;
        job ??= { version: 1, id: "h3-test-job", ownerId: original.project.ownerId, projectId: request.projectId, profile: "h3-ref2va-int8-v1", request, references: [], target: { timelineItemId: request.timelineItemId!, requirementId: request.requirementId, planSignature: request.planSignature, sectionId: request.sectionId, sectionLabel: "Verse", songStart: request.songStart, songEnd: request.songEnd }, state: "queued", createdAt: "fixed", updatedAt: "fixed", runId: "run-h3-test" };
        return Response.json({ success: true, jobId: job.id, runId: job.runId, job }, { status: 202 });
      }
      job = { ...job, state: "ready", result: { asset: { id: "generated-1", jobId: job.id, provider: "swarmui", model: "MiniMax H3", prompt: job.request.prompt, createdAt: "2026-11-06T00:00:00Z", triggerRunId: job.runId, mediaKind: "video", status: "completed", reviewStatus: "pending", durationSeconds: 10, target: job.target, fullStorage: { bucket: "studio", objectKey: "media-uploads/generated/shot.mp4", storagePath: "media-uploads/generated/shot.mp4", publicUrl: "", mime: "video/mp4" } } } };
      return Response.json({ success: true, job });
    }
    if (url.pathname === "/api/storage/media") return new Response(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), { status: 206 });
    throw new Error(`Unexpected fake request ${method} ${url.pathname}`);
  }) as typeof fetch;
  return { original, projects, calls, fetcher };
}

describe("H3 app verification harness", () => {
  test("defaults to read-only and never dispatches or rewrites a named project", async () => {
    const app = fakeApp();
    const report = await verifyH3DraftFlow(options, { fetch: app.fetcher, cookie: "private-test-cookie" });
    expect(app.calls.every(call => call.method === "GET")).toBe(true);
    expect(app.projects.size).toBe(1);
    expect(report.mode).toBe("read-only");
    expect(report.jobs).toHaveLength(0);
    expect(report.plannedWindowCount).toBe(1);
    expect(JSON.stringify(report)).not.toContain("private-test-cookie");
    expect(parseVerificationOptions(["--project-id", "project-1"], {}).run).toBe(false);
  });

  test("explicit run copies first, replays one intent, polls, reads durable bytes and restores a pending candidate", async () => {
    const app = fakeApp();
    const report = await verifyH3DraftFlow({ ...options, run: true }, { fetch: app.fetcher, cookie: "private-test-cookie", wait: async () => {} });
    expect(report.projectId).toBe("verification-copy");
    expect(report.jobs).toEqual([{ jobId: "h3-test-job", runId: "run-h3-test", state: "ready", assetId: "generated-1", storedByteRead: true }]);
    const submissions = app.calls.filter(call => call.path === "/api/generate/h3" && call.method === "POST");
    expect(submissions).toHaveLength(2);
    expect(submissions[0].body).toEqual(submissions[1].body);
    expect((submissions[0].body as H3GenerationRequest).referenceAssetIds).toEqual(["diego", "club"]);
    expect(app.projects.get("verification-copy")?.draft.generatedAssets?.[0].reviewStatus).toBe("pending");
    expect(app.projects.get("verification-copy")?.draft.generatedDraft?.assetIds).toEqual(["generated-1"]);
    expect(app.projects.get("project-1")?.draft).toEqual(app.original.draft);
    expect(report.approvedAssetCount).toBe(0);
    expect(report.export.fullSongCovered).toBe(false);
  });

  test("zero-footage variant retains story and durable inputs without mutating the source", () => {
    const { saved } = h3ProjectFixture();
    saved.draft.analysis = { sourceLabel: "Master.wav", mediaKey: "audio", duration: 10, waveform: [], energy: [], beats: [0, 5], onsets: [], sections: [{ label: "Verse", start: 0, end: 10 }], storageBucket: "studio", storagePath: "media-uploads/github-test/master.wav" };
    saved.draft.storyState.storyBeats = [{ id: "verse", label: "Verse", prompt: "Diego enters CLUB_MAIN.", start: 0, end: 10 }];
    saved.draft.storyState.confirmedTreatmentSnapshot = { id: "story-1", kind: "faithful", title: "Arrival", logline: "Diego enters CLUB_MAIN.", synopsis: "Diego enters. Diego crosses the floor. Diego reaches the stage.", visualThesis: "A fast performance.", endingHook: "The lights rise.", expectedReusePercent: 0, expectedGenerationPercent: 100, anchors: [] };
    const before = structuredClone(saved.draft);
    const copy = createVerificationCopy(saved.draft, true);
    expect(copy.videoSources).toHaveLength(0);
    expect(copy.storyState.transcriptSummary).toBeNull();
    expect(copy.musicVideoProject?.lyricChunks).toEqual([]);
    expect(isPlacementPlanCurrent(copy.musicVideoProject!)).toBe(true);
    expect(copy.referenceAssets).toEqual(saved.draft.referenceAssets);
    expect(copy.analysis?.storagePath).toBe(saved.draft.analysis.storagePath);
    expect(saved.draft).toEqual(before);
  });

  test("refuses remote cookie destinations and accidental reuse of an original project", async () => {
    const app = fakeApp();
    await expect(verifyH3DraftFlow({ ...options, baseUrl: "https://production.example" }, { fetch: app.fetcher, cookie: "private-test-cookie" })).rejects.toThrow("local app URL");
    expect(app.calls).toHaveLength(0);
    await expect(verifyH3DraftFlow({ ...options, run: true, reuseCopy: true }, { fetch: app.fetcher, cookie: "private-test-cookie" })).rejects.toThrow("previously created");
    expect(app.calls.every(call => call.method === "GET")).toBe(true);
  });
});
