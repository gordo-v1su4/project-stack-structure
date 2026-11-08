import { normalizeMediaPath } from "@/lib/mediaGateway";

export const STUDIO_DRAFT_FOLDER = "media-uploads/studio-drafts";

export function isOwnedDraftStoragePath(storagePath: string, userId: string) {
  const normalized = normalizeMediaPath(storagePath);
  const prefix = `${STUDIO_DRAFT_FOLDER}/`;
  if (!normalized.startsWith(prefix)) return false;

  const fileName = normalized.slice(prefix.length);
  if (!fileName || fileName.includes("/")) return false;
  const expectedName = `${encodeURIComponent(userId)}.json`;
  return fileName === expectedName || /^\d+-/.test(fileName) && fileName.endsWith(`-${expectedName}`);
}

export function studioDraftLocalCacheEnabled(env: Record<string, string | undefined> = process.env) {
  return env.NODE_ENV !== "production";
}
