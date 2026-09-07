import { createMediaEvidence, type MediaObservation } from "@/components/studio/mediaEvidence";

/** Explicit reviewed facts for synthetic fixtures; never infer verified evidence from caption prose. */
export function reviewedEvidence(observation: Partial<MediaObservation>, start = 0, end = 4) {
  const evidence = createMediaEvidence({ sourceId: "fixture", sceneId: "reviewed-scene", sourceStart: start, sourceEnd: end,
    rawCaption: "", input: { kind: "ordered-frames", sampleTimes: [start, end], urls: [] }, observation });
  evidence.provenance.origin = "manual";
  return evidence;
}

export const focalSubject = (name: string) => ({ name, role: "focal" as const, confidence: "supported" as const });
