/** Numeric foreground evidence only. It assigns no identity to background people. */
export type ForegroundFaceDetection = {
  trackId: string;
  box: [number, number, number, number];
  landmarks: number[];
  quality: { widthPixels: number; heightPixels: number; detectionScore: number; blurVariance: number; meanLuminance: number };
  score: number;
};
export type ForegroundFrameEvidence = {
  imageWidth: number;
  imageHeight: number;
  leadTrackId: string;
  detections: ForegroundFaceDetection[];
};
export type ForegroundGeometryScope = {
  minimumFaceWidthPixels: number; minimumFaceHeightPixels: number; minimumDetectionScore: number;
  maximumAbsoluteRollDegrees: number; maximumAbsoluteNoseEyeMidpointOffsetOverEyeDistance: number;
  maximumAbsoluteMouthEyeMidpointOffsetOverEyeDistance: number; minimumEyeDistancePixels: number;
  minimumNoseDepthOverEyeDistance: number; maximumNoseDepthOverEyeDistance: number; maximumMouthDepthOverEyeDistance: number;
  minimumConsecutiveFaceBoxIoU: number;
};
export type ForegroundDominanceScope = {
  maximumBackgroundWidthRatio: number; maximumBackgroundHeightRatio: number; maximumBackgroundAreaRatio: number;
  minimumLeadCosineMargin: number; maximumDetectedFaceCount: number;
};
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 512;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function validForegroundFrameEvidence(value: unknown): value is ForegroundFrameEvidence {
  if (!value || typeof value !== "object") return false;
  const evidence = value as ForegroundFrameEvidence;
  return [evidence.imageWidth, evidence.imageHeight].every(value => Number.isSafeInteger(value) && value > 0 && value <= 32768)
    && text(evidence.leadTrackId) && Array.isArray(evidence.detections) && evidence.detections.length <= 32
    && evidence.detections.every(face => face && text(face.trackId) && Array.isArray(face.box) && face.box.length === 4
      && face.box.every(value => finite(value) && Math.abs(value) <= 32768) && face.box[2] > 0 && face.box[3] > 0
      && Array.isArray(face.landmarks) && face.landmarks.length === 10 && face.landmarks.every(value => finite(value) && Math.abs(value) <= 32768)
      && finite(face.score) && face.score >= -1 && face.score <= 1 && face.quality
      && [face.quality.widthPixels, face.quality.heightPixels, face.quality.detectionScore, face.quality.blurVariance, face.quality.meanLuminance].every(finite)
      && face.quality.widthPixels === face.box[2] && face.quality.heightPixels === face.box[3]
      && face.quality.detectionScore >= 0 && face.quality.detectionScore <= 1 && face.quality.blurVariance >= 0
      && face.quality.meanLuminance >= 0 && face.quality.meanLuminance <= 255);
}

export function copyForegroundFrameEvidence(evidence: ForegroundFrameEvidence): ForegroundFrameEvidence {
  return { imageWidth: evidence.imageWidth, imageHeight: evidence.imageHeight, leadTrackId: evidence.leadTrackId,
    detections: evidence.detections.map(face => ({ trackId: face.trackId, box: [...face.box], landmarks: [...face.landmarks],
      score: face.score, quality: { widthPixels: face.quality.widthPixels, heightPixels: face.quality.heightPixels,
        detectionScore: face.quality.detectionScore, blurVariance: face.quality.blurVariance, meanLuminance: face.quality.meanLuminance } })) };
}

/** Mirrors the pinned Python frontal geometry; acquisition blur/light remain warnings. */
export function foregroundGeometryPasses(face: ForegroundFaceDetection, imageWidth: number, imageHeight: number, scope: ForegroundGeometryScope) {
  const [x, y, width, height] = face.box, quality = face.quality;
  if (quality.widthPixels < scope.minimumFaceWidthPixels || quality.heightPixels < scope.minimumFaceHeightPixels
    || quality.detectionScore < scope.minimumDetectionScore || x < 0 || y < 0 || x + width > imageWidth || y + height > imageHeight) return false;
  const points = Array.from({ length: 5 }, (_, index) => face.landmarks.slice(2 * index, 2 * index + 2));
  const eyes = points.slice(0, 2).sort((a, b) => a[0] - b[0]);
  const dx = eyes[1][0] - eyes[0][0], dy = eyes[1][1] - eyes[0][1], distance = Math.hypot(dx, dy);
  if (distance <= 0 || distance < scope.minimumEyeDistancePixels || Math.abs(Math.atan2(dy, dx) * 180 / Math.PI) > scope.maximumAbsoluteRollDegrees) return false;
  const across = [dx / distance, dy / distance], down = [-across[1], across[0]];
  const midpoint = [(eyes[0][0] + eyes[1][0]) / 2, (eyes[0][1] + eyes[1][1]) / 2];
  const nose = [points[2][0] - midpoint[0], points[2][1] - midpoint[1]];
  const mouth = [(points[3][0] + points[4][0]) / 2 - midpoint[0], (points[3][1] + points[4][1]) / 2 - midpoint[1]];
  const project = (point: number[], axis: number[]) => (point[0] * axis[0] + point[1] * axis[1]) / distance;
  const noseDepth = project(nose, down), mouthDepth = project(mouth, down);
  return Math.abs(project(nose, across)) <= scope.maximumAbsoluteNoseEyeMidpointOffsetOverEyeDistance
    && Math.abs(project(mouth, across)) <= scope.maximumAbsoluteMouthEyeMidpointOffsetOverEyeDistance
    && noseDepth >= scope.minimumNoseDepthOverEyeDistance && noseDepth <= scope.maximumNoseDepthOverEyeDistance
    && noseDepth < mouthDepth && mouthDepth <= scope.maximumMouthDepthOverEyeDistance;
}

const area = (face: ForegroundFaceDetection) => face.box[2] * face.box[3];
function intersection(left: number[], right: number[]) {
  return Math.max(0, Math.min(left[0] + left[2], right[0] + right[2]) - Math.max(left[0], right[0]))
    * Math.max(0, Math.min(left[1] + left[3], right[1] + right[3]) - Math.max(left[1], right[1]));
}

export function foregroundEvidenceBlockReason({ evidence, previous, assigned, candidates, geometry, dominance }: {
  evidence: ForegroundFrameEvidence | undefined; previous?: ForegroundFrameEvidence;
  assigned: { referenceHash: string; trackId: string; score: number };
  candidates?: { referenceHash: string; trackId: string; score: number }[];
  geometry: ForegroundGeometryScope; dominance: ForegroundDominanceScope;
}): string | null {
  if (!evidence || !validForegroundFrameEvidence(evidence) || !evidence.detections.length
    || evidence.detections.length > dominance.maximumDetectedFaceCount || !candidates || candidates.length !== evidence.detections.length
    || new Set(evidence.detections.map(face => face.trackId)).size !== evidence.detections.length) return "Similarity filter has incomplete foreground evidence";
  const lead = evidence.detections.find(face => face.trackId === evidence.leadTrackId);
  if (!lead || assigned.trackId !== lead.trackId || assigned.score !== lead.score
    || !foregroundGeometryPasses(lead, evidence.imageWidth, evidence.imageHeight, geometry)) return "Similarity filter has invalid foreground geometry";
  for (const face of evidence.detections) {
    const scores = candidates.filter(score => score.trackId === face.trackId && score.referenceHash === assigned.referenceHash);
    if (scores.length !== 1 || scores[0].score !== face.score) return "Similarity filter has incomplete foreground scores";
    if (face === lead) continue;
    if (area(face) >= area(lead) || face.box[2] > dominance.maximumBackgroundWidthRatio * lead.box[2]
      || face.box[3] > dominance.maximumBackgroundHeightRatio * lead.box[3] || area(face) > dominance.maximumBackgroundAreaRatio * area(lead)
      || intersection(face.box, lead.box) > 0 || foregroundGeometryPasses(face, evidence.imageWidth, evidence.imageHeight, geometry)) return "Similarity filter is outside foreground dominance scope";
    if (lead.score - face.score < dominance.minimumLeadCosineMargin) return "Similarity filter has ambiguous foreground assignment";
  }
  if (previous) {
    const old = previous.detections.find(face => face.trackId === previous.leadTrackId);
    if (!old || old.trackId !== lead.trackId || previous.imageWidth !== evidence.imageWidth || previous.imageHeight !== evidence.imageHeight) return "Similarity filter has ambiguous foreground tracking";
    const overlap = intersection(lead.box, old.box);
    if (overlap / Math.max(1, area(lead) + area(old) - overlap) < geometry.minimumConsecutiveFaceBoxIoU) return "Similarity filter has discontinuous foreground tracking";
  }
  return null;
}
