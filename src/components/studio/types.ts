export type Tab = "split" | "beatsplit" | "shuffle" | "join" | "beatjoin" | "ramp";

export type ShuffleMode = "simple" | "size" | "color" | "motion";

export type RampPreset = "subtle" | "dynamic" | "extreme" | "cinematic";

export type ColorGradient = "Rainbow" | "Sunset" | "Ocean";

export type JoinClip = { id: number; on: boolean };

export interface UploadedVideoSource {
  id: number;
  name: string;
  duration: number;
  size: number;
  thumbnailUrl: string;
}

export interface SegmentPreview {
  clipId: number;
  label: string;
  duration: number;
  thumbnailUrl?: string;
  sourceClipIds: number[];
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
