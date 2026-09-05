"use client";

import { useMemo, useState } from "react";

import type { DeepgramTranscriptSummary } from "./deepgramUtils";
import type { MusicVideoProject } from "./musicVideoProject";
import {
  hydrateTreatmentCoverage,
  isStoryPlanConfirmable,
  rerankAnchorCoverage,
  selectedTreatment,
  type CoverageResolution,
  type StoryAnchor,
  type StoryGenerationMeta,
  type StoryTreatment,
  type StoryTreatmentState,
} from "./storyTreatments";
import type { BeatJoinAnalysis } from "./types";

type StoryTreatmentPlannerProps = {
  analysis: BeatJoinAnalysis | null;
  transcriptSummary: DeepgramTranscriptSummary | null;
  project: MusicVideoProject;
  state: StoryTreatmentState;
  onChange: (patch: Partial<StoryTreatmentState>) => void;
  onConfirm: (treatment: StoryTreatment) => void;
  onInvalidateConfirmed: () => void;
};

type TreatmentApiPayload = {
  success?: boolean;
  treatments?: StoryTreatment[];
  meta?: StoryGenerationMeta;
  error?: string;
};

const KIND_COPY = {
  faithful: { number: "01", label: "Faithful", detail: "Protects the user's causal story" },
  bold: { number: "02", label: "Architecture as antagonist", detail: "Lets the world test the dancers" },
  wildcard: { number: "03", label: "Late reversal", detail: "Pushes the final reveal or betrayal" },
} as const;

export function StoryTreatmentPlanner({ analysis, transcriptSummary, project, state, onChange, onConfirm, onInvalidateConfirmed }: StoryTreatmentPlannerProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = selectedTreatment(state.treatments, state.selectedTreatmentId);
  const confirmed = state.confirmedTreatmentSnapshot;
  const canGenerate = Boolean(analysis && project.videoMoments.length > 0);
  const coverage = selected ? summarizeCoverage(selected) : null;

  const captionClusters = useMemo(() => project.videoMoments
    .map((moment) => [
      moment.label,
      moment.caption,
      moment.captionMeta?.caption,
      moment.captionMeta?.action,
      moment.captionMeta?.setting,
      ...(moment.captionMeta?.subjects ?? []),
    ].filter(Boolean).join(" · "))
    .filter(Boolean)
    .slice(0, 80), [project.videoMoments]);

  async function generateTreatments() {
    if (!canGenerate || isGenerating) return;
    setIsGenerating(true);
    setError(null);
    try {
      const response = await fetch("/api/story/treatments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          brief: state.brief.text,
          song: {
            title: analysis?.sourceLabel,
            duration: analysis?.duration,
            sections: analysis?.sections ?? [],
            lyricSummary: transcriptSummary?.summary || undefined,
            lyricExcerpt: transcriptSummary?.transcript?.slice(0, 4_000) || undefined,
          },
          footage: {
            captionClusters,
            sourceCount: new Set(project.videoMoments.map((moment) => moment.sourceClipId)).size,
            momentCount: project.videoMoments.length,
          },
          constraints: [
            "Keep dance and performance at roughly 80-90 percent of screen time.",
            "Use a light narrative spine with concrete visual geography rather than dialogue-heavy plotting.",
            "Do not reveal a simulation or survival-game premise early unless the user brief explicitly asks for it.",
          ],
        }),
      });
      const payload = await readPayload(response);
      if (!response.ok || !payload.success || payload.treatments?.length !== 3 || !payload.meta) {
        throw new Error(payload.error || `Story generation failed (${response.status}).`);
      }
      const generationKey = Date.now().toString(36);
      const namespaced = payload.treatments.map((treatment) => ({
        ...treatment,
        id: `${generationKey}-${treatment.kind}`,
        anchors: treatment.anchors.map((anchor, index) => ({ ...anchor, id: `${generationKey}-${treatment.kind}-${index + 1}` })),
      }));
      onChange({
        treatments: hydrateTreatmentCoverage(namespaced, project.videoMoments),
        selectedTreatmentId: null,
        generationMeta: payload.meta,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Story generation failed.");
    } finally {
      setIsGenerating(false);
    }
  }

  function selectTreatment(treatmentId: string) {
    onChange({ selectedTreatmentId: treatmentId });
  }

  function updateAnchor(anchorId: string, patch: Partial<StoryAnchor>) {
    if (!selected) return;
    const treatments = state.treatments.map((treatment) => treatment.id === selected.id
      ? {
          ...treatment,
          anchors: treatment.anchors.map((anchor) => {
            if (anchor.id !== anchorId) return anchor;
            const next = { ...anchor, ...patch };
            const changesCoverage = patch.title !== undefined || patch.description !== undefined || patch.purpose !== undefined;
            return changesCoverage ? rerankAnchorCoverage(next, project.videoMoments) : next;
          }),
        }
      : treatment);
    const invalidatesConfirmedPlan = selected.id === state.confirmedTreatmentId;
    if (invalidatesConfirmedPlan) onInvalidateConfirmed();
    onChange({
      treatments,
      ...(invalidatesConfirmedPlan ? {
        confirmedTreatmentId: null,
        confirmedTreatmentSnapshot: null,
        storyContentSignature: null,
      } : {}),
    });
  }

  function setResolution(anchor: StoryAnchor, resolution: CoverageResolution, selectedCandidateId: string | null = null) {
    updateAnchor(anchor.id, { resolution, selectedCandidateId: resolution === "source" ? selectedCandidateId : null });
  }

  return (
    <section className="overflow-hidden rounded-[2px] border border-[#2a211b] bg-[#090807]">
      <div className="relative border-b border-[#2a211b] bg-[linear-gradient(115deg,#180d07_0%,#0a0908_56%,#07100d_100%)] px-4 py-4">
        <div className="pointer-events-none absolute inset-y-0 right-0 w-1/2 opacity-20 [background-image:linear-gradient(135deg,transparent_45%,#e05c00_46%,#e05c00_47%,transparent_48%)] [background-size:28px_28px]" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="text-[9px] uppercase tracking-[0.28em] text-[#e05c00]">Story decision · required before Split</div>
            <h2 className="mt-2 font-serif text-2xl leading-none text-[#e8e1d8]">Find the throughline before the floor gives way.</h2>
            <p className="mt-2 max-w-2xl text-[11px] leading-5 text-[#817970]">Describe the film in a paragraph. The director pass returns three distinct treatments, then checks every major beat against the footage you actually ingested.</p>
          </div>
          <div className="min-w-44 border-l border-[#49301f] pl-4 font-mono text-[9px] uppercase tracking-[0.14em] text-[#817970]">
            <div>{project.videoMoments.length} captioned moments</div>
            <div className="mt-1">3 treatments · 1 decision</div>
            <div className="mt-1 text-[#c9a27e]">Caption evidence only · local Qwen</div>
          </div>
        </div>
      </div>

      <div className="p-4">
        {confirmed ? (
          <div className="mb-4 grid gap-3 border border-[#24492f] bg-[#07110a] p-3 lg:grid-cols-[1fr_auto]">
            <div>
              <div className="text-[8px] uppercase tracking-[0.2em] text-[#63b078]">Confirmed story</div>
              <div className="mt-1 text-sm font-semibold text-[#d7e5d8]">{confirmed.title}</div>
              <div className="mt-1 text-[10px] leading-4 text-[#83a489]">{confirmed.logline}</div>
            </div>
            <div className="self-center font-mono text-[9px] uppercase text-[#63b078]">{confirmed.anchors.length}/{confirmed.anchors.length} anchors resolved</div>
          </div>
        ) : null}

        <label className="block">
          <span className="text-[9px] uppercase tracking-[0.18em] text-[#b99070]">Your story seed <span className="text-[#5d554e]">· optional</span></span>
          <textarea
            value={state.brief.text}
            onChange={(event) => onChange({ brief: { text: event.target.value } })}
            rows={5}
            maxLength={4_000}
            placeholder="What should happen? A sentence or a short paragraph is enough."
            className="mt-2 w-full resize-y border border-[#2b2723] bg-[#050505] px-3 py-3 text-[12px] leading-5 text-[#d2cbc3] outline-none transition-colors placeholder:text-[#4b4642] focus:border-[#e05c00]"
          />
        </label>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="text-[9px] leading-4 text-[#625c56]">Uses song structure, lyric summary, and scene captions. Raw audio and video stay in the media pipeline.</div>
          <button
            type="button"
            disabled={!canGenerate || isGenerating}
            onClick={() => void generateTreatments()}
            className="min-w-52 bg-[#e05c00] px-4 py-2.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-white hover:bg-[#c95200] disabled:cursor-not-allowed disabled:bg-[#27231f] disabled:text-[#6b625a]"
          >
            {isGenerating ? "Directing three treatments…" : state.treatments.length ? "Generate three new treatments" : "Generate three treatments"}
          </button>
        </div>
        {!canGenerate ? <div className="mt-2 text-[9px] text-[#a56845]">Finish song analysis and scene captions in Ingest first.</div> : null}
        {error ? <div role="alert" className="mt-3 border border-[#5a1f1a] bg-[#170807] px-3 py-2 text-[10px] text-[#df786d]">{error} Your brief has been preserved; retry when ready.</div> : null}

        {state.treatments.length ? (
          <div className="mt-5 grid gap-2 xl:grid-cols-3">
            {state.treatments.map((treatment) => {
              const copy = KIND_COPY[treatment.kind];
              const active = treatment.id === state.selectedTreatmentId;
              const stats = summarizeCoverage(treatment);
              return (
                <button
                  key={treatment.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => selectTreatment(treatment.id)}
                  className={`group relative min-h-72 overflow-hidden border p-4 text-left transition-colors ${active ? "border-[#e05c00] bg-[#160c06]" : "border-[#27231f] bg-[#070707] hover:border-[#6f4227]"}`}
                >
                  <div className="absolute right-3 top-1 font-serif text-6xl text-[#24201d] transition-colors group-hover:text-[#32251d]">{copy.number}</div>
                  <div className="relative">
                    <div className="text-[8px] uppercase tracking-[0.2em] text-[#e05c00]">{copy.label}</div>
                    <div className="mt-1 text-[8px] uppercase tracking-[0.12em] text-[#625a53]">{copy.detail}</div>
                    <h3 className="mt-5 max-w-[85%] font-serif text-xl leading-tight text-[#e5ddd4]">{treatment.title}</h3>
                    <p className="mt-3 text-[11px] leading-5 text-[#aaa097]">{treatment.logline}</p>
                    <p className="mt-3 line-clamp-4 text-[9px] leading-4 text-[#706962]">{treatment.synopsis}</p>
                    <div className="mt-4 grid grid-cols-3 gap-px bg-[#29231e] font-mono text-[8px] uppercase">
                      <Metric value={`${stats.resolved}/${treatment.anchors.length}`} label="auto-resolved" />
                      <Metric value={`${stats.missing}`} label="missing" />
                      <Metric value={`${Math.round(treatment.expectedReusePercent)}%`} label="reuse est." />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        ) : null}

        {selected && coverage ? (
          <div className="mt-5 border-t border-[#2a211b] pt-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="text-[8px] uppercase tracking-[0.2em] text-[#e05c00]">Anchor review · {selected.title}</div>
                <div className="mt-1 text-[11px] text-[#746c64]">Resolve each anchor with real footage, a planned generation, or an intentional omission.</div>
              </div>
              <div className="font-mono text-[9px] uppercase text-[#82766b]">{coverage.resolved}/{selected.anchors.length} resolved · {coverage.missing} missing</div>
            </div>

            <div className="mt-3 space-y-2">
              {selected.anchors.map((anchor, index) => (
                <AnchorEditor key={anchor.id} anchor={anchor} index={index} onUpdate={updateAnchor} onResolution={setResolution} />
              ))}
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#211d1a] pt-4">
              <div className="text-[9px] leading-4 text-[#645d57]">Confirmation writes these anchors into the song-section prompts. Generated gaps remain empty until the paid Generate stage.</div>
              <button
                type="button"
                disabled={!isStoryPlanConfirmable(selected)}
                onClick={() => onConfirm(selected)}
                className="min-w-48 border border-[#3f7a4c] bg-[#0d2614] px-4 py-2.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-[#82cf91] hover:bg-[#12351c] disabled:cursor-not-allowed disabled:border-[#2b2b2b] disabled:bg-[#151515] disabled:text-[#5d5d5d]"
              >
                {state.confirmedTreatmentId === selected.id ? "Story plan confirmed" : "Confirm story plan"}
              </button>
            </div>
          </div>
        ) : null}

        {state.generationMeta ? <div className="mt-3 text-right font-mono text-[8px] uppercase tracking-[0.1em] text-[#4e4945]">{state.generationMeta.model} · {new Date(state.generationMeta.generatedAt).toLocaleString()}</div> : null}
      </div>
    </section>
  );
}

function AnchorEditor({ anchor, index, onUpdate, onResolution }: {
  anchor: StoryAnchor;
  index: number;
  onUpdate: (anchorId: string, patch: Partial<StoryAnchor>) => void;
  onResolution: (anchor: StoryAnchor, resolution: CoverageResolution, selectedCandidateId?: string | null) => void;
}) {
  const tone = anchor.coverage === "covered"
    ? "border-[#24492f] text-[#6ebe7e]"
    : anchor.coverage === "weak"
      ? "border-[#5d4820] text-[#d4ad55]"
      : "border-[#5a241d] text-[#d76d60]";
  return (
    <article className="grid gap-3 border border-[#24211e] bg-[#060606] p-3 lg:grid-cols-[48px_minmax(0,1fr)_minmax(260px,0.75fr)]">
      <div className="font-serif text-3xl text-[#45372d]">{String(index + 1).padStart(2, "0")}</div>
      <div>
        <input
          value={anchor.title}
          maxLength={100}
          aria-label={`Anchor ${index + 1} title`}
          onChange={(event) => onUpdate(anchor.id, { title: event.target.value })}
          className="w-full border-0 bg-transparent text-[11px] font-semibold uppercase tracking-[0.1em] text-[#d5cdc5] outline-none focus:text-white"
        />
        <textarea
          value={anchor.description}
          maxLength={500}
          rows={3}
          aria-label={`Anchor ${index + 1} description`}
          onChange={(event) => onUpdate(anchor.id, { description: event.target.value })}
          className="mt-2 w-full resize-y border-l border-[#302a25] bg-transparent pl-3 text-[10px] leading-4 text-[#8d857d] outline-none focus:border-[#e05c00] focus:text-[#c8c0b8]"
        />
        <div className="mt-2 text-[8px] uppercase tracking-[0.12em] text-[#554f49]">Purpose · {anchor.purpose}</div>
      </div>
      <div>
        <div className="flex items-center justify-between gap-2">
          <span className={`border px-2 py-1 text-[8px] uppercase tracking-[0.14em] ${tone}`}>{anchor.coverage}</span>
          <span className="font-mono text-[8px] text-[#5a544f]">{anchor.candidates[0] ? `${Math.round(anchor.candidates[0].score * 100)}% top match` : "no honest match"}</span>
        </div>
        <select
          aria-label={`Anchor ${index + 1} footage candidate`}
          value={anchor.resolution === "source" ? anchor.selectedCandidateId ?? "" : ""}
          onChange={(event) => onResolution(anchor, event.target.value ? "source" : null, event.target.value || null)}
          className="mt-2 w-full border border-[#28231f] bg-[#0c0b0a] px-2 py-2 text-[9px] text-[#9f968e] outline-none focus:border-[#e05c00]"
        >
          <option value="">Choose existing footage…</option>
          {anchor.candidates.map((candidate) => <option key={candidate.momentId} value={candidate.momentId}>{Math.round(candidate.score * 100)}% · {candidate.label}</option>)}
        </select>
        <div className="mt-2 grid grid-cols-2 gap-1">
          <ResolutionButton active={anchor.resolution === "generate"} label="Plan generation" onClick={() => onResolution(anchor, "generate")} />
          <ResolutionButton active={anchor.resolution === "omit"} label="Omit anchor" onClick={() => onResolution(anchor, "omit")} />
        </div>
        <div className="mt-2 min-h-8 text-[8px] leading-4 text-[#59534e]">{anchor.resolution === "generate" ? "Queued as a story gap; no generation starts here." : anchor.resolution === "omit" ? "Narrative beat removed; performance footage may bridge this window." : anchor.candidates.find((candidate) => candidate.momentId === anchor.selectedCandidateId)?.reason ?? "Select a resolution to continue."}</div>
      </div>
    </article>
  );
}

function ResolutionButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`border px-2 py-2 text-[8px] uppercase tracking-[0.1em] ${active ? "border-[#e05c00] bg-[#190c05] text-[#e88749]" : "border-[#28231f] text-[#706860] hover:border-[#664028]"}`}>{label}</button>;
}

function Metric({ value, label }: { value: string; label: string }) {
  return <div className="bg-[#090807] px-2 py-2"><div className="text-[#c8b6a7]">{value}</div><div className="mt-1 text-[#514b46]">{label}</div></div>;
}

function summarizeCoverage(treatment: StoryTreatment) {
  const resolved = treatment.anchors.filter((anchor) => anchor.resolution !== null).length;
  const missing = treatment.anchors.filter((anchor) => anchor.coverage === "missing").length;
  return { resolved, missing };
}

async function readPayload(response: Response): Promise<TreatmentApiPayload> {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as TreatmentApiPayload;
  } catch {
    return { error: text.slice(0, 300) };
  }
}
