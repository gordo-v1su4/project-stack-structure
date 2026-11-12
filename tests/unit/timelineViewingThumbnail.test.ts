import { expect, test } from "bun:test";
import { mediaThumbnailUrl, viewingThumbnailUrl } from "@/components/studio/mediaThumbnailUrl";

test("timeline viewing normalizes legacy still URLs and retains the exact version without video fallback", () => {
  const image = { bucket: "studio", objectKey: "media-uploads/still.png", sha256: "a".repeat(64) };
  const url = new URL(viewingThumbnailUrl(mediaThumbnailUrl(image, 640)), "https://studio.invalid");
  expect(url.searchParams.get("thumbnail")).toBe("320");
  expect(url.searchParams.get("v")).toBe(image.sha256);
  expect(url.searchParams.get("objectKey")).toBe(image.objectKey);
  expect(viewingThumbnailUrl("/api/storage/media?bucket=studio&objectKey=media-uploads%2Fsource.mp4")).toBe("");
  expect(viewingThumbnailUrl("/api/storage/media?bucket=studio&objectKey=media-uploads%2Fold.png")).toContain("thumbnail=320");
  expect(viewingThumbnailUrl("blob:local-image")).toBe("blob:local-image");
});
