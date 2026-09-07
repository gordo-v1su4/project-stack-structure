"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState } from "react";
import { beginStoryInspection, createStoryRequestGuard, describeStoryRevision, getStoryTimingError, markStoryEdited } from "./storyAuthoring";
import { isStoryPlanConfirmable, rerankAnchorCoverage, type StoryAnchor, type StoryShotRequirement, type StoryTreatment } from "./storyTreatments";
import type { StoryPlanDraft, VideoMoment } from "./musicVideoProject";

const field = "mt-1 w-full rounded-md border border-line bg-ink-1 px-3 py-2 text-sm leading-6 text-fg-1 outline-none focus:border-accent";
const secondary = "rounded-md border border-line px-3 py-2 text-sm text-fg-2 hover:border-line-3 disabled:opacity-40";

export function StoryTreatmentDialog({ treatment, moments, sections, cues, duration, onSave, onUse, onRefine, onClose }: {
  treatment: StoryTreatment;
  moments: VideoMoment[];
  sections: StoryPlanDraft[];
  cues: number[];
  duration?: number;
  onSave: (treatment: StoryTreatment) => void;
  onUse: (treatment: StoryTreatment) => void;
  onRefine: (treatment: StoryTreatment, instruction: string) => Promise<StoryTreatment>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const requests = useRef(createStoryRequestGuard());
  const [draft, setDraft] = useState(() => beginStoryInspection(treatment));
  const [editing, setEditing] = useState(false);
  const [evidencePreview, setEvidencePreview] = useState<Record<string, string>>({});
  const [instruction, setInstruction] = useState("");
  const [proposal, setProposal] = useState<StoryTreatment | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.showModal();
    const guard = requests.current;
    return () => { guard.invalidate(); returnFocus?.focus(); };
  }, []);
  const preview = proposal ?? draft;
  const pending = draft.reconciliation?.status === "pending";
  const timingError = getStoryTimingError(preview, sections, duration, cues);
  const update = (patch: Partial<StoryTreatment>) => {
    requests.current.invalidate();
    setProposal(null);
    setDraft(current => markStoryEdited(current, { ...current, ...patch }));
  };
  const updateAnchor = (id: string, patch: Partial<StoryAnchor>) => {
    const changesMeaning = patch.description !== undefined || patch.title !== undefined || patch.requirements !== undefined || patch.role !== undefined;
    const anchors = draft.anchors.map(anchor => anchor.id === id ? (changesMeaning ? rerankAnchorCoverage({ ...anchor, ...patch, resolution: null, selectedCandidateId: null }, moments) : { ...anchor, ...patch }) : anchor);
    update({ anchors });
  };
  const updateRequirement = (anchorId: string, requirementId: string, patch: Partial<StoryShotRequirement>) => {
    update({ anchors: draft.anchors.map(anchor => anchor.id === anchorId ? { ...anchor, requirements: anchor.requirements?.map(requirement => requirement.id === requirementId ? { ...requirement, ...patch } : requirement) } : anchor) });
  };
  const move = (index: number, offset: number) => {
    const anchors = [...draft.anchors];
    [anchors[index], anchors[index + offset]] = [anchors[index + offset], anchors[index]];
    update({ anchors });
  };
  async function refine() {
    const token = requests.current.begin();
    setBusy(true); setError(null);
    try {
      const next = await onRefine(draft, instruction.trim() || "Reconcile the edited logline and summary with the ordered story moments and shot requirements. Preserve unchanged facts and decisions.");
      if (!requests.current.isCurrent(token)) throw new Error("The draft changed during revision. The outdated proposal was discarded.");
      setProposal(next);
    }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Story revision failed."); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} aria-labelledby={headingId} onCancel={onClose}
    className="m-auto max-h-[88dvh] w-[min(960px,94vw)] overflow-y-auto rounded-md border border-line-2 bg-ink-2 p-5 text-fg-1 backdrop:bg-ink-0/80">
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 id={headingId} className="font-serif text-xl">{preview.title}</h2>
      <button type="button" onClick={onClose} aria-label="Close story" className={secondary}>Close</button>
    </div>
    <div className="space-y-4">
      {editing && !proposal ? <>
        <label className="block text-sm text-fg-2">Title<input maxLength={100} value={draft.title} className={field} onChange={e => update({ title: e.target.value })} /></label>
        <label className="block text-sm text-fg-2">Logline<textarea rows={3} maxLength={500} value={draft.logline} className={field} onChange={e => update({ logline: e.target.value })} /></label>
        <details className="text-sm text-fg-2"><summary className="cursor-pointer">Logline ingredients</summary><div className="mt-2 grid gap-3 sm:grid-cols-2">{(["incident", "protagonist", "goal", "opposition", "stakes"] as const).map(key => <label key={key} className="block text-xs capitalize">{key}<input className={field} maxLength={300} value={draft.loglineElements?.[key] ?? ""} onChange={event => update({ loglineElements: { incident: "", protagonist: "", goal: "", opposition: "", stakes: "", ...draft.loglineElements, [key]: event.target.value } })} /></label>)}</div></details>
        <label className="block text-sm text-fg-2">Three-sentence story hook<textarea rows={5} maxLength={2000} value={draft.synopsis} className={field} onChange={e => update({ synopsis: e.target.value })} /></label>
      </> : <><p className="text-base leading-7 text-fg-0">{preview.logline}</p><p className="whitespace-pre-wrap text-sm leading-6 text-fg-2">{preview.synopsis}</p></>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={secondary} disabled={busy || Boolean(proposal)} onClick={() => setEditing(!editing)}>{editing ? "Finish editing" : "Edit story"}</button>
        <span className="text-xs text-fg-3">{preview.anchors.length} story moments · {preview.anchors.filter(a => a.coverage === "missing").length} missing footage</span>
      </div>
      {preview.reconciliation?.status === "legacy" ? <p className="rounded-md border border-line p-3 text-sm text-fg-3">This saved story uses an older assessment. Review its moments and footage; refining it will update the structured story without replacing the other options.</p> : null}
      {pending && !proposal ? <p role="status" className="rounded-md border border-accent-lo bg-accent-tint p-3 text-sm text-fg-1">Story edits need reconciliation. Request an updated moment plan below, then review the changes before using this story.</p> : null}
      {proposal ? <div className="rounded-md border border-accent-lo bg-accent-tint p-3">
        <h3 className="text-sm font-medium">Proposed changes</h3>
        <ul className="my-2 list-inside list-disc text-sm text-fg-2">{describeStoryRevision(draft, proposal).map((change, i) => <li key={i}>{change}</li>)}</ul>
        <div className="flex gap-2"><button type="button" className={secondary} onClick={() => setProposal(null)}>Discard proposal</button><button type="button" className={secondary} onClick={() => { setDraft(proposal); setProposal(null); setEditing(false); }}>Accept revision</button></div>
      </div> : null}
      <ol className="space-y-3" aria-label="Story moments">
        {preview.anchors.map((anchor, index) => {
          const selected = moments.find(moment => moment.id === (evidencePreview[anchor.id] ?? anchor.selectedCandidateId ?? anchor.candidates[0]?.momentId));
          return <li key={anchor.id} className="rounded-md border border-line bg-ink-1 p-3">
            <div className="flex items-start justify-between gap-3"><h3 className="text-sm font-medium">{index + 1}. {anchor.title}</h3><span className="shrink-0 text-xs text-fg-3">{anchor.resolution === "generate" ? "Planned generation" : anchor.resolution === "omit" ? "Omitted" : anchor.coverage === "covered" ? "Footage found" : anchor.coverage === "weak" ? "Uncertain match" : "Missing footage"}</span></div>
            <p className="mt-1 text-xs text-fg-3">{anchor.role || anchor.purpose}</p>
            {editing && !proposal ? <>
              <label className="mt-2 block text-xs text-fg-2">Moment title<input value={anchor.title} className={field} maxLength={100} onChange={e => updateAnchor(anchor.id, { title: e.target.value })} /></label>
              <label className="mt-2 block text-xs text-fg-2">Narrative role<input value={anchor.role ?? ""} className={field} maxLength={100} onChange={e => updateAnchor(anchor.id, { role: e.target.value })} /></label>
              <label className="mt-2 block text-xs text-fg-2">Requested visual<textarea rows={3} value={anchor.description} className={field} maxLength={500} onChange={e => updateAnchor(anchor.id, { description: e.target.value })} /></label>
              <div className="mt-2 flex gap-2"><button type="button" className={secondary} disabled={index === 0} onClick={() => move(index, -1)}>Move earlier</button><button type="button" className={secondary} disabled={index === draft.anchors.length - 1} onClick={() => move(index, 1)}>Move later</button><button type="button" className={secondary} disabled={draft.anchors.length <= 2} onClick={() => update({ anchors: draft.anchors.filter(a => a.id !== anchor.id).map(a => ({ ...a, causalDependencies: a.causalDependencies?.filter(id => id !== anchor.id) })), sectionAnchorIds: Object.fromEntries(Object.entries(draft.sectionAnchorIds ?? {}).filter(([, id]) => id !== anchor.id)) })}>Remove</button></div>
            </> : <p className="mt-2 text-sm leading-6 text-fg-2">{anchor.description}</p>}
            {editing && !proposal && anchor.requirements?.length ? <div className="mt-2 space-y-2">{anchor.requirements.map(requirement => <label key={requirement.id} className="block text-xs text-fg-2">Required shot<textarea rows={2} className={field} value={requirement.description} maxLength={500} onChange={event => updateAnchor(anchor.id, { requirements: anchor.requirements?.map(item => item.id === requirement.id ? { ...item, description: event.target.value, resolution: null, selectedCandidateId: null } : item) })} /></label>)}</div> : null}
            {(!editing || proposal) && anchor.requirements?.length ? <ul className="mt-2 list-inside list-disc text-xs leading-5 text-fg-3">{anchor.requirements.map(requirement => <li key={requirement.id}>{requirement.description}{requirement.optional ? " · optional" : ""}</li>)}</ul> : null}
            <details className="mt-3 text-sm text-fg-2"><summary className="cursor-pointer">Review footage and timing</summary>
              {anchor.requirements?.length ? <div className="mt-2 space-y-3">{anchor.requirements.map(requirement => <RequirementReview key={requirement.id} requirement={requirement} moments={moments} disabled={Boolean(proposal)} onChange={patch => updateRequirement(anchor.id, requirement.id, patch)} />)}</div> : <>
              <select className={field} aria-label={`Footage for ${anchor.title}`} disabled={Boolean(proposal)} value={anchor.resolution === "source" ? anchor.selectedCandidateId ?? "" : ""} onChange={e => updateAnchor(anchor.id, { resolution: e.target.value ? "source" : null, selectedCandidateId: e.target.value || null })}>
                <option value="">Leave as a visible gap</option>
                {anchor.candidates.map(candidate => <option key={candidate.momentId} value={candidate.momentId} disabled={candidate.assessment?.eligibility !== undefined && candidate.assessment.eligibility !== "eligible"}>{candidate.label} · {candidate.reason}</option>)}
              </select>
              {anchor.candidates.length ? <div className="mt-2 flex flex-wrap gap-2">{anchor.candidates.map((candidate, candidateIndex) => <button key={candidate.momentId} type="button" className={secondary} onClick={() => setEvidencePreview(current => ({ ...current, [anchor.id]: candidate.momentId }))}>Inspect candidate {candidateIndex + 1}</button>)}</div> : null}
              {selected ? <div><p className="mt-2 text-xs leading-5 text-fg-3">{selected.caption || selected.label}</p><p className="mt-1 text-xs leading-5 text-fg-3">{anchor.candidates.find(candidate => candidate.momentId === selected.id)?.reason}</p><div className="mt-2 grid grid-cols-3 gap-2">{[selected.firstFrameUrl ?? selected.thumbnailUrl, selected.middleFrameUrl, selected.lastFrameUrl].map((url, frameIndex) => url ? <figure key={frameIndex}><Image unoptimized src={url} width={320} height={180} alt={`${anchor.title} · ${["first", "middle", "last"][frameIndex]} frame`} className="h-auto w-full rounded-sm" /><figcaption className="mt-1 text-xs text-fg-3">{["First", "Middle", "Last"][frameIndex]} frame</figcaption></figure> : null)}</div></div> : <p className="mt-2 text-xs text-fg-3">A related clip does not necessarily show the required action.</p>}
              <div className="mt-2 flex gap-2"><button type="button" className={secondary} disabled={Boolean(proposal)} onClick={() => updateAnchor(anchor.id, { resolution: "generate", selectedCandidateId: null })}>Plan missing shot</button><button type="button" className={secondary} disabled={Boolean(proposal)} onClick={() => updateAnchor(anchor.id, { resolution: "omit", selectedCandidateId: null })}>Omit moment</button></div>
              </>}
              {editing && !proposal ? <div className="mt-3 grid grid-cols-2 gap-2"><label className="text-xs">Song start (seconds)<input type="number" min="0" max={duration} step="0.1" value={anchor.songWindow?.start ?? ""} className={field} onChange={e => { const start = Number(e.target.value); updateAnchor(anchor.id, { songWindow: { start, end: Math.max(anchor.songWindow?.end ?? start + 5, start + 0.1) } }); }} /></label><label className="text-xs">Song end (seconds)<input type="number" min={(anchor.songWindow?.start ?? 0) + 0.1} max={duration} step="0.1" value={anchor.songWindow?.end ?? ""} className={field} onChange={e => updateAnchor(anchor.id, { songWindow: { start: anchor.songWindow?.start ?? 0, end: Number(e.target.value) } })} /></label><button type="button" className={secondary} onClick={() => updateAnchor(anchor.id, { songWindow: undefined })}>Use suggested timing</button></div> : null}
            </details>
          </li>;
        })}
      </ol>
      {editing && !proposal ? <button type="button" className={secondary} onClick={() => { const id = crypto.randomUUID(); update({ anchors: [...draft.anchors, { id, title: "New story moment", description: "", purpose: "", generationPrompt: "", coverage: "missing", candidates: [], selectedCandidateId: null, resolution: null }] }); }}>Add story moment</button> : null}
      {!proposal ? <div className="rounded-md border border-line p-3"><label className="text-sm text-fg-2">Refine this story <span className="text-xs text-fg-3">· optional</span><textarea rows={2} maxLength={2000} value={instruction} onChange={e => { requests.current.invalidate(); setInstruction(e.target.value); }} className={field} placeholder="Start outside, then show Diego arriving alone." /></label><button type="button" disabled={busy || (!instruction.trim() && !pending && draft.reconciliation?.status !== "legacy")} onClick={() => void refine()} className={`${secondary} mt-2`}>{busy ? "Preparing a revision…" : "Propose updated story"}</button><p className="mt-2 text-xs text-fg-3">Only this story is revised. Existing choices are kept where the visual requirements are unchanged.</p></div> : null}
      {timingError ? <p role="alert" className="rounded-md border border-accent-lo p-3 text-sm text-fg-1">{timingError}</p> : null}
      {error ? <p role="alert" className="text-sm text-fg-1">{error} Your draft is preserved.</p> : null}
      <div className="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t border-line bg-ink-2 pt-3">
        <button type="button" onClick={onClose} className={secondary}>Cancel</button>
        <button type="button" disabled={busy || Boolean(proposal) || Boolean(timingError)} onClick={() => onSave(draft)} className={secondary}>Save draft</button>
        <button type="button" disabled={busy || Boolean(proposal) || Boolean(timingError) || !isStoryPlanConfirmable(draft)} onClick={() => onUse(draft)} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-ink-0 disabled:opacity-40">Use this story</button>
      </div>
    </div>
  </dialog>;
}

function RequirementReview({ requirement, moments, disabled, onChange }: {
  requirement: StoryShotRequirement;
  moments: VideoMoment[];
  disabled: boolean;
  onChange: (patch: Partial<StoryShotRequirement>) => void;
}) {
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const candidates = requirement.candidates ?? [];
  const inspected = moments.find(moment => moment.id === (inspectedId ?? requirement.selectedCandidateId ?? candidates[0]?.momentId));
  const status = requirement.resolution === "source" ? "Selected footage" : requirement.resolution === "generate" ? "Planned generation" : requirement.resolution === "omit" ? "Omitted" : "Visible gap";
  return <section className="rounded-md border border-line p-3" aria-label={requirement.description}>
    <p className="text-sm leading-6">{requirement.description}{requirement.optional ? " · optional" : ""}</p>
    <p className="mt-1 text-xs text-fg-3">{status}</p>
    <select className={field} aria-label={`Footage for shot: ${requirement.description}`} disabled={disabled} value={requirement.resolution === "source" ? requirement.selectedCandidateId ?? "" : ""} onChange={event => onChange({ resolution: event.target.value ? "source" : null, selectedCandidateId: event.target.value || null })}>
      <option value="">Leave as a visible gap</option>
      {candidates.map(candidate => <option key={candidate.momentId} value={candidate.momentId} disabled={candidate.assessment?.eligibility !== "eligible"}>{candidate.label} · {candidate.reason}</option>)}
    </select>
    <div className="mt-2 flex flex-wrap gap-2"><button type="button" disabled={disabled} className={secondary} onClick={() => onChange({ resolution: "generate", selectedCandidateId: null })}>Plan missing shot</button><button type="button" disabled={disabled} className={secondary} onClick={() => onChange({ resolution: "omit", selectedCandidateId: null })}>Omit shot</button></div>
    {candidates.length ? <details className="mt-2"><summary className="cursor-pointer text-xs">Inspect footage evidence</summary><div className="mt-2 flex flex-wrap gap-2">{candidates.map((candidate, index) => <button type="button" key={candidate.momentId} className={secondary} onClick={() => setInspectedId(candidate.momentId)}>Candidate {index + 1}</button>)}</div>
      {inspected ? <><p className="mt-2 text-xs leading-5 text-fg-3">{inspected.caption || inspected.label}</p><p className="mt-1 text-xs leading-5 text-fg-3">{candidates.find(candidate => candidate.momentId === inspected.id)?.reason}</p><div className="mt-2 grid grid-cols-3 gap-2">{[inspected.firstFrameUrl ?? inspected.thumbnailUrl, inspected.middleFrameUrl, inspected.lastFrameUrl].map((url, index) => url ? <figure key={index}><Image unoptimized src={url} width={320} height={180} alt={`${requirement.description} · ${["first", "middle", "last"][index]} frame`} className="h-auto w-full rounded-sm" /><figcaption className="mt-1 text-xs text-fg-3">{["First", "Middle", "Last"][index]} frame</figcaption></figure> : null)}</div></> : null}
    </details> : <p className="mt-2 text-xs text-fg-3">No footage verifies this shot yet.</p>}
  </section>;
}
