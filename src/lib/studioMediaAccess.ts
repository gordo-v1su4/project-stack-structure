import {
  buildMediaGatewayFileUrl,
  downloadJsonFromMediaGateway,
  getMediaGatewayConfig,
  normalizeMediaPath,
} from "@/lib/mediaGateway";
import { mediaUploadBelongsToOwner } from "@/lib/essentiaUpload";

/**
 * Media access resolution for durable references. Ownership is proven two ways:
 * 1. Owner-segmented keys (server-inserted at upload time) pass immediately.
 * 2. Legacy unscoped keys pass when they appear in the caller's saved studio
 *    draft or one of their named projects — the server-side records written by
 *    their own session.
 */

type StoredDraftLike = {
  analysis?: { storagePath?: string } | null;
  videoSources?: Array<{
    storagePath?: string;
    uploadChunks?: { chunks?: Array<{ objectKey?: string }> } | null;
  } | null>;
} | null;

function ownerSegmentOf(ownerId: string) {
  return ownerId.trim().replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 128);
}

async function collectOwnedKeysFromObject(config: NonNullable<ReturnType<typeof getMediaGatewayConfig>>, objectKey: string, owned: Set<string>) {
  try {
    const draft = await downloadJsonFromMediaGateway<StoredDraftLike>({ bucket: config.bucket, objectKey });
    if (draft?.analysis?.storagePath) owned.add(normalizeMediaPath(draft.analysis.storagePath));
    for (const source of draft?.videoSources ?? []) {
      if (!source) continue;
      if (source.storagePath) owned.add(normalizeMediaPath(source.storagePath));
      for (const chunk of source.uploadChunks?.chunks ?? []) {
        if (chunk?.objectKey) owned.add(normalizeMediaPath(chunk.objectKey));
      }
    }
  } catch {
    // Missing or unreadable records simply contribute nothing.
  }
}

export async function loadUserOwnedMediaKeys(userId: string): Promise<Set<string>> {
  const config = getMediaGatewayConfig();
  const owned = new Set<string>();
  if (!config) return owned;

  const segment = ownerSegmentOf(userId);
  await collectOwnedKeysFromObject(config, `media-uploads/studio-drafts/${encodeURIComponent(userId)}.json`, owned);

  try {
    const index = await downloadJsonFromMediaGateway<{ projects?: Array<{ id?: string }> }>({
      bucket: config.bucket,
      objectKey: `media-uploads/projects/${segment}/index.json`,
    });
    for (const entry of (index?.projects ?? []).slice(0, 5)) {
      if (!entry?.id) continue;
      await collectOwnedKeysFromObject(config, `media-uploads/projects/${segment}/${entry.id}/project.json`, owned);
    }
  } catch {
    // No readable project index; the default draft above is the only record.
  }

  return owned;
}

export async function canReadMediaObject(args: { userId: string; bucket: string; objectKey: string }): Promise<boolean> {
  const objectKey = normalizeMediaPath(args.objectKey);
  if (mediaUploadBelongsToOwner(objectKey, args.userId)) return true;

  const config = getMediaGatewayConfig();
  if (!config) return false;
  const owned = await loadUserOwnedMediaKeys(args.userId);
  return owned.has(objectKey);
}

export function gatewayFileUrlFor(config: { url: string }, bucket: string, objectKey: string) {
  return buildMediaGatewayFileUrl(config, bucket, objectKey);
}
