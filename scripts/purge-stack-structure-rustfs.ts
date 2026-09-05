/**
 * Purge Stack Structure studio objects from RustFS.
 *
 * SAFETY: This script only ever targets the Stack Structure app bucket
 * (`stack-structure`) and keys under `media-uploads/`. It never touches
 * other RustFS apps (pindeck, storyception, super-seed2, etc.).
 *
 * Modes:
 * 1. Known-object delete from saved project/draft manifests (media gateway token).
 * 2. Optional full prefix wipe when RUSTFS_ACCESS_KEY + RUSTFS_SECRET_KEY are set
 *    AND `--confirm-stack-structure-only` is passed.
 *
 * Usage:
 *   bun run scripts/purge-stack-structure-rustfs.ts --dry-run
 *   bun run scripts/purge-stack-structure-rustfs.ts --owner github-179914528 --confirm-stack-structure-only
 *   bun run scripts/purge-stack-structure-rustfs.ts --confirm-stack-structure-only --full-prefix
 */

import { readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import {
  deleteMediaGatewayFiles,
  downloadJsonFromMediaGateway,
  getMediaGatewayConfig,
  normalizeMediaPath,
} from "../src/lib/mediaGateway";

const ALLOWED_BUCKET = "stack-structure";
const ALLOWED_PREFIX = "media-uploads";

type DraftLike = {
  analysis?: { storagePath?: string; uploadChunks?: { chunks?: Array<{ objectKey?: string }> } | null } | null;
  videoSources?: Array<{
    storagePath?: string;
    captionManifestPath?: string;
    uploadChunks?: { chunks?: Array<{ objectKey?: string }> } | null;
  } | null>;
  referenceAssets?: Array<{ storagePath?: string } | null>;
  generatedAssets?: Array<{ fullStorage?: { objectKey?: string; storagePath?: string } } | null>;
} | null;

function loadEnvLocal() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const match = /^([^#=]+)=(.*)$/.exec(line.trim());
    if (!match) continue;
    const [, key, raw] = match;
    process.env[key] = raw.replace(/^['"]|['"]$/g, "");
  }
}

function assertStackStructureScope(bucket: string, objectKey: string) {
  if (bucket !== ALLOWED_BUCKET) {
    throw new Error(`Refusing delete outside bucket ${ALLOWED_BUCKET}: ${bucket}`);
  }
  const normalized = normalizeMediaPath(objectKey);
  if (!normalized.startsWith(`${ALLOWED_PREFIX}/`) && normalized !== ALLOWED_PREFIX) {
    throw new Error(`Refusing delete outside ${ALLOWED_PREFIX}/: ${objectKey}`);
  }
  if (normalized.includes("/pindeck/") || normalized.startsWith("pindeck/")) {
    throw new Error(`Refusing cross-app key: ${objectKey}`);
  }
  return normalized;
}

function filterStackStructureKeys(objectKeys: Iterable<string>) {
  const allowed: string[] = [];
  const skipped: string[] = [];
  for (const objectKey of objectKeys) {
    const normalized = normalizeMediaPath(objectKey);
    if (!normalized.startsWith(`${ALLOWED_PREFIX}/`) && normalized !== ALLOWED_PREFIX) {
      skipped.push(normalized);
      continue;
    }
    allowed.push(assertStackStructureScope(ALLOWED_BUCKET, normalized));
  }
  if (skipped.length) {
    console.warn(JSON.stringify({
      skippedOutsideStackStructurePrefix: skipped.length,
      sample: skipped.slice(0, 10),
    }));
  }
  return [...new Set(allowed)].sort();
}

function collectKeysFromDraft(draft: DraftLike, keys: Set<string>) {
  if (!draft) return;
  if (draft.analysis?.storagePath) keys.add(normalizeMediaPath(draft.analysis.storagePath));
  for (const chunk of draft.analysis?.uploadChunks?.chunks ?? []) {
    if (chunk?.objectKey) keys.add(normalizeMediaPath(chunk.objectKey));
  }
  for (const source of draft.videoSources ?? []) {
    if (!source) continue;
    if (source.storagePath) keys.add(normalizeMediaPath(source.storagePath));
    if (source.captionManifestPath) keys.add(normalizeMediaPath(source.captionManifestPath));
    for (const chunk of source.uploadChunks?.chunks ?? []) {
      if (chunk?.objectKey) keys.add(normalizeMediaPath(chunk.objectKey));
    }
  }
  for (const asset of draft.referenceAssets ?? []) {
    if (asset?.storagePath) keys.add(normalizeMediaPath(asset.storagePath));
  }
  for (const asset of draft.generatedAssets ?? []) {
    const objectKey = asset?.fullStorage?.objectKey ?? asset?.fullStorage?.storagePath;
    if (objectKey) keys.add(normalizeMediaPath(objectKey));
  }
}

function discoverOwnerIds(args: string[]) {
  const owners = new Set<string>();
  for (const arg of args) {
    if (arg.startsWith("--owner=")) owners.add(arg.slice("--owner=".length));
    else if (!arg.startsWith("--")) owners.add(arg);
  }
  const cacheRoot = path.join(process.cwd(), ".tmp", "studio-projects");
  if (existsSync(cacheRoot)) {
    for (const entry of readdirSync(cacheRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) owners.add(entry.name);
    }
  }
  return [...owners];
}

async function collectKnownKeys(ownerId: string, keys: Set<string>) {
  const config = getMediaGatewayConfig();
  if (!config) throw new Error("Missing media gateway env.");
  if (config.bucket !== ALLOWED_BUCKET) {
    throw new Error(`Configured bucket ${config.bucket} is not ${ALLOWED_BUCKET}. Aborting.`);
  }

  const segment = ownerId.trim().replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 128);
  keys.add(`media-uploads/studio-drafts/${encodeURIComponent(ownerId)}.json`);
  keys.add(`media-uploads/projects/${segment}/index.json`);

  try {
    const index = await downloadJsonFromMediaGateway<{ projects?: Array<{ id?: string; storageFolder?: string }> }>({
      bucket: config.bucket,
      objectKey: `media-uploads/projects/${segment}/index.json`,
    });
    for (const project of index?.projects ?? []) {
      if (!project?.id) continue;
      const objectKey = project.storageFolder
        ? `${normalizeMediaPath(project.storageFolder)}/project.json`
        : `media-uploads/projects/${segment}/${project.id}/project.json`;
      keys.add(objectKey);
      if (project.storageFolder) {
        keys.add(normalizeMediaPath(project.storageFolder));
      }
      try {
        const saved = await downloadJsonFromMediaGateway<{ draft?: DraftLike }>({
          bucket: config.bucket,
          objectKey,
        });
        collectKeysFromDraft(saved?.draft ?? null, keys);
      } catch {
        // unreadable project record
      }
    }
  } catch {
    // no remote index
  }

  const cacheDir = path.join(process.cwd(), ".tmp", "studio-projects", segment);
  if (existsSync(cacheDir)) {
    for (const entry of readdirSync(cacheDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const projectPath = path.join(cacheDir, entry.name, "project.json");
      if (!existsSync(projectPath)) continue;
      try {
        const saved = JSON.parse(readFileSync(projectPath, "utf8")) as { draft?: DraftLike };
        collectKeysFromDraft(saved.draft ?? null, keys);
        keys.add(`media-uploads/projects/${segment}/${entry.name}/project.json`);
      } catch {
        // ignore bad cache
      }
    }
  }
}

async function purgePrefixWithS3(prefix: string, dryRun: boolean) {
  const endpoint = process.env.RUSTFS_S3_ENDPOINT || "https://s3.v1su4.dev";
  const accessKeyId = process.env.RUSTFS_ACCESS_KEY;
  const secretAccessKey = process.env.RUSTFS_SECRET_KEY;
  if (!accessKeyId || !secretAccessKey) return null;

  const bucket = ALLOWED_BUCKET;
  const normalizedPrefix = normalizeMediaPath(prefix);
  if (normalizedPrefix !== ALLOWED_PREFIX && !normalizedPrefix.startsWith(`${ALLOWED_PREFIX}/`)) {
    throw new Error(`Refusing S3 prefix outside ${ALLOWED_PREFIX}/: ${prefix}`);
  }

  const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } = await import("@aws-sdk/client-s3");
  const s3 = new S3Client({
    region: process.env.RUSTFS_REGION || "us-east-1",
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });

  let token: string | undefined;
  let deleted = 0;
  let listed = 0;
  do {
    const out = await s3.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: `${normalizedPrefix}/`,
      MaxKeys: 1000,
      ContinuationToken: token,
    }));
    const keys = filterStackStructureKeys(
      (out.Contents ?? []).map((entry) => entry.Key).filter((key): key is string => Boolean(key)),
    );
    listed += keys.length;
    if (keys.length && !dryRun) {
      await s3.send(new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
      }));
      deleted += keys.length;
    }
    token = out.NextContinuationToken;
  } while (token);

  return { bucket, prefix: `${normalizedPrefix}/`, listed, deleted, dryRun };
}

async function main() {
  loadEnvLocal();
  const dryRun = process.argv.includes("--dry-run");
  const confirmed = process.argv.includes("--confirm-stack-structure-only");
  const fullPrefix = process.argv.includes("--full-prefix");
  const owners = discoverOwnerIds(process.argv.slice(2).filter((arg) => !arg.startsWith("--")));
  const config = getMediaGatewayConfig();
  if (!config) throw new Error("Missing MEDIA_GATEWAY_URL/TOKEN in .env.local");
  if (config.bucket !== ALLOWED_BUCKET) {
    throw new Error(`Configured bucket ${config.bucket} is not ${ALLOWED_BUCKET}. Aborting.`);
  }

  const prefix = normalizeMediaPath(config.uploadPrefix || ALLOWED_PREFIX);
  if (prefix !== ALLOWED_PREFIX) {
    throw new Error(`Configured upload prefix ${prefix} is not ${ALLOWED_PREFIX}. Aborting.`);
  }

  if (!confirmed && !dryRun) {
    throw new Error(
      "Refusing to delete without --confirm-stack-structure-only. "
      + "This script only deletes stack-structure/media-uploads objects. "
      + "Pass --dry-run to preview.",
    );
  }

  if (fullPrefix) {
    const s3Result = await purgePrefixWithS3(prefix, dryRun);
    if (s3Result) {
      console.log(JSON.stringify({ mode: "s3-prefix", ...s3Result }, null, 2));
    } else {
      console.log(JSON.stringify({
        mode: "s3-prefix",
        skipped: true,
        reason: "RUSTFS_ACCESS_KEY/RUSTFS_SECRET_KEY not set; use known-object mode or set S3 creds for --full-prefix.",
      }, null, 2));
    }
  }

  const keys = new Set<string>();
  for (const owner of owners) await collectKnownKeys(owner, keys);
  const objectKeys = filterStackStructureKeys(keys);
  console.log(JSON.stringify({
    mode: "known-objects",
    bucket: ALLOWED_BUCKET,
    prefix: `${ALLOWED_PREFIX}/`,
    owners,
    objectKeyCount: objectKeys.length,
    sample: objectKeys.slice(0, 20),
    dryRun,
  }, null, 2));

  if (dryRun || !objectKeys.length) return;

  const batchSize = 200;
  let deleted = 0;
  for (let index = 0; index < objectKeys.length; index += batchSize) {
    const batch = objectKeys.slice(index, index + batchSize);
    const result = await deleteMediaGatewayFiles({ bucket: ALLOWED_BUCKET, objectKeys: batch });
    deleted += result.deleted;
  }
  console.log(JSON.stringify({ mode: "known-objects", deleted, objectKeyCount: objectKeys.length }, null, 2));

  const cacheRoot = path.join(process.cwd(), ".tmp", "studio-projects");
  if (existsSync(cacheRoot)) {
    rmSync(cacheRoot, { recursive: true, force: true });
    console.log(JSON.stringify({ clearedLocalCache: cacheRoot }, null, 2));
  }
}

await main();
