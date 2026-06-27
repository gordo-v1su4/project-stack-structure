import { describe, expect, test } from "bun:test";

import {
  buildSwarmTextToImagePayload,
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

  test("normalizes SwarmUI image paths into local proxy URLs", () => {
    expect(normalizeSwarmAssets(["View/local/raw/test.png"])).toEqual([
      { provider: "swarmui", kind: "image", path: "View/local/raw/test.png", url: "/api/generate/local/view?provider=swarmui&path=View%2Flocal%2Fraw%2Ftest.png", metadata: undefined },
    ]);
  });
});
