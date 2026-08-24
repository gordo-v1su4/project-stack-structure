import { downloadHttpBytes, type HttpDownload } from "@/lib/httpDownload";
import { getMediaGatewayConfig, normalizeMediaPath, uploadFileToMediaGateway, type MediaGatewayUploadResult } from "@/lib/mediaGateway";

export type ImageSplitMode = "fixed" | "auto";

export type ImageSplitPanel = {
  index: number;
  row: number;
  col: number;
  label: string;
  assetPath: string;
  url: string;
  storage?: MediaGatewayUploadResult;
};

export type ImageSplitManifest = {
  splitId: string;
  sourceFilename: string;
  width: number;
  height: number;
  mode: ImageSplitMode;
  rows: number;
  cols: number;
  gutterPx: number;
  panels: ImageSplitPanel[];
};

export type ImageSplitResponse = {
  manifest: ImageSplitManifest;
  raw: unknown;
};

export type ImageSplitRequestOptions = {
  mode?: ImageSplitMode;
  rows?: number;
  cols?: number;
  gutterPx?: number;
  sensitivity?: number;
};

export type ImageSplitPersistedResponse = ImageSplitResponse & {
  rustfsUploaded: boolean;
};

const DEFAULT_SPLITTER_URL = "https://splitter.serving.cloud";
const ACCESS_COOKIE_NAME = "splitter_access";

export function getImageSplitterBaseUrl(env: Record<string, string | undefined> = process.env) {
  return normalizeImageSplitterBaseUrl(env.IMAGE_SPLITTER_URL || env.SPLITTER_API_URL || DEFAULT_SPLITTER_URL);
}

export function getImageSplitterAccessCode(env: Record<string, string | undefined> = process.env) {
  return env.IMAGE_SPLITTER_ACCESS_CODE?.trim() || undefined;
}

type SplitterSession = { key: string; cookie: string };
let splitterSession: SplitterSession | null = null;
let splitterUnlockInFlight: Promise<SplitterSession> | null = null;

async function unlockSplitterSession(baseUrl: string, code: string): Promise<SplitterSession> {
  const response = await fetch(`${baseUrl}/api/access-gate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin: code }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Image splitter access gate rejected the code (${response.status}): ${text.slice(0, 200)}`);
  }
  const cookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const raw = cookies.find((cookie) => cookie.startsWith(`${ACCESS_COOKIE_NAME}=`));
  if (!raw) throw new Error("Image splitter access gate did not return a session cookie.");
  const cookie = raw.split(";")[0]!.trim();
  return { key: `${baseUrl}:${code}`, cookie };
}

async function getSplitterSession(baseUrl: string, code: string, forceRefresh = false): Promise<SplitterSession> {
  if (!forceRefresh && splitterSession?.key === `${baseUrl}:${code}`) return splitterSession;
  if (!splitterUnlockInFlight) {
    splitterUnlockInFlight = unlockSplitterSession(baseUrl, code)
      .then((session) => {
        splitterSession = session;
        return session;
      })
      .finally(() => {
        splitterUnlockInFlight = null;
      });
  }
  return splitterUnlockInFlight;
}

/**
 * Server-to-server callers must present the access-gate cookie minted from
 * IMAGE_SPLITTER_ACCESS_CODE, and re-mint once when it expires mid-flight —
 * without this the deployment answers every call with 401 access_locked.
 */
async function fetchSplitterWithAuth(
  url: string,
  init: RequestInit,
  env: Record<string, string | undefined>,
): Promise<Response> {
  const code = getImageSplitterAccessCode(env);
  if (!code) return fetch(url, init);

  const baseUrl = getImageSplitterBaseUrl(env);
  let session = await getSplitterSession(baseUrl, code);
  const headers = new Headers(init.headers);
  headers.set("Cookie", session.cookie);
  const response = await fetch(url, { ...init, headers });
  if (response.status !== 401) return response;

  await response.body?.cancel().catch(() => {});
  session = await getSplitterSession(baseUrl, code, true);
  headers.set("Cookie", session.cookie);
  return fetch(url, { ...init, headers });
}

export function normalizeImageSplitterBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "") || DEFAULT_SPLITTER_URL;
}

export function buildImageSplitterPanelProxyUrl(splitId: string, assetPath: string) {
  const search = new URLSearchParams({ splitId, assetPath });
  return `/api/splitter/image/panel?${search.toString()}`;
}

export function buildImageSplitterPanelSourceUrl(baseUrl: string, splitId: string, assetPath: string) {
  const safePath = assetPath.split("/").map(encodeURIComponent).join("/");
  return `${normalizeImageSplitterBaseUrl(baseUrl)}/api/image-split/${encodeURIComponent(splitId)}/panels/${safePath}`;
}

export async function buildSplitterRequestHeaders(
  env: Record<string, string | undefined> = process.env,
): Promise<Record<string, string>> {
  const code = getImageSplitterAccessCode(env);
  if (!code) return {};
  const session = await getSplitterSession(getImageSplitterBaseUrl(env), code);
  return { Cookie: session.cookie };
}

async function downloadSplitterBytesWithAuth(url: string, env: Record<string, string | undefined>): Promise<HttpDownload> {
  const code = getImageSplitterAccessCode(env);
  if (!code) return downloadHttpBytes(url);
  const session = await getSplitterSession(getImageSplitterBaseUrl(env), code);
  try {
    return await downloadHttpBytes(url, 60_000, { Cookie: session.cookie });
  } catch (error) {
    const expired = error instanceof Error && error.message.includes("(401)");
    if (!expired) throw error;
    const fresh = await getSplitterSession(getImageSplitterBaseUrl(env), code, true);
    return downloadHttpBytes(url, 60_000, { Cookie: fresh.cookie });
  }
}

export function normalizeImageSplitResponse(payload: unknown): ImageSplitResponse {
  const root = asRecord(payload);
  const manifest = asRecord(root?.manifest) ?? root;
  if (!manifest) throw new Error("Image splitter returned an empty manifest.");

  const splitId = readString(manifest.split_id) || readString(manifest.splitId);
  if (!splitId) throw new Error("Image splitter manifest is missing split_id.");

  const panels = Array.isArray(manifest.panels) ? manifest.panels : [];
  const cols = readNumber(manifest.cols, 0);
  return {
    raw: payload,
    manifest: {
      splitId,
      sourceFilename: readString(manifest.source_filename) || readString(manifest.sourceFilename) || "source-image",
      width: readNumber(manifest.width, 0),
      height: readNumber(manifest.height, 0),
      mode: readString(manifest.mode) === "auto" ? "auto" : "fixed",
      rows: readNumber(manifest.rows, 0),
      cols,
      gutterPx: readNumber(manifest.gutter_px, readNumber(manifest.gutterPx, 0)),
      panels: panels.map((panel, index): ImageSplitPanel | null => {
        const record = asRecord(panel);
        if (!record) return null;
        const assetPath = readString(record.asset_path) || readString(record.assetPath);
        if (!assetPath) return null;
        const normalizedIndex = Math.max(1, Math.trunc(readNumber(record.index, index + 1)));
        const row = cols > 0 ? Math.floor((normalizedIndex - 1) / cols) + 1 : 1;
        const col = cols > 0 ? ((normalizedIndex - 1) % cols) + 1 : normalizedIndex;
        return {
          index: normalizedIndex,
          row,
          col,
          label: `R${row}C${col} · Panel ${String(normalizedIndex).padStart(2, "0")}`,
          assetPath,
          url: buildImageSplitterPanelProxyUrl(splitId, assetPath),
        };
      }).filter((panel): panel is ImageSplitPanel => Boolean(panel)),
    },
  };
}

export function appendImageSplitOptions(formData: FormData, options: ImageSplitRequestOptions) {
  const mode = options.mode === "auto" ? "auto" : "fixed";
  if (mode === "fixed") {
    formData.set("rows", String(clampInt(options.rows ?? 3, 1, 24)));
    formData.set("cols", String(clampInt(options.cols ?? 3, 1, 24)));
  } else {
    formData.set("sensitivity", String(clampNumber(options.sensitivity ?? 0.55, 0, 1)));
  }
  formData.set("gutter_px", String(clampInt(options.gutterPx ?? 0, 0, 96)));
  return mode;
}

export async function splitImageWithGateway(args: {
  file: File;
  options?: ImageSplitRequestOptions;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}) {
  const baseUrl = getImageSplitterBaseUrl(args.env);
  const formData = new FormData();
  formData.set("file", args.file, args.file.name || "source-image.png");
  const mode = appendImageSplitOptions(formData, args.options ?? {});
  const endpoint = mode === "auto" ? "auto" : "fixed-grid";
  const url = `${baseUrl}/api/image-split/${endpoint}`;
  const init: RequestInit = { method: "POST", body: formData };
  const response = args.fetchImpl
    ? await args.fetchImpl(url, init)
    : await fetchSplitterWithAuth(url, init, args.env ?? process.env);
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(`Image splitter failed (${response.status}): ${JSON.stringify(payload).slice(0, 300)}`);
  }
  return normalizeImageSplitResponse(payload);
}


export async function uploadImageSplitPanelsToMediaGateway(args: {
  split: ImageSplitResponse;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  uploadFileImpl?: typeof uploadFileToMediaGateway;
}): Promise<ImageSplitPersistedResponse> {
  const env = args.env ?? process.env;
  const config = getMediaGatewayConfig(env);
  if (!config) {
    throw new Error("Missing RustFS media gateway env. Required: MEDIA_GATEWAY_URL/RUSTFS_MEDIA_API_URL and MEDIA_GATEWAY_TOKEN/MEDIA_API_TOKEN");
  }

  const baseUrl = getImageSplitterBaseUrl(env);
  const uploadFile = args.uploadFileImpl ?? uploadFileToMediaGateway;
  const sourceSlug = buildSourceSlug(args.split.manifest.sourceFilename);
  const folder = normalizeMediaPath(`${config.uploadPrefix}/image-splits/${sourceSlug}/${args.split.manifest.splitId}`);
  // Keep panel persistence sequential. Bun 1.3.14 on Windows crashes after
  // repeated panel fetches in this path, and serial writes also avoid bursting
  // the RustFS media gateway from a single Trigger queue slot.
  const panels: ImageSplitPanel[] = [];
  for (const panel of args.split.manifest.panels) {
    const sourceUrl = buildImageSplitterPanelSourceUrl(baseUrl, args.split.manifest.splitId, panel.assetPath);
    const filename = buildPanelFilename(panel, args.split.manifest);
    let file: File;
    if (args.fetchImpl) {
      const response = await args.fetchImpl(sourceUrl);
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`Image splitter panel fetch failed (${response.status}): ${text.slice(0, 300)}`);
      }
      const blob = await response.blob();
      const rawContentType = response.headers.get("Content-Type") || blob.type || "image/png";
      const contentType = rawContentType.split(";")[0].trim();
      file = new File([blob], filename, { type: contentType });
    } else {
      const downloaded = await downloadSplitterBytesWithAuth(sourceUrl, env);
      file = new File([downloaded.bytes], filename, { type: downloaded.contentType });
    }

    const storage = await uploadFile({ file, folder, env, fetchImpl: args.fetchImpl });
    panels.push({ ...panel, storage });
  }

  return {
    ...args.split,
    rustfsUploaded: true,
    manifest: {
      ...args.split.manifest,
      panels,
    },
  };
}

function buildPanelFilename(panel: ImageSplitPanel, manifest: ImageSplitManifest) {
  const sourceSlug = buildSourceSlug(manifest.sourceFilename);
  return `${sourceSlug}__grid-${manifest.rows}x${manifest.cols}__r${panel.row}c${panel.col}__p${String(panel.index).padStart(2, "0")}.png`;
}

function buildSourceSlug(filename: string) {
  const stem = filename.split(/[\\/]/).pop()?.replace(/\.[a-z0-9]+$/i, "") || "source-image";
  return stem.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "source-image";
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clampInt(value: number, min: number, max: number) {
  return Math.trunc(clampNumber(value, min, max));
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
