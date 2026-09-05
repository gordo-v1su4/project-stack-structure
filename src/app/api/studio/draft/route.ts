import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  buildMediaGatewayFileUrl,
  getMediaGatewayConfig,
  normalizeMediaPath,
  uploadJsonToMediaGateway,
} from "@/lib/mediaGateway";
import { getSessionUser, unauthorizedResponse } from "@/lib/session";
import type { PersistedStudioProjectDraft } from "@/components/studio/projectPersistence";

export const runtime = "nodejs";

const DRAFT_FOLDER = "media-uploads/studio-drafts";
const DRAFT_FILE_NAME = "default.json";
const DRAFT_POINTER_COOKIE = "stack_structure_studio_draft";
const LOCAL_DRAFT_PATH = path.join(process.cwd(), ".tmp", "studio-drafts", DRAFT_FILE_NAME);

function draftStoragePath(userId: string) {
  return normalizeMediaPath(`${DRAFT_FOLDER}/${encodeURIComponent(userId)}.json`);
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return unauthorizedResponse("Sign in with GitHub to load the studio draft.");
  try {
    if (studioDraftLocalCacheEnabled()) {
      const localDraft = await readLocalDraft();
      if (localDraft) {
        return Response.json({ success: true, draft: localDraft, storagePath: draftStoragePath(user.id), source: "local-cache" });
      }
    }

    const config = getMediaGatewayConfig();
    if (!config) return missingGatewayResponse();

    const legacyStoragePath = draftStoragePath(user.id);
    const pointer = (await cookies()).get(DRAFT_POINTER_COOKIE)?.value;
    const candidates = pointer && isOwnedDraftStoragePath(pointer, user.id)
      ? [pointer, legacyStoragePath]
      : [legacyStoragePath];

    for (const storagePath of candidates) {
      const response = await fetch(buildMediaGatewayFileUrl(config, config.bucket, storagePath), {
        headers: { Authorization: `Bearer ${config.token}` },
        cache: "no-store",
      });
      if (response.status === 404) continue;

      const text = await response.text();
      if (!response.ok) {
        return Response.json(
          { success: false, error: `Studio draft fetch failed (${response.status}): ${text.slice(0, 300)}` },
          { status: response.status },
        );
      }

      const draft = parseDraft(text);
      if (!draft) {
        return Response.json({ success: false, error: "Stored studio draft is invalid." }, { status: 422 });
      }
      return Response.json({ success: true, draft, storagePath, source: "remote" });
    }
    return Response.json({ success: true, draft: null, storagePath: legacyStoragePath });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Studio draft fetch failed";
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  return saveDraft(request);
}

export async function POST(request: Request) {
  return saveDraft(request);
}

async function saveDraft(request: Request) {
  const user = await getSessionUser();
  if (!user) return unauthorizedResponse("Sign in with GitHub to save the studio draft.");
  try {
    const body = await request.json() as { draft?: unknown } | unknown;
    const draft = isDraftEnvelope(body) ? body.draft : body;

    if (!isPersistedDraft(draft)) {
      return Response.json({ success: false, error: "Persisted studio draft payload required." }, { status: 400 });
    }

    const savedDraft: PersistedStudioProjectDraft = {
      ...draft,
      savedAt: new Date().toISOString(),
    };
    if (studioDraftLocalCacheEnabled()) {
      await writeLocalDraft(savedDraft);
    }

    const uploaded = await uploadJsonToMediaGateway({
      data: { ...savedDraft, ownerId: user.id },
      fileName: `${encodeURIComponent(user.id)}.json`,
      folder: DRAFT_FOLDER,
      preserveFileName: true,
    });

    const response = NextResponse.json({ success: true, draft: savedDraft, storage: uploaded });
    response.cookies.set(DRAFT_POINTER_COOKIE, uploaded.storagePath, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Studio draft save failed";
    const status = /Missing RustFS media gateway env/i.test(message) ? 503 : 500;
    return Response.json({ success: false, error: message }, { status });
  }
}

export function isOwnedDraftStoragePath(storagePath: string, userId: string) {
  const normalized = normalizeMediaPath(storagePath);
  const prefix = `${DRAFT_FOLDER}/`;
  if (!normalized.startsWith(prefix)) return false;

  const fileName = normalized.slice(prefix.length);
  if (!fileName || fileName.includes("/")) return false;
  const expectedName = `${encodeURIComponent(userId)}.json`;
  return fileName === expectedName || /^\d+-/.test(fileName) && fileName.endsWith(`-${expectedName}`);
}

export function studioDraftLocalCacheEnabled(env: Record<string, string | undefined> = process.env) {
  return env.NODE_ENV !== "production";
}

function parseDraft(text: string): PersistedStudioProjectDraft | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return isPersistedDraft(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function readLocalDraft(): Promise<PersistedStudioProjectDraft | null> {
  try {
    const raw = await readFile(LOCAL_DRAFT_PATH, "utf8");
    return parseDraft(raw);
  } catch {
    return null;
  }
}

async function writeLocalDraft(draft: PersistedStudioProjectDraft) {
  await mkdir(path.dirname(LOCAL_DRAFT_PATH), { recursive: true });
  await writeFile(LOCAL_DRAFT_PATH, JSON.stringify(draft, null, 2), "utf8");
}

function isDraftEnvelope(value: unknown): value is { draft: unknown } {
  return value !== null && typeof value === "object" && !Array.isArray(value) && "draft" in value;
}

function isPersistedDraft(value: unknown): value is PersistedStudioProjectDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<PersistedStudioProjectDraft>;
  return (record.version === 1 || record.version === 2) && Boolean(record.storyState) && Array.isArray(record.videoSources);
}

function missingGatewayResponse() {
  return Response.json(
    {
      success: false,
      error: "Missing RustFS media gateway env. Required: MEDIA_GATEWAY_URL/RUSTFS_MEDIA_API_URL and MEDIA_GATEWAY_TOKEN/MEDIA_API_TOKEN",
    },
    { status: 503 },
  );
}
