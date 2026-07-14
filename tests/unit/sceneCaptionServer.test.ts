import { describe, expect, mock, test } from "bun:test";

import { uploadSceneCaptionManifestToRustFs } from "@/components/studio/mediaStorage";
import { normalizeServerCaptionPayload } from "@/components/studio/sceneCaptioningServer";
import type { UploadedVideoSource } from "@/components/studio/types";

const triggerSmartSceneCaptionMock = mock(async () => ({ id: "run_caption_123" }));
mock.module("@/lib/triggerOrchestration", () => ({
  STACK_STRUCTURE_TRIGGER_TASKS: {
    mediaVideoPipeline: "media-video-pipeline",
    mediaSceneDetection: "media-video-scene-detect",
    mediaSceneCaptionBatch: "qwen-scene-caption-batch",
    mediaFinalization: "media-video-finalize",
    essentiaAnalysis: "essentia-analyze-stored-audio",
    smartSceneCaption: "qwen-smart-scene-caption",
    localGeneration: "local-ai-generation",
    higgsfieldGeneration: "higgsfield-nano-banana-pro-grid",
    deepgramTranscription: "deepgram-transcribe-stored-audio",
    ffmpegPreview: "ffmpeg-preview-or-concat",
    finalExport: "ffmpeg-final-music-video-export",
    shaderCaptureExport: "ffmpeg-shader-capture-export",
    ffglitch: "ffglitch-transform",
    imageSplitter: "image-split-grid",
  },
  assertTriggerConfigured: () => undefined,
  triggerSmartSceneCaption: triggerSmartSceneCaptionMock,
  triggerMediaSceneDetection: mock(async () => ({ id: "run_media_123" })),
  triggerEssentiaAnalysis: mock(async () => ({ id: "run_essentia_123" })),
  retrieveTriggerRun: mock(async () => ({})),
}));

const { GET, POST } = await import("@/app/api/caption/scene/route");

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

function restoreGlobals() {
  process.env = { ...originalEnv };
  globalThis.fetch = originalFetch;
}

type FetchCall = { url: string; init?: RequestInit };

describe("scene caption server seam", () => {
  test("reports unavailable when no self-hosted caption gateway is configured", async () => {
    try {
      delete process.env.SCENE_CAPTION_GATEWAY_URL;
      delete process.env.SCENE_CAPTION_FAST_GATEWAY_URL;
      delete process.env.SCENE_CAPTION_SMART_GATEWAY_URL;
      delete process.env.LFM_CAPTION_GATEWAY_URL;
      delete process.env.QWEN_CAPTION_GATEWAY_URL;
      delete process.env.VISION_CAPTION_GATEWAY_URL;

      const response = await GET();
      const payload = await response.json() as {
        configured?: boolean;
        reachable?: boolean;
        captionSource?: string;
        providers?: {
          fast?: { serverGateway?: { configured?: boolean; reachable?: boolean } };
          smart?: { configured?: boolean; reachable?: boolean; model?: string; captionSource?: string };
        };
      };

      expect(response.status).toBe(200);
      expect(payload.configured).toBe(false);
      expect(payload.reachable).toBe(false);
      expect(payload.captionSource).toBe("qwen3-vl-server");
      expect(payload.providers?.fast?.serverGateway?.configured).toBe(false);
      expect(payload.providers?.fast?.serverGateway?.reachable).toBe(false);
      expect(payload.providers?.smart?.configured).toBe(false);
      expect(payload.providers?.smart?.reachable).toBe(false);
      expect(payload.providers?.smart?.captionSource).toBe("qwen3-vl-server");
      expect(payload.providers?.smart?.model).toBe("Qwen/Qwen3-VL-4B-Instruct-GGUF:Q4_K_M");
    } finally {
      restoreGlobals();
    }
  });

  test("does not report smart captioning available from a generic fast gateway env var", async () => {
    try {
      delete process.env.SCENE_CAPTION_FAST_GATEWAY_URL;
      delete process.env.LFM_CAPTION_GATEWAY_URL;
      delete process.env.VISION_CAPTION_GATEWAY_URL;
      delete process.env.SCENE_CAPTION_FAST_GATEWAY_TOKEN;
      delete process.env.LFM_CAPTION_GATEWAY_TOKEN;
      delete process.env.VISION_CAPTION_GATEWAY_TOKEN;
      process.env.SCENE_CAPTION_GATEWAY_URL = "https://caption-gateway.local";
      delete process.env.SCENE_CAPTION_SMART_GATEWAY_URL;
      delete process.env.QWEN_CAPTION_GATEWAY_URL;

      globalThis.fetch = (async (_url: string | URL | Request) => {
        expect(String(_url)).toBe("https://caption-gateway.local/health");
        return Response.json({ ok: true });
      }) as unknown as typeof fetch;

      const response = await GET();
      const payload = await response.json() as {
        configured?: boolean;
        reachable?: boolean;
        providers?: {
          fast?: { serverGateway?: { configured?: boolean; reachable?: boolean; captionSource?: string } };
          smart?: { configured?: boolean; reachable?: boolean };
        };
      };

      expect(response.status).toBe(200);
      expect(payload.configured).toBe(false);
      expect(payload.reachable).toBe(false);
      expect(payload.providers?.fast?.serverGateway?.configured).toBe(true);
      expect(payload.providers?.fast?.serverGateway?.reachable).toBe(true);
      expect(payload.providers?.fast?.serverGateway?.captionSource).toBe("lfm-server");
      expect(payload.providers?.smart?.configured).toBe(false);
      expect(payload.providers?.smart?.reachable).toBe(false);
    } finally {
      restoreGlobals();
    }
  });

  test("does not report smart captioning available when the configured smart gateway is unhealthy", async () => {
    try {
      delete process.env.SCENE_CAPTION_GATEWAY_URL;
      delete process.env.SCENE_CAPTION_FAST_GATEWAY_URL;
      delete process.env.LFM_CAPTION_GATEWAY_URL;
      delete process.env.VISION_CAPTION_GATEWAY_URL;
      process.env.SCENE_CAPTION_SMART_GATEWAY_URL = "https://qwen-caption.local";
      delete process.env.QWEN_CAPTION_GATEWAY_URL;

      globalThis.fetch = (async (_url: string | URL | Request) => {
        expect(String(_url)).toBe("https://qwen-caption.local/health");
        return Response.json({ ok: false }, { status: 502, statusText: "Bad Gateway" });
      }) as unknown as typeof fetch;

      const response = await GET();
      const payload = await response.json() as {
        configured?: boolean;
        reachable?: boolean;
        providers?: {
          smart?: { configured?: boolean; reachable?: boolean; status?: number; error?: string };
        };
      };

      expect(response.status).toBe(200);
      expect(payload.configured).toBe(false);
      expect(payload.reachable).toBe(false);
      expect(payload.providers?.smart?.configured).toBe(true);
      expect(payload.providers?.smart?.reachable).toBe(false);
      expect(payload.providers?.smart?.status).toBe(502);
      expect(payload.providers?.smart?.error).toBe("502 Bad Gateway");
    } finally {
      restoreGlobals();
    }
  });

  test("keeps fast captions in browser WebGPU instead of bypassing Trigger", async () => {
    try {
      delete process.env.SCENE_CAPTION_FAST_GATEWAY_URL;
      delete process.env.LFM_CAPTION_GATEWAY_URL;
      delete process.env.VISION_CAPTION_GATEWAY_URL;
      delete process.env.SCENE_CAPTION_FAST_GATEWAY_TOKEN;
      delete process.env.LFM_CAPTION_GATEWAY_TOKEN;
      delete process.env.VISION_CAPTION_GATEWAY_TOKEN;
      process.env.SCENE_CAPTION_GATEWAY_URL = "https://caption-gateway.local";
      process.env.SCENE_CAPTION_GATEWAY_TOKEN = "test-token";
      process.env.SCENE_CAPTION_MODEL_ID = "LiquidAI/LFM2.5-VL-450M-ONNX";
      delete process.env.SCENE_CAPTION_SMART_GATEWAY_URL;
      delete process.env.QWEN_CAPTION_GATEWAY_URL;

      const form = new FormData();
      form.set("image", new File([new Uint8Array([1, 2, 3])], "frame.jpg", { type: "image/jpeg" }));
      form.set("sceneId", "7");

      const response = await POST(new Request("http://localhost/api/caption/scene", { method: "POST", body: form }));
      const payload = await response.json() as { ok?: boolean; error?: string };

      expect(response.status).toBe(400);
      expect(payload.ok).toBe(false);
      expect(payload.error).toContain("browser WebGPU");
      expect(triggerSmartSceneCaptionMock).not.toHaveBeenCalled();
    } finally {
      restoreGlobals();
    }
  });

  test("routes smart mode through the Qwen3-VL caption gateway with project context", async () => {
    const calls: FetchCall[] = [];
    try {
      delete process.env.SCENE_CAPTION_GATEWAY_URL;
      process.env.SCENE_CAPTION_SMART_GATEWAY_URL = "https://qwen-caption.local";
      process.env.SCENE_CAPTION_SMART_GATEWAY_TOKEN = "smart-token";
      process.env.MEDIA_GATEWAY_URL = "https://media.local";
      process.env.MEDIA_GATEWAY_TOKEN = "media-token";
      triggerSmartSceneCaptionMock.mockClear();

      globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(_url), init });
        const form = init?.body as FormData;
        expect(String(_url)).toBe("https://media.local/upload");
        expect(init?.headers).toMatchObject({ Authorization: "Bearer media-token" });
        expect(form.get("folder")).toBe("media-uploads/caption-frames");
        expect(form.get("file")).toBeInstanceOf(File);
        return Response.json({
          bucket: "stack-structure",
          publicUrl: "https://s3.local/stack-structure/caption-frame.jpg",
          objectKey: "media-uploads/caption-frames/caption-frame.jpg",
          mime: "image/jpeg",
        });
      }) as unknown as typeof fetch;

      const form = new FormData();
      form.set("image", new File([new Uint8Array([4, 5, 6])], "frame.jpg", { type: "image/jpeg" }));
      form.set("mode", "smart");
      form.set("captionContext", JSON.stringify({ lyricExcerpt: "love me tonight", projectIntent: "music video" }));
      form.set("sceneStart", "1.5");

      const response = await POST(new Request("http://localhost/api/caption/scene", { method: "POST", body: form }));
      const payload = await response.json() as { ok?: boolean; mode?: string; queued?: boolean; runId?: string; captionSource?: string; model?: string };

      expect(response.status).toBe(202);
      expect(payload.ok).toBe(true);
      expect(payload.mode).toBe("smart");
      expect(payload.queued).toBe(true);
      expect(payload.runId).toBe("run_caption_123");
      expect(payload.captionSource).toBe("qwen3-vl-server");
      expect(payload.model).toBe("Qwen/Qwen3-VL-4B-Instruct-GGUF:Q4_K_M");
      expect(calls).toHaveLength(1);
      expect(triggerSmartSceneCaptionMock).toHaveBeenCalledTimes(1);
      const triggerCalls = triggerSmartSceneCaptionMock.mock.calls as unknown as Array<[Record<string, unknown>, string]>;
      expect(triggerCalls[0]?.[0]).toMatchObject({
        bucket: "stack-structure",
        objectKey: "media-uploads/caption-frames/caption-frame.jpg",
        captionContext: JSON.stringify({ lyricExcerpt: "love me tonight", projectIntent: "music video" }),
        sceneStart: "1.5",
      });
    } finally {
      restoreGlobals();
    }
  });

  test("normalizes server caption payloads for the studio caption path", () => {
    expect(normalizeServerCaptionPayload({
      ok: true,
      text: "Wide shot of dancers moving through rain.",
      meta: { subjects: ["dancers"], weather: "rain" },
      model: "lfm-local",
    })).toMatchObject({
      text: "Wide shot of dancers moving through rain.",
      meta: { subjects: ["dancers"], weather: "rain" },
      captionSource: "qwen3-vl-server",
      model: "lfm-local",
    });
  });
});

describe("RustFS caption sidecar storage", () => {
  test("stores smart Qwen-generated caption manifests under a smart-captions sidecar folder", async () => {
    const source: UploadedVideoSource = {
      id: 0,
      name: "clip.mp4",
      duration: 3,
      size: 100,
      thumbnailUrl: "thumb",
      videoUrl: "blob:clip",
      storageProvider: "rustfs",
      storageBucket: "stack-structure",
      storagePath: "media-uploads/2026/06_18/clip.mp4",
      storageUrl: "https://media.local/clip.mp4",
      scenes: [{
        id: 0,
        sourceClipId: 0,
        label: "Scene 01",
        start: 0,
        end: 3,
        duration: 3,
        detector: "pyscenedetect-adaptive",
        caption: "A singer walks into a warm room.",
        captionSource: "qwen3-vl-server",
        captionMode: "smart",
        captionModel: "Qwen/Qwen3-VL-4B-Instruct-GGUF:Q4_K_M",
      }],
    };

    const calls: FetchCall[] = [];
    try {
      globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(_url), init });
        const form = init?.body as FormData;
        expect(form.get("folder")).toBe("media-uploads/2026/06_18/clip.mp4.analysis/smart-captions");
        const manifestFile = form.get("file") as File;
        const manifest = JSON.parse(await manifestFile.text()) as { captionProvider?: string; captions?: Array<{ captionSource?: string; captionMode?: string; captionModel?: string }> };
        expect(manifest.captionProvider).toBe("qwen3-vl-server");
        expect(manifest.captions?.[0]?.captionSource).toBe("qwen3-vl-server");
        expect(manifest.captions?.[0]?.captionMode).toBe("smart");
        expect(manifest.captions?.[0]?.captionModel).toBe("Qwen/Qwen3-VL-4B-Instruct-GGUF:Q4_K_M");
        return Response.json({
          publicUrl: "https://media.local/stack-structure/media-uploads/2026/06_18/clip.mp4.analysis/smart-captions/captions.json",
          storagePath: "media-uploads/2026/06_18/clip.mp4.analysis/smart-captions/captions.json",
        });
      }) as unknown as typeof fetch;

      const uploaded = await uploadSceneCaptionManifestToRustFs(source);

      expect(uploaded.captionManifestPath).toContain("smart-captions/captions.json");
      expect(calls).toHaveLength(1);
    } finally {
      restoreGlobals();
    }
  });
});
