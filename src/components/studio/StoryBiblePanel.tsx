"use client";

import { useId, useState } from "react";
import type { ReferenceAsset } from "./referenceAssets";
import { normalizeStoryBible, type CanonFact, type CanonRelationship, type StoryBible, type StoryBibleBinding } from "./storyBible";
import { canRebindStoryBible, confirmStoryBibleFact, confirmStoryBibleRelationship, editStoryBibleFact, editStoryBibleRelationship,
  importApprovedStoryBible, importStoryBibleJson, rebindStoryBible, removeStoryBibleRelationship, startStoryBibleWithCurrentReferences,
  storyBibleTextPatch, validateStoryBibleForAuthoring, type StoryBibleAuthoringContext } from "./storyBibleAuthoring";
import { storyBibleTreatmentSignature, type StoryTreatment } from "./storyTreatments";
import { Button, StatusDot, Surface } from "./ui";

export type StoryBiblePanelProps = {
  binding: StoryBibleBinding;
  treatment: StoryTreatment;
  confirmedTreatment: StoryTreatment | null;
  referenceAssets: ReferenceAsset[];
  onChange: (bible: StoryBible, options?: { bindingOnly?: boolean }) => void;
  disabled?: boolean;
};

const field = "w-full rounded-md border border-line-2 bg-ink-1 px-2 py-1.5 text-sm text-fg-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";
const kinds: CanonFact["kind"][] = ["premise", "thesis", "function", "backstory", "psychology", "movement", "stillness", "voice", "production"];

function FactEditor({ fact, characters, disabled, onEdit, onConfirm, onRemove }: {
  fact: CanonFact | CanonRelationship; characters: StoryBible["characters"]; disabled: boolean;
  onEdit: (patch: Partial<Pick<CanonFact, "value" | "visibility" | "channel">>) => void;
  onConfirm: () => void; onRemove: () => void;
}) {
  const [text, setText] = useState(fact.value ?? "");
  const id = useId();
  const changed = text.trim() !== (fact.value ?? "");
  const relationship = !("kind" in fact);
  const characterIds = "characterIds" in fact ? fact.characterIds : [fact.fromCharacterId, fact.toCharacterId];
  return <li className="space-y-2 border-t border-line py-3 first:border-t-0">
    <div className="flex flex-wrap items-center gap-2 text-xs text-fg-3">
      <StatusDot tone={fact.state === "confirmed" ? "ready" : "review"} />
      <span>{fact.state === "confirmed" ? "Confirmed" : "Needs review"}</span>
      <span>{characterIds.length ? characterIds.map(key => characters.find(c => c.id === key)?.canonicalName).join(", ") : "Whole story"}</span>
      <span>{fact.provenance.kind === "approved-story" ? "From approved story" : fact.provenance.kind === "reference" ? "From reference" : "User edit"}</span>
    </div>
    <label htmlFor={id} className="block text-xs text-fg-2">{"kind" in fact ? fact.kind === "production" ? "Production direction" : fact.kind.charAt(0).toUpperCase() + fact.kind.slice(1) : "Relationship"}</label>
    <textarea id={id} value={text} disabled={disabled} maxLength={1600} rows={2} className={field}
      onChange={event => setText(event.target.value)} />
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-xs text-fg-3">Visibility <select aria-label={`Visibility for ${fact.id}`} disabled={disabled} value={fact.visibility}
        className={field} onChange={event => onEdit(storyBibleTextPatch(text, { visibility: event.target.value as CanonFact["visibility"] }))}>
        <option value="public">Shared canon</option><option value="private">Private note</option>
      </select></label>
      <label className="text-xs text-fg-3">Use <select aria-label={`Use for ${fact.id}`} disabled={disabled} value={fact.channel}
        className={field} onChange={event => onEdit(storyBibleTextPatch(text, { channel: event.target.value as CanonFact["channel"] }))}>
        <option value="positive">Visible direction</option><option value="exclusion">Continuity constraint</option><option value="review">Review only</option>
      </select></label>
      {changed ? <Button disabled={disabled} size="sm" onClick={() => onEdit({ value: text })}>Save as proposal</Button>
        : fact.state === "proposed" ? <Button disabled={disabled || !text.trim()} size="sm" onClick={onConfirm}>{relationship ? "Confirm relationship" : "Confirm fact"}</Button> : null}
      <Button variant="ghost" size="sm" disabled={disabled} onClick={onRemove}>{relationship ? "Remove relationship" : "Remove fact"}</Button>
    </div>
    <details className="text-xs text-fg-3"><summary className="cursor-pointer">Source details</summary>
      <p className="mt-1 break-words">{fact.provenance.sourceIds.join(", ")}</p>
      {"referenceAssetIds" in fact && fact.referenceAssetIds.length > 0 && <p className="mt-1">References: {fact.referenceAssetIds.join(", ")}</p>}
    </details>
  </li>;
}

/** Local editor only. The parent saves changes and invalidates downstream approval. */
export function StoryBiblePanel({ binding, treatment, confirmedTreatment, referenceAssets, onChange, disabled = false }: StoryBiblePanelProps) {
  const heading = useId();
  const [error, setError] = useState<string | null>(null);
  const [json, setJson] = useState("");
  const [newText, setNewText] = useState("");
  const [newKind, setNewKind] = useState<CanonFact["kind"]>("production");
  const [newCharacter, setNewCharacter] = useState("");
  const [replacedCanonBackup, setReplacedCanonBackup] = useState<string | null>(null);
  const context: StoryBibleAuthoringContext = { binding, treatment, confirmedTreatment, referenceAssets };
  let bible: StoryBible | undefined;
  let invalid: string | null = null;
  if (treatment.storyBible) {
    try { bible = validateStoryBibleForAuthoring(treatment.storyBible, context); }
    catch (caught) { invalid = caught instanceof Error ? caught.message : "Canon needs review."; }
  }
  const rebindable = treatment.storyBible && canRebindStoryBible(treatment.storyBible, context);
  let previous: StoryBible | undefined;
  let previousJson: string | null = null;
  if (treatment.storyBible) {
    try { previous = normalizeStoryBible(treatment.storyBible); } catch { /* Unsupported prior data is still exportable below. */ }
    try { previousJson = JSON.stringify(treatment.storyBible, null, 2); } catch { /* Project persistence normally guarantees JSON. */ }
  }
  const backupJson = replacedCanonBackup ?? (invalid ? previousJson : null);
  const confirmedSource = confirmedTreatment && storyBibleTreatmentSignature(confirmedTreatment) === binding.storySignature;
  function run(operation: () => StoryBible, options?: { bindingOnly?: boolean }) {
    if (disabled) return;
    try { const next = operation(); onChange(next, options); setError(null); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Canon could not be updated."); }
  }
  function update(next: StoryBible) { run(() => validateStoryBibleForAuthoring(next, context)); }
  function replaceCanon(operation: () => StoryBible) {
    run(() => { const next = operation(); setReplacedCanonBackup(previousJson); return next; });
  }
  function downloadBackup() {
    if (!backupJson) return;
    const url = URL.createObjectURL(new Blob([backupJson], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "previous-story-canon.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  return <Surface aria-labelledby={heading} className="space-y-3">
    <div><h3 id={heading} className="text-sm font-semibold text-fg-0">Story bible</h3>
      <p className="mt-1 max-w-prose text-sm text-fg-3">Keep the approved story, exact character names and reference images together. Unknown biography and voice stay unwritten.</p></div>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {backupJson && <details className="space-y-2 rounded-md border border-line bg-ink-1 p-3 text-xs text-fg-3" open={Boolean(invalid)}>
      <summary className="cursor-pointer">Previous canon backup</summary>
      <p>Save this copy before replacing canon. It keeps the previous names, facts, relationships and review states.</p>
      <label className="block">Previous canon JSON<textarea readOnly value={backupJson} rows={5} className={`${field} font-mono`} onFocus={event => event.target.select()} /></label>
      <Button size="sm" onClick={downloadBackup}>Download previous canon</Button>
    </details>}
    {invalid ? <div className="space-y-2 text-sm text-fg-2"><p>{invalid}</p>
      {previous ? <><h4 className="font-semibold text-fg-1">Revised story</h4><p>{treatment.logline}</p><p>{treatment.synopsis}</p>
        <h4 className="font-semibold text-fg-1">Previous canon to review</h4>
        <p>{previous.characters.map(character => character.canonicalName).join(", ")}</p>
        <ul className="max-h-80 space-y-3 overflow-y-auto rounded-md border border-line bg-ink-1 p-3">
          {[...previous.facts, ...previous.relationships].map(fact => <li key={fact.id}>
            <p className="whitespace-pre-wrap">{fact.value || "Unwritten fact"}</p>
            <p className="text-xs text-fg-3">{fact.state} · {fact.visibility} · {fact.channel}</p>
          </li>)}
        </ul>
        {rebindable && <><p>Review these facts against the revised story. This keeps their review states and asks for story confirmation again.</p>
        <Button disabled={disabled} onClick={() => run(() => rebindStoryBible(treatment.storyBible, context), { bindingOnly: true })}>Review canon for this revised story</Button></>}</> : null}
      <p>Check named references in Setup. Starting new canon replaces the previous canon with the current named references and empty facts and relationships. It carries over no approvals.</p>
      <div className="flex flex-wrap gap-2"><Button disabled={disabled} onClick={() => replaceCanon(() => startStoryBibleWithCurrentReferences(context))}>Start new canon with current references</Button>
        {confirmedSource && <Button disabled={disabled} onClick={() => replaceCanon(() => importApprovedStoryBible(context))}>Replace with approved story facts</Button>}
      </div>
    </div> : !bible ? <div className="space-y-2"><p className="text-sm text-fg-3">Import the selected, confirmed story to begin. Check the declared names on the references in Setup before continuing.</p>
      <Button disabled={disabled || !confirmedTreatment} reason="Confirm the selected story first" onClick={() => run(() => importApprovedStoryBible(context))}>Import approved story</Button>
    </div> : <>
      <div className="space-y-2"><h4 className="text-xs font-semibold text-fg-1">Declared character names</h4>
        {bible.characters.length === 0 && <p className="text-sm text-fg-3">Add named character references in Setup to bind characters to this story.</p>}
        {bible.characters.map(character => <div key={character.id} className="flex flex-wrap items-center gap-2">
          <p className="min-w-48 flex-1 text-sm text-fg-1">{character.canonicalName}</p>
          <p className="flex-1 text-xs text-fg-3">{character.referenceAssetIds.map(id => referenceAssets.find(ref => ref.id === id)?.displayName).join(", ")}</p>
        </div>)}
        {bible.characters.length > 0 && <p className="text-xs text-fg-3">Change named references in Setup to change these names.</p>}
      </div>
      <p className="text-xs text-fg-3">Only confirmed shared facts enter creative guidance. Private notes stay private; constraints and review notes stay in review.</p>
      <ul>{bible.facts.map(fact => <FactEditor key={`${fact.id}:${fact.value}`} fact={fact} characters={bible.characters} disabled={disabled}
        onEdit={patch => run(() => editStoryBibleFact(bible, fact.id, patch))}
        onConfirm={() => run(() => confirmStoryBibleFact(bible, fact.id))}
        onRemove={() => update({ ...bible, facts: bible.facts.filter(item => item.id !== fact.id) })} />)}</ul>
      {bible.relationships.length > 0 && <details className="text-sm text-fg-2"><summary className="cursor-pointer">Relationships ({bible.relationships.length})</summary>
        <ul className="mt-2 space-y-2">{bible.relationships.map(relation => <FactEditor key={`${relation.id}:${relation.value}`} fact={relation} characters={bible.characters} disabled={disabled}
          onEdit={patch => run(() => editStoryBibleRelationship(bible, relation.id, patch))}
          onConfirm={() => run(() => confirmStoryBibleRelationship(bible, relation.id))}
          onRemove={() => run(() => removeStoryBibleRelationship(bible, relation.id))} />)}</ul>
      </details>}
      <fieldset disabled={disabled || bible.facts.length >= 64} className="space-y-2 border-t border-line pt-3"><legend className="text-xs font-semibold text-fg-1">Add a fact for review</legend>
        <div className="flex flex-wrap gap-2"><label className="text-xs text-fg-3">Kind<select value={newKind} onChange={event => setNewKind(event.target.value as CanonFact["kind"])} className={field}>
          {kinds.map(kind => <option key={kind}>{kind}</option>)}</select></label>
          <label className="text-xs text-fg-3">Applies to<select value={newCharacter} onChange={event => setNewCharacter(event.target.value)} className={field}>
            <option value="">Whole story</option>{bible.characters.map(character => <option key={character.id} value={character.id}>{character.canonicalName}</option>)}
          </select></label></div>
        <label className="block text-xs text-fg-3">Known direction<textarea value={newText} onChange={event => setNewText(event.target.value)} rows={2} maxLength={1600} className={field} /></label>
        <Button size="sm" disabled={disabled || !newText.trim() || bible.facts.length >= 64} onClick={() => run(() => {
          const id = `user-${crypto.randomUUID()}`;
          const next = validateStoryBibleForAuthoring({ ...bible, facts: [...bible.facts, { id, kind: newKind, value: newText.trim(),
            state: "proposed", visibility: "public", channel: "positive", characterIds: newCharacter ? [newCharacter] : [], referenceAssetIds: [],
            provenance: { kind: "user", sourceIds: [id] } }] }, context);
          setNewText(""); return next;
        })}>Add proposal</Button>
      </fieldset>
    </>}
    <details className="border-t border-line pt-3 text-xs text-fg-3"><summary className="cursor-pointer">Import structured canon</summary>
      <p className="my-2">Import a current project canon file. Imported approval is checked against existing facts or exact approved story sources; other facts need review.</p>
      <label className="block">Canon JSON<textarea value={json} disabled={disabled} maxLength={65536} rows={5} className={`${field} font-mono`}
        onChange={event => setJson(event.target.value)} /></label>
      <Button className="mt-2" size="sm" disabled={disabled || !json.trim()} onClick={() => invalid
        ? replaceCanon(() => importStoryBibleJson(json, context)) : run(() => importStoryBibleJson(json, context, bible))}>Import for review</Button>
    </details>
  </Surface>;
}
