import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PersistedStudioProjectDraft } from "@/components/studio/projectPersistence";
import {
  buildMediaGatewayFileUrl,
  getMediaGatewayConfig,
} from "@/lib/mediaGateway";
import {
  buildProjectStorageFolder,
  normalizeStudioOwnerSegment,
  normalizeStudioProjectId,
  ownerProjectsIndexPath,
  resolveLegacyProjectObjectPath,
  resolveProjectObjectPath,
} from "@/lib/studioStoragePaths";
import { mergeStudioProjectIndex, requireStudioProjectRevision, StudioProjectConflictError, studioProjectObjects } from "./studioProjectObjectStore";

export type StudioProjectSummary = {
  id: string;
  name: string;
  ownerId: string;
  storageFolder: string;
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
  /** Server-authored marker for metadata anchored at the full owner/ID key. */
  objectKeyVersion?: 2;
  project: StudioProjectSummary;
  draft: PersistedStudioProjectDraft;
  /** Actual durable ETag; attached to responses, never written inside the object. */
  revision?: string;
};

type StudioProjectIndex = {
  version: 1;
  projects: StudioProjectSummary[];
};

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

export async function readStudioProject(ownerId: string, projectId: string, options: { fresh?: boolean } = {}): Promise<SavedStudioProject | null> {
  const safeOwnerId = normalizeIdentity(ownerId);
  const safeProjectId = normalizeProjectId(projectId);
  const readSources = options.fresh ? ["remote"] as const : studioProjectReadSources();
  for (const source of readSources) {
    const project = source === "local"
      ? await readLocalJson<SavedStudioProject>(localProjectPath(safeOwnerId, safeProjectId))
      : await readRemoteProject(safeOwnerId, safeProjectId);
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
  expectedRevision?: string | null;
}): Promise<SavedStudioProject> {
  const ownerId = normalizeIdentity(params.ownerId);
  const projectId = normalizeProjectId(params.projectId);
  const version = await readRemoteProjectVersion(ownerId, projectId);
  const existing = version?.saved;
  if (existing) {
    if (params.expectedRevision === null) throw new StudioProjectConflictError("A project with this ID already exists; it was not replaced.");
    const expected = requireStudioProjectRevision(params.expectedRevision);
    if (expected !== existing.revision) throw new StudioProjectConflictError();
  } else if (params.expectedRevision) throw new StudioProjectConflictError("This saved project no longer exists. Your changes were not written.");
  const now = new Date().toISOString();
  const draft = { ...params.draft, savedAt: now };
  const scenes = draft.videoSources.flatMap((source) => source.scenes ?? []);
  const storageFolder = existing?.project.storageFolder
    ?? buildProjectStorageFolder(ownerId, projectId, params.name);
  const project: StudioProjectSummary = {
    id: projectId,
    name: normalizeProjectName(params.name),
    ownerId,
    storageFolder,
    createdAt: existing?.project.createdAt ?? now,
    updatedAt: now,
    audioLabel: draft.analysis?.sourceLabel ?? null,
    videoCount: draft.videoSources.length,
    sceneCount: scenes.length,
    captionedSceneCount: scenes.filter((scene) => Boolean(scene.caption?.trim())).length,
    status: draft.musicVideoProject ? "assembled" : draft.analysis || scenes.length ? "analyzed" : "draft",
  };
  const objectKey = version?.objectKey ?? resolveLegacyProjectObjectPath(ownerId, projectId);
  const saved: SavedStudioProject = { version: 1, project, draft,
    ...(objectKey === resolveLegacyProjectObjectPath(ownerId, projectId) ? { objectKeyVersion: 2 as const } : {}) };

  // New metadata has one owner/ID key independent of its display name. Two
  // create requests cannot claim the same ID in different named folders.
  // GET can reconcile its known ID even if the subsequent index ACK is lost.
  const revision = await studioProjectObjects.write(objectKey, saved, existing ? existing.revision! : null);
  const committed = { ...saved, revision };
  await mergeStudioProjectIndex(studioProjectObjects, ownerProjectsIndexPath(ownerId), async () => {
    const latest = await studioProjectObjects.read<SavedStudioProject>(objectKey);
    if (!latest || !isSavedStudioProject(latest.value, ownerId, projectId)) throw new Error("Saved project metadata could not be reconciled.");
    return latest.value.project;
  });
  if (studioProjectLocalCacheEnabled()) {
    await writeLocalJson(localProjectPath(ownerId, projectId), committed);
    const index = await studioProjectObjects.read<StudioProjectIndex>(ownerProjectsIndexPath(ownerId));
    if (index) await writeLocalJson(localIndexPath(ownerId), index.value);
  }
  return committed;
}

export function createStudioProjectId() {
  return crypto.randomUUID();
}

async function readRemoteProject(ownerId: string, projectId: string): Promise<SavedStudioProject | null> {
  return (await readRemoteProjectVersion(ownerId, projectId))?.saved ?? null;
}

async function readRemoteProjectVersion(ownerId: string, projectId: string) {
  const canonicalKey = resolveLegacyProjectObjectPath(ownerId, projectId);
  const canonical = await studioProjectObjects.read<SavedStudioProject>(canonicalKey);
  if (canonical?.value.objectKeyVersion === 2 && isSavedStudioProject(canonical.value, ownerId, projectId)) {
    return { saved: { ...canonical.value, revision: canonical.revision }, objectKey: canonicalKey };
  }
  // Unmarked legacy records may have a newer named-folder successor. Preserve
  // that existing lookup order; only server-marked canonical records skip it.
  const index = await readProjectIndex(ownerId, { fresh: true });
  const entry = index.projects.find((project) => project.id === projectId);
  const objectPaths = [
    entry?.storageFolder ? resolveProjectObjectPath(entry.storageFolder) : null,
  ].filter((value): value is string => Boolean(value));

  for (const objectPath of objectPaths) {
    const version = await studioProjectObjects.read<SavedStudioProject>(objectPath);
    if (version && isSavedStudioProject(version.value, ownerId, projectId)) {
      return { saved: { ...version.value, revision: version.revision }, objectKey: objectPath };
    }
  }
  if (canonical && isSavedStudioProject(canonical.value, ownerId, projectId)) {
    return { saved: { ...canonical.value, revision: canonical.revision }, objectKey: canonicalKey };
  }
  return null;
}

function localProjectPath(ownerId: string, projectId: string) {
  return path.join(LOCAL_PROJECTS_FOLDER, normalizeIdentity(ownerId), normalizeProjectId(projectId), "project.json");
}

function localIndexPath(ownerId: string) {
  return path.join(LOCAL_PROJECTS_FOLDER, normalizeIdentity(ownerId), "index.json");
}

async function readProjectIndex(ownerId: string, options: { fresh?: boolean } = {}): Promise<StudioProjectIndex> {
  const safeOwnerId = normalizeIdentity(ownerId);
  const readSources = options.fresh ? ["remote"] as const : studioProjectReadSources();
  for (const source of readSources) {
    const index = source === "local"
      ? await readLocalJson<StudioProjectIndex>(localIndexPath(safeOwnerId))
      : await readRemoteJson<StudioProjectIndex>(ownerProjectsIndexPath(safeOwnerId));
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
  return normalizeStudioOwnerSegment(value);
}

function normalizeProjectId(value: string) {
  return normalizeStudioProjectId(value);
}

function normalizeProjectName(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 120) || "Untitled project";
}

function isProjectIndex(value: unknown, ownerId: string): value is StudioProjectIndex {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const index = value as Partial<StudioProjectIndex>;
  return index.version === 1 && Array.isArray(index.projects)
    && index.projects.every((project) => project?.ownerId === ownerId && typeof project.id === "string"
      && (typeof project.storageFolder === "string" || project.storageFolder === undefined));
}

function isSavedStudioProject(value: unknown, ownerId: string, projectId: string): value is SavedStudioProject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const saved = value as Partial<SavedStudioProject>;
  return saved.version === 1
    && saved.project?.ownerId === ownerId
    && saved.project.id === projectId
    && (saved.draft?.version === 1 || saved.draft?.version === 2 || saved.draft?.version === 3);
}
