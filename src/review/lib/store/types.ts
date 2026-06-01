export type ReviewStatus = "in-review" | "needs-changes" | "approved";

export type AssetType = "video" | "image";

export interface SceneCaptionData {
  caption?: string;
  shotType?: string;
  subjects?: string[];
  action?: string;
  setting?: string;
  lighting?: string;
  timeOfDay?: string;
  weather?: string;
}

export interface SceneData {
  id: string;
  index: number;
  startTime: number;
  endTime: number;
  thumbnailUrl?: string;
  caption?: string;
  meta?: SceneCaptionData;
}

export type AnalysisStage =
  | "idle"
  | "probing"
  | "detecting"
  | "captioning"
  | "done"
  | "error";

export interface AssetVersion {
  id: string;
  label: string; // v1, v2 ...
  src: string; // object URL
  fps: number;
  width: number;
  height: number;
  codec: string;
  duration: number;
  fileSize: number;
  status: ReviewStatus;
  createdAt: number;
}

export interface Asset {
  id: string;
  name: string;
  type: AssetType;
  versions: AssetVersion[];
  currentVersionIndex: number;
  scenes: SceneData[];
  analysisStage: AnalysisStage;
  analysisProgress: number; // 0..1
  analysisLabel?: string;
  /** Operator-chosen poster frame. Falls back to first scene thumb / image src. */
  thumbnailOverride?: string;
}

export interface Comment {
  id: string;
  assetId: string;
  versionId: string;
  frame: number | null;
  timecode: number | null; // seconds
  author: string;
  body: string;
  annotationId: string | null;
  resolved: boolean;
  createdAt: number;
}

export interface VectorPath {
  tool: "pen" | "arrow" | "box" | "text";
  color: string;
  points: Array<{ x: number; y: number }>;
  text?: string;
}

export interface Annotation {
  id: string;
  versionId: string;
  frame: number;
  paths: VectorPath[];
}
