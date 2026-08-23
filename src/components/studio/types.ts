export type Tab = "review" | "story" | "compose" | "split" | "beatsplit" | "shuffle" | "generate" | "join" | "beatjoin" | "ramp";

export type ShuffleMode = "simple" | "size" | "color" | "motion";

export type RampPreset =
  | "subtle"
  | "dynamic"
  | "extreme"
  | "cinematic"
  | "pulseTrain"
  | "sawLift"
  | "gateChop"
  | "halfTimeBloom"
  | "doubleTimeRush"
  | "glitchSteps";

export type StutterPreset =
  | "steadyPulse"
  | "tightChop"
  | "ghostFrame"
  | "riserScatter"
  | "dropLatch"
  | "liquidRoll"
  | "syncopate"
  | "holdAndBurst"
  | "microMachine"
  | "breathingCuts";

export type ColorGradient = "Rainbow" | "Sunset" | "Ocean";

export type JoinClip = { id: number; on: boolean };


export type MotionTargetKind = "file" | "segment";

export type MotionProvenanceKind = "ffmpeg-motion-vectors" | "optical-flow" | "manual" | "placeholder";

export type CameraMotionType = "static" | "pan" | "tilt" | "push" | "pull" | "roll" | "mixed" | "unknown";

export interface MotionProvenance {
  kind: MotionProvenanceKind;
  tool: string;
  version?: string | null;
  generatedAt: string;
  notes?: string | null;
}

export interface MotionConfidence {
  overall: number;
  camera: number;
  residual: number;
}

export interface MotionDescriptor {
  id: string;
  targetKind: MotionTargetKind;
  filePath: string;
  segmentId?: number | null;
  start?: number | null;
  end?: number | null;
  dominantAngleDeg: number | null;
  dominantMagnitude: number | null;
  motionCoherence: number | null;
  cameraMotionType: CameraMotionType;
  cameraMotionStrength: number | null;
  residualMotionStrength: number | null;
  motionEntropy: number | null;
  acceleration: number | null;
  angleHistogram?: number[] | null;
  magnitudeP50?: number | null;
  magnitudeP90?: number | null;
  confidence: MotionConfidence;
  provenance: MotionProvenance;
}

export interface ColorPaletteSwatch {
  hex?: string;
  l?: number;
  a?: number;
  b?: number;
  weight: number;
}

export interface SceneColorAnalysis {
  palette: ColorPaletteSwatch[];
  firstPalette?: ColorPaletteSwatch[];
  middlePalette?: ColorPaletteSwatch[];
  lastPalette?: ColorPaletteSwatch[];
  paletteDistanceStartEnd?: number | null;
}

export interface SceneVisualAnalysis {
  schema?: string;
  analyzerVersion?: string;
  contentHash?: string;
  keyframeTimestamps?: number[];
  color?: SceneColorAnalysis;
  motion?: MotionDescriptor | null;
  generatedAt?: string;
}

export type SceneSplitStatus = "idle" | "uploading" | "detecting" | "ready" | "failed";
export type MediaStorageStatus = "local" | "uploading" | "uploaded" | "failed";
export type SceneCaptionStatus = "idle" | "captioning" | "ready" | "failed";
export type SceneCaptionMode = "fast" | "smart";
export type SceneCaptionSource = "lfm-webgpu" | "lfm-server" | "qwen3-vl-server" | "manual" | "imported";

export interface SceneCaptionContext {
  songTitle?: string;
  vocalStemName?: string;
  lyricExcerpt?: string;
  storySummary?: string;
  storyPrompts?: string[];
  projectIntent?: string;
}

export interface SceneCaptionSettings {
  mode: SceneCaptionMode;
  context?: SceneCaptionContext;
}

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

export interface DetectedSceneSegment {
  id: number;
  sourceClipId: number;
  label: string;
  start: number;
  end: number;
  duration: number;
  thumbnailUrl?: string;
  firstFrameUrl?: string;
  middleFrameUrl?: string;
  lastFrameUrl?: string;
  storyboardUrl?: string;
  sampleTimes?: {
    first?: number;
    middle?: number;
    last?: number;
  };
  clipUrl?: string;
  assetPath?: string;
  detector: "pyscenedetect-adaptive";
  confidence?: number | null;
  caption?: string;
  captionMeta?: SceneCaptionData;
  captionSource?: SceneCaptionSource;
  captionMode?: SceneCaptionMode;
  captionModel?: string;
  captionSampleStrategy?: string;
  captionError?: string | null;
  visualAnalysis?: SceneVisualAnalysis;
  motionDescriptor?: MotionDescriptor | null;
  contentHash?: string;
  keyframeTimestamps?: number[];
  splitKind?: "scene" | "micro-shot";
  parentSceneId?: number | null;
}

export interface UploadedVideoSource {
  id: number;
  name: string;
  duration: number;
  size: number;
  thumbnailUrl: string;
  videoUrl: string;
  storageProvider?: "local" | "rustfs";
  storageBucket?: string;
  storagePath?: string;
  storageUrl?: string;
  storageStatus?: MediaStorageStatus;
  storageError?: string | null;
  uploadChunks?: { size: number; chunks: Array<{ bucket: string; objectKey: string }> } | null;
  scenes?: DetectedSceneSegment[];
  sceneStatus?: SceneSplitStatus;
  sceneJobId?: string;
  sceneError?: string | null;
  captionStatus?: SceneCaptionStatus;
  captionError?: string | null;
  captionManifestPath?: string;
  captionManifestUrl?: string;
}

export interface SegmentPreview {
  clipId: number;
  label: string;
  duration: number;
  thumbnailUrl?: string;
  sourceClipIds: number[];
  sourceRefLabel?: string;
  timeLabel?: string;
  sourceStart?: number;
  sourceEnd?: number;
  motionDescriptor?: MotionDescriptor | null;
}

export interface BeatJoinSection {
  label: string;
  start: number;
  end: number;
  energy?: number;
}

export interface BeatJoinAnalysis {
  sourceLabel: string;
  audioUrl: string;
  waveform: number[];
  energy: number[];
  beats: number[];
  onsets: number[];
  sections: BeatJoinSection[];
  duration: number;
  storageProvider?: "local" | "rustfs";
  storageBucket?: string;
  storagePath?: string;
  storageUrl?: string;
  storageStatus?: MediaStorageStatus;
  storageError?: string | null;
}
