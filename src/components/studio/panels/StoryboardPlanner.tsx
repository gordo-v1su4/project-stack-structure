"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GeneratedStudioAsset } from "../generatedAssets";
import type { EditPlanPreviewSegment } from "../musicVideoProject";
import type { ReferenceAsset } from "../referenceAssets";
import { waitForTriggerRunOutput } from "@/lib/clientTriggerRuns";
import { fmt } from "../math";
import { buildFreshFramePrompt, buildSequenceGridPrompt, buildStoryboardSequences, canonicalStoryboardReferences, defaultSequenceGridDirection,
  IMAGE_MODELS, IMAGE_PRICE_GUIDE, identifyStoryboardJob, serializeStoryboardJob, type GenerationBilling, type StoryboardImageModel,
  type StoryboardJob, type StoryboardQuote, type VideoFrameRole } from "../storyboardGeneration";

const button = "rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-200 hover:border-orange-600 disabled:opacity-40 disabled:cursor-not-allowed";
const field = "w-full rounded border border-zinc-700 bg-zinc-950 p-2 text-xs text-zinc-200";
type ReviewBatch = { jobs: StoryboardJob[]; quotes: StoryboardQuote[]; completed: number; auto: boolean };

export function StoryboardPlanner({ projectId, segments, references, assets, onAsset, onInspect, sourceFrames, sectionLabels, locked = false }: {
  projectId: string; segments: EditPlanPreviewSegment[]; references: ReferenceAsset[];
  assets: GeneratedStudioAsset[]; onAsset: (asset: GeneratedStudioAsset) => void;
  onInspect?: (first: number, last: number) => void; locked?: boolean;
  sourceFrames?: Record<string, string | undefined>;
  sectionLabels?: Record<string, string>;
}) {
  const sequences = useMemo(() => buildStoryboardSequences(segments).map((sequence) => ({ ...sequence, label: sectionLabels?.[sequence.sectionId] ?? sequence.label })), [segments, sectionLabels]);
  const [selected, setSelected] = useState<string[]>([]);
  const [model, setModel] = useState<StoryboardImageModel>("nano_banana_pro");
  const [billing, setBilling] = useState<GenerationBilling>("subscription-manual");
  const [intents, setIntents] = useState<Record<string, string>>({});
  const [batch, setBatch] = useState<ReviewBatch | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Select sequences after watching the resolved edit. Nothing is selected or approved automatically.");
  const [handoff, setHandoff] = useState<StoryboardJob[]>([]);
  const [returnJobId, setReturnJobId] = useState("");
  const [returnUrl, setReturnUrl] = useState("");
  const pending = useRef(new Set<string>());
  const stop = useRef(false);
  const submitLock = useRef(false);
  const mounted = useRef(true);
  const latestOnAsset = useRef(onAsset);
  const dialog = useRef<HTMLDialogElement>(null);
  const canonical = canonicalStoryboardReferences(references);
  const blocked = locked || !canonical.some((ref) => ref.role.startsWith("character"));
  useEffect(() => { latestOnAsset.current = onAsset; }, [onAsset]);
  useEffect(() => {
    if (batch && !dialog.current?.open) dialog.current?.showModal();
    if (!batch) dialog.current?.close();
  }, [batch]);
  useEffect(() => {
    mounted.current = true;
    return () => { stop.current = true; mounted.current = false; };
  }, []);
  // Reload resumes monitoring existing runs; it never resubmits a paid request.
  useEffect(() => {
    for (const asset of assets) {
      if (!asset.triggerRunId || asset.status !== "queued" || pending.current.has(asset.id)) continue;
      pending.current.add(asset.id);
      void waitForTriggerRunOutput(asset.triggerRunId, { timeoutMs: 20 * 60_000, pollIntervalMs: 3000 })
        .then((result) => {
          if (!mounted.current) return;
          const output = result as GeneratedStudioAsset;
          if (!output.fullStorage || output.status !== "completed") throw new Error("Generation returned no durable image.");
          latestOnAsset.current({ ...asset, ...output, id: asset.id, storyboard: asset.storyboard,
            triggerRunId: asset.triggerRunId, mediaKind: "image", reviewStatus: "pending" });
        }).catch((error) => {
          // Unknown status may mean a paid job is still running. Keep its run ID.
          setStatus(`Could not confirm ${asset.title}: ${error instanceof Error ? error.message : "status unavailable"}. Use Check pending runs; do not generate again.`);
        });
    }
  }, [assets]);

  function gridJob(sequenceId: string): StoryboardJob {
    const sequence = sequences.find((candidate) => candidate.id === sequenceId)!;
    const sourceFrame = sourceFrames?.[sequence.cuts[0]?.momentId ?? ""];
    const refs = sourceFrame?.startsWith("https://")
      ? [...canonical, { url: sourceFrame, label: "Source opening composition", role: "composition" }] : canonical;
    return { id: `${projectId}:grid:${sequence.id}:${model}`, projectId, sequenceId: sequence.id,
      sectionId: sequence.sectionId, title: `${sequence.label} · ${fmt(sequence.songStart)}–${fmt(sequence.songEnd)} storyboard`,
      songStart: sequence.songStart, songEnd: sequence.songEnd, kind: "grid", model, billing, resolution: "2k",
      references: refs, prompt: buildSequenceGridPrompt(refs, intents[sequence.id] ?? defaultSequenceGridDirection(refs)) };
  }

  async function review(jobs: StoryboardJob[]) {
    if (busy || !jobs.length) return;
    if (blocked) { setStatus("Attach the current uploaded canonical character sheets before reviewing generation."); return; }
    jobs = jobs.map(identifyStoryboardJob);
    if (jobs.length > 50) { setStatus("Review up to 50 jobs at a time."); return; }
    setBusy(true);
    try {
      const quotes: StoryboardQuote[] = [];
      for (const job of jobs) {
        if (job.billing === "subscription-manual") {
          quotes.push({ token: "manual", expiresAt: Date.now() + 15 * 60_000, credits: null, guideUsd: IMAGE_MODELS[job.model].guideUsd2k });
        } else {
          const response = await fetch("/api/generate/storyboard", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "quote", job }) });
          const quote = await response.json();
          if (!response.ok) throw new Error(quote.error || "Quote unavailable.");
          quotes.push(quote);
        }
      }
      setBatch({ jobs, quotes, completed: 0, auto: false });
    } catch (error) { setStatus(error instanceof Error ? error.message : "Could not review jobs."); }
    finally { setBusy(false); }
  }

  async function approve() {
    if (!batch || submitLock.current) return;
    submitLock.current = true;
    setBusy(true);
    stop.current = false;
    let completed = batch.completed;
    try {
      const end = batch.auto ? batch.jobs.length : completed + 1;
      for (; completed < end && !stop.current; completed++) {
        const job = batch.jobs[completed];
        const quote = batch.quotes[completed];
        if (job.billing === "subscription-manual") {
          setHandoff((current) => [...current.filter((item) => item.id !== job.id), job]);
          latestOnAsset.current({ id: `manual:${job.id}`, provider: "higgsfield", model: job.model, title: job.title,
            prompt: job.prompt, createdAt: new Date().toISOString(), status: "queued", mediaKind: "image",
            storyboard: job, reviewStatus: "pending", approvedAt: new Date().toISOString() });
        } else {
          if (quote.credits === null) throw new Error("Live provider credit cost is unavailable; no job was submitted.");
          const response = await fetch("/api/generate/storyboard", { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "submit", job, token: quote.token, approved: true }) });
          const payload = await response.json();
          if (!response.ok || !payload.runId) throw new Error(payload.error || "Submission outcome unknown. Check provider history before retrying.");
          if (!mounted.current) break;
          latestOnAsset.current({ id: `storyboard:${job.id}`, provider: "higgsfield", model: job.model, title: job.title,
            prompt: job.prompt, createdAt: new Date().toISOString(), status: "queued", mediaKind: "image",
            storyboard: job, triggerRunId: payload.runId, reviewStatus: "pending", approvedAt: new Date().toISOString() });
        }
        const nextCompleted = completed + 1;
        setBatch((current) => current ? { ...current, completed: nextCompleted } : null);
      }
      if (completed === batch.jobs.length) setBatch(null);
      setStatus(batch.jobs[0].billing === "subscription-manual"
        ? "Approved handoff packets are ready below. No API generation or charge occurred. Submit manually only after verifying subscription inclusion."
        : "Approved jobs dispatched. Returned images remain pending visual review; no videos are generated automatically.");
    } catch (error) {
      stop.current = true;
      setBatch(null);
      setStatus(`${error instanceof Error ? error.message : "Submission failed."} Batch stopped; already submitted jobs remain in the asset list.`);
    } finally { submitLock.current = false; setBusy(false); }
  }

  function freshJob(asset: GeneratedStudioAsset, index: number): StoryboardJob | null {
    const grid = asset.storyboard;
    const panel = asset.split?.panels.find((item) => item.index === index);
    if (!grid || !panel) return null;
    const refs = [...canonical, {
      url: panel.storage?.mediaUrl || panel.storage?.publicUrl || panel.url, label: panel.label, role: "composition" }];
    return { ...grid, id: `${asset.id}:panel:${index}:${model}`, sourceGridId: asset.id, panelIndex: index,
      title: `${grid.title} · ${panel.label} fresh frame`, kind: "fresh-frame", model, billing,
      references: refs, prompt: buildFreshFramePrompt(refs) };
  }

  const manualJobs = assets.filter((asset) => asset.storyboard?.billing === "subscription-manual" && asset.status === "queued" && !asset.triggerRunId)
    .map((asset) => asset.storyboard!);
  const packets = [...new Map([...manualJobs, ...handoff].map((job) => [job.id, job])).values()];
  async function importReturn() {
    const job = packets.find((item) => item.id === returnJobId);
    if (!job || !returnUrl.trim()) return;
    setBusy(true);
    try {
      const response = await fetch("/api/generate/storyboard/return", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job, url: returnUrl.trim() }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Import failed.");
      if (!mounted.current) return;
      latestOnAsset.current({ ...payload.asset, id: `manual:${job.id}`, storyboard: job, reviewStatus: "pending", mediaKind: "image" });
      setHandoff((current) => current.filter((item) => item.id !== job.id));
      setReturnUrl("");
      setStatus("Returned image stored. Review composition and identity before approval.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Import failed."); }
    finally { setBusy(false); }
  }

  return <section aria-label="Storyboard generation planner" className="space-y-4 rounded border border-zinc-700 bg-zinc-950 p-4 text-zinc-200">
    <div><h2 className="text-sm font-semibold">Sequence storyboard → fresh 2K frames → Seedance</h2>
      <p className="mt-1 text-xs leading-5 text-zinc-400">A 2K grid is an audition: split into nine small panels, select compositions, then generate new full-frame 2K images. Never upscale the crops. Character sheets control identity; panels control layout only.</p></div>
    <div className="grid gap-3 md:grid-cols-2">
      <label className="space-y-1 text-xs">Image model<select aria-label="Storyboard image model" className={field} value={model} disabled={busy || !!batch} onChange={(event) => setModel(event.target.value as StoryboardImageModel)}>
        {Object.entries(IMAGE_MODELS).map(([id, info]) => <option key={id} value={id}>{info.label} · ~${info.guideUsd2k.toFixed(3)}/2K image benchmark</option>)}</select></label>
      <label className="space-y-1 text-xs">Billing route<select aria-label="Storyboard billing route" className={field} value={billing} disabled={busy || !!batch} onChange={(event) => setBilling(event.target.value as GenerationBilling)}>
        <option value="subscription-manual">My subscription · manual handoff, no API spend</option><option value="api-credits">Higgsfield API · paid credits, live quote required</option></select></label>
    </div>
    <p className="text-xs text-zinc-400">{canonical.length} uploaded canonical references. {IMAGE_PRICE_GUIDE.note} <a className="underline" href={IMAGE_PRICE_GUIDE.url} target="_blank" rel="noreferrer">Pricing guide · {IMAGE_PRICE_GUIDE.checkedAt}</a></p>
    {blocked ? <p className="text-xs text-amber-400">Finish Story/Match and attach an uploaded character sheet before generation.</p> : null}
    <div className="flex flex-wrap gap-2">
      <button className={button} disabled={busy || !!batch} onClick={() => setSelected(sequences.map((sequence) => sequence.id))}>Select all sequences</button>
      <button className={button} disabled={busy || !!batch} onClick={() => setSelected([])}>Clear selection</button>
      <button className={button} disabled={blocked || busy || !!batch || !selected.length} onClick={() => void review(sequences.filter((sequence) => selected.includes(sequence.id)).map((sequence) => gridJob(sequence.id)))}>Review selected grids ({sequences.filter((sequence) => selected.includes(sequence.id)).length})</button>
    </div>
    <div className="grid max-h-96 gap-3 overflow-y-auto md:grid-cols-2 xl:grid-cols-3">
      {sequences.map((sequence) => <article key={sequence.id} className="space-y-2 rounded border border-zinc-800 p-3">
        <label className="flex gap-2 text-xs"><input type="checkbox" checked={selected.includes(sequence.id)} disabled={busy || !!batch} onChange={(event) => setSelected((current) => event.target.checked ? [...current, sequence.id] : current.filter((id) => id !== sequence.id))} />
          <span>{sequence.label} · {fmt(sequence.songStart)}–{fmt(sequence.songEnd)}</span></label>
        <p className="text-xs text-zinc-500">{sequence.cuts.length} resolved cuts · one 3×3 sequence board · suggested review scope, not a confirmed gap</p>
        <label className="block text-xs text-zinc-400">Sequence direction<textarea aria-label={`Direction for ${sequence.id}`} className={field} rows={2} disabled={busy || !!batch} value={intents[sequence.id] ?? defaultSequenceGridDirection(canonical)} placeholder="Describe the action and mood in one sentence…" onChange={(event) => setIntents((current) => ({ ...current, [sequence.id]: event.target.value }))} /></label>
        <div className="flex gap-2"><button className={button} disabled={blocked || busy || !!batch} onClick={() => void review([gridJob(sequence.id)])}>Review this grid</button>
          {onInspect ? <button className={button} onClick={() => onInspect(segments.indexOf(sequence.cuts[0]), segments.indexOf(sequence.cuts.at(-1)!))}>Watch sequence</button> : null}</div>
      </article>)}
    </div>
    <p role="status" className="text-xs leading-5 text-amber-200">{status}</p>
    {assets.some((asset) => asset.triggerRunId && asset.status === "queued") ? <button className={button} onClick={() => { pending.current.clear(); for (const asset of assets.filter((item) => item.status === "queued" && item.triggerRunId)) onAsset({ ...asset }); }}>Check pending runs</button> : null}
    <div className="space-y-4">
      {assets.filter((asset) => asset.storyboard && asset.status === "completed").map((asset) => <article key={asset.id} className="space-y-3 rounded border border-zinc-700 p-3">
        <h3 className="text-sm">{asset.title}</h3>
        {asset.storyboard?.kind === "grid" ? <>
          <p className="text-xs text-zinc-400">Approve panel compositions for fresh generation. Selecting a panel spends nothing.</p>
          <div className="grid grid-cols-3 gap-2">{asset.split?.panels.map((panel) => <div key={panel.index} className="space-y-2 rounded border border-zinc-800 p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={panel.storage?.mediaUrl || panel.storage?.publicUrl || panel.url} alt={`${asset.title} ${panel.label} composition preview`} className="aspect-video w-full object-contain" />
            <label className="flex gap-2 text-xs"><input type="checkbox" checked={asset.panelReviews?.[panel.index] === "approved"} disabled={busy || !!batch} onChange={(event) => onAsset({ ...asset, panelReviews: { ...asset.panelReviews, [panel.index]: event.target.checked ? "approved" : "pending" } })} />{panel.label}</label>
            <button className={button} disabled={busy || !!batch || asset.panelReviews?.[panel.index] !== "approved"} onClick={() => { const job = freshJob(asset, panel.index); if (job) void review([job]); }}>Review fresh 2K</button>
          </div>)}</div>
          <button className={button} disabled={busy || !!batch || !Object.values(asset.panelReviews ?? {}).includes("approved")} onClick={() => void review((asset.split?.panels ?? []).filter((panel) => asset.panelReviews?.[panel.index] === "approved").flatMap((panel) => { const job = freshJob(asset, panel.index); return job ? [job] : []; }))}>Review all selected fresh frames</button>
        </> : <div className="grid gap-3 md:grid-cols-[240px_1fr]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={asset.fullStorage?.mediaUrl || asset.fullStorage?.publicUrl || asset.resultUrl} alt={`${asset.title} fresh standalone 2K`} className="aspect-video w-full object-contain" />
          <div className="space-y-2 text-xs"><p>Fresh standalone image · {asset.reviewStatus ?? "pending"}. No automatic entry into Join.</p>
            <div className="flex gap-2"><button className={button} onClick={() => onAsset({ ...asset, reviewStatus: "approved" })}>Approve frame for video</button><button className={button} onClick={() => onAsset({ ...asset, reviewStatus: "rejected" })}>Reject frame</button></div>
            <label className="block">Video conditioning role<select aria-label={`Video role for ${asset.title}`} className={field} value={asset.frameRole ?? "composition-reference"} onChange={(event) => onAsset({ ...asset, frameRole: event.target.value as VideoFrameRole })}>
              <option value="composition-reference">Composition reference · default, free edit handles</option><option value="start-frame">Exact start frame · no pre-roll before this frame</option><option value="end-frame">End frame · only in a supported video mode</option></select></label>
            <p className="text-zinc-400">Select this sequence&apos;s cut in the replacement lab below to prepare its Seedance packet.</p>
          </div>
        </div>}
      </article>)}
    </div>
    {packets.length ? <details open className="space-y-3 rounded border border-zinc-700 p-3"><summary className="text-sm">Approved subscription handoffs ({packets.length}) · not generated yet</summary>
      {packets.map((job) => <details key={job.id}><summary className="cursor-pointer text-xs">{job.title}</summary><textarea readOnly aria-label={`Submission packet ${job.title}`} className={`${field} mt-2`} rows={10} value={serializeStoryboardJob(job)} /><button className={button} onClick={() => void navigator.clipboard.writeText(serializeStoryboardJob(job)).then(() => setStatus("Packet copied."), () => setStatus("Clipboard unavailable; select and copy the packet text."))}>Copy packet</button></details>)}
      <p className="text-xs text-zinc-400">After manual generation, upload the result to the project&apos;s RustFS storage and attach its image URL here. Grids are split into nine panels on import; standalone images are not split.</p>
      <label className="block text-xs">Returned job<select aria-label="Returned storyboard job" className={field} value={returnJobId} onChange={(event) => setReturnJobId(event.target.value)}><option value="">Choose the exact approved job</option>{packets.map((job) => <option key={job.id} value={job.id}>{job.title}</option>)}</select></label>
      <input aria-label="Returned image RustFS URL" className={field} value={returnUrl} onChange={(event) => setReturnUrl(event.target.value)} placeholder="https://… durable image URL" />
      <button className={button} disabled={busy || !returnJobId || !returnUrl.trim()} onClick={() => void importReturn()}>Attach returned image</button>
    </details> : null}
    <dialog ref={dialog} aria-labelledby="generation-review-title" className="m-auto max-h-[85vh] w-[min(850px,94vw)] overflow-y-auto rounded-lg border border-zinc-600 bg-zinc-950 p-5 text-zinc-100 backdrop:bg-black/80" onCancel={(event) => { if (busy) event.preventDefault(); else setBatch(null); }}>
      {batch ? <div className="space-y-4">
        <h2 id="generation-review-title" className="text-lg font-semibold">Review generation approval</h2>
        <p className="text-sm">{batch.jobs.length} image job(s) · {IMAGE_MODELS[batch.jobs[0].model].label} · fresh 2K output · {batch.jobs[0].billing === "subscription-manual" ? "subscription handoff — no API charge" : "metered Higgsfield API"}</p>
        <p className="text-sm">Image-output benchmark: ~${batch.quotes.reduce((sum, quote) => sum + quote.guideUsd, 0).toFixed(3)} total.
          {batch.jobs[0].billing === "api-credits" ? ` Provider quote: ${batch.quotes.every((quote) => quote.credits !== null) ? batch.quotes.reduce((sum, quote) => sum + (quote.credits ?? 0), 0) + " credits" : "unavailable — submission blocked"}.` : " Subscription inclusion must be verified in the provider UI; this benchmark is not an extra subscription fee."}</p>
        <p className="text-xs text-zinc-400">{IMAGE_PRICE_GUIDE.note} Grid approval does not approve fresh frames or video jobs. Returned outputs always need visual review.</p>
        <ol className="space-y-3">{batch.jobs.map((job, index) => <li key={job.id} className="rounded border border-zinc-700 p-3 text-xs">
          <div>{index < batch.completed ? "✓ Approved" : index === batch.completed ? "Next" : "Waiting"} · {job.title} · {fmt(job.songStart)}–{fmt(job.songEnd)} · {job.kind === "grid" ? "1 grid → 9 previews" : "1 new standalone frame"} · ~${batch.quotes[index].guideUsd.toFixed(3)}</div>
          {job.references.some((ref) => ref.role === "composition") ? <div className="mt-2 flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={job.references.findLast((ref) => ref.role === "composition")?.url} alt={`Composition being approved for ${job.title}`} className="aspect-video w-36 object-contain" /><span>Composition/layout only. Canonical sheets define identity.</span>
          </div> : null}
          <details><summary className="mt-2 cursor-pointer">Inspect exact prompt and references ({job.references.length})</summary><pre className="mt-2 whitespace-pre-wrap text-zinc-400">{serializeStoryboardJob(job)}</pre></details>
        </li>)}</ol>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={batch.auto} disabled={busy} onChange={(event) => setBatch({ ...batch, auto: event.target.checked })} /><span>Auto-approve remaining generations in this reviewed batch only.<span className="block text-xs text-zinc-400">Off by default. No future batches, retries, fresh-frame stages, video jobs or visual approvals are included.</span></span></label>
        <div className="flex flex-wrap gap-2"><button autoFocus className={button} disabled={busy} onClick={() => setBatch(null)}>Cancel · generate nothing more</button>
          <button className={button} disabled={busy || (batch.jobs[0].billing === "api-credits" && batch.quotes.slice(batch.completed).some((quote) => quote.credits === null))} onClick={() => void approve()}>{batch.jobs[0].billing === "subscription-manual" ? "Approve handoff" : "Approve & generate"} {batch.auto ? `all remaining (${batch.jobs.length - batch.completed})` : `one (${batch.completed + 1}/${batch.jobs.length})`}</button>
          {busy ? <button className={button} onClick={() => { stop.current = true; setStatus("Stopping after the in-flight request; no further jobs will submit."); }}>Stop after current</button> : null}</div>
      </div> : null}
    </dialog>
  </section>;
}
