import { describe, expect, test } from "bun:test";

import {
  buildSwarmComfyDirectUrl,
  buildSwarmTextToImagePayload,
  chooseSwarmModel,
  extractComfyOutputRefs,
  getComfyHistoryStatus,
  normalizeSwarmAssets,
  patchComfyWorkflow,
  type ComfyWorkflow,
} from "@/components/studio/localGeneration";

const workflow: ComfyWorkflow = {
  "3": { class_type: "KSampler", inputs: { seed: 1, steps: 20, cfg: 7, positive: ["6", 0], negative: ["7", 0] } },
  "5": { class_type: "EmptyLatentImage", inputs: { width: 512, height: 512, batch_size: 1 } },
  "6": { class_type: "CLIPTextEncode", inputs: { text: "old positive", clip: ["4", 1] } },
  "7": { class_type: "CLIPTextEncode", inputs: { text: "old negative", clip: ["4", 1] } },
  "9": { class_type: "SaveImage", inputs: { filename_prefix: "ComfyUI", images: ["8", 0] } },
};

describe("local ComfyUI generation helpers", () => {
  test("routes every ComfyUI API path through the stable SwarmUI proxy", () => {
    expect(buildSwarmComfyDirectUrl("http://127.0.0.1:7861/", "prompt"))
      .toBe("http://127.0.0.1:7861/ComfyBackendDirect/prompt");
    expect(buildSwarmComfyDirectUrl("http://100.73.126.36:7861", "/history/prompt-1"))
      .toBe("http://100.73.126.36:7861/ComfyBackendDirect/history/prompt-1");
    expect(buildSwarmComfyDirectUrl("http://127.0.0.1:7861", "view?filename=clip.mp4&type=output"))
      .toBe("http://127.0.0.1:7861/ComfyBackendDirect/view?filename=clip.mp4&type=output");
  });

  test("patches prompt, negative prompt, dimensions, sampler, and filename prefix", () => {
    const patched = patchComfyWorkflow(workflow, {
      provider: "comfyui",
      prompt: "neon singer in rain",
      negativePrompt: "blurry, low quality",
      width: 777,
      height: 513,
      steps: 32,
      seed: 123.7,
      cfg: 5.5,
      action: "alt-angle",
    });

    expect((patched["6"] as { inputs: { text: string } }).inputs.text).toBe("neon singer in rain");
    expect((patched["7"] as { inputs: { text: string } }).inputs.text).toBe("blurry, low quality");
    expect((patched["5"] as { inputs: { width: number; height: number } }).inputs.width).toBe(776);
    expect((patched["5"] as { inputs: { width: number; height: number } }).inputs.height).toBe(512);
    expect((patched["3"] as { inputs: { steps: number; seed: number; cfg: number } }).inputs.steps).toBe(32);
    expect((patched["3"] as { inputs: { steps: number; seed: number; cfg: number } }).inputs.seed).toBe(123);
    expect((patched["3"] as { inputs: { steps: number; seed: number; cfg: number } }).inputs.cfg).toBe(5.5);
    expect((patched["9"] as { inputs: { filename_prefix: string } }).inputs.filename_prefix).toBe("stack-alt-angle");
  });

  test("extracts image and video output refs from ComfyUI history", () => {
    const history = {
      abc: {
        status: { completed: true, status_str: "success" },
        outputs: {
          "9": { images: [{ filename: "frame.png", subfolder: "", type: "output" }] },
          "10": { videos: [{ filename: "clip.mp4", subfolder: "video", type: "output" }] },
        },
      },
    };

    expect(getComfyHistoryStatus(history, "abc")).toBe("completed");
    expect(extractComfyOutputRefs(history, "abc")).toEqual([
      { filename: "frame.png", subfolder: "", type: "output", kind: "image" },
      { filename: "clip.mp4", subfolder: "video", type: "output", kind: "video" },
    ]);
  });

  test("treats ComfyUI error status as error even when completed is true", () => {
    expect(getComfyHistoryStatus({ abc: { status: { completed: true, status_str: "error" } } }, "abc")).toBe("error");
  });
});

describe("local SwarmUI generation helpers", () => {
  test("defaults SwarmUI generation dimensions to 16:9", () => {
    const payload = buildSwarmTextToImagePayload({ provider: "swarmui", prompt: "wide stage" }, "session-1");

    expect(payload.width).toBe(1280);
    expect(payload.height).toBe(720);
  });

  test("builds a root raw-map GenerateText2Image payload", () => {
    const payload = buildSwarmTextToImagePayload({ provider: "swarmui", prompt: "city dance", width: 1025, height: 777, steps: 20, cfg: 4, seed: 9, model: "flux-model", swarmParams: { sampler: "euler", scheduler: "simple", loras: ["zimage/IMAX 1570 Film stlyle v1.2.safetensors"], loraweights: [1], prompt: "ignored" } }, "session-1");

    expect(payload.session_id).toBe("session-1");
    expect((payload as Record<string, unknown>).loras).toEqual(["zimage/IMAX 1570 Film stlyle v1.2.safetensors"]);
    expect((payload as Record<string, unknown>).loraweights).toEqual([1]);
    expect(payload.prompt).toBe("city dance");
    expect(payload.width).toBe(1024);
    expect(payload.height).toBe(776);
    expect(payload.cfgscale).toBe(4);
    expect(payload.model).toBe("flux-model");
    expect((payload as Record<string, unknown>).sampler).toBe("euler");
    expect((payload as Record<string, unknown>).scheduler).toBe("simple");
    expect(payload.prompt).toBe("city dance");
  });

  test("passes only the supported MiniMax video controls through the raw map", () => {
    const payload = buildSwarmTextToImagePayload({
      provider: "swarmui",
      kind: "video",
      prompt: "extend the shot",
      model: "minimax_h3_fl2va_pruned_int8_convrot",
      swarmParams: {
        videomodel: "minimax_h3_fl2va_pruned_int8_convrot",
        videoframes: 124,
        videosteps: 20,
        videocfg: 1,
        videoresolution: "Image",
        videofps: 24,
        videoformat: "h264-mp4",
        modelspecificenhancements: true,
        initimage: "data:image/png;base64,unsafe-client-value",
      },
    }, "session-video");

    expect((payload as Record<string, unknown>).videoframes).toBe(124);
    expect((payload as Record<string, unknown>).videomodel).toBe("minimax_h3_fl2va_pruned_int8_convrot");
    expect((payload as Record<string, unknown>).videoformat).toBe("h264-mp4");
    expect((payload as Record<string, unknown>).initimage).toBe(undefined);
  });

  test("chooses an installed non-FP16 image model when SwarmUI does not provide one", () => {
    expect(chooseSwarmModel([
      { name: "video-model-Q8_0.gguf", class: "Wan Video", local: true },
      { name: "flux1-dev-F16.gguf", class: "Flux.1 Dev", local: true },
      { name: "Krea-2-Turbo.safetensors", local: true },
      { name: "z-image-turbo_fp8_scaled_e5m2_KJ.safetensors", class: "Z-Image", compat_class: "z-image", architecture: "z-image", local: true },
    ])).toBe("z-image-turbo_fp8_scaled_e5m2_KJ.safetensors");
  });

  test("normalizes SwarmUI image paths into local proxy URLs", () => {
    expect(normalizeSwarmAssets(["View/local/raw/test.png"])).toEqual([
      { provider: "swarmui", kind: "image", path: "View/local/raw/test.png", url: "/api/generate/local/view?provider=swarmui&path=View%2Flocal%2Fraw%2Ftest.png", metadata: undefined },
    ]);
  });
});
