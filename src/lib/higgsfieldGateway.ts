import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
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

export async function getHiggsfieldAccount(env: Record<string, string | undefined> = process.env) {
  return runHiggsfieldJsonCli(["account", "status"], env);
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

  const inputImages = await Promise.all(args.inputImages.filter((image) => image.url.trim()).map((image) => ensureHiggsfieldMediaInput(image, env)));
  const aspectRatio = args.aspectRatio || "16:9";
  const resolution = args.resolution || "2k";
  const createArgs = [
    "generate", "create", "nano_banana_2",
    "--prompt", prompt,
    "--aspect-ratio", aspectRatio,
    "--resolution", resolution,
  ];
  for (const image of inputImages) createArgs.push("--image-references", image.id);
  const created = await runHiggsfieldJsonCli(createArgs, env);
  const jobId = readJobId(created);
  if (!jobId) throw new Error(`Higgsfield job create returned no job id: ${JSON.stringify(created).slice(0, 500)}`);

  const timeoutMs = args.timeoutMs ?? 15 * 60_000;
  const intervalMs = args.pollIntervalMs ?? 5_000;
  const job = await runHiggsfieldJsonCli([
    "generate", "wait", jobId,
    "--timeout", `${Math.max(1, Math.ceil(timeoutMs / 1_000))}s`,
    "--interval", `${Math.max(1, Math.ceil(intervalMs / 1_000))}s`,
    "--quiet",
  ], env) as HiggsfieldJob;
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

async function fetchResultAsFile(url: string, filename: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download Higgsfield result (${response.status})`);
  const blob = await response.blob();
  return new File([blob], filename, { type: response.headers.get("Content-Type") || blob.type || "image/png" });
}

function runHiggsfieldJsonCli(args: string[], env: Record<string, string | undefined>) {
  return runHiggsfieldCli(["--json", ...args], env).then((stdout) => JSON.parse(stdout) as unknown);
}

function runHiggsfieldCli(args: string[], env: Record<string, string | undefined>): Promise<string> {
  const childEnv = { ...process.env, ...env };
  const credentialsPath = env.HIGGSFIELD_CREDENTIALS_PATH?.trim();
  if (credentialsPath) childEnv.HIGGSFIELD_CREDENTIALS_PATH = credentialsPath;
  else if (env.HIGGSFIELD_CREDENTIALS_JSON?.trim()) {
    // The CLI only reads credentials from a file; deployments receive the JSON
    // as an env var, so materialize it per-spawn and never bake it into images.
    const tmpCredentials = path.join(os.tmpdir(), `higgsfield-credentials-${process.pid}.json`);
    writeFileSync(tmpCredentials, env.HIGGSFIELD_CREDENTIALS_JSON.trim());
    childEnv.HIGGSFIELD_CREDENTIALS_PATH = tmpCredentials;
  } else delete childEnv.HIGGSFIELD_CREDENTIALS_PATH;
  return new Promise((resolve, reject) => {
    const child = spawn(resolveHiggsfieldExecutable(childEnv), args, {
      env: childEnv,
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

function resolveHiggsfieldExecutable(env: NodeJS.ProcessEnv) {
  const configured = env.HIGGSFIELD_CLI_PATH?.trim();
  if (configured) return configured;
  const bundled = path.join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "higgsfield.cmd" : "higgsfield");
  if (existsSync(bundled)) return bundled;
  return process.platform === "win32" ? "higgsfield.exe" : "higgsfield";
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
