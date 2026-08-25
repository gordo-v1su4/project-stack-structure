import { createHash } from "node:crypto";

import {
  downloadJsonFromMediaGateway,
  normalizeMediaPath,
  uploadJsonToMediaGateway,
} from "@/lib/mediaGateway";
import {
  essentiaUploadOwnerSegment,
  isUnscopedLegacyMediaKey,
  mediaUploadBelongsToOwner,
} from "@/lib/essentiaUpload";

/**
 * Ownership ledger for durable media references. New uploads carry their owner
 * segment directly in the object key; keys persisted before owner scoping are
 * claimed into the ledger the first time their legitimate uploader exports, so
 * saved projects keep working without weakening the dispatch-time check.
 */

type OwnershipClaim = {
  schema: "stack-structure.media-ownership.v1";
  objectKey: string;
  ownerId: string;
  claimedAt: string;
};

function claimMarkerKey(objectKey: string, ownerId: string) {
  const digest = createHash("sha256").update(`${ownerId}\n${normalizeMediaPath(objectKey)}`).digest("hex");
  return `media-uploads/.ownership/${essentiaUploadOwnerSegment(ownerId)}/${digest}.json`;
}

async function readClaim(args: { bucket: string; objectKey: string; ownerId: string }): Promise<OwnershipClaim | null> {
  try {
    const claim = await downloadJsonFromMediaGateway<OwnershipClaim>({
      bucket: args.bucket,
      objectKey: claimMarkerKey(args.objectKey, args.ownerId),
    });
    return claim?.schema === "stack-structure.media-ownership.v1" ? claim : null;
  } catch {
    return null;
  }
}

export async function authorizeMediaObject(args: {
  bucket: string;
  objectKey: string;
  ownerId: string;
}): Promise<boolean> {
  const objectKey = normalizeMediaPath(args.objectKey);
  if (mediaUploadBelongsToOwner(objectKey, args.ownerId)) return true;
  if (!isUnscopedLegacyMediaKey(objectKey)) return false;

  const existing = await readClaim({ bucket: args.bucket, objectKey, ownerId: args.ownerId });
  if (existing) return true;

  await uploadJsonToMediaGateway({
    data: {
      schema: "stack-structure.media-ownership.v1",
      objectKey,
      ownerId: args.ownerId,
      claimedAt: new Date().toISOString(),
    } satisfies OwnershipClaim,
    fileName: `${createHash("sha256").update(`${args.ownerId}\n${objectKey}`).digest("hex")}.json`,
    folder: `media-uploads/.ownership/${essentiaUploadOwnerSegment(args.ownerId)}`,
  });
  return true;
}
