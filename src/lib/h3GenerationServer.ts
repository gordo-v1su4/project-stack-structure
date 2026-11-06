import { createHash } from "node:crypto";
import { H3_MAX_SHOT_SECONDS, H3_PROFILE, type H3GenerationJob, type H3GenerationRequest, type H3ReferenceSnapshot } from "@/components/studio/h3Generation";
import { isPlacementPlanCurrent } from "@/components/studio/musicVideoProject";
import { assertReferenceLanguage } from "@/components/studio/referenceLanguage";
import { buildStoryContentSignature } from "@/components/studio/storyTreatments";
import { buildStudioSourceContextSignature } from "@/components/studio/studioSourceContext";
import { mediaUploadBelongsToOwner } from "./essentiaUpload";
import type { SavedStudioProject } from "./studioProjectStore";
import { normalizeStudioOwnerSegment, normalizeStudioProjectId } from "./studioStoragePaths";

export class H3RequestError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

function text(value: unknown, name: string, max = 500) {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) {
    throw new H3RequestError(`Invalid ${name}.`);
  }
  return value.trim();
}

export function parseH3Request(value: unknown): H3GenerationRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new H3RequestError("A shot request is required.");
  const v = value as Record<string, unknown>;
  const requestIntentId = text(v.requestIntentId, "request intent");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestIntentId)) {
    throw new H3RequestError("The request intent must be a UUID.");
  }
  const projectId = text(v.projectId, "project");
  if (!/^[a-zA-Z0-9_-]{1,96}$/.test(projectId)) throw new H3RequestError("Invalid project id.");
  const songStart = v.songStart, songEnd = v.songEnd;
  if (typeof songStart !== "number" || typeof songEnd !== "number" || !Number.isFinite(songStart) || !Number.isFinite(songEnd)
    || songStart < 0 || songEnd <= songStart || songEnd - songStart > H3_MAX_SHOT_SECONDS + 0.001) {
    throw new H3RequestError(`Choose a positive song window up to ${H3_MAX_SHOT_SECONDS} seconds.`);
  }
  if (!Array.isArray(v.referenceAssetIds) || !v.referenceAssetIds.length || v.referenceAssetIds.length > 9
    || new Set(v.referenceAssetIds).size !== v.referenceAssetIds.length) throw new H3RequestError("Choose 1–9 distinct project reference images.");
  const attempt = v.attempt ?? 0;
  if (typeof attempt !== "number" || !Number.isInteger(attempt) || attempt < 0 || attempt > 2) throw new H3RequestError("A shot permits an initial attempt and two deliberate revisions.");
  if (v.seed !== undefined && (typeof v.seed !== "number" || !Number.isSafeInteger(v.seed) || v.seed < 0)) throw new H3RequestError("Invalid seed.");
  if (v.draftRevision !== undefined && (typeof v.draftRevision !== "number" || !Number.isSafeInteger(v.draftRevision) || v.draftRevision < 0)) throw new H3RequestError("Invalid draft revision.");
  const prompt = text(v.prompt, "shot direction", 6000);
  // The server compiles the native wrapper; input cannot redefine its reference map or cuts.
  if (/<(?:Subject|Picture|Video|Audio)\s|\[Shot\s|(?:^|\n)\s*(?:subject_definitions|detailed_description|summary)\s*:/i.test(prompt)) {
    throw new H3RequestError("Send visible shot direction; the server supplies the H3 reference wrapper.");
  }
  try { assertReferenceLanguage(prompt); } catch (error) { throw new H3RequestError((error as Error).message, 422); }
  return { projectId, planSignature: text(v.planSignature, "plan signature"), sectionId: text(v.sectionId, "section"),
    requirementId: v.requirementId === undefined ? undefined : text(v.requirementId, "requirement"),
    timelineItemId: v.timelineItemId === undefined ? undefined : text(v.timelineItemId, "timeline item"),
    songStart, songEnd, prompt, referenceAssetIds: v.referenceAssetIds.map(id => text(id, "reference asset")),
    requestIntentId: requestIntentId.toLowerCase(), attempt, seed: v.seed as number | undefined,
    draftRevision: v.draftRevision as number | undefined };
}

function digest(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

export function h3GenerationJobId(ownerId: string, request: H3GenerationRequest, references: H3ReferenceSnapshot[]) {
  return `h3-${digest([H3_PROFILE, ownerId, request, references])}`;
}

/** Validate against the saved project again immediately before dispatch and GPU execution. */
export function materializeH3Job(ownerId: string, saved: SavedStudioProject, request: H3GenerationRequest, bucket: string): H3GenerationJob {
  if (saved.project.ownerId !== normalizeStudioOwnerSegment(ownerId) || saved.project.id !== normalizeStudioProjectId(request.projectId)) {
    throw new H3RequestError("Project not found.", 404);
  }
  const { draft } = saved;
  const project = draft.musicVideoProject;
  const story = draft.storyState;
  if (!story.storyGenerated || !story.confirmedTreatmentId || story.confirmedTreatmentSnapshot?.id !== story.confirmedTreatmentId
    || story.confirmedTreatmentSnapshot.reconciliation?.status === "pending") {
    throw new H3RequestError("Confirm the story before generating its draft.", 409);
  }
  if (story.storyContentSignature && buildStoryContentSignature(story.confirmedTreatmentSnapshot, story.storyBeats) !== story.storyContentSignature) {
    throw new H3RequestError("The approved story text changed. Confirm the updated story first.", 409);
  }
  if (story.confirmedSourceContextSignature) {
    const liveContext = buildStudioSourceContextSignature({
      analysis: draft.analysis ? { ...draft.analysis, audioUrl: draft.analysis.storageUrl ?? "" } : null,
      videoSources: draft.videoSources.map(source => ({ ...source, videoUrl: source.storageUrl ?? "" })),
      referenceAssets: draft.referenceAssets ?? [],
    });
    if (liveContext !== story.confirmedSourceContextSignature) throw new H3RequestError("The master, footage or references changed after story approval.", 409);
  }
  if (!project || !isPlacementPlanCurrent(project) || project.placementPlan?.inputSignature !== request.planSignature) {
    throw new H3RequestError("The story or edit plan changed. Save the current plan before generation.", 409);
  }
  const item = project.editPlan.timelineItems.find(item => item.sectionId === request.sectionId
    && (!request.timelineItemId || item.id === request.timelineItemId)
    && (!request.requirementId || item.requirementId === request.requirementId)
    && item.start <= request.songStart + 0.001 && item.end >= request.songEnd - 0.001);
  const placement = project.placementPlan.placements.find(placement => placement.timelineItemId === item?.id
    && placement.songStart <= request.songStart + 0.001 && placement.songEnd >= request.songEnd - 0.001);
  if (!item || !placement) throw new H3RequestError("The requested shot does not belong to the current edit window.", 409);
  const references: H3ReferenceSnapshot[] = request.referenceAssetIds.map(id => {
    const asset = draft.referenceAssets?.find(asset => asset.id === id);
    if (!asset || asset.storageStatus !== "uploaded" || !asset.storagePath || asset.storageBucket !== bucket
      || !mediaUploadBelongsToOwner(asset.storagePath, ownerId)
      || asset.storagePath.includes("\\") || /[\x00-\x1f]/.test(asset.storagePath)
      || asset.storagePath.split("/").some(part => !part || part === "." || part === "..")) {
      throw new H3RequestError("Every reference must be an uploaded image owned by this project's user.", 403);
    }
    const canonicalName = text(asset.displayName, "canonical reference name", 120);
    if (/[<>\r\n]/.test(canonicalName)) throw new H3RequestError("Reference names cannot contain prompt labels or newlines.");
    const role: H3ReferenceSnapshot["role"] = asset.kind === "character" || asset.role.startsWith("character") ? "identity"
      : asset.kind === "environment" || asset.role === "environment" ? "environment"
      : asset.kind === "crowd" || asset.role === "crowd" ? "crowd"
      : asset.kind === "prop" || asset.kind === "vehicle" || asset.kind === "wardrobe" ? asset.kind : "composition";
    // Upload keys include an immutable UUID; include metadata so relabeling or reordering invalidates reuse.
    const version = digest([asset.id, asset.storageBucket, asset.storagePath, asset.createdAt, role, canonicalName]);
    return { assetId: id, canonicalName, role, bucket, objectKey: asset.storagePath, version };
  });
  if (!references.some(reference => reference.role === "environment")) throw new H3RequestError("Attach the named environment reference.");
  if (new Set(references.map(ref => ref.canonicalName.toLowerCase())).size !== references.length) {
    throw new H3RequestError("Give each reference one distinct canonical name.");
  }
  const mentions = (name: string) => new RegExp(`(?<!\\w)${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\w)`, "i").test(request.prompt);
  for (const asset of draft.referenceAssets ?? []) {
    if ((asset.kind === "character" || asset.role.startsWith("character")) && mentions(asset.displayName)
      && !references.some(ref => ref.assetId === asset.id)) throw new H3RequestError(`Attach the named identity reference for ${asset.displayName}.`);
  }
  for (const ref of references.filter(ref => ref.role === "identity")) {
    if (!mentions(ref.canonicalName)) throw new H3RequestError(`Use ${ref.canonicalName}'s exact name in the visible shot direction, or omit that identity reference.`);
  }
  const id = h3GenerationJobId(ownerId, request, references);
  const now = new Date().toISOString();
  return { version: 1, id, ownerId, projectId: request.projectId, profile: H3_PROFILE, request, references,
    target: { planSignature: request.planSignature, timelineItemId: item.id, requirementId: item.requirementId,
      narrativeMomentId: item.narrativeMomentId, sectionId: item.sectionId, sectionLabel: item.label,
      songStart: request.songStart, songEnd: request.songEnd }, state: "queued", createdAt: now, updatedAt: now };
}

export function h3StableSeed(job: H3GenerationJob) {
  return job.request.seed ?? Number.parseInt(job.id.slice(3, 15), 16);
}
