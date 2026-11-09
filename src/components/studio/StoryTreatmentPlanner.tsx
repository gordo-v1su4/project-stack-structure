"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { waitForTriggerRunOutput } from "@/lib/clientTriggerRuns";
import { assertStoryLoglineReview, isStoryReviewDeploymentError } from "@/lib/storyLoglineReview";
import type { StoryTreatmentTriggerResult } from "@/lib/triggerOrchestration";
import type { DeepgramTranscriptSummary } from "./deepgramUtils";
import type { MusicVideoProject } from "./musicVideoProject";
import { buildStoryCaptionClusters, storyValidationFeedback, hydrateTreatmentCoverage, parseGeneratedTreatments, type StoryGenerationMeta, type StoryTreatment, type StoryTreatmentRequest, type StoryTreatmentState } from "./storyTreatments";
import { assertStoryBibleConfirmation, describeStoryCoverage, buildStoryDraftCommit, createStoryRequestGuard, markStoryEdited, mergeStoryRevision, storyAuthoringInputSignature, validateStoryAuthoring } from "./storyAuthoring";
import { StoryTreatmentDialog } from "./StoryTreatmentDialog";
import { StoryBiblePanel } from "./StoryBiblePanel";
import { buildStoryBibleBinding } from "./storyBibleBinding";
import type { StoryBible } from "./storyBible";
import type { BeatJoinAnalysis } from "./types";
import type { ReferenceAsset } from "./referenceAssets";

type StoryTreatmentPlannerProps = {
  savedProjectId?: string | null;
  savedProjectRevision?: string | null;
  onPrepareStoryContext?: () => Promise<{ projectId: string; revision: string }>;
  referenceRevision?: string;
  referenceAssets?: ReferenceAsset[];
  analysis: BeatJoinAnalysis | null;
  transcriptSummary: DeepgramTranscriptSummary | null;
  project: MusicVideoProject;
  state: StoryTreatmentState;
  onChange: (patch: Partial<StoryTreatmentState>) => void;
  onConfirm: (treatment: StoryTreatment) => void;
  onInvalidateConfirmed: () => void;
};

type TreatmentApiPayload = {
  success?: boolean; runId?: string; model?: string; treatments?: StoryTreatment[]; meta?: StoryGenerationMeta; error?: string;
  loglineReview?: unknown;
};
const KIND_COPY = { faithful: "Faithful", bold: "Bold", wildcard: "Wildcard" } as const;

export function StoryTreatmentPlanner({ savedProjectId, savedProjectRevision, onPrepareStoryContext, referenceRevision, referenceAssets, analysis, transcriptSummary, project, state, onChange, onConfirm, onInvalidateConfirmed }: StoryTreatmentPlannerProps) {
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const [canonTreatmentId, setCanonTreatmentId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canGenerate = Boolean(analysis && analysis.duration > 0);
  const inspected = state.treatments.find(treatment => treatment.id === inspectedId) ?? (state.confirmedTreatmentSnapshot?.id === inspectedId ? state.confirmedTreatmentSnapshot : undefined);
  const confirmed = state.confirmedTreatmentSnapshot;
  const canonTreatment = state.treatments.find(treatment => treatment.id === canonTreatmentId)
    ?? state.treatments.find(treatment => treatment.id === state.selectedTreatmentId) ?? confirmed;
  const canonBinding = useMemo(() => {
    if (!savedProjectId || !canonTreatment) return null;
    try { return { binding: buildStoryBibleBinding({ projectId: savedProjectId, treatment: canonTreatment, referenceAssets: referenceAssets ?? [] }), error: null }; }
    catch (caught) { return { binding: null, error: caught instanceof Error ? caught.message : "Upload the named references before editing canon." }; }
  }, [savedProjectId, canonTreatment, referenceAssets]);
  const captionClusters = useMemo(() => buildStoryCaptionClusters(project.videoMoments), [project.videoMoments]);

  const requests = useRef(createStoryRequestGuard());
  const inputSignature = storyAuthoringInputSignature({ savedProjectId, referenceRevision, brief: state.brief, treatments: state.treatments, confirmed, analysis, transcriptSummary, moments: project.videoMoments });
  useEffect(() => { requests.current.invalidate(); }, [inputSignature]);
  useEffect(() => { const guard = requests.current; return () => guard.invalidate(); }, []);

  async function context(source = canonTreatment): Promise<StoryTreatmentRequest> {
    const saved = source?.storyBible && onPrepareStoryContext ? await onPrepareStoryContext()
      : savedProjectId && savedProjectRevision ? { projectId: savedProjectId, revision: savedProjectRevision } : null;
    if (source?.storyBible && (!saved || saved.projectId !== source.storyBible.binding.projectId)) throw new Error("Save and review this project's current canon before using it to develop the story.");
    return {
      ...(source?.storyBible ? { canonContext: { projectId: saved!.projectId, expectedRevision: saved!.revision, bible: source.storyBible } } : {}),
      brief: state.brief.text,
      song: { title: analysis?.sourceLabel, duration: analysis?.duration, sections: analysis?.sections ?? [], lyricSummary: transcriptSummary?.summary || undefined, lyricExcerpt: transcriptSummary?.transcript?.slice(0, 1200) || undefined },
      footage: { captionClusters, sourceCount: new Set(project.videoMoments.map(moment => moment.sourceClipId)).size, momentCount: project.videoMoments.length },
      constraints: ["Honor the user's chosen story. Keep missing shots visible instead of silently substituting similar-looking actions.", "Use a light visual spine appropriate to the song; do not force a disaster, relationship, or a fixed song form.", "Use the supplied music-section timing when timed lyrics are absent. Do not invent lyric text or claim footage exists when sourceCount is zero. Plan filmable narrative or performance shots; do not require lip-sync.", ...(referenceAssets ?? []).filter((asset) => asset.storageStatus === "uploaded").map((asset) => `Approved ${asset.role} reference: ${asset.displayName}. ${asset.promptHint || "Use this exact declared name for the subject or location."}`)],
    };
  }
  async function requestStory(body: StoryTreatmentRequest, requestIntentId: string): Promise<{ output: unknown; meta: StoryGenerationMeta }> {
    const response = await fetch("/api/story/treatments", { method: "POST", headers: { "content-type": "application/json", "x-story-request-id": requestIntentId }, body: JSON.stringify(body) });
    const payload = await response.json() as TreatmentApiPayload;
    if (!response.ok || payload.success === false) throw new Error(payload.error || `Story generation failed (${response.status}).`);
    if (response.status === 202 && payload.runId) {
      const result = await waitForTriggerRunOutput(payload.runId, { timeoutMs: 540000, pollIntervalMs: 2000 }) as StoryTreatmentTriggerResult;
      assertStoryLoglineReview(result.loglineReview);
      return { output: result.output, meta: { model: result.model || payload.model || "Qwen", generatedAt: new Date().toISOString(), inputTokens: result.usage?.prompt_tokens, outputTokens: result.usage?.completion_tokens } };
    }
    if (!payload.treatments || !payload.meta) throw new Error("Story generation returned an incomplete response.");
    assertStoryLoglineReview(payload.loglineReview);
    return { output: { treatments: payload.treatments }, meta: payload.meta };
  }
  async function generateTreatments() {
    if (!canGenerate || isGenerating) return;
    const token = requests.current.begin();
    const requestIntentId = crypto.randomUUID();
    setIsGenerating(true); setError(null);
    try {
      let lastError: unknown;
      let validationFeedback: string | undefined;
      const preparedContext = await context();
      if (!requests.current.isCurrent(token)) throw new Error("Story inputs changed while the canon was being saved. Develop the current story again.");
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const result = await requestStory({ ...preparedContext, validationAttempt: attempt, validationFeedback }, requestIntentId);
          if (!requests.current.isCurrent(token)) throw new Error("Story inputs changed while generation was running. The outdated reply was discarded.");
          const treatments = hydrateTreatmentCoverage(parseGeneratedTreatments(result.output), project.videoMoments).map(validateStoryAuthoring);
          const prefix = crypto.randomUUID();
          const namespaced = treatments.map(treatment => {
            const ids = new Map(treatment.anchors.map(anchor => [anchor.id, `${prefix}-${treatment.kind}-${anchor.id}`]));
            return { ...treatment, storyBible: canonTreatment?.storyBible, id: `${prefix}-${treatment.kind}`, anchors: treatment.anchors.map(anchor => ({ ...anchor, id: ids.get(anchor.id)!, causalDependencies: anchor.causalDependencies?.map(id => ids.get(id)!), requirements: anchor.requirements?.map(requirement => ({ ...requirement, id: `${prefix}-${requirement.id}`, momentId: ids.get(anchor.id)! })) })) };
          });
          // New options do not replace the confirmed story until the user chooses one.
          onChange({ treatments: namespaced, selectedTreatmentId: null, generationMeta: result.meta });
          return;
        } catch (caught) { if (!requests.current.isCurrent(token) || isStoryReviewDeploymentError(caught)) throw caught; lastError = caught; validationFeedback = storyValidationFeedback(caught); }
      }
      throw lastError;
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Story generation failed."); }
    finally { setIsGenerating(false); }
  }
  function saveTreatment(next: StoryTreatment, use = false) {
    let canConfirm = use;
    if (use && next.storyBible) {
      try { assertStoryBibleConfirmation(next, savedProjectId ? buildStoryBibleBinding({ projectId: savedProjectId, treatment: next, referenceAssets: referenceAssets ?? [] }) : null); }
      catch (caught) { setError(`Story saved as a draft. ${caught instanceof Error ? caught.message : "Review the current story canon first."}`); canConfirm = false; }
    }
    const { patch, invalidatesConfirmed } = buildStoryDraftCommit(state, next, canConfirm);
    if (invalidatesConfirmed) onInvalidateConfirmed();
    onChange(patch);
    if (canConfirm) onConfirm(next);
    setCanonTreatmentId(next.id);
    setInspectedId(null);
  }
  function saveBible(bible: StoryBible, options?: { bindingOnly?: boolean }) {
    if (!canonTreatment) return;
    requests.current.invalidate();
    const next = { ...canonTreatment, storyBible: bible };
    // Binding review follows an already reviewed revision; facts remain intact.
    // Authored fact changes still require story reconciliation.
    saveTreatment(options?.bindingOnly ? next : markStoryEdited(canonTreatment, next));
  }
  async function refine(treatment: StoryTreatment, instruction: string) {
    const token = requests.current.begin();
    const requestIntentId = crypto.randomUUID();
    let lastError: unknown;
    let validationFeedback: string | undefined;
    const preparedContext = await context(treatment);
    if (!requests.current.isCurrent(token)) throw new Error("Story inputs changed while the canon was being saved. Revise the current story again.");
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await requestStory({ ...preparedContext, revision: { treatment, instruction }, validationAttempt: attempt, validationFeedback }, requestIntentId);
        if (!requests.current.isCurrent(token)) throw new Error("Story inputs changed while the revision was running. The outdated reply was discarded.");
        return mergeStoryRevision(treatment, result.output, project.videoMoments);
      } catch (caught) { if (!requests.current.isCurrent(token) || isStoryReviewDeploymentError(caught)) throw caught; lastError = caught; validationFeedback = storyValidationFeedback(caught); }
    }
    throw lastError;
  }

  return <section className="rounded-md border border-line bg-ink-2 p-4">
    <div className="flex items-start justify-between gap-3"><div><h2 className="font-serif text-lg text-fg-0">Choose the story</h2><p className="mt-1 text-sm text-fg-3">Three directions, with room to make one your own.</p></div><span className="text-xs text-fg-3">{project.videoMoments.length} source moments</span></div>
    {confirmed ? <div className="mt-3 rounded-md border border-line-2 bg-ink-1 p-3"><p className="text-xs text-accent">Current story</p><p className="mt-1 text-sm font-medium text-fg-1">{confirmed.title}</p><p className="mt-1 text-xs text-fg-2">{confirmed.logline}</p><button type="button" onClick={() => { setCanonTreatmentId(confirmed.id); setInspectedId(confirmed.id); }} className="mt-2 text-sm text-accent">Read current story</button></div> : null}
    {canonTreatment && canonBinding?.binding ? <div className="mt-3"><p className="mb-2 text-xs text-fg-3">Canon for {canonTreatment.title}</p><StoryBiblePanel key={`${canonBinding.binding.projectId}:${canonBinding.binding.storySignature}:${canonBinding.binding.referenceSignature}`} binding={canonBinding.binding} treatment={canonTreatment} confirmedTreatment={confirmed} referenceAssets={referenceAssets ?? []} onChange={saveBible} disabled={isGenerating} /></div> : canonTreatment ? <p className="mt-3 text-xs text-fg-3">{canonBinding?.error || "Save the project to add its story canon."}</p> : null}
    <label className="mt-4 block text-sm text-fg-2">Story seed <span className="text-xs text-fg-3">· optional</span><textarea rows={2} value={state.brief.text} maxLength={4000} onChange={event => onChange({ brief: { text: event.target.value } })} placeholder="What should happen? A sentence or a short paragraph is enough." className="mt-2 w-full rounded-md border border-line bg-ink-1 px-3 py-2 text-sm text-fg-1 outline-none focus:border-accent" /></label>
    <div className="mt-2 flex justify-end"><button type="button" disabled={!canGenerate || isGenerating} onClick={() => void generateTreatments()} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-ink-0 disabled:opacity-40">{isGenerating ? "Developing three stories…" : state.treatments.length ? "Generate three new treatments" : "Generate three treatments"}</button></div>
    {!canGenerate ? <p className="mt-2 text-xs text-fg-3">Analyze the master song in Setup first.</p> : !project.videoMoments.length ? <p className="mt-2 text-xs text-fg-3">Plan from the song and references. The draft will keep every unfilmed shot visible for generation.</p> : null}
    {error ? <p role="alert" className="mt-3 rounded-md border border-line p-3 text-sm text-fg-1">{error} Your story seed has been preserved.</p> : null}
    {state.treatments.some(treatment => treatment.reconciliation?.status === "legacy") ? <p className="mt-3 text-sm text-fg-2">These saved options contain earlier summaries. Their loglines still need updating; generate new treatments or refine an option.</p> : null}
    <div className="mt-4 grid gap-3 xl:grid-cols-3">{state.treatments.map(treatment => <button key={treatment.id} type="button" onClick={() => { setCanonTreatmentId(treatment.id); setInspectedId(treatment.id); }} aria-label={`Read story: ${treatment.title}`} className={`rounded-md border p-4 text-left transition-colors hover:border-accent ${treatment.id === state.selectedTreatmentId ? "border-accent bg-accent-tint" : "border-line bg-ink-1"}`}><p className="text-xs text-accent">{KIND_COPY[treatment.kind]}</p><h3 className="mt-2 font-serif text-lg text-fg-0">{treatment.title}</h3>{treatment.reconciliation?.status === "legacy" ? <p className="mt-2 text-xs text-fg-3">Earlier summary · logline needs updating</p> : null}<p className="mt-2 text-sm leading-6 text-fg-1">{treatment.logline}</p><p className="mt-2 line-clamp-3 text-xs leading-5 text-fg-3">{treatment.synopsis}</p><p className="mt-3 text-xs text-fg-3">{treatment.reconciliation?.status === "legacy" || treatment.reconciliation?.status === "pending" ? "Assessment needs review" : describeStoryCoverage(treatment)}</p><span className="mt-3 block text-sm text-accent">Read story →</span></button>)}</div>
    {inspected ? <StoryTreatmentDialog key={inspected.id} treatment={inspected} moments={project.videoMoments} sections={project.storySections} cues={[...(analysis?.beats ?? []), ...(analysis?.onsets ?? [])]} duration={analysis?.duration} onSave={next => saveTreatment(next)} onUse={next => saveTreatment(next, true)} onRefine={refine} onClose={() => setInspectedId(null)} /> : null}
  </section>;
}
