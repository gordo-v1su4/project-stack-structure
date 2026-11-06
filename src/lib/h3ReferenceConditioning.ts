import {
  H3_CONDITIONING_PREPARATION_VERSION, H3_LEGACY_PROFILE, H3_PROFILE,
  H3_V2_PROFILE, H3_V2_CONDITIONING_PREPARATION_VERSION,
  type H3ConditioningPreparation, type H3GenerationProfileOptions, type H3ReferenceSnapshot,
} from "@/components/studio/h3Generation";
import { H3_FIRST_FRAME_PROFILE, H3_FIRST_FRAME_PREPARATION } from "@/components/studio/h3FirstFrame";

/** Exact canonical source, never selected by filename, storage key or visual similarity. */
export const DIEGO_CANONICAL_REFERENCE_SHA256 = "47d772694e0c14397707f31b7802fe91d434da1e4b54be7bac3eb00037364381";
/** Original RGB pixels inside the front panel; excludes labels and adjacent views. */
export const DIEGO_FRONT_PORTRAIT_CROP = Object.freeze({ x: 80, y: 10, width: 320, height: 615 });
export const VALENTINA_CANONICAL_REFERENCE_SHA256 = "15a317d4bc85ab1b794f0bb0e9e25658b616c41a1b77bc23520ebbecc95ffc67";
/** Label-free raw-source rectangle; trims the disclosed four crown pixels. */
export const VALENTINA_FRONT_PORTRAIT_CROP = Object.freeze({ x: 390, y: 36, width: 344, height: 512 });

export function assertH3ConditioningProfile(options: H3GenerationProfileOptions) {
  if (options.profile === H3_LEGACY_PROFILE && options.conditioningPreparationVersion === undefined) return;
  if (options.profile === H3_V2_PROFILE && options.conditioningPreparationVersion === H3_V2_CONDITIONING_PREPARATION_VERSION) return;
  if (options.profile === H3_PROFILE && options.conditioningPreparationVersion === H3_CONDITIONING_PREPARATION_VERSION) return;
  if (options.profile === H3_FIRST_FRAME_PROFILE && options.conditioningPreparationVersion === H3_FIRST_FRAME_PREPARATION) return;
  throw new Error("Unsupported H3 conditioning preparation profile.");
}

/** Pure plan only. The worker hashes the original file bytes before choosing any crop. */
export function planH3ReferenceConditioning(input: H3GenerationProfileOptions & {
  rawSha256: string; width: number; height: number;
  canonicalName: string; role: H3ReferenceSnapshot["role"];
}): H3ConditioningPreparation {
  assertH3ConditioningProfile(input);
  if (input.profile === H3_FIRST_FRAME_PROFILE) throw new Error("I2VA uses the frozen first frame; canonical authorities are not visual conditioning sockets.");
  if (!/^[a-f0-9]{64}$/.test(input.rawSha256)
    || !Number.isSafeInteger(input.width) || input.width < 1
    || !Number.isSafeInteger(input.height) || input.height < 1) throw new Error("Invalid H3 reference image metadata.");
  const original: H3ConditioningPreparation = {
    version: input.profile === H3_LEGACY_PROFILE ? "original-v1" : input.conditioningPreparationVersion!,
    rawSha256: input.rawSha256, operation: "original", sourceWidth: input.width, sourceHeight: input.height,
  };
  if (input.profile === H3_LEGACY_PROFILE || input.role !== "identity") return original;
  let crop: H3ConditioningPreparation["crop"];
  if (input.rawSha256 === DIEGO_CANONICAL_REFERENCE_SHA256 && input.canonicalName === "Diego") {
    if (input.width !== 1402 || input.height !== 1122) throw new Error("Canonical Diego reference dimensions changed.");
    crop = { ...DIEGO_FRONT_PORTRAIT_CROP };
  } else if (input.profile === H3_PROFILE && input.rawSha256 === VALENTINA_CANONICAL_REFERENCE_SHA256 && input.canonicalName === "Valentina") {
    if (input.width !== 1448 || input.height !== 1086) throw new Error("Canonical Valentina reference dimensions changed.");
    crop = { ...VALENTINA_FRONT_PORTRAIT_CROP };
  } else return original;
  return { ...original, operation: "crop", crop,
    ffmpegFilter: `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}:exact=1` };
}
