import { S3Client } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { getMediaThumbnail } from "../../src/lib/mediaThumbnail";
import { preparedThumbnailPersistence } from "../../src/lib/preparedThumbnailStore";

// Isolated loopback S3 protocol fixture: never uses production configuration.
const [endpoint, file, mode, sha256] = process.argv.slice(2);
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint) || !["prepare", "reload"].includes(mode)
  || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error("Invalid thumbnail test input.");
const client = new S3Client({ endpoint, region: "us-east-1", forcePathStyle: true, maxAttempts: 1,
  credentials: { accessKeyId: "fixture-access", secretAccessKey: "fixture-secret" },
  requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" });
try {
  let loads = 0;
  const persistence = preparedThumbnailPersistence({ ownerId: "thumbnail-fixture", bucket: "stack-structure",
    objectKey: "media-uploads/thumbnail-fixture/original.png", sha256, width: 320 }, () => ({ client, bucket: "stack-structure", fingerprint: "fixture" }));
  const result = await getMediaThumbnail("same-key-in-independent-processes", 320, async () => {
    loads++;
    if (mode === "reload") throw new Error("A restarted process must use the stored derivative.");
    const png = new Uint8Array(await readFile(file));
    return new Response(png, { headers: { "content-type": "image/png" } });
  }, persistence);
  console.log(JSON.stringify({ loads, durable: result.durable, bytes: result.bytes.byteLength, etag: result.etag,
    sha256: createHash("sha256").update(result.bytes).digest("hex") }));
} finally { client.destroy(); }
