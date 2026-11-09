"use client";

import { useRef, useState } from "react";
import { MiniMaxStillPanel } from "./panels/MiniMaxStillPanel";
import { stillMediaUrl } from "./h3StillClient";
import { fmt } from "./math";
import { Button, Surface } from "./ui";
import { generationScopeSha256 } from "./generationScope";
import { attachSceneProofJob, prepareSceneProofPlan, reviewSceneProof, sceneMomentBinding, sceneProofContextSha256,
  sceneProofReviewStatus, sceneProofShot, sceneProofPrompt, reviseSceneDirection, type SceneProofContext, type SceneProofPlan, type SceneProofRole, type SceneProofScene } from "./sceneProofs";

type Props = Omit<SceneProofContext, "projectId"> & { projectId: string | null; plan?: SceneProofPlan;
  onChange: (plan: SceneProofPlan) => void; onPersist?: (plan: SceneProofPlan, expected?: SceneProofPlan) => Promise<void>;
  onEnsureSavedProject?: () => Promise<string> };
const ROLE_LABELS = { setting: "Setting", action: "Action / progression", transition: "Into the next scene" };

/** Only the selected moment mounts a generator. A scene review never selects a take. */
export function SceneProofPanel(props: Props) {
  const [sceneId, setSceneId] = useState<string | null>(null), [role, setRole] = useState<SceneProofRole>("setting");
  const [note, setNote] = useState(""), [error, setError] = useState(""), [saving, setSaving] = useState(false);
  const live = useRef(props); live.current = props;
  const input = props.projectId ? { ...props, projectId: props.projectId } : null;
  const context = input ? sceneProofContextSha256(input) : "";
  const plan = props.plan;
  const scene = plan?.scenes.find(s => s.id === sceneId) ?? plan?.scenes[0];
  const moment = scene?.moments.find(m => m.role === role);
  const binding = plan && scene && moment ? sceneMomentBinding(plan, scene, moment) : null;
  const stale = plan?.contextSha256 !== context;
  const approved = plan?.scenes.filter(s => sceneProofReviewStatus(plan, s, context) === "approved").length ?? 0;

  async function persist(next: SceneProofPlan, expected = live.current.plan) {
    if (!live.current.onPersist) throw new Error("Scene preview saving is unavailable in this view.");
    await live.current.onPersist(next, expected);
  }
  function updateScene(update: (scene: SceneProofScene) => SceneProofScene) {
    if (!plan || !scene) return;
    props.onChange({ ...plan, scenes: plan.scenes.map(s => s.id === scene.id ? update(s) : s) });
  }
  async function action(run: () => Promise<void>) {
    setError(""); setSaving(true);
    try { await run(); } catch (e) { setError(e instanceof Error ? e.message : "Scene preview could not be saved."); }
    finally { setSaving(false); }
  }

  return <Surface className="space-y-3" aria-label="Whole-song scene previews">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="text-sm font-medium text-fg-0">Scene previews across the song</h3>
        <p className="mt-1 text-sm text-fg-3">Review setting, action and the connection into the next scene before generating the footage. Scene direction is separate from take and final-cut approval.</p></div>
      {plan ? <span className="font-mono text-xs text-fg-3">{approved}/{plan.scenes.length} directions approved</span> : null}
    </div>
    {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
    {!input ? <Button type="button" className="rounded-md border border-line px-3 py-2 text-sm text-fg-1" disabled={saving || !props.onEnsureSavedProject}
      onClick={() => void action(async () => { await props.onEnsureSavedProject?.(); })}>Save project to prepare scene previews</Button> : null}
    {input && (!plan || stale) ? <div className="space-y-2">
      {plan ? <p role="status" className="text-sm text-warn">Story, timing or references changed. Previous directions need new previews and review; historical still jobs remain available.</p> : null}
      <Button type="button" disabled={saving || !props.onPersist} className="rounded-md border border-accent px-3 py-2 text-sm text-accent"
        onClick={() => void action(async () => { await persist(prepareSceneProofPlan(input)); })}>{plan ? "Prepare current scene previews" : "Prepare whole-song scene previews"}</Button>
    </div> : null}
    {plan ? <>
      <ol className="grid gap-2 md:grid-cols-2 xl:grid-cols-3" aria-label="Scenes in song order">
        {plan.scenes.map((s, index) => <li key={s.id}><Button type="button" className={`w-full rounded-md border p-3 text-left ${s.id === scene?.id ? "border-accent bg-ink-3" : "border-line bg-ink-1"}`}
          onClick={() => { setSceneId(s.id); setNote(s.review?.note ?? ""); setError(""); }}>
          <span className="block text-sm text-fg-1">{index + 1}. {s.title}</span>
          <span className="mt-1 block font-mono text-xs text-fg-3">{fmt(s.songStart)}–{fmt(s.songEnd)} · {sceneProofReviewStatus(plan, s, context)}</span>
        </Button></li>)}
      </ol>
      {scene && moment && binding ? <div className="space-y-3 border-t border-line pt-3">
        <label className="block text-sm text-fg-2">Scene direction
          <textarea className="mt-1 w-full rounded-md border border-line bg-ink-0 p-2 text-fg-1" rows={3} value={scene.direction} maxLength={6000}
            disabled={saving || stale} onChange={e => updateScene(s => reviseSceneDirection(s, e.target.value))} /></label>
        <fieldset disabled={saving || stale} className="flex flex-wrap gap-3 text-xs text-fg-2"><legend className="mb-2">Named reference authorities for this scene</legend>
          {props.references.filter(ref => ref.storageStatus === "uploaded").map(ref => <label key={ref.id} className="flex items-center gap-1">
            <input type="checkbox" checked={scene.referenceAssetIds.includes(ref.id)} onChange={e => updateScene(s => ({ ...s,
              referenceAssetIds: e.target.checked ? [...s.referenceAssetIds, ref.id].slice(0, 9) : s.referenceAssetIds.filter(id => id !== ref.id) }))} />{ref.displayName}
          </label>)}
        </fieldset>
        <div className="grid gap-2 md:grid-cols-3">
          {scene.moments.map(m => <div key={m.role} className={`rounded-md border p-2 ${role === m.role ? "border-accent" : "border-line"}`}>
            <Button type="button" className="mb-2 text-sm text-fg-1" onClick={() => setRole(m.role)}>{ROLE_LABELS[m.role]}</Button>
            {m.proof && !stale && m.record?.context === sceneMomentBinding(plan, scene, m).bindingSha256 ? <a href={stillMediaUrl(m.proof.result.master)} target="_blank" rel="noreferrer" aria-label={`Inspect full-quality ${ROLE_LABELS[m.role]} image`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- authenticated immutable media, master remains inspectable */}
              <img loading="lazy" src={stillMediaUrl(m.proof.result.master)} alt={`${scene.title}: ${ROLE_LABELS[m.role]}`} className="aspect-video w-full rounded-sm object-contain bg-ink-0" />
            </a> : <div className="flex aspect-video items-center justify-center bg-ink-0 text-xs text-fg-4">{m.proof ? "Previous image is stale" : m.record ? "Recover saved proof job" : "Image not prepared"}</div>}
          </div>)}
        </div>
        <MiniMaxStillPanel key={`${plan.projectId}:${scene.id}:${moment.role}`} projectId={plan.projectId} context={binding.bindingSha256}
          storageScope={`${scene.id}:${moment.role}`} suppliedRecord={moment.record ?? null} sceneProof={binding}
          disabled={stale || saving || !props.onPersist} creativePrompt={moment.prompt}
          onCreativePromptChange={prompt => updateScene(s => ({ ...s, moments: s.moments.map(m => m.role === moment.role ? { ...m, prompt } : m) }))}
          compileCreativePrompt={() => sceneProofPrompt(scene, moment)}
          hideVideoAction labels={{ heading: `${ROLE_LABELS[moment.role]} image`, description: "Generate one full-quality local MiniMax H3 proof. The scene direction and visible moment both guide the image. Completion does not approve this scene.", prompt: "Visible moment", generate: "Generate this scene image", regenerate: "Generate revised scene image" }}
          prepareShot={async () => {
            const p = live.current, current = p.plan;
            if (!p.projectId || !current || !p.onPersist) throw new Error("Save the current scene plan first.");
            const s = current.scenes.find(s => s.id === binding.sceneId), m = s?.moments.find(m => m.role === binding.momentId);
            if (!s || !m) throw new Error("Scene moment changed.");
            return sceneProofShot({ ...p, projectId: p.projectId }, current, s, m);
          }}
          onRecord={async record => {
            const current = live.current.plan, s = current?.scenes.find(s => s.id === binding.sceneId), m = s?.moments.find(m => m.role === binding.momentId);
            if (!current || !s || !m || sceneMomentBinding(current, s, m).bindingSha256 !== binding.bindingSha256) throw new Error("Scene direction changed before its intent was saved.");
            const next = { ...current, scenes: current.scenes.map(item => item.id === s.id ? { ...item, moments: item.moments.map(item => item.role === m.role
              ? { ...item, record: record ?? undefined, ...(generationScopeSha256(item.record?.request ?? null) !== generationScopeSha256(record?.request ?? null) ? { proof: undefined } : {}) } : item) } : item) };
            await persist(next, current);
          }}
          onJob={async (job, record) => { const current = live.current.plan; if (!current) throw new Error("Scene plan is unavailable.");
            const next = attachSceneProofJob(current, binding, record, job); if (next !== current) await persist(next, current); }}
        />
        <label className="block text-sm text-fg-2">Review notes / requested change<textarea className="mt-1 w-full rounded-md border border-line bg-ink-0 p-2 text-fg-1" rows={2} value={note} maxLength={1000} onChange={e => setNote(e.target.value)} /></label>
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={saving || stale || sceneProofReviewStatus(plan, scene, context) === "missing"} className="rounded-md border border-accent px-3 py-2 text-sm text-accent"
            onClick={() => void action(async () => { await persist(reviewSceneProof(plan, scene.id, "approved", note, context)); })}>Approve this scene direction</Button>
          <Button type="button" disabled={saving || stale || !note.trim()} className="rounded-md border border-line px-3 py-2 text-sm text-fg-1"
            onClick={() => void action(async () => { await persist(reviewSceneProof(plan, scene.id, "revise", note, context)); })}>Request scene revision</Button>
        </div>
        <p className="text-xs text-fg-3">Inspect each full-quality image. Small previews do not establish likeness, motion quality, lip-sync or final-film approval.</p>
      </div> : null}
    </> : null}
  </Surface>;
}
