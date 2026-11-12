/** Lightweight viewing derivative; never use this URL for conditioning or export. */
export function mediaThumbnailUrl(image: { bucket: string; objectKey: string; sha256?: string }, width: 320 | 640 = 320) {
  return `/api/storage/media?${new URLSearchParams({ bucket: image.bucket, objectKey: image.objectKey,
    thumbnail: String(width), ...(image.sha256 ? { v: image.sha256 } : {}) })}`;
}

/** Normalize legacy internal still references too; keep their version binding. */
export function viewingThumbnailUrl(value: string) {
  try {
    const url = new URL(value, "https://studio.invalid");
    if (url.origin === "https://studio.invalid" && url.pathname === "/api/storage/media"
      && url.searchParams.has("bucket") && url.searchParams.has("objectKey")) {
      if (/\.(mp4|mov|mkv|webm|m4v)$/i.test(url.searchParams.get("objectKey")!)) return "";
      url.searchParams.set("thumbnail", "320");
      return `${url.pathname}${url.search}`;
    }
    return value;
  } catch { return ""; }
}
