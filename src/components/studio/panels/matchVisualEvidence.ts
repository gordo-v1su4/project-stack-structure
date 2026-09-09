import type { VideoMoment } from "../musicVideoProject";
import type { ColorPaletteSwatch } from "../types";

/** Scene-wide image flow. It does not identify camera/subject tracks or trim edges. */
export function sceneMotionLabel(moment?: VideoMoment): string {
  const descriptor = moment?.motionDescriptor ?? moment?.visualAnalysis?.motion;
  if (!descriptor || descriptor.provenance.kind === "placeholder"
    || !Number.isFinite(descriptor.confidence.overall) || descriptor.confidence.overall < 0.2) return "Motion unavailable";
  const magnitude = descriptor.dominantMagnitude;
  if (magnitude === null || !Number.isFinite(magnitude) || magnitude < 0) return "Motion unavailable";
  if (magnitude < 0.08) return "Little image motion";
  const coherence = descriptor.motionCoherence;
  if (coherence === null || !Number.isFinite(coherence)) return "Direction unavailable";
  if (coherence < 0.2) return "Mixed image motion";
  const angle = descriptor.dominantAngleDeg;
  if (angle === null || !Number.isFinite(angle)) return "Direction unavailable";
  // Worker optical flow uses image coordinates: positive x is right, positive y is down.
  const normalized = ((angle % 360) + 360) % 360;
  if (normalized >= 315 || normalized < 45) return "Rightward flow";
  if (normalized < 135) return "Downward flow";
  if (normalized < 225) return "Leftward flow";
  return "Upward flow";
}

export function scenePalette(moment?: VideoMoment): string[] {
  const color = moment?.visualAnalysis?.color;
  return paletteToHex([
    ...(color?.firstPalette ?? []), ...(color?.middlePalette ?? []),
    ...(color?.lastPalette ?? []), ...(color?.palette ?? []),
  ]).slice(0, 5);
}

function paletteToHex(palette: ColorPaletteSwatch[]) {
  return palette
    .filter((swatch) => Number.isFinite(swatch.weight) && swatch.weight > 0)
    .sort((left, right) => right.weight - left.weight)
    .map((swatch) => swatch.hex && /^#[0-9a-f]{6}$/i.test(swatch.hex) ? swatch.hex : labToHex(swatch))
    .filter((color): color is string => Boolean(color));
}

function labToHex(swatch: ColorPaletteSwatch) {
  if (!Number.isFinite(swatch.l) || !Number.isFinite(swatch.a) || !Number.isFinite(swatch.b)) return null;
  const y = (swatch.l! + 16) / 116;
  const x = swatch.a! / 500 + y;
  const z = y - swatch.b! / 200;
  const xyz = [x, y, z].map((value, index) => {
    const cubed = value ** 3;
    const normalized = cubed > 0.008856 ? cubed : (value - 16 / 116) / 7.787;
    return normalized * [95.047, 100, 108.883][index] / 100;
  });
  let [r, g, b] = [
    xyz[0] * 3.2406 + xyz[1] * -1.5372 + xyz[2] * -0.4986,
    xyz[0] * -0.9689 + xyz[1] * 1.8758 + xyz[2] * 0.0415,
    xyz[0] * 0.0557 + xyz[1] * -0.204 + xyz[2] * 1.057,
  ];
  [r, g, b] = [r, g, b].map((value) => {
    const corrected = value > 0.0031308 ? 1.055 * value ** (1 / 2.4) - 0.055 : 12.92 * value;
    return clamp(Math.round(corrected * 255), 0, 255);
  });
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
