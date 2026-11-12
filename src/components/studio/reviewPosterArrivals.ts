export type ReviewPosterArrival = { bucket: string; objectKey: string; posterKey: string };
const listeners = new Map<string, Set<(value: ReviewPosterArrival) => void>>();
const keyFor = (source: { bucket: string; objectKey: string }) => JSON.stringify([source.bucket, source.objectKey]);
/** No media cache: only currently visible subscribers retain their own compact poster pointer. */
export function subscribeReviewPoster(source: { bucket: string; objectKey: string }, listener: (value: ReviewPosterArrival) => void) {
  const key = keyFor(source), group = listeners.get(key) ?? new Set();
  group.add(listener); listeners.set(key, group);
  return () => { group.delete(listener); if (!group.size) listeners.delete(key); };
}
export function publishReviewPoster(value: ReviewPosterArrival) {
  for (const listener of listeners.get(keyFor(value)) ?? []) listener(value);
}
