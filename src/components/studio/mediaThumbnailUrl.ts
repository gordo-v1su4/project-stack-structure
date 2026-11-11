/** Lightweight viewing derivative; never use this URL for conditioning or export. */
export function mediaThumbnailUrl(image: { bucket: string; objectKey: string; sha256?: string }, width: 320 | 640 = 320) {
  return `/api/storage/media?${new URLSearchParams({ bucket: image.bucket, objectKey: image.objectKey,
    thumbnail: String(width), ...(image.sha256 ? { v: image.sha256 } : {}) })}`;
}
