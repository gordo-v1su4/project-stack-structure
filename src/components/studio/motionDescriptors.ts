import type { ProbedMediaFile } from "./mediaProbe";
import type { SegmentManifestItem } from "./segmentManifest";
import type { MotionDescriptor, MotionTargetKind } from "./types";

export interface MotionRankingInput {
  dominantAngleDeg: number | null;
  dominantMagnitude: number | null;
  motionCoherence: number | null;
  cameraMotionType: MotionDescriptor["cameraMotionType"];
  cameraMotionStrength: number | null;
  residualMotionStrength: number | null;
  confidence: MotionDescriptor["confidence"];
}

export function createPlaceholderMotionDescriptor(params: {
  targetKind: MotionTargetKind;
  filePath: string;
  segmentId?: number | null;
  start?: number | null;
  end?: number | null;
  notes?: string | null;
  generatedAt?: string;
}): MotionDescriptor {
  const {
    targetKind,
    filePath,
    segmentId = null,
    start = null,
    end = null,
    notes = null,
    generatedAt = new Date().toISOString(),
  } = params;
  const targetSuffix = targetKind === "segment" ? `:${segmentId ?? "pending"}` : ":file";

  return {
    id: `${targetKind}:${filePath}${targetSuffix}`,
    targetKind,
    filePath,
    segmentId,
    start,
    end,
    dominantAngleDeg: null,
    dominantMagnitude: null,
    motionCoherence: null,
    cameraMotionType: "unknown",
    cameraMotionStrength: null,
    residualMotionStrength: null,
    motionEntropy: null,
    acceleration: null,
    angleHistogram: null,
    magnitudeP50: null,
    magnitudeP90: null,
    confidence: {
      overall: 0.1,
      camera: 0.1,
      residual: 0.1,
    },
    provenance: {
      kind: "placeholder",
      tool: "contract-only",
      version: null,
      generatedAt,
      notes,
    },
  };
}

export function attachMotionDescriptorToFile(file: ProbedMediaFile, descriptor?: MotionDescriptor | null): ProbedMediaFile {
  return {
    ...file,
    motionDescriptor:
      descriptor ??
      createPlaceholderMotionDescriptor({
        targetKind: "file",
        filePath: file.inputPath,
        notes: "Descriptor not computed yet.",
      }),
  };
}

export function attachMotionDescriptorToSegment(
  segment: SegmentManifestItem,
  filePath: string,
  descriptor?: MotionDescriptor | null,
): SegmentManifestItem {
  return {
    ...segment,
    motionDescriptor:
      descriptor ??
      createPlaceholderMotionDescriptor({
        targetKind: "segment",
        filePath,
        segmentId: segment.id,
        start: segment.start,
        end: segment.end,
        notes: "Segment descriptor not computed yet.",
      }),
  };
}

export function getAuthoritativeMotionDescriptor(params: {
  segmentDescriptor?: MotionDescriptor | null;
  fileDescriptor?: MotionDescriptor | null;
}) {
  return params.segmentDescriptor ?? params.fileDescriptor ?? null;
}

export function toMotionRankingInput(descriptor: MotionDescriptor): MotionRankingInput {
  return {
    dominantAngleDeg: descriptor.dominantAngleDeg,
    dominantMagnitude: descriptor.dominantMagnitude,
    motionCoherence: descriptor.motionCoherence,
    cameraMotionType: descriptor.cameraMotionType,
    cameraMotionStrength: descriptor.cameraMotionStrength,
    residualMotionStrength: descriptor.residualMotionStrength,
    confidence: descriptor.confidence,
  };
}
