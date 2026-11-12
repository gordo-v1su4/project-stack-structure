import { afterEach, expect, mock, test } from "bun:test";
import { reviewedScenePlanningFixture } from "../helpers/sceneProofPlanning";
import { animaticContextSha256 } from "@/components/studio/stillAnimatic";
import { animaticReviewBinding } from "@/components/studio/animaticReview";
import { StudioProjectConflictError } from "@/lib/studioProjectObjectStore";
import type { SavedStudioProject } from "@/lib/studioProjectStore";

let signedIn = true, saved: SavedStudioProject | null = null, writes = 0, conflict = false;
mock.module("@/lib/session", () => ({ getSessionUser: async () => signedIn ? { id: "github-test" } : null,
  unauthorizedResponse: () => Response.json({}, { status: 401 }) }));
mock.module("@/lib/studioProjectStore", () => ({
  readStudioProject: async (owner: string, id: string, options: { fresh: boolean }) => {
    expect(owner).toBe("github-test"); expect(id).toBe("project-1"); expect(options.fresh).toBe(true); return saved;
  },
  saveStudioProject: async (input: { ownerId: string; projectId: string; expectedRevision: string; draft: SavedStudioProject["draft"]; name: string }) => {
    writes++; expect(input.ownerId).toBe("github-test"); expect(input.projectId).toBe("project-1"); expect(input.expectedRevision).toBe('"old"');
    if (conflict) throw new StudioProjectConflictError();
    const expected = structuredClone(saved!.draft); expected.storyState.stillAnimaticPlan!.review = input.draft.storyState.stillAnimaticPlan!.review;
    expect(input.draft).toEqual(expected);
    saved = { ...saved!, draft: input.draft, revision: '"new"' }; return saved;
  },
}));
const { POST } = await import("@/app/api/studio/projects/[projectId]/preview/review/route");
const context = { params: Promise.resolve({ projectId: "project-1" }) };
const request = (body: unknown, revision: string | null = '"old"') => new Request("https://app.test/api/studio/projects/project-1/preview/review", {
  method: "POST", headers: { "content-type": "application/json", ...(revision ? { "if-match": revision } : {}) }, body: JSON.stringify(body) });
function setup() {
  const f = reviewedScenePlanningFixture();
  f.saved.draft.analysis = { ...f.saved.draft.analysis!, duration: 10, storageBucket: "studio", storagePath: "media-uploads/github-test/master.wav" };
  const input = f.source(), plan = { version: 1 as const, projectId: "project-1", contextSha256: animaticContextSha256(input), fps: 24,
    masterDuration: 10, totalFrames: 240, shots: [{ id: "A001", sceneId: "S01", title: "Opening", sourceTimelineItemId: "old-item",
      startFrame: 0, endFrame: 240, prompt: "", referenceAssetIds: [], sourceFrame: { sourceId: 1, sourceSecond: 0,
        sourceSha256: "a".repeat(64), image: { bucket: "studio", objectKey: "media-uploads/github-test/source.png", sha256: "b".repeat(64), byteLength: 100, width: 2048, height: 1152 } } }] };
  f.saved.draft.storyState.stillAnimaticPlan = plan;
  saved = { ...f.saved, revision: '"old"' };
  const audioUrl = "/api/storage/media?bucket=studio&objectKey=media-uploads%2Fgithub-test%2Fmaster.wav";
  return { bindingSha256: animaticReviewBinding(plan, plan.contextSha256, audioUrl)!, status: "approved", note: "Reviewed whole song" };
}
afterEach(() => { signedIn = true; saved = null; writes = 0; conflict = false; });

test("review requires auth, owned project, exact revision and bounded explicit decision", async () => {
  const body = setup(); signedIn = false; expect((await POST(request(body), context)).status).toBe(401);
  signedIn = true; saved = null; expect((await POST(request(body), context)).status).toBe(404);
  setup(); expect((await POST(request(body, null), context)).status).toBe(428);
  expect((await POST(request(body, '"stale"'), context)).status).toBe(409);
  for (const invalid of [{ ...body, status: "ready" }, { ...body, note: "x".repeat(2001) }, { ...body, extra: true }]) {
    expect((await POST(request(invalid), context)).status).toBe(400);
  }
  expect(writes).toBe(0);
});

test("only exact current completed direction is saved, preserving all other draft state", async () => {
  const body = setup(); const response = await POST(request(body), context);
  expect(response.status).toBe(200); const result = await response.json();
  expect(result.review.status).toBe("approved"); expect(result.review.bindingSha256).toBe(body.bindingSha256);
  expect(result.revision).toBe('"new"'); expect(writes).toBe(1);
  expect(saved!.draft.storyState.stillAnimaticPlan!.review).toEqual(result.review);
});

test("replaced or missing image and storage CAS race reject approval without automatic retry", async () => {
  const body = setup(); saved!.draft.storyState.stillAnimaticPlan!.shots[0].sourceFrame!.image!.sha256 = "c".repeat(64);
  expect((await POST(request(body), context)).status).toBe(409); expect(writes).toBe(0);
  setup(); delete saved!.draft.storyState.stillAnimaticPlan!.shots[0].sourceFrame!.image;
  expect((await POST(request(body), context)).status).toBe(409); expect(writes).toBe(0);
  setup(); conflict = true; expect((await POST(request(body), context)).status).toBe(409); expect(writes).toBe(1);
});

test("Preview master override and duration changes cannot reuse another track's review", async () => {
  const body = setup();
  saved!.draft.analysis!.storagePath = "media-uploads/github-test/replacement-master.wav";
  expect((await POST(request(body), context)).status).toBe(409); expect(writes).toBe(0);
  setup(); saved!.draft.analysis!.duration = 9;
  expect((await POST(request(body), context)).status).toBe(409); expect(writes).toBe(0);
  setup(); saved!.draft.analysis!.storagePath = undefined;
  expect((await POST(request(body), context)).status).toBe(409); expect(writes).toBe(0);
});
