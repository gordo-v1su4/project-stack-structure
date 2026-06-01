export interface SceneCut {
  time: number;
  confidence: number; // chi-squared distance at the cut
}

export interface DetectionProgress {
  percent: number; // 0..1
  cuts: number;
}

// Messages to the histogram worker.
export type HistogramRequest = {
  type: "frame";
  time: number;
  width: number;
  height: number;
  pixels: ArrayBuffer; // RGBA Uint8ClampedArray buffer (transferred)
};

export type HistogramResponse =
  | { type: "distance"; time: number; distance: number }
  | { type: "ready" };

// Messages to / from the LFM caption worker.
export type CaptionRequest =
  | { type: "init" }
  | { type: "caption"; id: number; bitmap: ImageBitmap };

export type CaptionResponse =
  | { type: "ready" }
  | { type: "progress"; percent: number; stage: string }
  | { type: "caption"; id: number; text: string }
  | { type: "error"; message: string; id?: number };
