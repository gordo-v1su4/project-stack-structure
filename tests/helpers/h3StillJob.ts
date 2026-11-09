import type { H3StillJob, H3StillJobInput, H3StillResult } from "@/lib/h3StillJobStore";
import { freezeH3Still } from "@/lib/h3StillProfile";
import { StudioProjectConflictError, type StudioJsonObjectStore } from "@/lib/studioProjectObjectStore";
export function h3StillJobFixture() {
  const target = { timelineItemId: "arrival", sectionId: "intro", songStart: 0, songEnd: 2 };
  const initial: Omit<H3StillJobInput, "template"> = { ownerId: "github-owner", projectId: "project", requestIntentId: "00000000-0000-4000-8000-000000000001", attempt: 0,
    descriptor: freezeH3Still({ ownerId: "github-owner", projectId: "project", planSignature: "plan", target,
      prompt: "<Picture 1> Diego stands inside CLUB_MAIN from <Picture 2>.", seed: 17,
      references: [
        { assetId: "diego", canonicalName: "Diego", role: "identity", bucket: "studio", objectKey: "media-uploads/github-owner/diego.png", etag: '"diego"', version: "v1", rawSha256: "a".repeat(64) },
        { assetId: "club", canonicalName: "CLUB_MAIN", role: "environment", bucket: "studio", objectKey: "media-uploads/github-owner/club.png", etag: '"club"', version: "v1", rawSha256: "b".repeat(64) },
      ] }),
    shotRequest: { ...target, projectId: "project", planSignature: "plan", prompt: "Diego advances inside CLUB_MAIN.", referenceAssetIds: ["diego", "club"], requestIntentId: "00000000-0000-4000-8000-000000000002", attempt: 0 } };
  const input: H3StillJobInput = { ...initial, template: { version: 1, id: `h3-${"6".repeat(64)}`, ownerId: initial.ownerId, projectId: initial.projectId,
    profile: "h3-ref2va-int8-v3", request: structuredClone(initial.shotRequest), target: { ...target, planSignature: "plan", sectionLabel: "Intro" },
    references: initial.descriptor.body.references.map(({ rawSha256: _hash, ...ref }) => { void _hash; return ref; }), state: "queued", createdAt: "2026-11-08T00:00:00Z", updatedAt: "2026-11-08T00:00:00Z" } };
  const rows = new Map<string, { value: unknown; revision: string }>();
  let writes = 0, revisionCounter = 0;
  const objects: StudioJsonObjectStore = {
    async read<T>(key: string) { return structuredClone(rows.get(key) ?? null) as { value: T; revision: string } | null; },
    async write<T>(key: string, value: T, revision: string | null) {
      writes++;
      if ((rows.get(key)?.revision ?? null) !== revision) throw new StudioProjectConflictError();
      const next = `"${++revisionCounter}"`; rows.set(key, { value: structuredClone(value), revision: next }); return next;
    },
  };
  return { input, rows, objects, writes: () => writes };
}
export function h3StillResultFixture(job: H3StillJob): H3StillResult {
  const prefix = `media-uploads/projects/${job.ownerId}/still-results/${job.projectId}/${job.id}/`;
  return { master: { bucket: "studio", objectKey: `${prefix}master.png`, sha256: "c".repeat(64), byteLength: 1234, width: 2048, height: 1152 },
    native: { bucket: "studio", objectKey: `${prefix}native.png`, sha256: "d".repeat(64), byteLength: 1000, width: 1344, height: 768 },
    artifactId: `h3-frame-${"e".repeat(64)}`, artifactSha256: "e".repeat(64) };
}
