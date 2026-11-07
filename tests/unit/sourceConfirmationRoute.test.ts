import { afterEach, describe, expect, mock, test } from "bun:test";
import { gunzipSync } from "node:zlib";
import { h3ProjectFixture } from "../helpers/h3Project";
import type { SavedStudioProject } from "@/lib/studioProjectStore";
let signedIn = true, reads = 0, historyReads = 0, prepares = 0;
let saved: (SavedStudioProject & { revision: string }) | null = null;
mock.module("@/lib/session", () => ({ getSessionUser: async () => signedIn ? { id: "github-test" } : null, unauthorizedResponse: () => Response.json({}, { status: 401 }) }));
mock.module("@/lib/studioProjectStore", () => ({ readStudioProject: async (owner: string, project: string, options: { fresh: boolean }) => {
  reads++; expect(owner).toBe("github-test"); expect(project).toBe("project-1"); expect(options.fresh).toBe(true); return saved;
} }));
mock.module("@/lib/h3JobStore", () => ({ listH3Jobs: async () => { historyReads++; return []; } }));
const actualMediaGateway = await import("@/lib/mediaGateway");
mock.module("@/lib/mediaGateway", () => ({ ...actualMediaGateway, getMediaGatewayConfig: () => ({ bucket: "studio" }) }));
class SourceConfirmationError extends Error { constructor(message: string, readonly status = 409) { super(message); } }
mock.module("@/lib/generationScopeServer", () => ({ SourceConfirmationError, prepareAdditiveSourceConfirmation: async (params: { ownerId: string; saved: typeof saved; expectedRevision: string }) => {
  prepares++; expect(params.ownerId).toBe("github-test"); expect(params.saved).toBe(saved); expect(params.expectedRevision).toBe('"current"');
  return { draft: { ...saved!.draft, syntheticLargeProof: "unchanged-evidence".repeat(40_000) }, expectedRevision: params.expectedRevision, receipt: { id: "canonical-server-record" } };
} }));
const { POST } = await import("@/app/api/studio/projects/source-confirmation/route");
afterEach(() => { signedIn = true; reads = 0; historyReads = 0; prepares = 0; saved = null; });
const request = (body: unknown) => new Request("http://app.test/api/studio/projects/source-confirmation", { method: "POST", headers: { "content-type": "application/json", "x-studio-json-transport": "gzip" }, body: JSON.stringify(body) });
describe("authenticated additive source confirmation route", () => {
  test("anonymous requests never read the body, project, history or receipt store", async () => {
    signedIn = false;
    const input = request({}); input.text = async () => { throw new Error("must not read"); };
    expect((await POST(input)).status).toBe(401);
    expect([reads, historyReads, prepares]).toEqual([0, 0, 0]);
  });
  test("missing ownership and stale revisions short-circuit canonical history reads", async () => {
    expect((await POST(request({ projectId: "project-1", expectedRevision: '"current"' }))).status).toBe(404);
    saved = { ...h3ProjectFixture().saved, revision: '"newer"' };
    expect((await POST(request({ projectId: "project-1", expectedRevision: '"current"' }))).status).toBe(409);
    expect(historyReads).toBe(0); expect(prepares).toBe(0);
  });
  test("returns a lossless compressed candidate from canonical saved inputs without a project write or dispatch", async () => {
    saved = { ...h3ProjectFixture().saved, revision: '"current"' };
    const response = await POST(request({ projectId: "project-1", expectedRevision: '"current"', forgedManifest: ["ignored"], generationScope: "ignored" }));
    expect(response.status).toBe(200); expect(response.headers.get("content-encoding")).toBe("gzip");
    const payload = JSON.parse(gunzipSync(Buffer.from(await response.arrayBuffer())).toString());
    expect(payload.expectedRevision).toBe('"current"'); expect(payload.draft.syntheticLargeProof.length).toBe("unchanged-evidence".length * 40_000);
    expect([reads, historyReads, prepares]).toEqual([1, 1, 1]);
  });
  test("malformed metadata fails before storage reads", async () => {
    expect((await POST(request({ projectId: "../other", expectedRevision: "x" }))).status).toBe(400);
    expect((await POST(request({ projectId: "project-1", expectedRevision: "x".repeat(3000) }))).status).toBe(400);
    expect([reads, historyReads, prepares]).toEqual([0, 0, 0]);
  });
});
