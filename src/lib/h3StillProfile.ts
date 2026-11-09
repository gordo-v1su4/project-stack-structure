import { createHash } from "node:crypto";

function freezeProfile<T extends object>(value: T): T {
  Object.values(value).forEach(child => { if (child && typeof child === "object") freezeProfile(child); });
  return Object.freeze(value);
}

/** Source-only profile. Historical graph evidence is not installed-node readiness. */
export const H3_STILL_PROFILE = freezeProfile({
  version: "h3-raw-ref-fizgig-two-pass-v1",
  evidenceSha256: "53436673cf967996d0595ca7bc53bce42d51c59f9f782e711a1ea4ab09b12874",
  checkpoint: "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
  clip: "qwen3vl_32b_minimax_h3_int4_convrot.safetensors",
  vae: "minimax_h3_video_vae_int8_convrot.safetensors",
  upscaler: "minimax_h3_latent_upscaler_3d_conv_v1_fp16.safetensors",
  native: { width: 2560, height: 1440 },
  firstPass: { sampler: "er_sde", scheduler: "simple", steps: 50, denoise: 1 },
  upscale: { multiplier: 2, align: 32 },
  secondPass: { sampler: "er_sde", scheduler: "simple", steps: 10, denoise: 0.2 },
  master: { width: 2048, height: 1152, method: "lanczos", crop: "disabled" },
} as const);

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
export function h3StillDigest(value: unknown): string { return createHash("sha256").update(canonical(value)).digest("hex"); }
export const H3_STILL_PROFILE_SHA256 = h3StillDigest(H3_STILL_PROFILE);

export interface H3StillReference {
  assetId: string; canonicalName: string;
  role: "identity" | "environment" | "composition" | "style" | "crowd" | "prop" | "vehicle" | "wardrobe";
  bucket: string; objectKey: string; version: string; etag: string; rawSha256: string;
}
export interface H3StillInput {
  ownerId: string; projectId: string; planSignature: string;
  target: { timelineItemId: string; sectionId: string; requirementId?: string; songStart: number; songEnd: number };
  prompt: string; seed: number; references: H3StillReference[];
}
export interface H3StillDescriptor {
  version: 1; sha256: string;
  body: H3StillInput & { profileSha256: string };
}
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const text = (v: unknown, max = 512): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max && !/[\x00-\x1f\x7f]/.test(v);
const segment = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,96}$/.test(v);
const roles = new Set(["identity", "environment", "composition", "style", "crowd", "prop", "vehicle", "wardrobe"]);

/** Adapter must supply canonical owned refs and lint the final prompt before dispatch. */
export function freezeH3Still(input: H3StillInput): H3StillDescriptor {
  if (!input || !segment(input.ownerId) || !segment(input.projectId) || !text(input.planSignature)
    || !input.target || !text(input.target.timelineItemId) || !text(input.target.sectionId)
    || (input.target.requirementId !== undefined && !text(input.target.requirementId))
    || !Number.isFinite(input.target.songStart) || input.target.songStart < 0 || !Number.isFinite(input.target.songEnd)
    || input.target.songEnd <= input.target.songStart || input.target.songEnd - input.target.songStart > 12.001
    || typeof input.prompt !== "string" || !input.prompt.trim() || Buffer.byteLength(input.prompt, "utf8") > 16_384
    || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(input.prompt)
    || !Number.isSafeInteger(input.seed) || input.seed < 0 || input.seed > 0xffffffff
    || !Array.isArray(input.references) || input.references.length < 1 || input.references.length > 9) throw new Error("Invalid H3 still input.");
  const references = input.references.map((r, i) => {
    if (!r || !text(r.assetId) || !text(r.canonicalName, 120) || !roles.has(r.role) || !text(r.bucket)
      || !text(r.version) || !text(r.etag) || !hash(r.rawSha256) || !text(r.objectKey, 2048)
      || r.objectKey.includes("\\") || r.objectKey.split("/").some(p => !p || p === "." || p === "..")
      || !input.prompt.includes(r.canonicalName) || !input.prompt.includes(`<Picture ${i + 1}>`)) throw new Error("H3 still references must be named and ordered in the prompt.");
    return { assetId: r.assetId, canonicalName: r.canonicalName, role: r.role, bucket: r.bucket, objectKey: r.objectKey, version: r.version, etag: r.etag, rawSha256: r.rawSha256 };
  });
  if (new Set(references.map(r => r.assetId)).size !== references.length || new Set(references.map(r => r.canonicalName)).size !== references.length) throw new Error("H3 still references must be unique.");
  const { timelineItemId, sectionId, requirementId, songStart, songEnd } = input.target;
  const body = { ownerId: input.ownerId, projectId: input.projectId, planSignature: input.planSignature,
    target: { timelineItemId, sectionId, ...(requirementId === undefined ? {} : { requirementId }), songStart, songEnd },
    prompt: input.prompt, seed: input.seed, references, profileSha256: H3_STILL_PROFILE_SHA256 };
  return { version: 1, sha256: h3StillDigest(body), body };
}

type Node = { class_type: string; inputs: Record<string, unknown> };
export type H3StillWorkflow = Record<string, Node>;

/** Hydrated paths are exact backend-relative PNG names, paired with frozen raw hashes. */
export function buildH3StillWorkflow(descriptor: H3StillDescriptor, hydrated: { rawSha256: string; image: string }[]) {
  const frozen = freezeH3Still(descriptor.body);
  if (descriptor.version !== 1 || descriptor.body.profileSha256 !== H3_STILL_PROFILE_SHA256 || descriptor.sha256 !== frozen.sha256
    || hydrated.length !== frozen.body.references.length) throw new Error("H3 still descriptor changed.");
  hydrated.forEach((r, i) => {
    if (r.rawSha256 !== frozen.body.references[i].rawSha256 || r.image !== `stack-stills/${r.rawSha256}.png`) throw new Error("H3 still hydrated reference changed.");
  });
  const p = H3_STILL_PROFILE, body = frozen.body;
  const workflow: H3StillWorkflow = {
    model: { class_type: "UNETLoader", inputs: { unet_name: p.checkpoint, weight_dtype: "default" } },
    shift: { class_type: "MiniMaxH3SigmaShift", inputs: { model: ["model", 0], shift_video: 12, shift_audio: 3 } },
    clip: { class_type: "CLIPLoader", inputs: { clip_name: p.clip, type: "minimax", device: "default" } },
    vae: { class_type: "VAELoader", inputs: { vae_name: p.vae } },
    cond: { class_type: "MiniMaxH3ReferenceToVideo", inputs: { clip: ["clip", 0], vae: ["vae", 0], prompt: body.prompt,
      width: 2560, height: 1440, length: 5, ref_image_size: "max" } },
    latent: { class_type: "FizgigH3StillLatent", inputs: { width: 2560, height: 1440, batch_size: 1 } },
    guider: { class_type: "BasicGuider", inputs: { model: ["shift", 0], conditioning: ["cond", 0] } },
    noise: { class_type: "RandomNoise", inputs: { noise_seed: body.seed } },
    sampler: { class_type: "KSamplerSelect", inputs: { sampler_name: "er_sde" } },
    sigmas: { class_type: "BasicScheduler", inputs: { model: ["shift", 0], scheduler: "simple", steps: 50, denoise: 1 } },
    sample: { class_type: "SamplerCustomAdvanced", inputs: { noise: ["noise", 0], guider: ["guider", 0], sampler: ["sampler", 0], sigmas: ["sigmas", 0], latent_image: ["latent", 0] } },
    separate: { class_type: "LTXVSeparateAVLatent", inputs: { av_latent: ["sample", 0] } },
    upscale: { class_type: "MinimaxH3LatentUpscaler3D", inputs: { latent: ["separate", 0], model_name: p.upscaler,
      mode: "scale by multiplier", "mode.scale": 2, align: 32, enable_temporal_chunking: true, force_unload: true, device: "cuda", precision: "fp16" } },
    concat: { class_type: "LTXVConcatAVLatent", inputs: { video_latent: ["upscale", 0], audio_latent: ["separate", 1] } },
    refineSampler: { class_type: "KSamplerSelect", inputs: { sampler_name: "er_sde" } },
    refineSigmas: { class_type: "BasicScheduler", inputs: { model: ["shift", 0], scheduler: "simple", steps: 10, denoise: 0.2 } },
    refine: { class_type: "SamplerCustomAdvanced", inputs: { noise: ["noise", 0], guider: ["guider", 0], sampler: ["refineSampler", 0], sigmas: ["refineSigmas", 0], latent_image: ["concat", 0] } },
    decode: { class_type: "FizgigH3StillDecode", inputs: { samples: ["refine", 0], vae: ["vae", 0] } },
    master: { class_type: "ImageScale", inputs: { image: ["decode", 0], upscale_method: "lanczos", width: 2048, height: 1152, crop: "disabled" } },
    save: { class_type: "SaveImage", inputs: { images: ["master", 0], filename_prefix: `stack-stills/${frozen.sha256}/master` } },
  };
  hydrated.forEach((r, i) => {
    workflow[`reference_${i}`] = { class_type: "LoadImage", inputs: { image: r.image } };
    workflow.cond.inputs[`ref_images.ref_image_${i}`] = [`reference_${i}`, 0];
  });
  return { descriptor: frozen, workflow, workflowSha256: h3StillDigest(workflow) };
}

/** Separate derivative contract; does not resize pixels or certify identity. */
export function h3StillNativePreparation(masterPngSha256: string) {
  if (!hash(masterPngSha256)) throw new Error("Choose the exact master PNG hash.");
  // Master 16:9 and existing H3 input 7:4 differ. Preserve composition with 6px top/bottom padding.
  const body = { version: "h3-still-native-contain-v1", masterPngSha256, source: { width: 2048, height: 1152 },
    output: { width: 1344, height: 768 }, resized: { width: 1344, height: 756 },
    method: "lanczos", crop: "disabled", padding: { top: 6, bottom: 6, left: 0, right: 0, rgb: [0, 0, 0] },
    format: "png", identityAssessment: "required-on-final-pixels" } as const;
  return { body, sha256: h3StillDigest(body) };
}
