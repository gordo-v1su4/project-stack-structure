import { createHash } from "node:crypto";
import { buildSwarmComfyDirectUrl } from "@/components/studio/localGeneration";
import { buildH3StillWorkflow, H3_STILL_PROFILE, h3StillDigest, type H3StillDescriptor, type H3StillReference, type H3StillWorkflow } from "./h3StillProfile";

const MAX_IMAGE = 32 * 1024 * 1024;
const sha = (v: Uint8Array) => createHash("sha256").update(v).digest("hex");
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v);
export interface H3StillTransport { baseUrl: string; fetchImpl?: typeof fetch; timeoutMs?: number; signal?: AbortSignal }
export interface PreparedH3StillProvider { jobId: string; descriptor: H3StillDescriptor; workflow: H3StillWorkflow; workflowSha256: string }
export interface H3StillSubmissionReceipt { jobId: string; descriptorSha256: string; workflowSha256: string; schemaSha256: string }
export class H3StillSubmissionError extends Error {
  constructor(public readonly disposition: "rejected" | "unknown") { super(disposition === "rejected" ? "SwarmUI rejected the H3 still submission." : "The H3 still submission outcome is unknown; reconcile it before any further submission."); }
}
function rejectedPrompt(result: Record<string, unknown>) {
  return !result.prompt_id && object(result.error) && typeof result.error.type === "string"
    && ["no_prompt", "prompt_no_outputs", "prompt_outputs_failed_validation", "node_missing_class_type", "invalid_prompt"].includes(result.error.type);
}
function transport(o: H3StillTransport) {
  const u = new URL(o.baseUrl);
  if (!/^https?:$/.test(u.protocol) || u.username || u.password || u.search || u.hash || (u.pathname !== "/" && u.pathname !== "")) throw new Error("Configure the SwarmUI origin explicitly.");
  const ms = o.timeoutMs ?? 90_000;
  if (!Number.isSafeInteger(ms) || ms < 1 || ms > 180_000) throw new Error("Invalid still transport deadline.");
  return { fetcher: o.fetchImpl ?? fetch, base: u.origin, signal: AbortSignal.any([AbortSignal.timeout(ms), ...(o.signal ? [o.signal] : [])]) };
}
async function bounded<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let cancel: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => { cancel = () => reject(new Error("The H3 still transport deadline expired.")); signal.addEventListener("abort", cancel, { once: true }); });
  try { return await Promise.race([promise, aborted]); } finally { if (cancel) signal.removeEventListener("abort", cancel); }
}
async function bytes(response: Response, max: number, signal: AbortSignal) {
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > max)) { void response.body?.cancel(); throw new Error("Still response exceeded its byte bound."); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Still response was empty.");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const next = await bounded(reader.read(), signal); if (next.done) break; size += next.value.byteLength;
      if (size > max) throw new Error("Still response exceeded its byte bound."); chunks.push(next.value); }
    if (!size || (length !== null && size !== Number(length))) throw new Error("Still response was incomplete.");
    return Buffer.concat(chunks, size);
  } finally { void reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
async function json(response: Response, max: number, signal: AbortSignal) {
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await bytes(response, max, signal)));
  if (!object(value)) throw new Error("Invalid still provider response."); return value;
}
async function request(t: ReturnType<typeof transport>, route: string, init?: RequestInit) {
  return bounded(t.fetcher(buildSwarmComfyDirectUrl(t.base, route), { ...init, cache: "no-store", redirect: "error", signal: t.signal }), t.signal);
}
function verified(prepared: PreparedH3StillProvider) {
  const hydrated = prepared.descriptor.body.references.map(r => ({ rawSha256: r.rawSha256, image: `stack-stills/${r.rawSha256}.png` }));
  const rebuilt = buildH3StillWorkflow(prepared.descriptor, hydrated);
  if (!/^h3-still-[a-f0-9]{64}$/.test(prepared.jobId)) throw new Error("Invalid still job correlation.");
  rebuilt.workflow.save.inputs.filename_prefix = `stack-stills/${rebuilt.descriptor.sha256}/${prepared.jobId}/master`;
  rebuilt.workflowSha256 = h3StillDigest(rebuilt.workflow);
  if (rebuilt.workflowSha256 !== prepared.workflowSha256 || h3StillDigest(prepared.workflow) !== rebuilt.workflowSha256) throw new Error("Still prepared workflow changed.");
  return { ...rebuilt, jobId: prepared.jobId };
}
/** Rebuild the exact frozen attempt for read-only recovery; performs no upload or provider call. */
export function rebuildH3StillProvider(descriptor: H3StillDescriptor, jobId: string): PreparedH3StillProvider {
  const built = buildH3StillWorkflow(descriptor, descriptor.body.references.map(r => ({ rawSha256: r.rawSha256, image: `stack-stills/${r.rawSha256}.png` })));
  if (!/^h3-still-[a-f0-9]{64}$/.test(jobId)) throw new Error("Invalid still job correlation.");
  built.workflow.save.inputs.filename_prefix = `stack-stills/${descriptor.sha256}/${jobId}/master`;
  built.workflowSha256 = h3StillDigest(built.workflow);
  return { ...built, jobId };
}
function imageMime(raw: Uint8Array) {
  if (raw.length >= 8 && Buffer.from(raw.subarray(0, 8)).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return "image/png";
  if (raw.length >= 3 && raw[0] === 255 && raw[1] === 216 && raw[2] === 255) return "image/jpeg";
  if (raw.length >= 12 && Buffer.from(raw.subarray(0, 4)).toString("ascii") === "RIFF" && Buffer.from(raw.subarray(8, 12)).toString("ascii") === "WEBP") return "image/webp";
  throw new Error("Still references must retain their PNG, JPEG or WebP bytes.");
}

/** Storage implementation must perform conditional owned reads. All raw bytes remain unchanged. */
export async function prepareH3StillProvider(descriptor: H3StillDescriptor, options: H3StillTransport & {
  jobId: string;
  readReference: (reference: H3StillReference, signal: AbortSignal) => Promise<{ bytes: Uint8Array; mime: string; etag: string; version: string }>;
}): Promise<PreparedH3StillProvider> {
  const prepared = rebuildH3StillProvider(descriptor, options.jobId);
  const t = transport(options); let total = 0;
  for (const ref of prepared.descriptor.body.references) {
    const raw = await bounded(options.readReference(ref, t.signal), t.signal);
    total += raw.bytes.byteLength;
    if (!raw.bytes.byteLength || raw.bytes.byteLength > MAX_IMAGE || total > 128 * 1024 * 1024 || raw.etag !== ref.etag || raw.version !== ref.version || sha(raw.bytes) !== ref.rawSha256 || imageMime(raw.bytes) !== raw.mime) throw new Error("The approved still reference bytes or version changed.");
    const form = new FormData(); form.set("subfolder", "stack-stills"); form.set("type", "input"); form.set("overwrite", "true");
    form.set("image", new File([new Uint8Array(raw.bytes)], `${ref.rawSha256}.png`, { type: raw.mime }));
    const response = await request(t, "upload/image", { method: "POST", body: form });
    if (!response.ok) { void response.body?.cancel(); throw new Error("Still reference upload failed."); }
    const result = await json(response, 16_384, t.signal);
    if (result.name !== `${ref.rawSha256}.png` || result.subfolder !== "stack-stills" || result.type !== "input") throw new Error("Still reference upload binding changed.");
  }
  return { ...prepared, jobId: options.jobId };
}

function choices(v: unknown): unknown[] {
  if (!Array.isArray(v)) return [];
  if (Array.isArray(v[0])) return v[0];
  return object(v[1]) && Array.isArray(v[1].options) ? v[1].options : [];
}
/** Recheck actual classes, selectors and dynamic input schema immediately before submission. */
async function checkSchema(prepared: PreparedH3StillProvider, t: ReturnType<typeof transport>) {
  const classes = [...new Set(Object.values(prepared.workflow).map(n => n.class_type))].sort();
  const schema: Record<string, Record<string, unknown>> = {};
  for (const cls of classes) {
    const response = await request(t, `object_info/${encodeURIComponent(cls)}`);
    if (!response.ok) { void response.body?.cancel(); throw new Error("A required still node is unavailable."); }
    const result = await json(response, 512 * 1024, t.signal);
    if (!object(result[cls]) || !object(result[cls].input)) throw new Error("A required still node schema is unavailable.");
    schema[cls] = result[cls].input;
  }
  const fields = (cls: string) => ({ ...(object(schema[cls].required) ? schema[cls].required : {}), ...(object(schema[cls].optional) ? schema[cls].optional : {}) });
  for (const [cls, key, name] of [["UNETLoader", "unet_name", H3_STILL_PROFILE.checkpoint], ["CLIPLoader", "clip_name", H3_STILL_PROFILE.clip],
    ["VAELoader", "vae_name", H3_STILL_PROFILE.vae], ["MinimaxH3LatentUpscaler3D", "model_name", H3_STILL_PROFILE.upscaler]]) {
    if (!choices(fields(cls)[key]).includes(name)) throw new Error("A pinned still model is unavailable.");
  }
  const refs = fields("MiniMaxH3ReferenceToVideo").ref_images;
  const template = Array.isArray(refs) && refs[0] === "COMFY_AUTOGROW_V3" && object(refs[1]) ? refs[1].template : undefined;
  if (!object(template) || template.prefix !== "ref_image_" || template.min !== 0 || typeof template.max !== "number" || template.max < prepared.descriptor.body.references.length
    || !object(template.input) || !object(template.input.required) || !Array.isArray(template.input.required.ref_image) || template.input.required.ref_image[0] !== "IMAGE") throw new Error("Still reference capacity changed.");
  const modes = fields("MinimaxH3LatentUpscaler3D").mode;
  const mode = choices(modes).find(v => object(v) && v.key === "scale by multiplier");
  if (!Array.isArray(modes) || modes[0] !== "COMFY_DYNAMICCOMBO_V3" || !object(mode) || !object(mode.inputs) || !object(mode.inputs.required)) throw new Error("Still upscale mode changed.");
  const scale = mode.inputs.required.scale;
  if (!Array.isArray(scale) || scale[0] !== "FLOAT" || !object(scale[1]) || typeof scale[1].min !== "number" || typeof scale[1].max !== "number" || scale[1].min > 2 || scale[1].max < 2) throw new Error("Still upscale multiplier changed.");
  for (const node of Object.values(prepared.workflow)) for (const key of Object.keys(node.inputs)) {
    if (key.startsWith("ref_images.ref_image_") && node.class_type === "MiniMaxH3ReferenceToVideo" || key === "mode.scale" && node.class_type === "MinimaxH3LatentUpscaler3D") continue;
    if (!(key in fields(node.class_type))) throw new Error("A required still node input changed.");
  }
  return h3StillDigest(schema);
}

export async function submitH3StillOnce(prepared: PreparedH3StillProvider, jobId: string, options: H3StillTransport & {
  beforeSubmit: (receipt: H3StillSubmissionReceipt) => Promise<void>;
}) {
  if (jobId !== prepared.jobId) throw new Error("Invalid still job correlation.");
  const pinned = verified(prepared), t = transport(options);
  const schemaSha256 = await checkSchema(pinned, t);
  const receipt = { jobId, descriptorSha256: pinned.descriptor.sha256, workflowSha256: pinned.workflowSha256, schemaSha256 };
  await bounded(options.beforeSubmit(receipt), t.signal);
  // Caller durably records submitting before this one POST. Never retry on timeout or response loss.
  try {
    const response = await request(t, "prompt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      prompt: pinned.workflow, client_id: `still-${jobId}`, extra_data: correlation(receipt),
    }) });
    if (!response.ok) {
      const result = await json(response, 128 * 1024, t.signal).catch(() => null);
      throw new H3StillSubmissionError(response.status === 400 && result && rejectedPrompt(result) ? "rejected" : "unknown");
    }
    const result = await json(response, 128 * 1024, t.signal);
    if (result.error) throw new H3StillSubmissionError(rejectedPrompt(result) ? "rejected" : "unknown");
    if (!id(result.prompt_id)) throw new H3StillSubmissionError("unknown");
    return { ...receipt, promptId: result.prompt_id };
  } catch (error) { if (error instanceof H3StillSubmissionError) throw error; throw new H3StillSubmissionError("unknown"); }
}
function correlation(r: Pick<H3StillSubmissionReceipt, "jobId" | "descriptorSha256" | "workflowSha256">) {
  return { stack_h3_still_job_id: r.jobId, descriptor_sha256: r.descriptorSha256, workflow_sha256: r.workflowSha256 };
}
function matchesPrompt(prompt: unknown, prepared: PreparedH3StillProvider, jobId: string) {
  if (!Array.isArray(prompt) || !object(prompt[2]) || h3StillDigest(prompt[2]) !== prepared.workflowSha256 || !object(prompt[3])) return false;
  const expected = correlation({ jobId, descriptorSha256: prepared.descriptor.sha256, workflowSha256: prepared.workflowSha256 });
  return Object.entries(expected).every(([key, value]) => (prompt[3] as Record<string, unknown>)[key] === value);
}
export function findH3StillPrompt(prepared: PreparedH3StillProvider, jobId: string, queue: Record<string, unknown>, history: Record<string, unknown>): string | undefined {
  verified(prepared); if (jobId !== prepared.jobId) throw new Error("Invalid still job correlation.");
  const matches = new Set<string>();
  for (const entry of [...(Array.isArray(queue.queue_running) ? queue.queue_running : []), ...(Array.isArray(queue.queue_pending) ? queue.queue_pending : [])]) {
    if (Array.isArray(entry) && id(entry[1]) && matchesPrompt(entry, prepared, jobId)) matches.add(entry[1]);
  }
  for (const [promptId, entry] of Object.entries(history)) if (id(promptId) && object(entry) && matchesPrompt(entry.prompt, prepared, jobId)) matches.add(promptId);
  if (matches.size > 1) throw new Error("Multiple still submissions matched; reconcile manually without submitting again.");
  return [...matches][0];
}
export async function reconcileH3StillPrompt(prepared: PreparedH3StillProvider, jobId: string, options: H3StillTransport): Promise<string | undefined> {
  const t = transport(options);
  const read = async (route: string) => { const response = await request(t, route); if (!response.ok) { void response.body?.cancel(); throw new Error("Still reconciliation is unavailable."); } return json(response, 8 * 1024 * 1024, t.signal); };
  return findH3StillPrompt(prepared, jobId, await read("queue"), await read("history?max_items=1000"));
}

export interface H3StillOutput { filename: string; subfolder: string; type: "output" }
function outputReference(value: unknown, descriptorSha256: string, jobId: string): H3StillOutput {
  if (!/^h3-still-[a-f0-9]{64}$/.test(jobId) || !object(value) || value.type !== "output" || typeof value.subfolder !== "string"
    || /^[\\/]|^[a-z]:/i.test(value.subfolder)
    || typeof value.filename !== "string" || !/^master_\d+_\.png$/.test(value.filename)) throw new Error("Still output is outside its owned prefix.");
  const subfolder = value.subfolder.replace(/\\/g, "/"), parts = subfolder.split("/");
  if (parts.some(part => !part || part === "." || part === "..") || subfolder !== `stack-stills/${descriptorSha256}/${jobId}`) throw new Error("Still output is outside its owned prefix.");
  return { filename: value.filename, subfolder, type: "output" };
}
export async function readH3StillStatus(prepared: PreparedH3StillProvider, jobId: string, promptId: string, options: H3StillTransport) {
  verified(prepared); if (!id(promptId) || jobId !== prepared.jobId) throw new Error("Invalid still provider correlation.");
  const t = transport(options), response = await request(t, `history/${encodeURIComponent(promptId)}`);
  if (!response.ok) { void response.body?.cancel(); throw new Error("Still history is unavailable."); }
  const history = await json(response, 2 * 1024 * 1024, t.signal), entry = history[promptId];
  if (entry === undefined) return { status: "unknown" as const };
  if (!object(entry) || !matchesPrompt(entry.prompt, prepared, jobId)) throw new Error("Still history does not match this owned job.");
  if (object(entry.status) && entry.status.status_str === "error") return { status: "failed" as const };
  if (!object(entry.status) || entry.status.completed !== true) return { status: "running" as const };
  if (!object(entry.outputs) || !object(entry.outputs.save) || !Array.isArray(entry.outputs.save.images) || entry.outputs.save.images.length !== 1) throw new Error("Still history did not contain one master output.");
  return { status: "completed" as const, output: outputReference(entry.outputs.save.images[0], prepared.descriptor.sha256, jobId) };
}
export async function downloadH3StillMaster(descriptor: H3StillDescriptor, jobId: string, output: H3StillOutput, options: H3StillTransport) {
  // Rebuild validates the frozen descriptor before accepting its output namespace.
  buildH3StillWorkflow(descriptor, descriptor.body.references.map(r => ({ rawSha256: r.rawSha256, image: `stack-stills/${r.rawSha256}.png` })));
  const safe = outputReference(output, descriptor.sha256, jobId), t = transport(options);
  const response = await request(t, `view?${new URLSearchParams({ filename: safe.filename, subfolder: safe.subfolder, type: safe.type })}`);
  if (!response.ok) { void response.body?.cancel(); throw new Error("Still master download failed."); }
  const raw = await bytes(response, MAX_IMAGE, t.signal);
  if (raw.length < 33 || imageMime(raw) !== "image/png" || raw.readUInt32BE(8) !== 13 || raw.toString("ascii", 12, 16) !== "IHDR"
    || raw.readUInt32BE(16) !== 2048 || raw.readUInt32BE(20) !== 1152) throw new Error("Still master PNG dimensions changed.");
  // Full PNG decoding/CRC/opacity validation belongs to the separate bounded pixel adapter.
  return { bytes: new Uint8Array(raw), pngSha256: sha(raw), byteCount: raw.length, width: 2048 as const, height: 1152 as const };
}
