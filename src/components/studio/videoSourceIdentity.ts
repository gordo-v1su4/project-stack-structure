import type { UploadedVideoSource } from "./types";

export function getNextVideoSourceId(sources: Pick<UploadedVideoSource, "id">[]) {
  return sources.reduce((nextId, source) => Math.max(nextId, source.id + 1), 0);
}

export function assignVideoSourceIds(sources: UploadedVideoSource[], firstId: number) {
  return sources.map((source, index) => withVideoSourceId(source, firstId + index));
}

export function withVideoSourceId(source: UploadedVideoSource, id: number): UploadedVideoSource {
  return {
    ...source,
    id,
    scenes: source.scenes?.map((scene) => ({ ...scene, sourceClipId: id })),
  };
}

export function removeVideoSourceById(sources: UploadedVideoSource[], sourceId: number) {
  return sources.filter((source) => source.id !== sourceId);
}
