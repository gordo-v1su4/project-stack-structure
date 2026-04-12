export type Tab = "split" | "beatsplit" | "shuffle" | "join" | "beatjoin" | "ramp";

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

export interface UploadedVideoSource {
  id: number;
  name: string;
  duration: number;
  size: number;
  thumbnailUrl: string;
  videoUrl: string;
}

export interface SegmentPreview {
  clipId: number;
  label: string;
  duration: number;
  thumbnailUrl?: string;
  sourceClipIds: number[];
  sourceRefLabel?: string;
  timeLabel?: string;
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
}
