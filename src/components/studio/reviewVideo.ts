/** Viewing derivatives never become conditioning, identity or export inputs. */
export const REVIEW_VIDEO_RECIPE = "review-video-v1-640x360-h264-q26-sprite32";
export type ReviewVideoInfo = { sha256: string; bytes: number; width: number; height: number; duration: number;
  startTime: number; frameCount: number; frameRate: number; rotation: number };
export type ReviewVideoArtifact = { sha256: string; bytes: number; width: number; height: number; mime: string };
export type ReviewVideoMetadata = {
  version: 1; recipe: typeof REVIEW_VIDEO_RECIPE;
  source: ReviewVideoInfo;
  proxy: ReviewVideoArtifact & { duration: number; frameCount: number; sourceTimeOffset: number };
  poster: ReviewVideoArtifact;
  sprite: ReviewVideoArtifact & { columns: 8; rows: 4; count: 32; times: number[] };
};
