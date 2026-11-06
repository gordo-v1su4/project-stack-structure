import type { ReferenceAsset } from "./referenceAssets";

export type IngestLaneKey = "song" | "stem" | "references" | "clips" | "scenes" | "captions";

export type IngestLaneStatus = "ready" | "processing" | "waiting" | "failed";

export interface IngestLane {
  key: IngestLaneKey;
  label: string;
  status: IngestLaneStatus;
  ready: boolean;
  optional?: boolean;
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
  return referencesReady;
}

export function deriveIngestLanes(input: IngestLaneInput): IngestLane[] {
  const hasFootage = input.videoCount > 0;
  const captionsReady = !hasFootage || (input.captionTotalCount > 0 && input.captionReadyCount === input.captionTotalCount);
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
      label: "Vocal stem / lyrics · optional",
      optional: true,
      ready: input.hasLyricTranscript,
      status: input.hasLyricTranscript ? "ready" : "waiting",
      detail: input.hasLyricTranscript ? "Timed lyrics ready" : "Optional · plan from the music without lyrics",
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
      label: "Source clips · optional",
      optional: true,
      ready: true,
      status: "ready",
      detail: hasFootage ? `${input.videoCount} clip${input.videoCount === 1 ? "" : "s"}` : "No footage · generate the planned shots",
    },
    {
      key: "scenes",
      label: "Scene detection",
      optional: true,
      ready: !hasFootage || input.sceneCount > 0,
      status: !hasFootage || input.sceneCount > 0 ? "ready" : "processing",
      detail: !hasFootage ? "No source clips to analyze" : input.sceneCount > 0 ? `${input.sceneCount} scenes` : "Waiting for scene detect",
    },
    {
      key: "captions",
      label: "Smart captions",
      optional: true,
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
      detail: !hasFootage
        ? "No source clips to caption"
        : !captionContextReady
        ? "Needs Char 1 + environment before captioning"
        : captionsReady
          ? `${input.captionReadyCount}/${input.captionTotalCount} ready`
          : `Captioning ${input.captionReadyCount}/${input.captionTotalCount || input.sceneCount || 0}`,
    },
  ];
}

export function isIngestReady(input: IngestLaneInput) {
  return input.hasAudioAnalysis && (input.referencesReady ?? hasRequiredIngestReferences(input.referenceAssets));
}
