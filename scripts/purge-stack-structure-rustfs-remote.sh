#!/usr/bin/env bash
# Purge ONLY stack-structure bucket objects under media-uploads/.
# Does not touch pindeck, storyception, super-seed2, or any other bucket.
set -euo pipefail

BUCKET="stack-structure"
PREFIX="media-uploads/"

if [[ "${CONFIRM_STACK_STRUCTURE_ONLY:-}" != "1" ]]; then
  echo "Refusing to run without CONFIRM_STACK_STRUCTURE_ONLY=1" >&2
  echo "This deletes only ${BUCKET}/${PREFIX}* — no other RustFS apps." >&2
  exit 1
fi

export RUSTFS_BUCKET="$BUCKET"
export RUSTFS_PREFIX="$PREFIX"

docker exec rustfs-media-api node --input-type=module - <<'NODE'
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";

const bucket = "stack-structure";
const prefix = "media-uploads/";

if (process.env.RUSTFS_BUCKET && process.env.RUSTFS_BUCKET !== bucket) {
  throw new Error(`Refusing bucket ${process.env.RUSTFS_BUCKET}; only ${bucket} is allowed.`);
}
if (!prefix.startsWith("media-uploads/")) {
  throw new Error(`Refusing prefix ${prefix}`);
}

const s3 = new S3Client({
  region: process.env.RUSTFS_REGION || "us-east-1",
  endpoint: process.env.RUSTFS_S3_ENDPOINT,
  forcePathStyle: process.env.RUSTFS_FORCE_PATH_STYLE !== "false",
  credentials: {
    accessKeyId: process.env.RUSTFS_ACCESS_KEY || "",
    secretAccessKey: process.env.RUSTFS_SECRET_KEY || "",
  },
});

let token;
let deleted = 0;
let batches = 0;

do {
  const out = await s3.send(new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: prefix,
    MaxKeys: 1000,
    ContinuationToken: token,
  }));
  const keys = (out.Contents ?? [])
    .map((entry) => entry.Key)
    .filter((key) => typeof key === "string" && key.startsWith("media-uploads/"));
  if (keys.length) {
    await s3.send(new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
    }));
    deleted += keys.length;
    batches += 1;
    process.stderr.write(`deleted batch ${batches}: ${keys.length} objects from ${bucket}/${prefix}\n`);
  }
  token = out.NextContinuationToken;
} while (token);

console.log(JSON.stringify({ bucket, prefix, deleted, batches }));
NODE
