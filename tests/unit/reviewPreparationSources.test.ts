import { expect, test } from "bun:test";
import { reviewPreparationSources } from "@/components/studio/reviewPreparationSources";
import type { GeneratedStudioAsset } from "@/components/studio/generatedAssets";
import { publishReviewPoster, subscribeReviewPoster } from "@/components/studio/reviewPosterArrivals";

test("bulk inventory deduplicates stored originals and excludes images, unfinished and remote videos", () => {
  const fullStorage = { bucket: "studio", objectKey: "media-uploads/video.mp4" };
  const asset = { id: "video", title: "Retained take", status: "completed", mediaKind: "video", fullStorage } as GeneratedStudioAsset;
  const videos = [{ name: "Original", storageBucket: "studio", storagePath: fullStorage.objectKey }];
  const assets = [asset, { ...asset, id: "image", mediaKind: "image" }, { ...asset, status: "processing" },
    { ...asset, id: "remote", fullStorage: undefined, resultUrl: "https://provider.invalid/video.mp4" },
    { ...asset, id: "second", fullStorage: { ...fullStorage, objectKey: "media-uploads/second.MOV" } }] as GeneratedStudioAsset[];
  const before = JSON.stringify({ videos, assets });
  expect(reviewPreparationSources(videos, assets)).toEqual([
    { bucket: "studio", objectKey: fullStorage.objectKey, label: "Original" },
    { bucket: "studio", objectKey: "media-uploads/second.MOV", label: "Retained take" },
  ]);
  expect(JSON.stringify({ videos, assets })).toBe(before);
});
test("poster arrivals are source scoped, ephemeral and removable without cached broadcasts", () => {
  const source = { bucket: "studio", objectKey: "original.mp4" }, received: string[] = [];
  const remove = subscribeReviewPoster(source, value => received.push(value.posterKey));
  publishReviewPoster({ ...source, bucket: "foreign", posterKey: "wrong" });
  publishReviewPoster({ ...source, posterKey: "ready.webp" }); remove();
  publishReviewPoster({ ...source, posterKey: "late.webp" });
  const removeNext = subscribeReviewPoster(source, value => received.push(value.posterKey)); removeNext();
  expect(received).toEqual(["ready.webp"]);
});
