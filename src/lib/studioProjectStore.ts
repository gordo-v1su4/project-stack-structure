import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PersistedStudioProjectDraft } from "@/components/studio/projectPersistence";
import {
  buildMediaGatewayFileUrl,
  getMediaGatewayConfig,
  normalizeMediaPath,
  uploadJsonToMediaGateway,
} from "@/lib/mediaGateway";

export type StudioProjectSummary = {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  audioLabel: string | null;
  videoCount: number;
  sceneCount: number;
  captionedSceneCount: number;
  status: "draft" | "analyzed" | "assembled";
};

export type SavedStudioProject = {
  version: 1;
  project: StudioProjectSummary;
  draft: PersistedStudioProjectDraft;
};

type StudioProjectIndex = {
  version: 1;
  projects: StudioProjectSummary[];
};

const PROJECTS_FOLDER = "media-uploads/projects";
const LOCAL_PROJECTS_FOLDER = path.join(process.cwd(), ".tmp", "studio-projects");

export function studioProjectReadSources(env: Record<string, string | undefined> = process.env) {
  return studioProjectLocalCacheEnabled(env) ? ["local", "remote"] as const : ["remote"] as const;
}

export function studioProjectLocalCacheEnabled(env: Record<string, string | undefined> = process.env) {
  return env.NODE_ENV !== "production";
}

export async function listStudioProjects(ownerId: string) {
  return (await readProjectIndex(ownerId)).projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function readStudioProject(ownerId: string, projectId: string): Promise<SavedStudioProject | null> {
  const safeOwnerId = normalizeIdentity(ownerId);
  const safeProjectId = normalizeProjectId(projectId);
  const readSources = studioProjectReadSources();
  for (const source of readSources) {
    const project = source === "local"
      ? await readLocalJson<SavedStudioProject>(localProjectPath(safeOwnerId, safeProjectId))
      : await readRemoteJson<SavedStudioProject>(projectObjectPath(safeOwnerId, safeProjectId));
    if (!isSavedStudioProject(project, safeOwnerId, safeProjectId)) continue;
    if (source === "remote" && readSources[0] === "local") {
      await writeLocalJson(localProjectPath(safeOwnerId, safeProjectId), project);
    }
    return project;
  }
  return null;
}

export async function saveStudioProject(params: {
  ownerId: string;
  projectId: string;
  name: string;
  draft: PersistedStudioProjectDraft;
}): Promise<SavedStudioProject> {
  const ownerId = normalizeIdentity(params.ownerId);
  const projectId = normalizeProjectId(params.projectId);
  const existing = await readStudioProject(ownerId, projectId);
  const now = new Date().toISOString();
  const draft = { ...params.draft, savedAt: now };
  const scenes = draft.videoSources.flatMap((source) => source.scenes ?? []);
  const project: StudioProjectSummary = {
    id: projectId,
    name: normalizeProjectName(params.name),
    ownerId,
    createdAt: existing?.project.createdAt ?? now,
    updatedAt: now,
    audioLabel: draft.analysis?.sourceLabel ?? null,
    videoCount: draft.videoSources.length,
    sceneCount: scenes.length,
    captionedSceneCount: scenes.filter((scene) => Boolean(scene.caption?.trim())).length,
    status: draft.musicVideoProject ? "assembled" : draft.analysis || scenes.length ? "analyzed" : "draft",
  };
  const saved: SavedStudioProject = { version: 1, project, draft };

  if (studioProjectLocalCacheEnabled()) {
    await writeLocalJson(localProjectPath(ownerId, projectId), saved);
  }
  await uploadJsonToMediaGateway({
    data: saved,
    fileName: "project.json",
    folder: projectFolder(ownerId, projectId),
  });

  const index = await readProjectIndex(ownerId);
  const projects = [project, ...index.projects.filter((entry) => entry.id !== projectId)]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const nextIndex: StudioProjectIndex = { version: 1, projects };
  if (studioProjectLocalCacheEnabled()) {
    await writeLocalJson(localIndexPath(ownerId), nextIndex);
  }
  await uploadJsonToMediaGateway({
    data: nextIndex,
    fileName: "index.json",
    folder: ownerFolder(ownerId),
  });
  return saved;
}

export function createStudioProjectId() {
  return crypto.randomUUID();
}

function ownerFolder(ownerId: string) {
  return normalizeMediaPath(`${PROJECTS_FOLDER}/${normalizeIdentity(ownerId)}`);
}

function projectFolder(ownerId: string, projectId: string) {
  return normalizeMediaPath(`${ownerFolder(ownerId)}/${normalizeProjectId(projectId)}`);
}

function projectObjectPath(ownerId: string, projectId: string) {
  return `${projectFolder(ownerId, projectId)}/project.json`;
}

function indexObjectPath(ownerId: string) {
  return `${ownerFolder(ownerId)}/index.json`;
}

function localProjectPath(ownerId: string, projectId: string) {
  return path.join(LOCAL_PROJECTS_FOLDER, normalizeIdentity(ownerId), normalizeProjectId(projectId), "project.json");
}

function localIndexPath(ownerId: string) {
  return path.join(LOCAL_PROJECTS_FOLDER, normalizeIdentity(ownerId), "index.json");
}

async function readProjectIndex(ownerId: string): Promise<StudioProjectIndex> {
  const safeOwnerId = normalizeIdentity(ownerId);
  const readSources = studioProjectReadSources();
  for (const source of readSources) {
    const index = source === "local"
      ? await readLocalJson<StudioProjectIndex>(localIndexPath(safeOwnerId))
      : await readRemoteJson<StudioProjectIndex>(indexObjectPath(safeOwnerId));
    if (!isProjectIndex(index, safeOwnerId)) continue;
    if (source === "remote" && readSources[0] === "local") {
      await writeLocalJson(localIndexPath(safeOwnerId), index);
    }
    return index;
  }
  return { version: 1, projects: [] };
}

async function readRemoteJson<T>(objectKey: string): Promise<T | null> {
  const config = getMediaGatewayConfig();
  if (!config) throw new Error("Missing RustFS media gateway env.");
  const response = await fetch(buildMediaGatewayFileUrl(config, config.bucket, objectKey), {
    headers: { Authorization: `Bearer ${config.token}` },
    cache: "no-store",
  });
  if (response.status === 404) return null;
  const text = await response.text();
  if (!response.ok) throw new Error(`Studio project fetch failed (${response.status}): ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Studio project JSON is invalid: ${objectKey}`);
  }
}

async function readLocalJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

async function writeLocalJson(filePath: string, data: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

function normalizeIdentity(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!normalized) throw new Error("A valid project owner is required.");
  return normalized.slice(0, 96);
}

function normalizeProjectId(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!normalized) throw new Error("A valid project id is required.");
  return normalized.slice(0, 96);
}

function normalizeProjectName(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 120) || "Untitled project";
}

function isProjectIndex(value: unknown, ownerId: string): value is StudioProjectIndex {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const index = value as Partial<StudioProjectIndex>;
  return index.version === 1 && Array.isArray(index.projects)
    && index.projects.every((project) => project?.ownerId === ownerId && typeof project.id === "string");
}

function isSavedStudioProject(value: unknown, ownerId: string, projectId: string): value is SavedStudioProject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const saved = value as Partial<SavedStudioProject>;
  return saved.version === 1
    && saved.project?.ownerId === ownerId
    && saved.project.id === projectId
    && saved.draft?.version === 1;
}
