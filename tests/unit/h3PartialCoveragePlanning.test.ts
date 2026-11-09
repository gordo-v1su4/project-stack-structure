import { describe, expect, test } from "bun:test";
import { h3ProjectFixture } from "../helpers/h3Project";
import { buildH3DraftPlanningInput, buildPlannedH3DraftRequests } from "@/components/studio/h3PlannedDraftRequests";
import { applyDraftGeneratedAssets } from "@/components/studio/generatedDraft";
import { buildEditPlanPreviewSegments, placementInputSignature } from "@/components/studio/musicVideoProject";
import { h3WindowKey, planH3DraftWindows } from "@/components/studio/h3DraftPlan";
import type { GeneratedStudioAsset } from "@/components/studio/generatedAssets";
import type { H3ShotPlanningResult } from "@/components/studio/h3ShotPlanning";
import { loadH3ShotPlanningContext } from "@/lib/h3ShotPlanningServer";
import { materializeH3Job } from "@/lib/h3GenerationServer";

function fixture() {
  const { saved } = h3ProjectFixture();
  const project = saved.draft.musicVideoProject!;
  const base = buildEditPlanPreviewSegments({ project, videoSources: [] });
  const signature = base[0].planSignature!;
  const asset: GeneratedStudioAsset = { id: "editorial:prefix", provider: "editorial", model: "original-footage-edit",
    prompt: "Editable text must not become observed or requested action evidence.", createdAt: "2026-11-08T00:00:00Z",
    status: "completed", mediaKind: "video", reviewStatus: "pending", durationSeconds: 8, trimStart: 2,
    mediaSha256: "a".repeat(64), fullStorage: { bucket: "studio", objectKey: "media-uploads/projects/github-test/editorial/prefix.mp4",
      storagePath: "media-uploads/projects/github-test/editorial/prefix.mp4", publicUrl: "https://media.example/prefix.mp4", mime: "video/mp4" },
    target: { planSignature: signature, timelineItemId: base[0].timelineItemId!, sectionId: base[0].sectionId,
      sectionLabel: "Verse", songStart: 0, songEnd: 3 } };
  const draft = { planSignature: signature, revision: 1, assetIds: [asset.id] };
  saved.draft.generatedAssets = [asset]; saved.draft.generatedDraft = draft;
  const context = { assets: [asset], draft, jobs: [] };
  return { saved, project, base, asset, draft, context, signature };
}

describe("partial coverage through canonical shot planning", () => {
  test("missing browser URLs cannot turn covered source footage into a new or retried render", () => {
    const f = fixture();
    f.project.videoMoments = [{ id: "source", sourceClipId: 7, label: "Doorway", start: 0, end: 20, duration: 20 }];
    Object.assign(f.project.placementPlan!.placements[0], { kind: "source", momentId: "source", sourceStart: 4, sourceEnd: 14 });
    f.project.placementPlan!.inputSignature = placementInputSignature(f.project, f.project.placementPlan!.settings);
    const input = buildH3DraftPlanningInput(f.saved.project.id, f.project, f.saved.draft.referenceAssets!);
    const windows = planH3DraftWindows(buildEditPlanPreviewSegments({ project: f.project, videoSources: [] }));
    expect(windows).toHaveLength(1);
    expect(input.groups[0].windows[0].sourceEvidence?.momentId).toBe("source");
    const result: H3ShotPlanningResult = { version: 1, bindingSha256: input.bindingSha256, directions: [{
      windowKey: h3WindowKey(windows[0]), direction: "[Tracking] Medium shot. Diego advances along CLUB_MAIN.",
      entryState: "Diego holds the rail", exitState: "Diego holds the rail", actionIndices: [],
    }] };
    const { request } = h3ProjectFixture();
    const previous = { ...materializeH3Job(f.saved.project.ownerId, f.saved, { ...request,
      planSignature: input.planSignature, songEnd: 10 }, "studio"), state: "failed" as const };
    for (const jobs of [[], [previous]]) expect(() => buildPlannedH3DraftRequests({ projectId: f.saved.project.id,
      windows, jobs, draftRevision: 1, referenceAssets: f.saved.draft.referenceAssets!, planningInput: input, planningResult: result }))
      .toThrow("already contains canonical footage");
  });

  test("server and browser bind the same selected prefix while only 3–10 becomes a new request", async () => {
    const f = fixture();
    const input = buildH3DraftPlanningInput(f.saved.project.id, f.project, f.saved.draft.referenceAssets!, f.context);
    const server = await loadH3ShotPlanningContext(f.saved.project.ownerId, f.saved.project.id,
      { planSignature: f.signature, bindingSha256: input.bindingSha256 }, { read: async () => f.saved, validate: async () => f.signature });
    expect(server.input).toEqual(input);
    const all = input.groups.flatMap(group => group.windows);
    expect(all.map(window => [window.songStart, window.songEnd])).toEqual([[0, 3], [3, 10]]);
    expect(all[0].generatedEvidence).toEqual({ assetId: f.asset.id, mediaSha256: "a".repeat(64), sourceStart: 2, sourceEnd: 5,
      evidenceKind: "media-only", completion: "unverified" });
    expect(JSON.stringify(input)).not.toContain(f.asset.prompt);
    const result: H3ShotPlanningResult = { version: 1, bindingSha256: input.bindingSha256, directions: all.map(window => ({
      windowKey: window.key, direction: "[Tracking] Medium shot. Diego advances along CLUB_MAIN.",
      entryState: "Diego holds the rail", exitState: "Diego holds the rail", actionIndices: [],
    })) };
    const windows = planH3DraftWindows(applyDraftGeneratedAssets(f.base, [f.asset], f.draft));
    expect(windows.map(h3WindowKey)).toEqual([all[1].key]);
    const requests = buildPlannedH3DraftRequests({ projectId: f.saved.project.id, windows, jobs: [], draftRevision: 1,
      referenceAssets: f.saved.draft.referenceAssets!, planningInput: input, planningResult: result });
    expect(requests.map(request => [request.songStart, request.songEnd])).toEqual([[3, 10]]);
  });

  test("irrelevant bank/prose changes do not bind but selected trim/media changes reject stale planning", async () => {
    const f = fixture();
    const build = () => buildH3DraftPlanningInput(f.saved.project.id, f.project, f.saved.draft.referenceAssets!, f.context);
    const before = build();
    f.asset.prompt = "Another editable description";
    f.context.assets.push({ ...f.asset, id: "unselected", trimStart: 0 });
    expect(build().bindingSha256).toBe(before.bindingSha256);
    f.asset.trimStart = 1;
    expect(build().bindingSha256).not.toBe(before.bindingSha256);
    await expect(loadH3ShotPlanningContext(f.saved.project.ownerId, f.saved.project.id,
      { planSignature: f.signature, bindingSha256: before.bindingSha256 }, { read: async () => f.saved, validate: async () => f.signature }))
      .rejects.toThrow("planning context changed");
    f.asset.trimStart = 2; f.asset.mediaSha256 = "b".repeat(64);
    expect(build().bindingSha256).not.toBe(before.bindingSha256);
  });
});
