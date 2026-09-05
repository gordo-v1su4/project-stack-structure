import type { ReferenceAsset } from "./referenceAssets";

export type IngestLaneKey = "song" | "stem" | "references" | "clips" | "scenes" | "captions";

export type IngestLaneStatus = "ready" | "processing" | "waiting" | "failed";

export interface IngestLane {
  key: IngestLaneKey;
  label: string;
  status: IngestLaneStatus;
  ready: boolean;
  detail: string;
}

export interface IngestLaneInput {
  hasAudioAnalysis: boolean;
  hasLyricTranscript: boolean;
  referenceAssets: ReferenceAsset[];
  referencesReady?: boolean;
  videoCount: number;
  sceneCount: number;
  captionReadyCount: number;
  captionTotalCount: number;
  captionJobsRunning?: boolean;
}

export function hasRequiredIngestReferences(referenceAssets: ReferenceAsset[]) {
  const isUploaded = (role: ReferenceAsset["role"]) =>
    referenceAssets.some((asset) => asset.role === role && asset.storageStatus === "uploaded");
  return isUploaded("character-1") && isUploaded("environment");
}

export function isCaptionContextReady(input: Pick<IngestLaneInput, "hasLyricTranscript" | "referenceAssets" | "referencesReady">) {
  const referencesReady = input.referencesReady ?? hasRequiredIngestReferences(input.referenceAssets);
  return input.hasLyricTranscript && referencesReady;
}

export function deriveIngestLanes(input: IngestLaneInput): IngestLane[] {
  const captionsReady = input.captionTotalCount > 0 && input.captionReadyCount === input.captionTotalCount;
  const referencesReady = input.referencesReady ?? hasRequiredIngestReferences(input.referenceAssets);
  const captionContextReady = isCaptionContextReady(input);

  return [
    {
      key: "song",
      label: "Master song",
      ready: input.hasAudioAnalysis,
      status: input.hasAudioAnalysis ? "ready" : "waiting",
      detail: input.hasAudioAnalysis ? "Analyzed" : "Upload master audio",
    },
    {
      key: "stem",
      label: "Vocal stem / lyrics",
      ready: input.hasLyricTranscript,
      status: input.hasLyricTranscript ? "ready" : "waiting",
      detail: input.hasLyricTranscript ? "SRT ready" : "Upload vocal stem for Deepgram",
    },
    {
      key: "references",
      label: "Character + location refs",
      ready: referencesReady,
      status: referencesReady ? "ready" : "waiting",
      detail: referencesReady ? "Char 1 + environment uploaded" : "Upload Char 1 and environment sheets",
    },
    {
      key: "clips",
      label: "Source clips",
      ready: input.videoCount > 0,
      status: input.videoCount > 0 ? "ready" : "waiting",
      detail: input.videoCount > 0 ? `${input.videoCount} clip${input.videoCount === 1 ? "" : "s"}` : "Upload footage",
    },
    {
      key: "scenes",
      label: "Scene detection",
      ready: input.sceneCount > 0,
      status: input.sceneCount > 0 ? "ready" : input.videoCount > 0 ? "processing" : "waiting",
      detail: input.sceneCount > 0 ? `${input.sceneCount} scenes` : "Waiting for scene detect",
    },
    {
      key: "captions",
      label: "Smart captions",
      ready: captionsReady,
      status: captionsReady
        ? "ready"
        : !captionContextReady
          ? "waiting"
          : input.captionJobsRunning
            ? "processing"
            : input.captionTotalCount === 0
              ? "waiting"
              : "processing",
      detail: !captionContextReady
        ? "Needs stem + Char 1 + environment before captioning"
        : captionsReady
          ? `${input.captionReadyCount}/${input.captionTotalCount} ready`
          : `Captioning ${input.captionReadyCount}/${input.captionTotalCount || input.sceneCount || 0}`,
    },
  ];
}

export function isIngestReady(input: IngestLaneInput) {
  return deriveIngestLanes(input).every((lane) => lane.ready);
}
