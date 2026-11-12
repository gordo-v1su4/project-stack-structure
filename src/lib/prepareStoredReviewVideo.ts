import { GetObjectCommand } from "@aws-sdk/client-s3";
import { mkdir, mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { prepareReviewVideo, ReviewVideoPreparationError } from "./prepareReviewVideo";
import { assertReviewVideoSource, readPreparedReviewVideo, storePreparedReviewVideo, type ReviewVideoSource } from "./preparedReviewVideoStore";
import { canReadMediaObject } from "./studioMediaAccess";
import { studioMediaStorage } from "./studioProjectObjectStore";

type Options = { storage?: typeof studioMediaStorage; authorize?: typeof canReadMediaObject; encode?: typeof prepareReviewVideo;
  tempRoot?: string; signal?: AbortSignal; onStage?: (stage: string) => void };

/** CPU-only preparation. Callers dispatch via Trigger; this does not alter any project or take. */
export async function prepareStoredReviewVideo(source: ReviewVideoSource, options: Options = {}) {
  assertReviewVideoSource(source);
  const storage = options.storage ?? studioMediaStorage;
  if (!await (options.authorize ?? canReadMediaObject)({ userId: source.ownerId, bucket: source.bucket, objectKey: source.objectKey })) {
    throw new ReviewVideoPreparationError("Review video does not belong to the current user.", "unsupported");
  }
  const { client, bucket } = storage();
  if (bucket !== source.bucket) throw new ReviewVideoPreparationError("Invalid review-video bucket.", "unsupported");
  options.signal?.throwIfAborted();
  options.onStage?.("Checking prepared review media");
  const ready = await readPreparedReviewVideo(source, storage);
  if (ready) return ready;
  const root = resolve(options.tempRoot ?? (process.platform === "win32" ? join(process.cwd(), ".tmp/review-media") : tmpdir()));
  await mkdir(root, { recursive: true });
  const folder = await mkdtemp(join(root, "stack-review-source-"));
  try {
    options.onStage?.("Reading the pinned source video");
    const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000);
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: source.objectKey, IfMatch: source.etag }), { abortSignal: signal }).catch(error => {
      if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 412) throw new ReviewVideoPreparationError("Stored source video changed before preparation.", "source-changed");
      throw error;
    });
    if (!response.Body) throw new ReviewVideoPreparationError("Stored source video is unavailable.", "process-failed");
    const stream = response.Body.transformToWebStream();
    if (response.ETag !== source.etag || response.ContentLength !== source.bytes) {
      await stream.cancel(); throw new ReviewVideoPreparationError("Stored source video changed before preparation.", "source-changed");
    }
    const file = join(folder, "source.video"), handle = await open(file, "wx"), reader = stream.getReader(); let size = 0;
    try {
      for (;;) {
        signal.throwIfAborted();
        const part = await reader.read(); if (part.done) break;
        size += part.value.byteLength;
        if (size > source.bytes) throw new ReviewVideoPreparationError("Stored source video exceeds its pinned size.", "source-changed");
        await handle.writeFile(part.value);
      }
      if (size !== source.bytes) throw new ReviewVideoPreparationError("Stored source video was incomplete.", "source-changed");
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); await handle.close(); }
    const prepared = await (options.encode ?? prepareReviewVideo)(file, { signal: options.signal, tempRoot: folder,
      onStage: stage => options.onStage?.(`Preparing review ${stage}`) });
    options.signal?.throwIfAborted();
    options.onStage?.("Persisting review media");
    return await storePreparedReviewVideo(source, prepared, storage);
  } finally {
    if (!resolve(folder).startsWith(root + sep)) throw new Error("Review source cleanup escaped its temporary root.");
    await rm(folder, { recursive: true, force: true });
  }
}
