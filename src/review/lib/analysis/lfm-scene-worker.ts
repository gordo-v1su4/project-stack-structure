/// <reference lib="webworker" />
/**
 * LFM-2.5-VL captioning worker. Loads LiquidAI/LFM2.5-VL-450M-ONNX via
 * @huggingface/transformers and captions individual scene frames entirely
 * client-side (WebGPU). Ported from FreeCut's lfm-scene-worker.ts.
 *
 * Messages in:  { type: 'init' } | { type: 'caption', id, bitmap }
 * Messages out: { type: 'ready' } | { type: 'progress' } | { type: 'caption' } | { type: 'error' }
 */

import {
  AutoProcessor,
  AutoModelForImageTextToText,
  RawImage,
} from "@huggingface/transformers";
import {
  LFM_SCENE_CAPTION_PROMPT,
  parseSceneCaptionResponse,
} from "./scene-caption-format";

const MODEL_ID = "LiquidAI/LFM2.5-VL-450M-ONNX";
const MAX_NEW_TOKENS = 160;

/* eslint-disable @typescript-eslint/no-explicit-any */
let processor: any = null;
let model: any = null;
/* eslint-enable @typescript-eslint/no-explicit-any */
let loading = false;

function post(msg: Record<string, unknown>) {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);
}

async function loadModel() {
  if (model && processor) {
    post({ type: "ready" });
    return;
  }
  if (loading) return;
  loading = true;
  try {
    post({ type: "progress", stage: "loading-model", percent: 2 });
    const loadedProcessor = await AutoProcessor.from_pretrained(MODEL_ID);
    let lastPct = 5;
    const loadedModel = await AutoModelForImageTextToText.from_pretrained(MODEL_ID, {
      dtype: {
        vision_encoder: "fp16",
        embed_tokens: "fp16",
        decoder_model_merged: "q4",
      },
      device: "webgpu",
      progress_callback: (info: { status?: string; total?: number; loaded?: number }) => {
        if (info.status === "progress" && info.total && info.loaded) {
          const pct = 5 + (info.loaded / info.total) * 90;
          if (pct - lastPct > 2) {
            lastPct = pct;
            post({ type: "progress", stage: "loading-model", percent: Math.round(pct) });
          }
        }
      },
    });
    processor = loadedProcessor;
    model = loadedModel;
    post({ type: "progress", stage: "ready", percent: 100 });
    post({ type: "ready" });
  } catch (err) {
    post({ type: "error", message: `Model load failed: ${(err as Error).message}` });
  } finally {
    loading = false;
  }
}

async function captionFrame(id: number, bitmap: ImageBitmap) {
  if (!model || !processor) {
    post({ type: "error", message: "Model not loaded", id });
    return;
  }
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
    const image = await RawImage.fromBlob(blob);

    const messages = [
      {
        role: "user",
        content: [{ type: "image" }, { type: "text", text: LFM_SCENE_CAPTION_PROMPT }],
      },
    ];
    const prompt = processor.apply_chat_template(messages, { add_generation_prompt: true });
    const inputs = await processor(image, prompt, { add_special_tokens: false });
    const outputs = await model.generate({
      ...inputs,
      max_new_tokens: MAX_NEW_TOKENS,
      do_sample: false,
      repetition_penalty: 1.05,
    });
    const decoded = processor.batch_decode(
      outputs.slice(null, [inputs.input_ids.dims.at(-1), null]),
      { skip_special_tokens: true }
    );
    const parsed = parseSceneCaptionResponse(decoded[0] ?? "");
    post({ type: "caption", id, text: parsed.text, meta: parsed.meta });
  } catch (err) {
    post({ type: "caption", id, text: "", error: (err as Error).message });
  }
}

self.onmessage = (e: MessageEvent) => {
  const msg = e.data;
  if (msg.type === "init") void loadModel();
  else if (msg.type === "caption") void captionFrame(msg.id, msg.bitmap);
};
