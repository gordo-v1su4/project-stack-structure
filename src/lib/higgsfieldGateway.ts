import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { uploadFileToMediaGateway, type MediaGatewayUploadResult } from "@/lib/mediaGateway";
import { splitImageWithGateway, uploadImageSplitPanelsToMediaGateway, type ImageSplitManifest } from "@/lib/imageSplitterGateway";

export type HiggsfieldResolution = "1k" | "2k" | "4k";

export type HiggsfieldInputImage = {
  id?: string;
  url: string;
  type?: "media_input";
  label?: string;
};

export type HiggsfieldGeneratedAsset = {
  id: string;
  provider: "higgsfield";
  model: "nano_banana_2";
  characterName?: string;
  title?: string;
  prompt: string;
  createdAt: string;
  jobId: string;
  status: "completed" | "failed" | "queued" | "processing";
  aspectRatio: string;
  resolution: HiggsfieldResolution;
  width?: number;
  height?: number;
  resultUrl: string;
  thumbnailUrl?: string;
  fullStorage: MediaGatewayUploadResult;
  split?: ImageSplitManifest;
};

type HiggsfieldMediaInput = {
  id: string;
  url: string;
  type: "media_input";
};

type HiggsfieldJob = {
  id?: string;
  status?: string;
  result_url?: string;
  min_result_url?: string;
  params?: {
    width?: number;
    height?: number;
    aspect_ratio?: string;
    resolution?: HiggsfieldResolution;
  };
  created_at?: number;
};

const DEFAULT_HIGGSFIELD_API_URL = "https://fnf.higgsfield.ai";
const DEFAULT_CREDENTIALS_PATH = ".higgsfield-stack-structure.json";

export function getHiggsfieldApiUrl(env: Record<string, string | undefined> = process.env) {
  return (env.HIGGSFIELD_API_URL || DEFAULT_HIGGSFIELD_API_URL).replace(/\/+$/, "");
}

export async function getHiggsfieldAccount(env: Record<string, string | undefined> = process.env) {
  const token = await getHiggsfieldAccessToken(env);
  const response = await fetch(`${getHiggsfieldApiUrl(env)}/agents/balance`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await readJson(response);
  if (!response.ok) throw new Error(`Higgsfield account check failed (${response.status}): ${JSON.stringify(payload).slice(0, 300)}`);
  return payload;
}

export async function createNanoBananaProGrid(args: {
  prompt: string;
  inputImages: HiggsfieldInputImage[];
  characterName?: string;
  title?: string;
  aspectRatio?: string;
  resolution?: HiggsfieldResolution;
  splitRows?: number;
  splitCols?: number;
  env?: Record<string, string | undefined>;
  pollIntervalMs?: number;
  timeoutMs?: number;
}): Promise<HiggsfieldGeneratedAsset> {
  const env = args.env ?? process.env;
  const prompt = args.prompt.trim();
  if (!prompt) throw new Error("prompt is required");

  const token = await getHiggsfieldAccessToken(env);
  const inputImages = await Promise.all(args.inputImages.filter((image) => image.url.trim()).map((image) => ensureHiggsfieldMediaInput(image, env)));
  const aspectRatio = args.aspectRatio || "16:9";
  const resolution = args.resolution || "2k";
  const createBody = {
    job_set_type: "nano_banana_2",
    prompt,
    input_images: inputImages,
    params: {
      prompt,
      aspect_ratio: aspectRatio,
      resolution,
      input_images: inputImages,
    },
  };

  const createResponse = await fetch(`${getHiggsfieldApiUrl(env)}/agents/jobs`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(createBody),
  });
  const created = await readJson(createResponse);
  if (!createResponse.ok) throw new Error(`Higgsfield job create failed (${createResponse.status}): ${JSON.stringify(created).slice(0, 500)}`);
  const jobId = readJobId(created);
  if (!jobId) throw new Error(`Higgsfield job create returned no job id: ${JSON.stringify(created).slice(0, 500)}`);

  const job = await pollHiggsfieldJob({ jobId, token, env, pollIntervalMs: args.pollIntervalMs, timeoutMs: args.timeoutMs });
  if (job.status !== "completed" || !job.result_url) {
    throw new Error(`Higgsfield job did not complete: ${JSON.stringify(job).slice(0, 500)}`);
  }

  const resultFile = await fetchResultAsFile(job.result_url, buildFullGridFilename(args.characterName || args.title || "higgsfield-grid", jobId));
  const folderSlug = buildSlug(args.characterName || args.title || "nano-banana-pro");
  const fullStorage = await uploadFileToMediaGateway({
    file: resultFile,
    folder: `media-uploads/generated/higgsfield/nano-banana-pro/${folderSlug}/${jobId}`,
    env,
  });

  let split: ImageSplitManifest | undefined;
  if (args.splitRows && args.splitCols) {
    const splitResponse = await splitImageWithGateway({
      file: resultFile,
      options: { mode: "fixed", rows: args.splitRows, cols: args.splitCols, gutterPx: 0 },
      env,
    });
    const persisted = await uploadImageSplitPanelsToMediaGateway({ split: splitResponse, env });
    split = persisted.manifest;
  }

  return {
    id: `higgsfield:${jobId}`,
    provider: "higgsfield",
    model: "nano_banana_2",
    characterName: args.characterName,
    title: args.title,
    prompt,
    createdAt: new Date().toISOString(),
    jobId,
    status: "completed",
    aspectRatio,
    resolution,
    width: job.params?.width,
    height: job.params?.height,
    resultUrl: job.result_url,
    thumbnailUrl: job.min_result_url,
    fullStorage,
    split,
  };
}

async function ensureHiggsfieldMediaInput(image: HiggsfieldInputImage, env: Record<string, string | undefined>): Promise<HiggsfieldMediaInput> {
  if (image.id && image.type === "media_input") return { id: image.id, url: image.url, type: "media_input" };
  return uploadRemoteImageToHiggsfield(image.url, env);
}

async function uploadRemoteImageToHiggsfield(url: string, env: Record<string, string | undefined>): Promise<HiggsfieldMediaInput> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not fetch reference image (${response.status}): ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const ext = extensionFromContentType(response.headers.get("Content-Type")) || extensionFromUrl(url) || ".png";
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "higgsfield-ref-"));
  const filePath = path.join(tmpDir, `reference${ext}`);
  try {
    await writeFile(filePath, buffer);
    const uploaded = await runHiggsfieldJsonCli(["upload", "create", filePath], env) as Record<string, unknown>;
    const id = readString(uploaded.id);
    const uploadedUrl = readString(uploaded.url);
    if (!id || !uploadedUrl) throw new Error(`Higgsfield upload returned an incomplete payload: ${JSON.stringify(uploaded).slice(0, 300)}`);
    return { id, url: uploadedUrl, type: "media_input" };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

async function pollHiggsfieldJob(args: { jobId: string; token: string; env: Record<string, string | undefined>; pollIntervalMs?: number; timeoutMs?: number }): Promise<HiggsfieldJob> {
  const started = Date.now();
  const timeoutMs = args.timeoutMs ?? 240_000;
  const pollIntervalMs = args.pollIntervalMs ?? 5_000;
  let last: HiggsfieldJob = {};
  while (Date.now() - started < timeoutMs) {
    const response = await fetch(`${getHiggsfieldApiUrl(args.env)}/agents/jobs/${encodeURIComponent(args.jobId)}`, {
      headers: { Authorization: `Bearer ${args.token}` },
    });
    const payload = await readJson(response) as HiggsfieldJob;
    if (!response.ok) throw new Error(`Higgsfield job poll failed (${response.status}): ${JSON.stringify(payload).slice(0, 300)}`);
    last = payload;
    const status = String(payload.status || "").toLowerCase();
    if (["completed", "complete", "succeeded", "success", "failed", "error", "canceled", "cancelled"].includes(status)) return payload;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  throw new Error(`Higgsfield job timed out after ${Math.round(timeoutMs / 1000)}s: ${JSON.stringify(last).slice(0, 300)}`);
}

async function fetchResultAsFile(url: string, filename: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download Higgsfield result (${response.status})`);
  const blob = await response.blob();
  return new File([blob], filename, { type: response.headers.get("Content-Type") || blob.type || "image/png" });
}

async function getHiggsfieldAccessToken(env: Record<string, string | undefined>) {
  if (env.HIGGSFIELD_ACCESS_TOKEN?.trim()) return env.HIGGSFIELD_ACCESS_TOKEN.trim();
  // The CLI refreshes short-lived access tokens during account status checks.
  await runHiggsfieldCli(["account", "status"], env).catch(() => "");
  const cliToken = await runHiggsfieldCli(["auth", "token"], env).catch(() => "");
  if (cliToken.trim()) return cliToken.trim();
  throw new Error("Missing Higgsfield auth. Set HIGGSFIELD_ACCESS_TOKEN or login with HIGGSFIELD_CREDENTIALS_PATH.");
}

function runHiggsfieldJsonCli(args: string[], env: Record<string, string | undefined>) {
  return runHiggsfieldCli(["--json", ...args], env).then((stdout) => JSON.parse(stdout) as unknown);
}

function runHiggsfieldCli(args: string[], env: Record<string, string | undefined>): Promise<string> {
  const credentialsPath = env.HIGGSFIELD_CREDENTIALS_PATH || path.join(process.cwd(), DEFAULT_CREDENTIALS_PATH);
  return new Promise((resolve, reject) => {
    const child = spawn("higgsfield", args, {
      env: { ...process.env, ...env, HIGGSFIELD_CREDENTIALS_PATH: credentialsPath },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`higgsfield ${args.join(" ")} failed (${code}): ${stderr.slice(0, 300) || stdout.slice(0, 300)}`));
    });
  });
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => "");
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: text.slice(0, 300) };
  }
}

function readJobId(payload: unknown) {
  if (Array.isArray(payload)) return readString(payload[0]);
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    return readString(record.id) || readString(record.job_id) || readString((record.job as Record<string, unknown> | undefined)?.id);
  }
  return undefined;
}

function buildFullGridFilename(label: string, jobId: string) {
  return `${buildSlug(label)}__${jobId}__full-grid.png`;
}

function buildSlug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "higgsfield";
}

function extensionFromUrl(url: string) {
  const pathname = new URL(url).pathname;
  const match = pathname.match(/\.(png|jpe?g|webp|gif)$/i);
  return match ? `.${match[1].toLowerCase().replace("jpeg", "jpg")}` : undefined;
}

function extensionFromContentType(contentType: string | null) {
  if (!contentType) return undefined;
  if (contentType.includes("jpeg")) return ".jpg";
  if (contentType.includes("png")) return ".png";
  if (contentType.includes("webp")) return ".webp";
  if (contentType.includes("gif")) return ".gif";
  return undefined;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
