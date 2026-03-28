export type Tab = "split" | "beatsplit" | "shuffle" | "join" | "beatjoin" | "ramp";

export type ShuffleMode = "simple" | "size" | "color" | "motion";

export type RampPreset = "subtle" | "dynamic" | "extreme" | "cinematic";

export type ColorGradient = "Rainbow" | "Sunset" | "Ocean";

export type JoinClip = { id: number; on: boolean };

export interface BeatJoinSection {
  label: string;
  start: number;
  end: number;
  energy?: number;
}

export interface BeatJoinAnalysis {
  sourceLabel: string;
  waveform: number[];
  energy: number[];
  beats: number[];
  onsets: number[];
  sections: BeatJoinSection[];
  duration: number;
}
