import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import fixture from "../fixtures/h3-still-provider-node-inputs.json";
import { freezeH3Still, type H3StillDescriptor } from "../../src/lib/h3StillProfile";
import { downloadH3StillMaster, findH3StillPrompt, H3StillSubmissionError, H3StillUploadError, prepareH3StillProvider, readH3StillStatus,
  reconcileH3StillPrompt, submitH3StillOnce, type H3StillTransport, type PreparedH3StillProvider } from "../../src/lib/h3StillProvider";

const jobId = `h3-still-${"d".repeat(64)}`, baseUrl = "http://swarm.test:7861";
const raw = Buffer.from([137,80,78,71,13,10,26,10,1,2,3]);
const rawSha = createHash("sha256").update(raw).digest("hex");
function descriptor(): H3StillDescriptor { return freezeH3Still({ ownerId: "github-123", projectId: "project-1", planSignature: "plan-1",
  target: { timelineItemId: "shot1", sectionId: "intro", songStart: 0, songEnd: 4 }, seed: 42, prompt: "Diego is <Picture 1>. Diego faces the camera.",
  references: [{ assetId: "diego", canonicalName: "Diego", role: "identity", bucket: "studio", objectKey: "refs/diego.png", version: "version1", etag: "etag1", rawSha256: rawSha }] }); }
const reference = async () => ({ bytes: raw, mime: "image/png", etag: "etag1", version: "version1" });
const reply = (body: unknown, status = 200) => Response.json(body, { status });
function harness() {
  const calls: { route: string; init?: RequestInit }[] = [];
  let promptReply: () => Promise<Response> = async () => reply({ prompt_id: "prompt-1" });
  let schemas = structuredClone(fixture.nodes) as Record<string, unknown>;
  let history: Record<string, unknown> = {}, queue: Record<string, unknown> = {};
  let master = Buffer.alloc(33); raw.copy(master); master.writeUInt32BE(13, 8); master.write("IHDR", 12); master.writeUInt32BE(2048, 16); master.writeUInt32BE(1152, 20);
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const parsed = new URL(String(url)); expect(parsed.origin).toBe(baseUrl); expect(parsed.pathname.startsWith("/ComfyBackendDirect/")).toBe(true);
    const route = parsed.pathname.replace("/ComfyBackendDirect/", "") + parsed.search; calls.push({ route, init });
    if (route === "upload/image") return reply({ name: `${rawSha}.png`, subfolder: "stack-stills", type: "input" });
    if (route.startsWith("object_info/")) { const cls = decodeURIComponent(route.split("/")[1]); return reply(schemas[cls] ? { [cls]: schemas[cls] } : {}); }
    if (route === "prompt") return promptReply();
    if (route === "queue") return reply(queue);
    if (route.startsWith("history")) return reply(history);
    if (route.startsWith("view?")) return new Response(master, { headers: { "content-type": "image/png" } });
    throw new Error("Unexpected endpoint");
  }) as typeof fetch;
  return { options: { baseUrl, fetchImpl } satisfies H3StillTransport, calls,
    setPrompt: (fn: typeof promptReply) => { promptReply = fn; }, setSchema: (v: typeof schemas) => { schemas = v; },
    schemas, setHistory: (v: typeof history) => { history = v; }, setQueue: (v: typeof queue) => { queue = v; }, setMaster: (v: Buffer) => { master = Buffer.from(v); } };
}
async function prepare(h: ReturnType<typeof harness>, desc = descriptor()) { return prepareH3StillProvider(desc, { ...h.options, jobId, readReference: reference }); }
function entry(p: PreparedH3StillProvider, id = "prompt-1", completed = true) {
  return { prompt: [0, id, p.workflow, { stack_h3_still_job_id: jobId, descriptor_sha256: p.descriptor.sha256, workflow_sha256: p.workflowSha256 }],
    status: { completed, status_str: "success" }, outputs: { save: { images: [{ filename: "master_00001_.png", subfolder: `stack-stills/${p.descriptor.sha256}/${jobId}`, type: "output" }] } } };
}

describe("H3 still managed provider adapter", () => {
  test("preserves raw reference bytes and binds exact upload response without generation", async () => {
    const h = harness(), p = await prepare(h);
    expect(h.calls.length).toBe(1); expect(h.calls[0].route).toBe("upload/image");
    const form = h.calls[0].init!.body as FormData, file = form.get("image") as File;
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array(raw));
    expect(file.name).toBe(`${rawSha}.png`); expect(form.get("overwrite")).toBe("true");
    expect(p.workflow.save.inputs.filename_prefix).toBe(`stack-stills/${p.descriptor.sha256}/${jobId}/master`);
  });

  test("accepts exact JPEG/WebP bytes under content-addressed input names without conversion", async () => {
    for (const [mime, bytes] of [["image/jpeg", Buffer.from([255,216,255,1])], ["image/webp", Buffer.from("RIFFxxxxWEBPxxx")]] as const) {
      const h = harness(), d = descriptor(), hash = createHash("sha256").update(bytes).digest("hex");
      d.body.references[0].rawSha256 = hash;
      const frozen = freezeH3Still(d.body);
      const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
        const f = (init!.body as FormData).get("image") as File;
        expect(new Uint8Array(await f.arrayBuffer())).toEqual(new Uint8Array(bytes)); expect(f.type).toBe(mime);
        return reply({ name: `${hash}.png`, subfolder: "stack-stills", type: "input" });
      }) as typeof fetch;
      await prepareH3StillProvider(frozen, { ...h.options, fetchImpl, jobId, readReference: async () => ({ bytes, mime, version: "version1", etag: "etag1" }) });
    }
  });

  test("rejects changed raw bytes, versions, ETags and upload bindings before prompt", async () => {
    for (const patch of [{ etag: "wrong" }, { version: "wrong" }, { bytes: Buffer.from("bad") }, { mime: "image/jpeg" }]) {
      const h = harness(); let failed = false;
      try { await prepareH3StillProvider(descriptor(), { ...h.options, jobId, readReference: async () => ({ ...await reference(), ...patch }) }); } catch { failed = true; }
      expect(failed).toBe(true); expect(h.calls.length).toBe(0);
    }
    const h = harness(); let failed = false;
    try { await prepareH3StillProvider(descriptor(), { ...h.options, jobId, fetchImpl: (async () => reply({ name: "other.png", subfolder: "stack-stills", type: "input" })) as typeof fetch, readReference: reference }); } catch { failed = true; }
    expect(failed).toBe(true);
  });

  test("reports an upload HTTP failure without exposing its body or submitting a prompt", async () => {
    const routes: string[] = [];
    const failure = await prepareH3StillProvider(descriptor(), { baseUrl, jobId, readReference: reference,
      fetchImpl: (async url => { routes.push(new URL(String(url)).pathname); return new Response("private backend details", { status: 500 }); }) as typeof fetch,
    }).catch(error => error);
    expect(failure).toBeInstanceOf(H3StillUploadError);
    expect(failure.message).toContain("HTTP 500");
    expect(failure.message).toContain("available disk space");
    expect(failure.message).not.toContain("private backend details");
    expect(routes).toEqual(["/ComfyBackendDirect/upload/image"]);
  });

  test("checks all actual node schemas and models, durably records submitting, then posts once", async () => {
    const h = harness(), p = await prepare(h); let recorded = false;
    h.setPrompt(async () => { expect(recorded).toBe(true); return reply({ prompt_id: "prompt-1" }); });
    const submitted = await submitH3StillOnce(p, jobId, { ...h.options, beforeSubmit: async r => { expect(r.workflowSha256).toBe(p.workflowSha256); expect(r.schemaSha256.length).toBe(64); recorded = true; } });
    expect(submitted.promptId).toBe("prompt-1");
    expect(h.calls.filter(c => c.route.startsWith("object_info/")).length).toBe(18);
    const posts = h.calls.filter(c => c.route === "prompt"); expect(posts.length).toBe(1);
    const sent = JSON.parse(posts[0].init!.body as string); expect(sent.prompt).toEqual(p.workflow);
    expect(sent.extra_data.stack_h3_still_job_id).toBe(jobId);
  });

  test("missing node/model/capacity or failed durable state prevents submission", async () => {
    for (const mutate of [(s: Record<string, unknown>) => { delete s.FizgigH3StillLatent; }, (s: Record<string, unknown>) => {
      (s.UNETLoader as { input: { required: Record<string, unknown> } }).input.required.unet_name = ["COMBO", { options: ["other"] }];
    }, (s: Record<string, unknown>) => { (s.MiniMaxH3ReferenceToVideo as { input: { optional: Record<string, unknown> } }).input.optional.ref_images = ["IMAGE"]; }]) {
      const h = harness(), p = await prepare(h); mutate(h.schemas); h.setSchema(h.schemas); let failed = false;
      try { await submitH3StillOnce(p, jobId, { ...h.options, beforeSubmit: async () => { throw new Error("Must not reach state"); } }); } catch { failed = true; }
      expect(failed).toBe(true); expect(h.calls.filter(c => c.route === "prompt").length).toBe(0);
    }
    const h = harness(), p = await prepare(h); let failed = false;
    try { await submitH3StillOnce(p, jobId, { ...h.options, beforeSubmit: async () => { throw new Error("State write failed"); } }); } catch { failed = true; }
    expect(failed).toBe(true); expect(h.calls.filter(c => c.route === "prompt").length).toBe(0);
  });

  test("classifies definitive rejection versus ambiguous failures without repeating POST", async () => {
    for (const [response, disposition] of [[async () => reply({ error: { type: "prompt_no_outputs" } }, 400), "rejected"], [async () => reply({}, 503), "unknown"],
      [async () => { throw new Error("lost ack"); }, "unknown"], [async () => new Response("invalid JSON"), "unknown"],
      [async () => reply({}), "unknown"], [async () => reply({ error: { type: "invalid_prompt" } }), "rejected"],
      [async () => reply({ error: "upstream timeout" }, 408), "unknown"], [async () => reply({}, 429), "unknown"],
      [async () => reply({ error: "invalid graph" }, 400), "unknown"]] as const) {
      const h = harness(), p = await prepare(h); h.setPrompt(response); let error: unknown;
      try { await submitH3StillOnce(p, jobId, { ...h.options, beforeSubmit: async () => undefined }); } catch (e) { error = e; }
      expect(error instanceof H3StillSubmissionError).toBe(true); expect((error as H3StillSubmissionError).disposition).toBe(disposition);
      expect(h.calls.filter(c => c.route === "prompt").length).toBe(1);
    }
  });

  test("readonly reconciliation requires exact attempt, descriptor and workflow; empty history stays unknown", async () => {
    const h = harness(), p = await prepare(h), owned = entry(p);
    h.setHistory({ "prompt-1": owned }); expect(await reconcileH3StillPrompt(p, jobId, h.options)).toBe("prompt-1");
    expect(h.calls.filter(c => c.route === "prompt").length).toBe(0);
    expect(findH3StillPrompt(p, jobId, { queue_running: [owned.prompt] }, {})).toBe("prompt-1");
    const wrong = structuredClone(owned); (wrong.prompt[3] as Record<string, string>).stack_h3_still_job_id = "other";
    expect(findH3StillPrompt(p, jobId, {}, { "prompt-1": wrong })).toBe(undefined);
    expect(() => findH3StillPrompt(p, jobId, {}, { "prompt-1": owned, "prompt-2": entry(p, "prompt-2") })).toThrow();
    h.setHistory({}); expect(await readH3StillStatus(p, jobId, "prompt-1", h.options)).toEqual({ status: "unknown" });
  });

  test("only accepts the exact attempt master output and expected PNG dimensions", async () => {
    const h = harness(), p = await prepare(h); h.setHistory({ "prompt-1": entry(p) });
    const status = await readH3StillStatus(p, jobId, "prompt-1", h.options); expect(status.status).toBe("completed");
    if (status.status !== "completed") throw new Error("Expected master");
    const master = await downloadH3StillMaster(p.descriptor, jobId, status.output, h.options); expect(master.byteCount).toBe(33); expect(master.pngSha256.length).toBe(64);
    let failed = false;
    try { await downloadH3StillMaster(p.descriptor, jobId, { ...status.output, subfolder: `stack-stills/${p.descriptor.sha256}` }, h.options); } catch { failed = true; } expect(failed).toBe(true);
    const bad = Buffer.alloc(33); raw.copy(bad); bad.writeUInt32BE(13, 8); bad.write("IHDR", 12); bad.writeUInt32BE(1344, 16); bad.writeUInt32BE(768, 20); h.setMaster(bad);
    failed = false; try { await downloadH3StillMaster(p.descriptor, jobId, status.output, h.options); } catch { failed = true; } expect(failed).toBe(true);
  });

  test("bounded deadline also aborts a provider that stalls after successful response headers", async () => {
    const h = harness(), p = await prepare(h);
    const fetchImpl = (async () => new Response(new ReadableStream({ start() { /* intentionally no chunks */ } }))) as typeof fetch;
    let failed = false; const start = Date.now();
    // Native AbortSignal.timeout is unref'd; keep this synthetic socket-free stream alive in Bun.
    const keepAlive = setInterval(() => undefined, 10);
    try { await readH3StillStatus(p, jobId, "prompt-1", { ...h.options, fetchImpl, timeoutMs: 25 }); } catch { failed = true; }
    finally { clearInterval(keepAlive); }
    expect(failed).toBe(true); expect(Date.now() - start < 1000).toBe(true);
  });

  test("normalizes Windows provider subfolders while rejecting absolute, traversal and extra paths", async () => {
    const h = harness(), p = await prepare(h), valid = entry(p);
    const image = valid.outputs.save.images[0], prefix = image.subfolder;
    image.subfolder = prefix.replace(/\//g, "\\");
    h.setHistory({ "prompt-1": valid });
    const status = await readH3StillStatus(p, jobId, "prompt-1", h.options);
    expect(status.status).toBe("completed");
    if (status.status !== "completed") throw new Error("Expected Windows master output");
    expect(status.output.subfolder).toBe(prefix);
    await downloadH3StillMaster(p.descriptor, jobId, { ...status.output, subfolder: image.subfolder }, h.options);
    expect(new URL(h.calls[h.calls.length - 1].route, baseUrl).searchParams.get("subfolder")).toBe(prefix);
    const unsafe = [
      `C:\\${image.subfolder}`, `\\${image.subfolder}`, `/${prefix}`, `../${prefix}`,
      `stack-stills\\${p.descriptor.sha256}/..\\${jobId}`, `stack-stills/${p.descriptor.sha256}\\.\\${jobId}`,
      `${prefix}\\extra`, `${prefix}/`, prefix.replace("/", "//"),
      `stack-stills/${p.descriptor.sha256}/h3-still-${"a".repeat(64)}`,
    ];
    for (const subfolder of unsafe) {
      image.subfolder = subfolder; h.setHistory({ "prompt-1": valid }); let failed = false;
      try { await readH3StillStatus(p, jobId, "prompt-1", h.options); } catch { failed = true; }
      expect(failed).toBe(true);
    }
  });

  test("rejects prepared-graph tampering and refuses outputs above the byte bound before reading", async () => {
    const h = harness(), p = await prepare(h), changed = structuredClone(p);
    changed.workflow.model.inputs.unet_name = "unapproved.safetensors";
    let failed = false;
    try { await submitH3StillOnce(changed, jobId, { ...h.options, beforeSubmit: async () => undefined }); } catch { failed = true; }
    expect(failed).toBe(true); expect(h.calls.filter(c => c.route === "prompt").length).toBe(0);
    const fetchImpl = (async () => new Response("tiny", { headers: { "content-length": String(32 * 1024 * 1024 + 1) } })) as typeof fetch;
    failed = false;
    try { await downloadH3StillMaster(p.descriptor, jobId, { filename: "master_00001_.png", subfolder: `stack-stills/${p.descriptor.sha256}/${jobId}`, type: "output" }, { ...h.options, fetchImpl }); } catch { failed = true; }
    expect(failed).toBe(true);
    const forbidden = ["", "http://user:password@swarm.test:7861", "http://swarm.test:7861/not-an-origin", "ftp://swarm.test"];
    for (const baseUrl of forbidden) {
      failed = false;
      try { await prepareH3StillProvider(descriptor(), { ...h.options, baseUrl, jobId, readReference: reference }); } catch { failed = true; }
      expect(failed).toBe(true);
    }
  });
});
