export type LocalGenerationProvider = "comfyui" | "swarmui";
export type LocalGenerationKind = "image" | "video";

export interface LocalGenerationStatus {
  provider: LocalGenerationProvider;
  baseUrl: string;
  configured: boolean;
  reachable: boolean;
  message: string;
  details?: unknown;
}

export interface LocalGenerationAssetRef {
  provider: LocalGenerationProvider;
  kind: LocalGenerationKind;
  filename?: string;
  subfolder?: string;
  type?: string;
  path?: string;
  url: string;
  mimeType?: string;
  metadata?: unknown;
}

export interface LocalGenerationJob {
  provider: LocalGenerationProvider;
  promptId?: string;
  sessionId?: string;
  queued: boolean;
  completed: boolean;
  status: "queued" | "completed" | "error";
  message: string;
  assets: LocalGenerationAssetRef[];
  nodeErrors?: unknown;
}

export type SwarmParamValue = string | number | boolean | Array<string | number | boolean>;

export interface LocalGenerationRequest {
  provider: LocalGenerationProvider;
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  steps?: number;
  seed?: number;
  cfg?: number;
  model?: string;
  action?: string;
  kind?: LocalGenerationKind;
  batchSize?: number;
  swarmParams?: Record<string, SwarmParamValue>;
  workflow?: ComfyWorkflow;
  waitForCompletion?: boolean;
}

export interface ComfyPromptResponse {
  prompt_id?: string;
  number?: number;
  node_errors?: unknown;
  error?: string;
}

export type ComfyWorkflow = Record<string, ComfyWorkflowNode | unknown>;

export interface ComfyWorkflowNode {
  class_type?: string;
  inputs?: Record<string, unknown>;
}

export interface ComfyOutputRef {
  filename: string;
  subfolder?: string;
  type?: string;
  kind: LocalGenerationKind;
}

export interface SwarmImageResult {
  image?: string;
  metadata?: unknown;
  batch_index?: string | number;
}

export interface SwarmModelCatalogEntry {
  name?: string;
  title?: string;
  class?: string;
  compat_class?: string;
  architecture?: string;
  special_format?: string;
  local?: boolean;
}

const DEFAULT_SWARMUI_URL = "http://127.0.0.1:7861";
const DEFAULT_SWARM_WIDTH = 1280;
const DEFAULT_SWARM_HEIGHT = 720;

export function getDefaultLocalGenerationUrl() {
  return DEFAULT_SWARMUI_URL;
}

export function normalizeLocalGenerationUrl(value: string | undefined) {
  const base = value?.trim() || getDefaultLocalGenerationUrl();
  return base.replace(/\/+$/, "");
}

export async function checkComfyUiStatus(params: {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<LocalGenerationStatus> {
  const fetcher = params.fetchImpl ?? fetch;
  const baseUrl = normalizeLocalGenerationUrl(params.baseUrl);
  try {
    const response = await fetchWithTimeout(fetcher, buildSwarmComfyDirectUrl(baseUrl, "system_stats"), { method: "GET" }, params.timeoutMs ?? 1500);
    if (!response.ok) {
      return { provider: "comfyui", baseUrl, configured: true, reachable: false, message: `ComfyUI-through-Swarm returned HTTP ${response.status}.` };
    }
    const details = await safeJson(response);
    return { provider: "comfyui", baseUrl, configured: true, reachable: true, message: "ComfyUI is reachable through SwarmUI /ComfyBackendDirect.", details };
  } catch (error) {
    return { provider: "comfyui", baseUrl, configured: true, reachable: false, message: errorToMessage(error, "ComfyUI-through-Swarm is not reachable.") };
  }
}

export async function checkSwarmUiStatus(params: {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<LocalGenerationStatus> {
  const fetcher = params.fetchImpl ?? fetch;
  const baseUrl = normalizeLocalGenerationUrl(params.baseUrl);
  try {
    const response = await fetchWithTimeout(fetcher, `${baseUrl}/API/GetNewSession`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }, params.timeoutMs ?? 1500);
    if (!response.ok) {
      return { provider: "swarmui", baseUrl, configured: true, reachable: false, message: `SwarmUI returned HTTP ${response.status}.` };
    }
    const details = await safeJson(response) as { session_id?: string; version?: string; error?: string } | null;
    if (details?.error) {
      return { provider: "swarmui", baseUrl, configured: true, reachable: false, message: details.error, details };
    }
    return { provider: "swarmui", baseUrl, configured: true, reachable: Boolean(details?.session_id), message: details?.session_id ? "SwarmUI is reachable." : "SwarmUI responded without a session id.", details };
  } catch (error) {
    return { provider: "swarmui", baseUrl, configured: true, reachable: false, message: errorToMessage(error, "SwarmUI is not reachable.") };
  }
}

export function patchComfyWorkflow(workflow: ComfyWorkflow, request: LocalGenerationRequest, options: {
  positiveNodeIds?: string[];
  negativeNodeIds?: string[];
  filenamePrefix?: string;
} = {}): ComfyWorkflow {
  const patched = deepClone(workflow);
  const nodes = Object.entries(patched).filter((entry): entry is [string, ComfyWorkflowNode] => isComfyWorkflowNode(entry[1]));
  const textNodes = nodes.filter(([, node]) => node.class_type === "CLIPTextEncode" && typeof node.inputs?.text === "string");
  const positiveNodeIds = options.positiveNodeIds?.length ? options.positiveNodeIds : textNodes[0] ? [textNodes[0][0]] : [];
  const negativeNodeIds = options.negativeNodeIds?.length ? options.negativeNodeIds : textNodes[1] ? [textNodes[1][0]] : [];

  patchNodeInputs(patched, positiveNodeIds, { text: request.prompt });
  if (request.negativePrompt !== undefined) {
    patchNodeInputs(patched, negativeNodeIds, { text: request.negativePrompt });
  }

  for (const [, node] of nodes) {
    if (!node.inputs) continue;
    if (node.class_type === "EmptyLatentImage") {
      if (request.width) node.inputs.width = clampDimension(request.width);
      if (request.height) node.inputs.height = clampDimension(request.height);
      if (request.batchSize) node.inputs.batch_size = clampInt(request.batchSize, 1, 16);
    }
    if (node.class_type === "KSampler") {
      if (typeof request.seed === "number") node.inputs.seed = Math.trunc(request.seed);
      if (request.steps) node.inputs.steps = clampInt(request.steps, 1, 150);
      if (request.cfg) node.inputs.cfg = clampNumber(request.cfg, 0, 30);
    }
    if (node.class_type === "SaveImage") {
      node.inputs.filename_prefix = options.filenamePrefix ?? buildGenerationFilenamePrefix(request);
    }
  }

  return patched;
}

export async function queueComfyPrompt(params: {
  baseUrl: string;
  workflow: ComfyWorkflow;
  clientId: string;
  fetchImpl?: typeof fetch;
}): Promise<ComfyPromptResponse> {
  const fetcher = params.fetchImpl ?? fetch;
  const response = await fetcher(buildSwarmComfyDirectUrl(params.baseUrl, "prompt"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: params.workflow, client_id: params.clientId }),
  });
  const payload = await safeJson(response) as ComfyPromptResponse | null;
  if (!response.ok) {
    return { error: payload?.error ?? `ComfyUI prompt request failed with HTTP ${response.status}.` };
  }
  return payload ?? { error: "ComfyUI returned an empty prompt response." };
}

export async function fetchComfyHistory(params: {
  baseUrl: string;
  promptId: string;
  fetchImpl?: typeof fetch;
}) {
  const fetcher = params.fetchImpl ?? fetch;
  const response = await fetcher(buildSwarmComfyDirectUrl(params.baseUrl, `history/${encodeURIComponent(params.promptId)}`));
  if (!response.ok) return null;
  return safeJson(response);
}

export function extractComfyOutputRefs(history: unknown, promptId?: string): ComfyOutputRef[] {
  const entry = getComfyHistoryEntry(history, promptId);
  const outputs = isRecord(entry?.outputs) ? entry.outputs : {};
  const refs: ComfyOutputRef[] = [];

  for (const output of Object.values(outputs)) {
    if (!isRecord(output)) continue;
    refs.push(...extractOutputArray(output.images, "image"));
    refs.push(...extractOutputArray(output.gifs, "video"));
    refs.push(...extractOutputArray(output.videos, "video"));
    refs.push(...extractOutputArray(output.video, "video"));
  }

  return refs;
}

export function getComfyHistoryStatus(history: unknown, promptId?: string): "queued" | "completed" | "error" {
  const entry = getComfyHistoryEntry(history, promptId);
  const status = isRecord(entry?.status) ? entry.status : null;
  if (status?.status_str === "error") return "error";
  if (status?.completed === true) return "completed";
  return "queued";
}

export async function createSwarmImage(params: {
  baseUrl: string;
  request: LocalGenerationRequest;
  fetchImpl?: typeof fetch;
}): Promise<LocalGenerationJob> {
  const fetcher = params.fetchImpl ?? fetch;
  const baseUrl = normalizeLocalGenerationUrl(params.baseUrl);
  const sessionResponse = await fetcher(`${baseUrl}/API/GetNewSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const session = await safeJson(sessionResponse) as { session_id?: string; error?: string } | null;
  if (!sessionResponse.ok || !session?.session_id) {
    return {
      provider: "swarmui",
      sessionId: session?.session_id,
      queued: false,
      completed: false,
      status: "error",
      message: session?.error ?? `Could not create SwarmUI session: HTTP ${sessionResponse.status}.`,
      assets: [],
    };
  }

  const model = await resolveSwarmModel({
    baseUrl,
    sessionId: session.session_id,
    requestedModel: params.request.model,
    fetchImpl: fetcher,
  });

  const generateResponse = await fetcher(`${baseUrl}/API/GenerateText2Image`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildSwarmTextToImagePayload({ ...params.request, model }, session.session_id)),
  });
  const payload = await safeJson(generateResponse) as { images?: Array<string | SwarmImageResult>; error?: string; error_id?: string } | null;
  if (!generateResponse.ok || payload?.error) {
    return {
      provider: "swarmui",
      sessionId: session.session_id,
      queued: false,
      completed: false,
      status: "error",
      message: payload?.error ?? `SwarmUI generation failed with HTTP ${generateResponse.status}.`,
      assets: [],
    };
  }

  return {
    provider: "swarmui",
    sessionId: session.session_id,
    queued: true,
    completed: true,
    status: "completed",
    message: "SwarmUI returned generated image assets.",
    assets: normalizeSwarmAssets(payload?.images ?? []),
  };
}

export async function resolveSwarmModel(params: {
  baseUrl: string;
  sessionId: string;
  requestedModel?: string;
  fetchImpl?: typeof fetch;
}) {
  const requestedModel = params.requestedModel?.trim();
  if (requestedModel) return requestedModel;

  const configuredModel = process.env.LOCAL_SWARMUI_MODEL?.trim() || process.env.SWARMUI_MODEL?.trim();
  if (configuredModel) return configuredModel;

  const fetcher = params.fetchImpl ?? fetch;
  const response = await fetcher(`${normalizeLocalGenerationUrl(params.baseUrl)}/API/ListModels`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: params.sessionId,
      path: "",
      depth: 2,
      subtype: "Stable-Diffusion",
      sortBy: "Name",
      allowRemote: false,
      sortReverse: false,
      dataImages: false,
    }),
  });
  const payload = await safeJson(response) as { files?: SwarmModelCatalogEntry[]; error?: string } | null;
  if (!response.ok || payload?.error) {
    throw new Error(`SwarmUI model catalog failed (${response.status}): ${payload?.error ?? response.statusText}`);
  }

  const model = chooseSwarmModel(payload?.files ?? []);
  if (!model) {
    throw new Error("SwarmUI did not report a usable local image model. Set SWARMUI_MODEL to an installed model name.");
  }
  return model;
}

export function chooseSwarmModel(entries: SwarmModelCatalogEntry[]) {
  const usable = entries
    .map((entry) => ({ ...entry, name: entry.name?.trim() }))
    .filter((entry): entry is SwarmModelCatalogEntry & { name: string } => Boolean(entry.name))
    .filter((entry) => entry.local !== false)
    .filter((entry) => !/(video|lora|controlnet|vae|text.?encoder|clip|embedding|upscal|inpaint)/i.test(`${entry.name} ${entry.class ?? ""} ${entry.compat_class ?? ""}`))
    .filter((entry) => !/(fp16|bf16|fp32|f16)/i.test(entry.name))
    .filter((entry) => Boolean(entry.class || entry.compat_class || entry.architecture));

  const preferred = usable.find((entry) => /z[-_ ]?image.*turbo/i.test(entry.name))
    ?? usable.find((entry) => /qwen.*image.*(fp8|q8|gguf)/i.test(entry.name))
    ?? usable.find((entry) => /flux.*(fp8|q8)/i.test(entry.name))
    ?? usable.find((entry) => /krea.*turbo/i.test(entry.name));
  return (preferred ?? usable[0])?.name;
}

export function buildSwarmTextToImagePayload(request: LocalGenerationRequest, sessionId: string) {
  return {
    session_id: sessionId,
    images: clampInt(request.batchSize ?? 1, 1, 8),
    prompt: request.prompt,
    negativeprompt: request.negativePrompt ?? "",
    width: clampDimension(request.width ?? DEFAULT_SWARM_WIDTH),
    height: clampDimension(request.height ?? DEFAULT_SWARM_HEIGHT),
    steps: clampInt(request.steps ?? 24, 1, 150),
    cfgscale: clampNumber(request.cfg ?? 6, 0, 30),
    seed: typeof request.seed === "number" ? Math.trunc(request.seed) : -1,
    ...(request.model ? { model: request.model } : {}),
    ...pickSwarmParams(request.swarmParams),
    extra_metadata: JSON.stringify({ source: "project-stack-structure", action: request.action ?? "generate" }),
  };
}

export function buildSwarmComfyDirectUrl(swarmBaseUrl: string, routePath: string) {
  return `${normalizeLocalGenerationUrl(swarmBaseUrl)}/ComfyBackendDirect/${routePath.replace(/^\/+/, "")}`;
}

export function buildComfyAssetUrl(ref: ComfyOutputRef) {
  const search = new URLSearchParams({ provider: "comfyui", filename: ref.filename, type: ref.type ?? "output" });
  if (ref.subfolder) search.set("subfolder", ref.subfolder);
  return `/api/generate/local/view?${search.toString()}`;
}

export function normalizeSwarmAssets(images: Array<string | SwarmImageResult>): LocalGenerationAssetRef[] {
  return images.map((item) => {
    const path = typeof item === "string" ? item : item.image ?? "";
    const metadata = typeof item === "string" ? undefined : item.metadata;
    return {
      provider: "swarmui" as const,
      kind: inferKindFromPath(path),
      path,
      url: path.startsWith("data:") ? path : `/api/generate/local/view?provider=swarmui&path=${encodeURIComponent(path)}`,
      metadata,
    };
  }).filter((asset) => Boolean(asset.path));
}

const ALLOWED_SWARM_PARAM_KEYS = new Set([
  "sampler",
  "scheduler",
  "preferreddtype",
  "sigmashift",
  "refinerupscale",
  "refinersteps",
  "loras",
  "loraweights",
]);

function pickSwarmParams(params: LocalGenerationRequest["swarmParams"]) {
  if (!params) return {};
  const picked: Record<string, SwarmParamValue> = {};
  for (const [key, value] of Object.entries(params)) {
    if (!ALLOWED_SWARM_PARAM_KEYS.has(key)) continue;
    if (isSwarmParamValue(value)) picked[key] = value;
  }
  return picked;
}

function isSwarmParamValue(value: unknown): value is SwarmParamValue {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return true;
  return Array.isArray(value) && value.every((entry) => typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean");
}

function patchNodeInputs(workflow: ComfyWorkflow, nodeIds: string[], values: Record<string, unknown>) {
  for (const nodeId of nodeIds) {
    const node = workflow[nodeId];
    if (!isComfyWorkflowNode(node)) continue;
    node.inputs = { ...(node.inputs ?? {}), ...values };
  }
}

function getComfyHistoryEntry(history: unknown, promptId?: string) {
  if (!isRecord(history)) return null;
  if (promptId && isRecord(history[promptId])) return history[promptId] as Record<string, unknown>;
  if (isRecord(history.outputs) || isRecord(history.status)) return history;
  const first = Object.values(history).find(isRecord);
  return first ?? null;
}

function extractOutputArray(value: unknown, kind: LocalGenerationKind): ComfyOutputRef[] {
  const values = Array.isArray(value) ? value : isRecord(value) ? [value] : [];
  return values.map((entry): ComfyOutputRef | null => {
    if (!isRecord(entry) || typeof entry.filename !== "string") return null;
    return {
      filename: entry.filename,
      subfolder: typeof entry.subfolder === "string" ? entry.subfolder : undefined,
      type: typeof entry.type === "string" ? entry.type : "output",
      kind,
    };
  }).filter((entry): entry is ComfyOutputRef => entry !== null);
}

function buildGenerationFilenamePrefix(request: LocalGenerationRequest) {
  const action = request.action ?? request.kind ?? "generation";
  return `stack-${action}`.replace(/[^a-z0-9_-]+/gi, "-").replace(/-+/g, "-").slice(0, 80);
}

function inferKindFromPath(path: string): LocalGenerationKind {
  return /\.(mp4|mov|webm|mkv|gif)$/i.test(path) ? "video" : "image";
}

function isComfyWorkflowNode(value: unknown): value is ComfyWorkflowNode {
  return isRecord(value) && (typeof value.class_type === "string" || isRecord(value.inputs));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function clampDimension(value: number) {
  return Math.round(clampNumber(value, 64, 4096) / 8) * 8;
}

function clampInt(value: number, min: number, max: number) {
  return Math.trunc(clampNumber(value, min, max));
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

async function fetchWithTimeout(fetcher: typeof fetch, url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function safeJson(response: Response) {
  try {
    return await response.json() as unknown;
  } catch {
    return null;
  }
}

function errorToMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return `${fallback} ${error.message}`;
  return fallback;
}
