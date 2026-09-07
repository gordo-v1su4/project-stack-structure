import type { ReferenceAsset } from "./referenceAssets";
import type { BeatJoinAnalysis, UploadedVideoSource } from "./types";

const durableUrl = (value?: string) => value && !/^(blob:|data:)/.test(value) ? value : undefined;

/** Captures live evidence inputs independently of the saved project's old video moments. */
export function buildStudioSourceContextSignature({ analysis, videoSources, referenceAssets, referenceRevision }: {
  analysis: BeatJoinAnalysis | null;
  videoSources: UploadedVideoSource[];
  referenceAssets?: ReferenceAsset[];
  referenceRevision?: string;
}): string {
  let references = referenceAssets;
  if (!references && referenceRevision) {
    try { const parsed: unknown = JSON.parse(referenceRevision); if (Array.isArray(parsed)) references = parsed as ReferenceAsset[]; } catch { /* Opaque revision remains part of the signature. */ }
  }
  const input = JSON.stringify({
    song: analysis && { label: analysis.sourceLabel, duration: analysis.duration, bucket: analysis.storageBucket,
      path: analysis.storagePath, url: durableUrl(analysis.storageUrl) ?? durableUrl(analysis.audioUrl),
      sections: analysis.sections, beats: analysis.beats, onsets: analysis.onsets, energy: analysis.energy, waveform: analysis.waveform },
    videos: [...videoSources].sort((a, b) => a.id - b.id).map((source) => ({
      id: source.id, name: source.name, size: source.size, duration: source.duration,
      bucket: source.storageBucket, path: source.storagePath, url: durableUrl(source.storageUrl) ?? durableUrl(source.videoUrl),
      scenes: source.scenes?.map((scene) => ({ id: scene.id, start: scene.start, end: scene.end, duration: scene.duration,
        contentHash: scene.contentHash, caption: scene.caption, captionMeta: scene.captionMeta, mediaEvidence: scene.mediaEvidence,
        captionSource: scene.captionSource, captionModel: scene.captionModel, captionError: scene.captionError,
        visualAnalysis: scene.visualAnalysis, motionDescriptor: scene.motionDescriptor })),
    })),
    references: references ? [...references].sort((a, b) => a.id.localeCompare(b.id)).map((reference) => ({
      id: reference.id, role: reference.role, kind: reference.kind, name: reference.displayName, file: reference.fileName,
      hint: reference.promptHint, bucket: reference.storageBucket, path: reference.storagePath,
      url: durableUrl(reference.storageUrl) ?? durableUrl(reference.previewUrl), status: reference.storageStatus,
    })) : referenceRevision ?? [],
  });
  let hash = 2166136261;
  for (let index = 0; index < input.length; index++) hash = Math.imul(hash ^ input.charCodeAt(index), 16777619);
  return `studio-source-v1-${(hash >>> 0).toString(16)}`;
}
