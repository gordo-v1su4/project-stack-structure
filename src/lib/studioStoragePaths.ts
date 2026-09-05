import { essentiaUploadOwnerSegment } from "@/lib/essentiaUpload";
import { normalizeMediaPath } from "@/lib/mediaGateway";

export type StudioProjectMediaKind =
  | "meta"
  | "audio"
  | "clips"
  | "references"
  | "generated"
  | "analysis"
  | "chunks";

const PROJECTS_ROOT = "media-uploads/projects";

export function slugifyStorageSegment(value: string, fallback = "untitled") {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (slug || fallback).slice(0, 48);
}

export function normalizeStudioOwnerSegment(ownerId: string) {
  return essentiaUploadOwnerSegment(ownerId).toLowerCase();
}

export function normalizeStudioProjectId(projectId: string) {
  const normalized = projectId.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!normalized) throw new Error("A valid project id is required.");
  return normalized.slice(0, 96);
}

export function buildProjectStorageFolder(ownerId: string, projectId: string, projectName: string) {
  const owner = normalizeStudioOwnerSegment(ownerId);
  const shortId = normalizeStudioProjectId(projectId).replace(/-/g, "").slice(0, 8) || "draft";
  const slug = slugifyStorageSegment(projectName, "untitled");
  return normalizeMediaPath(`${PROJECTS_ROOT}/${owner}/${slug}--${shortId}`);
}

export function buildProjectMediaFolder(
  ownerId: string,
  projectId: string,
  projectName: string,
  kind: StudioProjectMediaKind,
) {
  const base = buildProjectStorageFolder(ownerId, projectId, projectName);
  return kind === "meta" ? base : normalizeMediaPath(`${base}/${kind}`);
}

export function resolveProjectObjectPath(storageFolder: string) {
  return normalizeMediaPath(`${storageFolder}/project.json`);
}

export function resolveLegacyProjectObjectPath(ownerId: string, projectId: string) {
  const owner = normalizeStudioOwnerSegment(ownerId);
  const project = normalizeStudioProjectId(projectId);
  return normalizeMediaPath(`${PROJECTS_ROOT}/${owner}/${project}/project.json`);
}

export function ownerProjectsIndexPath(ownerId: string) {
  return normalizeMediaPath(`${PROJECTS_ROOT}/${normalizeStudioOwnerSegment(ownerId)}/index.json`);
}

export function ownerProjectsRoot(ownerId: string) {
  return normalizeMediaPath(`${PROJECTS_ROOT}/${normalizeStudioOwnerSegment(ownerId)}`);
}
