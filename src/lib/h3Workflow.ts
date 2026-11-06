import { h3FrameCount, H3_FPS, H3_WIDTH, H3_HEIGHT, type H3GenerationJob } from "@/components/studio/h3Generation";
import type { ComfyWorkflow } from "@/components/studio/localGeneration";
import { assertReferenceLanguage } from "@/components/studio/referenceLanguage";
import { h3StableSeed } from "./h3GenerationServer";

export const H3_MODEL = "minimax_h3_ref2va_pruned_int8_convrot.safetensors";
export const H3_CLIP = "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors";
export const H3_VIDEO_VAE = "minimax_h3_video_vae_fp16.safetensors";
export const H3_AUDIO_VAE = "minimax_h3_audio_vae_fp32.safetensors";

/** Single-shot counterpart of the installed dynamic compiler's native profile checks. */
export function assertH3ShotProfile(body: string, seconds: number) {
  const camera = /^\[([^\]]+)\]/.exec(body);
  if (!camera) throw new Error("Start the shot with one bracketed camera command.");
  if (!/\b(?:wide shot|medium(?:[- ]tight| full)?(?: shot| framing)?|close[- ]up|full[- ]body|full shot|tight framing|upper body|overhead view)\b/i.test(body.slice(0, 160))) {
    throw new Error("State one shot size near the camera command.");
  }
  const prose = body.slice(camera[0].length);
  if (/\b(?:without|no|not|never|stops|avoid|don't|doesn't|do not|empty of)\b/i.test(prose)) throw new Error("Use positive visible action; keep negative constraints in review notes.");
  if (/\b(\w+)\s+\1\b/i.test(prose)) throw new Error("Remove repeated adjacent words from the shot direction.");
  if (/\b(?:wears|wearing|dressed in|outfit|(?:brown|blue|green) eyes|(?:dark|blond|blonde|black|brown|red|curly|straight|long|short) hair|(?:olive|silver|red|blue|black|white) (?:shirt|top|shorts|dress)|muscular body|slim body)\b/i.test(prose)) {
    throw new Error("Let the reference supply character appearance.");
  }
  if (/\b(?:capturing (?:the|an)|embodying|symbolizing|evoking (?:the|a)|a testament to)\b/i.test(prose)) throw new Error("Use visible action instead of interpretive wrap-up prose.");
  if (/\b(?:collapes|clifff|promtp|realiable|continous|simultanously)\b/i.test(prose)) throw new Error("Correct the spelling in the shot direction.");
  if (/static/i.test(camera[1]) && /\b(?:pans?|orbits?|tracks?|dollies|push(?:es)? in)\b/i.test(body)) throw new Error("The static camera command conflicts with movement.");
  if (/clockwise/i.test(camera[1]) && /\b(?:counterclockwise|anticlockwise)\b/i.test(body)) throw new Error("Choose one camera rotation direction.");
  if (/close[- ]up/i.test(body) && /\b(?:whole|full|entire)[- ]body\b/i.test(body)) throw new Error("Close-up and full-body framing conflict.");
  const limit = seconds <= 2 ? 35 : seconds < 6 ? 65 : 85;
  if ((prose.match(/\b[\w’'-]+\b/g)?.length ?? 0) > limit) throw new Error(`Keep this shot below ${limit} words of visible action.`);
}

/** Native single-shot grammar; reference numbering is generated from actual input order. */
export function compileH3Prompt(job: H3GenerationJob) {
  const direction = job.request.prompt.trim();
  assertReferenceLanguage(direction, job.references.filter(r => r.role === "identity").map(r => r.canonicalName));
  if (/\bthe (?:woman|man|girl|boy|guy|dancer|singer|figure|person)\b/i.test(direction)) {
    throw new Error("Use the exact named character in the shot direction.");
  }
  const hasShotSize = /\b(?:wide shot|medium(?:[- ]tight| full)?(?: shot| framing)?|close[- ]up|full[- ]body|full shot|tight framing|upper body|overhead view)\b/i.test(direction.slice(0, 160));
  const body = /^\[[^\]]+\]/.test(direction) ? direction : `[Tracking] ${hasShotSize ? "" : "Medium shot. "}${direction}`;
  const definitions = job.references.map((ref, i) => `<Subject ${i + 1}> is ${ref.canonicalName} from <Picture ${i + 1}>, the ${ref.role === "identity" ? "identity and wardrobe" : ref.role} authority.`);
  const retention = job.references.map((ref, i) => `<Subject ${i + 1}> (appears in [Shot 1]): fully_preserved - preserve ${ref.canonicalName}'s ${ref.role === "identity" ? "identity and wardrobe" : ref.role} reference.`);
  const environment = job.references.find(ref => ref.role === "environment")!.canonicalName;
  const shot = `${body.replace(/[\s.]+$/, "")}. ${environment}.`;
  assertH3ShotProfile(shot, h3FrameCount(job.request.songEnd - job.request.songStart) / H3_FPS);
  const prompt = `subject_definitions:\n${definitions.join("\n")}\n\nsummary:\n[reference generation] One music-video pickup.\n\nretention_analysis:\n${retention.join("\n")}\n\ndetailed_description:\n[Shot 1] ${shot}\n\noverall_soundscape:\nEnvironmental room tone and movement sounds.\n\nnon_diegetic_music:\nN/A`;
  return { prompt, frameSchedule: { "0": shot }, frames: h3FrameCount(job.request.songEnd - job.request.songStart) };
}

/**
 * Base-path adaptation of the accepted 2026-09-01 bar-trio Ref2VA PNG prompt.
 * Explicit dimensions replace its ResolutionSelector; extension/join branches are omitted.
 * This version requires its own live baseline before production promotion.
 */
export function buildH3Workflow(job: H3GenerationJob, inputPaths: string[]) {
  if (inputPaths.length !== job.references.length) throw new Error("H3 reference mapping changed.");
  const compiled = compileH3Prompt(job);
  const conditioning: Record<string, unknown> = { clip: ["clip", 0], vae: ["vae", 0], audio_vae: ["audio_vae", 0],
    prompt: compiled.prompt, width: H3_WIDTH, height: H3_HEIGHT, length: compiled.frames, ref_image_size: "match" };
  const workflow: ComfyWorkflow = {
    model: { class_type: "UNETLoader", inputs: { unet_name: H3_MODEL, weight_dtype: "default" } },
    attention: { class_type: "PathchSageAttentionKJ", inputs: { model: ["model", 0], sage_attention: "auto", allow_compile: false } },
    shift: { class_type: "MiniMaxH3SigmaShift", inputs: { model: ["attention", 0], shift_video: 12, shift_audio: 3 } },
    clip: { class_type: "CLIPLoader", inputs: { clip_name: H3_CLIP, type: "minimax", device: "default" } },
    vae: { class_type: "VAELoader", inputs: { vae_name: H3_VIDEO_VAE } },
    audio_vae: { class_type: "VAELoader", inputs: { vae_name: H3_AUDIO_VAE } },
    cond: { class_type: "MiniMaxH3ReferenceToVideo", inputs: conditioning },
    guider: { class_type: "BasicGuider", inputs: { model: ["shift", 0], conditioning: ["cond", 0] } },
    noise: { class_type: "RandomNoise", inputs: { noise_seed: h3StableSeed(job) } },
    sampler: { class_type: "KSamplerSelect", inputs: { sampler_name: "res_multistep" } },
    sigmas: { class_type: "BasicScheduler", inputs: { model: ["shift", 0], scheduler: "simple", steps: 20, denoise: 1 } },
    sample: { class_type: "SamplerCustomAdvanced", inputs: { noise: ["noise", 0], guider: ["guider", 0], sampler: ["sampler", 0], sigmas: ["sigmas", 0], latent_image: ["cond", 1] } },
    decode: { class_type: "VAEDecode", inputs: { samples: ["sample", 0], vae: ["vae", 0] } },
    audio: { class_type: "VAEDecodeAudio", inputs: { samples: ["sample", 0], vae: ["audio_vae", 0] } },
    save: { class_type: "VHS_VideoCombine", inputs: { images: ["decode", 0], audio: ["audio", 0], frame_rate: H3_FPS,
      loop_count: 0, filename_prefix: `stack-structure/${job.id}/shot`, format: "video/h264-mp4", pix_fmt: "yuv420p",
      crf: 19, save_metadata: true, trim_to_audio: false, pingpong: false, save_output: true } },
  };
  inputPaths.forEach((path, i) => {
    const id = `reference_${i}`;
    workflow[id] = { class_type: "LoadImage", inputs: { image: path } };
    conditioning[`ref_images.ref_image_${i}`] = [id, 0];
  });
  return { workflow, ...compiled };
}
