"use client";

import { useRef, useState } from "react";
import { MiniMaxStillPanel } from "./panels/MiniMaxStillPanel";
import { StillAnimaticPreview } from "./StillAnimaticPreview";
import { animaticContextSha256, animaticImage, animaticShotBinding, attachAnimaticJob, importStillAnimatic,
  refreshStillAnimaticContext, replaceStillAnimatic, stillAnimaticShotRequest, type AnimaticContext, type StillAnimaticPlan } from "./stillAnimatic";
import { stillMediaUrl } from "./h3StillClient";
import { Button, Surface } from "./ui";

type Props = AnimaticContext & { plan?: StillAnimaticPlan; audioUrl: string;
  onChange: (next: StillAnimaticPlan) => void;
  onPersist?: (next: StillAnimaticPlan, expected?: StillAnimaticPlan) => Promise<void> };

export function StillAnimaticPanel(props: Props) {
  const [selected, setSelected] = useState(""), [preview, setPreview] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const live = useRef(props); live.current = props;
  const plan = props.plan, context = animaticContextSha256(props), stale = Boolean(plan && plan.contextSha256 !== context);
  const shot = plan?.shots.find(s => s.id === selected) ?? plan?.shots[0];
  const binding = plan && shot ? animaticShotBinding(plan, shot) : undefined;
  const ready = plan?.shots.filter(s => animaticImage(plan, s, context)).length ?? 0;
  async function persist(next: StillAnimaticPlan, expected = live.current.plan) {
    if (!live.current.onPersist) throw new Error("Timed still saving is unavailable.");
    await live.current.onPersist(next, expected);
  }
  async function importFile(file: File) {
    if (file.size > 8_000_000) { setError("The still plan exceeds its import bound."); return; }
    setBusy(true); setError("");
    const start = live.current;
    try { const value = JSON.parse(await file.text());
      if (live.current.projectId !== start.projectId || animaticContextSha256(live.current) !== animaticContextSha256(start)) throw new Error("The open project changed during import.");
      if (start.plan && start.plan.contextSha256 === animaticContextSha256(start)) throw new Error("Revise individual shots in the current plan; an updated import is available after a context change.");
      await persist(start.plan ? replaceStillAnimatic(start, start.plan, value) : importStillAnimatic(start, value), start.plan);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The still plan could not be imported."); }
    finally { setBusy(false); }
  }
  return <Surface className="min-w-0 space-y-3" aria-label="Full-song still animatic">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-medium text-fg-0">Full-song still animatic</h3>
      <p className="mt-1 text-sm text-fg-3">Every shot has its own image and musical hold. Watch the original song before generating motion.</p></div>
      <div className="flex flex-wrap items-center gap-3">{plan ? <span role="status" className="font-mono text-xs text-fg-3">{ready}/{plan.shots.length} current images</span> : null}
        <a href={`/preview/${encodeURIComponent(props.projectId)}`} target="_blank" rel="noreferrer" className="text-sm text-accent hover:underline">Open Preview page</a></div></div>
    {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
    {stale ? <p role="status" className="text-sm text-warn">The story, scene direction or references changed. Image history is retained; current work needs new bindings.</p> : null}
    {stale && plan ? <Button type="button" disabled={busy || !props.onPersist} className="rounded-md border border-accent px-3 py-2 text-sm text-accent" onClick={() => {
      setBusy(true); setError(""); const start = live.current;
      void Promise.resolve().then(() => persist(refreshStillAnimaticContext(start, plan), plan))
        .catch(failure => setError((failure as Error).message)).finally(() => setBusy(false));
    }}>Use current story and references</Button> : null}
    {!plan || stale ? <label className="block text-sm text-fg-2">{plan ? "Import updated timing and retain prior images" : "Import the timed shot plan"}<input type="file" accept="application/json,.json" disabled={busy || !props.onPersist} className="mt-1 block w-full text-xs text-fg-3" onChange={e => { const file = e.target.files?.[0]; if (file) void importFile(file); e.target.value = ""; }} /></label> : null}
    {plan?.priorVersions?.length ? <details className="text-sm text-fg-3"><summary>Archived animatic versions ({plan.priorVersions.length})</summary>
      {plan.priorVersions.map((version, index) => <div key={`${version.archivedAt}:${index}`} className="mt-2"><p>Version {index + 1} · {version.shots.length} shots · images retained for inspection</p>
        <div className="flex flex-wrap gap-2">{version.shots.map(s => { const image = s.sourceFrame?.image ?? s.proof?.result.master;
          return image ? <a key={s.id} href={stillMediaUrl(image)} target="_blank" rel="noreferrer" className="text-accent">{s.id}</a> : null; })}</div></div>)}
    </details> : null}
    {plan && shot && binding ? <>
      <Button type="button" disabled={stale || busy || !props.audioUrl} className="rounded-md border border-accent px-3 py-2 text-sm text-accent" onClick={() => setPreview(true)}>Preview animatic</Button>
      <ol aria-label="Timed still shots" className="flex max-h-52 flex-wrap gap-2 overflow-y-auto">
        {plan.shots.map(s => { const image = animaticImage(plan, s, context); return <li key={s.id} className="shrink-0"><button type="button" aria-pressed={shot.id === s.id} className={`block w-24 rounded-md border p-2 text-left focus-visible:outline-2 focus-visible:outline-accent ${shot.id === s.id ? "border-accent" : "border-line"}`} onClick={() => { setSelected(s.id); setError(""); }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- inspect exact immutable owned pixels */}
          {image && Math.abs(plan.shots.indexOf(s) - plan.shots.indexOf(shot)) <= 3 ? <img src={stillMediaUrl(image)} loading="lazy" alt="" className="mb-1 aspect-video w-full object-contain" /> : <span className="mb-1 flex aspect-video items-center justify-center bg-ink-0 text-xs text-fg-4">{image ? "Ready" : s.record ? "Job saved" : "Missing"}</span>}
          <span className="block font-mono text-xs text-fg-1">{s.id}</span><span className="block font-mono text-xs text-fg-3">{((s.endFrame - s.startFrame) / plan.fps).toFixed(2)}s</span>
        </button></li>; })}
      </ol>
      <div className="text-sm text-fg-2">{shot.id} · {shot.title} · frames {shot.startFrame}–{shot.endFrame}</div>
      {shot.sourceFrame ? <p className="text-sm text-fg-3">Retained source frame at {shot.sourceFrame.sourceSecond.toFixed(2)}s. Its stored PNG remains a source image, without a generated-job or approval claim.</p> : <MiniMaxStillPanel key={`${plan.projectId}:${shot.id}`} projectId={plan.projectId} context={binding.bindingSha256}
        storageScope={`animatic:${shot.id}`} animaticShot={binding} suppliedRecord={shot.record ?? null} creativePrompt={shot.prompt}
        disabled={stale || busy || !props.onPersist} hideVideoAction
        labels={{ heading: `${shot.id} still`, description: "One reference-conditioned still for this exact song window. Ready images remain pending review.", generate: "Generate shot image", regenerate: "Generate revised shot image" }}
        onCreativePromptChange={prompt => { const current = live.current.plan; if (current) props.onChange({ ...current,
          shots: current.shots.map(s => s.id === shot.id ? { ...s, prompt } : s) }); }}
        prepareShot={async () => { const p = live.current, current = p.plan, currentShot = current?.shots.find(s => s.id === shot.id);
          if (!current || !currentShot) throw new Error("Timed shot is unavailable."); return stillAnimaticShotRequest(p, current, currentShot); }}
        onRecord={async record => { const current = live.current.plan, currentShot = current?.shots.find(s => s.id === shot.id);
          if (!current || !currentShot || animaticShotBinding(current, currentShot).bindingSha256 !== binding.bindingSha256) throw new Error("The timed shot changed before saving its intent.");
          await persist({ ...current, shots: current.shots.map(s => s.id === shot.id ? { ...s, record: record ?? undefined,
            ...(record?.request.requestIntentId !== s.record?.request.requestIntentId || record?.request.attempt !== s.record?.request.attempt ? { proof: undefined } : {}) } : s) }, current); }}
        onJob={async (job, record) => { const current = live.current.plan; if (!current) throw new Error("Timed still plan is unavailable.");
          const next = attachAnimaticJob(current, binding, record, job); if (next !== current) await persist(next, current); }} />}
      {preview ? <StillAnimaticPreview key={plan.projectId} plan={plan} context={context} audioUrl={props.audioUrl} onClose={() => setPreview(false)} /> : null}
    </> : null}
  </Surface>;
}
