import { describe, expect, mock, test } from "bun:test";

let authenticatedUserId: string | null = "github-test-user";
const authMock = mock(async () => authenticatedUserId ? { user: { id: authenticatedUserId } } : null);

const uploadFileToMediaGatewayMock = mock(async ({ file, folder }: { file: File; folder: string }) => ({
  bucket: "stack-structure",
  objectKey: `${folder}/${file.name}`,
  storagePath: `${folder}/${file.name}`,
  publicUrl: `https://media.test/${encodeURIComponent(file.name)}`,
  mediaUrl: `https://media.test/${encodeURIComponent(file.name)}`,
  mime: file.type || "application/octet-stream",
}));
const downloadJsonFromMediaGatewayMock = mock(async () => {
  throw new Error("404 not found");
});
const uploadJsonToMediaGatewayMock = mock(async () => ({
  bucket: "stack-structure",
  objectKey: "media-uploads/analysis/result.json",
  storagePath: "media-uploads/analysis/result.json",
  publicUrl: "https://media.test/result.json",
  mediaUrl: "https://media.test/result.json",
  mime: "application/json",
}));
const deleteMediaGatewayFilesMock = mock(async () => ({ deleted: 0, failed: 0 }));

const triggerMocks = {
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
  triggerLocalGeneration: mock(async () => ({ id: "run-local-123" })),
  triggerHiggsfieldGeneration: mock(async () => ({ id: "run-higgsfield-123" })),
  triggerDeepgramTranscription: mock(async () => ({ id: "run-deepgram-123" })),
  triggerEssentiaAnalysis: mock(async (payload: unknown) => {
    void payload;
    return { id: "run-essentia-123" };
  }),
  triggerMediaSceneDetection: mock(async () => ({ id: "run-media-123" })),
  triggerFfmpegPreview: mock(async () => ({ id: "run-preview-123" })),
  triggerFinalExport: mock(async () => ({ id: "run-export-123" })),
  triggerShaderCaptureExport: mock(async () => ({ id: "run-shader-123" })),
  triggerFfglitch: mock(async () => ({ id: "run-ffglitch-123" })),
  triggerImageSplitter: mock(async () => ({ id: "run-splitter-123" })),
};

mock.module("@/lib/mediaGateway", () => ({
  getMediaGatewayConfig: () => ({
    url: "https://media.test",
    token: "test-token",
    userId: "stack-structure",
    bucket: "stack-structure",
    uploadPrefix: "media-uploads",
  }),
  normalizeMediaPath: (value: string) => value,
  buildMediaGatewayFileUrl: (config: { url: string }, bucket: string, objectKey: string) =>
    `${config.url}/files/${bucket}/${objectKey}`,
  downloadJsonFromMediaGateway: downloadJsonFromMediaGatewayMock,
  downloadMediaGatewayFile: mock(async () => ({
    bytes: new Uint8Array([1, 2, 3]),
    fileName: "source.bin",
    mime: "application/octet-stream",
  })),
  deleteMediaGatewayFiles: deleteMediaGatewayFilesMock,
  uploadFileToMediaGateway: uploadFileToMediaGatewayMock,
  uploadJsonToMediaGateway: uploadJsonToMediaGatewayMock,
}));

mock.module("@/auth", () => ({ auth: authMock }));
mock.module("@/lib/triggerOrchestration", () => triggerMocks);
mock.module("@/lib/higgsfieldGateway", () => ({
  getHiggsfieldAccount: mock(async () => ({ balance: 0 })),
}));
mock.module("@/components/studio/ffglitchApi", () => ({
  detectFfglitch: mock(async () => ({ available: true })),
}));

const { POST: postLocalGeneration } = await import("@/app/api/generate/local/route");
const { POST: postHiggsfield } = await import("@/app/api/generate/higgsfield/route");
const { POST: postDeepgram } = await import("@/app/api/deepgram/transcribe/route");
const { POST: postEssentia } = await import("@/app/api/essentia/full/route");
const { POST: postStorageUpload } = await import("@/app/api/storage/upload/route");
const { POST: postMediaJob } = await import("@/app/api/media/video/jobs/route");
const { POST: postPreviewGateway } = await import("@/app/api/preview/gateway/route");
const { POST: postFinalExport } = await import("@/app/api/export/final/route");
const { POST: postShaderExport } = await import("@/app/api/export/shader-capture/route");
const { POST: postFfglitch } = await import("@/app/api/ffglitch/route");
const { POST: postImageSplitter } = await import("@/app/api/splitter/image/route");

function imageFile(name = "frame.png") {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });
}

function videoFile(name = "source.mp4") {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "video/mp4" });
}

function audioFile(name = "master.wav") {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "audio/wav" });
}

function resetMocks() {
  authenticatedUserId = "github-test-user";
  authMock.mockClear();
  uploadFileToMediaGatewayMock.mockClear();
  for (const trigger of Object.values(triggerMocks)) {
    if (typeof trigger === "function" && "mockClear" in trigger) trigger.mockClear();
  }
}

async function jsonResponse(response: Response) {
  return await response.json() as Record<string, unknown>;
}

describe("Next route Trigger.dev dispatch boundary", () => {
  test("queues local SwarmUI generation", async () => {
    resetMocks();
    const response = await postLocalGeneration(new Request("http://localhost/api/generate/local", {
      method: "POST",
      body: JSON.stringify({ provider: "swarmui", prompt: "a blue sphere", width: 512, height: 512 }),
      headers: { "content-type": "application/json" },
    }));
    const payload = await jsonResponse(response);

    expect(response.status).toBe(202);
    expect(payload.orchestration).toBe("trigger.dev");
    expect(payload.runId).toBe("run-local-123");
    expect(triggerMocks.triggerLocalGeneration).toHaveBeenCalledTimes(1);
  });

  test("queues Higgsfield generation", async () => {
    resetMocks();
    const response = await postHiggsfield(new Request("http://localhost/api/generate/higgsfield", {
      method: "POST",
      body: JSON.stringify({ prompt: "portrait", inputImages: [{ url: "https://media.test/reference.png" }] }),
      headers: { "content-type": "application/json" },
    }));
    const payload = await jsonResponse(response);

    expect(response.status).toBe(202);
    expect(payload.runId).toBe("run-higgsfield-123");
    expect(triggerMocks.triggerHiggsfieldGeneration).toHaveBeenCalledTimes(1);
  });

  test("uploads audio before queuing Deepgram", async () => {
    resetMocks();
    const response = await postDeepgram(new Request("http://localhost/api/deepgram/transcribe", {
      method: "POST",
      body: new Uint8Array([1, 2, 3]),
      headers: { "content-type": "audio/wav", "x-audio-filename": "vocal.wav" },
    }) as Parameters<typeof postDeepgram>[0]);
    const payload = await jsonResponse(response);

    expect(response.status).toBe(202);
    expect(payload.runId).toBe("run-deepgram-123");
    expect(uploadFileToMediaGatewayMock).toHaveBeenCalledTimes(1);
    expect(triggerMocks.triggerDeepgramTranscription).toHaveBeenCalledTimes(1);
  });

  test("queues oversized Essentia audio from uploaded chunk references", async () => {
    resetMocks();
    const response = await postEssentia(new Request("http://localhost/api/essentia/full?mode=fast", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sourceLabel: "master.wav",
        mimeType: "audio/wav",
        size: 3 * 1024 * 1024 + 1,
        chunks: [
          { bucket: "stack-structure", objectKey: "media-uploads/source-audio/chunks/github-test-user/87f25c0c-90f0-4c8d-8451-e7a08d56f57a/1784709256001-00000.part" },
          { bucket: "stack-structure", objectKey: "media-uploads/source-audio/chunks/github-test-user/87f25c0c-90f0-4c8d-8451-e7a08d56f57a/1784709256002-00001.part" },
        ],
      }),
    }));
    const payload = await jsonResponse(response);

    expect(response.status).toBe(202);
    expect(payload.runId).toBe("run-essentia-123");
    expect(uploadFileToMediaGatewayMock).toHaveBeenCalledTimes(0);
    expect(triggerMocks.triggerEssentiaAnalysis.mock.calls[0]?.[0]).toEqual({
      sourceLabel: "master.wav",
      mimeType: "audio/wav",
      size: 3 * 1024 * 1024 + 1,
      mode: "fast",
      chunks: [
        { bucket: "stack-structure", objectKey: "media-uploads/source-audio/chunks/github-test-user/87f25c0c-90f0-4c8d-8451-e7a08d56f57a/1784709256001-00000.part" },
        { bucket: "stack-structure", objectKey: "media-uploads/source-audio/chunks/github-test-user/87f25c0c-90f0-4c8d-8451-e7a08d56f57a/1784709256002-00001.part" },
      ],
    });
  });

  test("scopes Essentia chunk uploads to the authenticated user", async () => {
    resetMocks();
    const form = new FormData();
    form.set("file", new File([new Uint8Array([1, 2, 3])], "00000.part"));
    form.set("folder", "media-uploads/source-audio/chunks/87f25c0c-90f0-4c8d-8451-e7a08d56f57a");

    const response = await postStorageUpload(new Request("http://localhost/api/storage/upload", {
      method: "POST",
      body: form,
    }));

    expect(response.status).toBe(200);
    expect(uploadFileToMediaGatewayMock.mock.calls[0]?.[0]).toMatchObject({
      folder: "media-uploads/source-audio/chunks/github-test-user/87f25c0c-90f0-4c8d-8451-e7a08d56f57a",
    });
  });

  test("rejects anonymous Essentia chunk uploads", async () => {
    resetMocks();
    authenticatedUserId = null;
    const form = new FormData();
    form.set("file", new File([new Uint8Array([1, 2, 3])], "00000.part"));
    form.set("folder", "media-uploads/source-audio/chunks/87f25c0c-90f0-4c8d-8451-e7a08d56f57a");

    const response = await postStorageUpload(new Request("http://localhost/api/storage/upload", {
      method: "POST",
      body: form,
    }));

    expect(response.status).toBe(401);
    expect(uploadFileToMediaGatewayMock).toHaveBeenCalledTimes(0);
  });

  test("rejects anonymous Essentia analysis requests", async () => {
    resetMocks();
    authenticatedUserId = null;

    const response = await postEssentia(new Request("http://localhost/api/essentia/full?mode=fast", {
      method: "POST",
      body: new FormData(),
    }));

    expect(response.status).toBe(401);
    expect(triggerMocks.triggerEssentiaAnalysis).toHaveBeenCalledTimes(0);
  });

  test("rejects chunk references outside the authenticated user's audio folder", async () => {
    resetMocks();
    const response = await postEssentia(new Request("http://localhost/api/essentia/full?mode=fast", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sourceLabel: "master.wav",
        mimeType: "audio/wav",
        size: 3 * 1024 * 1024 + 1,
        chunks: [
          { bucket: "stack-structure", objectKey: "media-uploads/source-audio/chunks/github-other-user/87f25c0c-90f0-4c8d-8451-e7a08d56f57a/00000.part" },
          { bucket: "stack-structure", objectKey: "media-uploads/source-audio/chunks/github-other-user/87f25c0c-90f0-4c8d-8451-e7a08d56f57a/00001.part" },
        ],
      }),
    }));

    expect(response.status).toBe(400);
    expect(triggerMocks.triggerEssentiaAnalysis).toHaveBeenCalledTimes(0);
  });

  test("rejects incomplete or out-of-order Essentia chunk manifests", async () => {
    resetMocks();
    const response = await postEssentia(new Request("http://localhost/api/essentia/full?mode=fast", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sourceLabel: "master.wav",
        mimeType: "audio/wav",
        size: 6 * 1024 * 1024 + 1,
        chunks: [
          { bucket: "stack-structure", objectKey: "media-uploads/source-audio/chunks/github-test-user/87f25c0c-90f0-4c8d-8451-e7a08d56f57a/00000.part" },
          { bucket: "stack-structure", objectKey: "media-uploads/source-audio/chunks/github-test-user/87f25c0c-90f0-4c8d-8451-e7a08d56f57a/00002.part" },
          { bucket: "stack-structure", objectKey: "media-uploads/source-audio/chunks/github-test-user/87f25c0c-90f0-4c8d-8451-e7a08d56f57a/00001.part" },
        ],
      }),
    }));

    expect(response.status).toBe(400);
    expect(triggerMocks.triggerEssentiaAnalysis).toHaveBeenCalledTimes(0);
  });

  test("returns 400 for malformed Essentia JSON", async () => {
    resetMocks();
    const response = await postEssentia(new Request("http://localhost/api/essentia/full?mode=fast", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    }));

    expect(response.status).toBe(400);
    expect(triggerMocks.triggerEssentiaAnalysis).toHaveBeenCalledTimes(0);
  });

  test("queues media scene detection from a durable object reference", async () => {
    resetMocks();
    const response = await postMediaJob(new Request("http://localhost/api/media/video/jobs", {
      method: "POST",
      body: JSON.stringify({ bucket: "stack-structure", objectKey: "media-uploads/source.mp4" }),
      headers: { "content-type": "application/json" },
    }));
    const payload = await jsonResponse(response);

    expect(response.status).toBe(202);
    expect((payload.job as Record<string, unknown>).job_id).toBe("run-media-123");
    expect(triggerMocks.triggerMediaSceneDetection).toHaveBeenCalledTimes(1);
  });

  test("uploads preview inputs before queuing FFmpeg", async () => {
    resetMocks();
    const form = new FormData();
    form.set("file", videoFile());
    form.set("segments", JSON.stringify([{ startTime: 0, endTime: 1, sourceIndex: 0 }]));
    form.set("requestKey", "preview-route-test");

    const response = await postPreviewGateway(new Request("http://localhost/api/preview/gateway", { method: "POST", body: form }));
    const payload = await jsonResponse(response);

    expect(response.status).toBe(202);
    expect(payload.runId).toBe("run-preview-123");
    expect(uploadFileToMediaGatewayMock).toHaveBeenCalledTimes(1);
    expect(triggerMocks.triggerFfmpegPreview).toHaveBeenCalledTimes(1);
  });

  test("uploads final-export inputs before queuing the export task", async () => {
    resetMocks();
    const form = new FormData();
    form.set("audio", audioFile());
    form.set("file:0", videoFile());
    form.set("requestKey", "final-route-test");
    form.set("segments", JSON.stringify([{ sourceIndex: 0, startTime: 0, endTime: 1 }]));

    const response = await postFinalExport(new Request("http://localhost/api/export/final", { method: "POST", body: form }));
    const payload = await jsonResponse(response);

    expect(response.status).toBe(202);
    expect(payload.runId).toBe("run-export-123");
    expect(uploadFileToMediaGatewayMock).toHaveBeenCalledTimes(2);
    expect(triggerMocks.triggerFinalExport).toHaveBeenCalledTimes(1);
  });

  test("passes validated durable refs straight through without re-uploading", async () => {
    resetMocks();
    const form = new FormData();
    form.set("requestKey", "final-route-refs-test");
    form.set("segments", JSON.stringify([{ sourceIndex: 0, startTime: 0, endTime: 1 }]));
    form.set("audioRef", JSON.stringify({ bucket: "stack-structure", objectKey: "media-uploads/github-test-user/source-audio/master.wav" }));
    form.set("videoRefs", JSON.stringify([
      { bucket: "stack-structure", objectKey: "media-uploads/github-test-user/sources/clip-a.mp4" },
      { bucket: "stack-structure", objectKey: "media-uploads/github-test-user/sources/clip-b.mp4" },
    ]));

    const response = await postFinalExport(new Request("http://localhost/api/export/final", { method: "POST", body: form }));
    const payload = await jsonResponse(response);

    expect(response.status).toBe(202);
    expect(payload.runId).toBe("run-export-123");
    expect(uploadFileToMediaGatewayMock).not.toHaveBeenCalled();
    expect(triggerMocks.triggerFinalExport).toHaveBeenCalledTimes(1);
    type ExportDispatch = {
      audio: { objectKey: string };
      videos: Array<{ objectKey: string }>;
    };
    const dispatches = triggerMocks.triggerFinalExport.mock.calls as unknown as ExportDispatch[][];
    const dispatched = dispatches[0]?.[0];
    expect(dispatched?.audio.objectKey).toBe("media-uploads/github-test-user/source-audio/master.wav");
    expect(dispatched?.videos.map((video) => video.objectKey)).toEqual([
      "media-uploads/github-test-user/sources/clip-a.mp4",
      "media-uploads/github-test-user/sources/clip-b.mp4",
    ]);
  });

  test("rejects durable refs owned by another user", async () => {
    resetMocks();
    authenticatedUserId = "attacker-user";
    const form = new FormData();
    form.set("requestKey", "final-route-cross-user-test");
    form.set("segments", JSON.stringify([{ sourceIndex: 0, startTime: 0, endTime: 1 }]));
    form.set("audioRef", JSON.stringify({ bucket: "stack-structure", objectKey: "media-uploads/github-test-user/source-audio/master.wav" }));
    form.set("videoRefs", JSON.stringify([
      { bucket: "stack-structure", objectKey: "media-uploads/github-test-user/sources/clip-a.mp4" },
    ]));

    const response = await postFinalExport(new Request("http://localhost/api/export/final", { method: "POST", body: form }));
    const payload = await jsonResponse(response);

    expect(response.status).toBe(403);
    expect(payload.success).toBe(false);
    expect(payload.error).toMatch(/not registered to this account/i);
  });

  test("rejects durable refs from a foreign bucket", async () => {
    resetMocks();
    const form = new FormData();
    form.set("segments", JSON.stringify([{ sourceIndex: 0, startTime: 0, endTime: 1 }]));
    form.set("audioRef", JSON.stringify({ bucket: "other-bucket", objectKey: "media-uploads/x.wav" }));
    form.set("videoRefs", JSON.stringify([{ bucket: "stack-structure", objectKey: "media-uploads/y.mp4" }]));

    const response = await postFinalExport(new Request("http://localhost/api/export/final", { method: "POST", body: form }));
    const payload = await jsonResponse(response);

    expect(response.status).toBe(400);
    expect(payload.success).toBe(false);
    expect(payload.error).toMatch(/bucket/i);
  });

  test("uploads shader-capture inputs before queuing the shader export", async () => {
    resetMocks();
    const form = new FormData();
    form.set("audio", audioFile());
    form.set("shaderCapture", new File([new Uint8Array([1, 2, 3])], "capture.webm", { type: "video/webm" }));
    form.set("requestKey", "shader-route-test");

    const response = await postShaderExport(new Request("http://localhost/api/export/shader-capture", { method: "POST", body: form }));
    const payload = await jsonResponse(response);

    expect(response.status).toBe(202);
    expect(payload.runId).toBe("run-shader-123");
    expect(uploadFileToMediaGatewayMock).toHaveBeenCalledTimes(2);
    expect(triggerMocks.triggerShaderCaptureExport).toHaveBeenCalledTimes(1);
  });

  test("queues FFglitch instead of invoking the gateway from the route", async () => {
    resetMocks();
    const response = await postFfglitch(new Request("http://localhost/api/ffglitch", {
      method: "POST",
      body: JSON.stringify({ action: "probe", inputPath: "https://media.test/source.mp4" }),
      headers: { "content-type": "application/json" },
    }));
    const payload = await jsonResponse(response);

    expect(response.status).toBe(202);
    expect(payload.runId).toBe("run-ffglitch-123");
    expect(triggerMocks.triggerFfglitch).toHaveBeenCalledTimes(1);
  });

  test("uploads the source before queuing image splitting", async () => {
    resetMocks();
    const form = new FormData();
    form.set("file", imageFile());
    form.set("rows", "3");
    form.set("cols", "3");

    const response = await postImageSplitter(new Request("http://localhost/api/splitter/image", { method: "POST", body: form }));
    const payload = await jsonResponse(response);

    expect(response.status).toBe(202);
    expect(payload.runId).toBe("run-splitter-123");
    expect(uploadFileToMediaGatewayMock).toHaveBeenCalledTimes(1);
    expect(triggerMocks.triggerImageSplitter).toHaveBeenCalledTimes(1);
  });
});
