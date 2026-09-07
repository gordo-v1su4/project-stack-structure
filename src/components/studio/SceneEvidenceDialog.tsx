"use client";

import { useEffect, useId, useRef, useState } from "react";
import { sceneEvidenceInput, type MediaObservation } from "./mediaEvidence";
import { initialSceneEvidenceReview, type SceneEvidenceReview } from "./sceneEvidenceReview";
import type { DetectedSceneSegment, UploadedVideoSource } from "./types";
import { Button } from "./ui";

const field = "mt-1 w-full rounded-md border border-line bg-ink-1 px-3 py-2 text-sm text-fg-1 outline-none focus:border-accent";
const lines = (value: string) => value.split("\n").map(line => line.trim()).filter(Boolean);

export function SceneEvidenceDialog({ source, scene, onSave, onClose }: {
  source: UploadedVideoSource;
  scene: DetectedSceneSegment;
  onSave: (review: SceneEvidenceReview) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  const [draft, setDraft] = useState(() => initialSceneEvidenceReview(scene));
  const [videoError, setVideoError] = useState(false);
  const temporal = sceneEvidenceInput(scene, scene.start).kind === "ordered-frames";
  useEffect(() => {
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.showModal();
    return () => { returnFocus?.focus(); };
  }, []);
  function updateObservation(patch: Partial<MediaObservation>) {
    setDraft(current => ({ ...current, observation: { ...current.observation, ...patch } }));
  }
  const frames = [
    ["First", scene.firstFrameUrl ?? scene.thumbnailUrl],
    ["Middle", scene.middleFrameUrl],
    ["Last", scene.lastFrameUrl],
  ].filter((frame): frame is [string, string] => Boolean(frame[1]));
  return <dialog ref={dialog} aria-labelledby={heading} onCancel={onClose}
    className="m-auto max-h-[90dvh] w-[min(880px,94vw)] overflow-y-auto rounded-md border border-line-2 bg-ink-2 p-5 text-fg-1 backdrop:bg-ink-0/80">
    <form onSubmit={event => { event.preventDefault(); onSave(draft); }}>
      <div className="flex items-start justify-between gap-3">
        <div><h2 id={heading} className="text-lg font-medium">Review scene observations</h2>
          <p className="mt-1 break-all text-xs text-fg-3">{source.name} · Cut {scene.id + 1} · {scene.start.toFixed(2)}–{scene.end.toFixed(2)} s</p></div>
        <Button type="button" onClick={onClose}>Cancel</Button>
      </div>
      <video controls preload="metadata" playsInline aria-label="Scene interval preview" src={source.videoUrl}
        className="mt-4 max-h-72 w-full rounded-md bg-ink-0" onError={() => setVideoError(true)}
        onLoadedMetadata={event => { event.currentTarget.currentTime = scene.start; }}
        onPlay={event => { const video = event.currentTarget; if (video.currentTime < scene.start || video.currentTime >= scene.end) video.currentTime = scene.start; }}
        onSeeking={event => { const video = event.currentTarget; if (video.currentTime < scene.start) video.currentTime = scene.start; else if (video.currentTime > scene.end) video.currentTime = scene.end; }}
        onTimeUpdate={event => { const video = event.currentTarget; if (video.currentTime >= scene.end && !video.paused) { video.pause(); video.currentTime = scene.start; } }} />
      {videoError ? <p role="status" className="mt-2 text-sm text-warn">The video could not load. Review the frames below; leave motion uncertain when they do not establish it.</p> : null}
      {frames.length ? <div className="mt-2 grid grid-cols-3 gap-2">{frames.map(([label, url]) => <figure key={label}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={`${label} frame of cut ${scene.id + 1}`} className="aspect-video w-full rounded-sm object-contain bg-ink-0" />
        <figcaption className="mt-1 text-xs text-fg-3">{label}</figcaption>
      </figure>)}</div> : null}
      <p className="my-4 text-sm leading-6 text-fg-2">Describe only what this interval shows. Leave uncertain details blank. Structured fields start blank until manually reviewed; the original caption and evidence stay in the review history.</p>
      <label className="block text-sm text-fg-2">Caption<textarea required rows={3} maxLength={4000} className={field} value={draft.caption} onChange={event => setDraft(current => ({ ...current, caption: event.target.value }))} /></label>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {(["focal", "background"] as const).map(role => <label key={role} className="text-sm text-fg-2">{role === "focal" ? "Recognizable focal subjects" : "Recognizable background subjects"} (one name per line)
          <textarea rows={2} maxLength={500} className={field} defaultValue={draft.observation.subjects.filter(subject => subject.role === role && subject.confidence === "supported").map(subject => subject.name).filter(Boolean).join("\n")}
            onChange={event => updateObservation({ subjects: [...draft.observation.subjects.filter(subject => subject.role !== role), ...lines(event.target.value).map(name => ({ name, role, confidence: "supported" as const }))] })} />
        </label>)}
        <label className="text-sm text-fg-2">Number of focal subjects<input type="number" min={0} max={100} step={1} className={field} value={draft.observation.focalSubjectCount ?? ""} onChange={event => updateObservation({ focalSubjectCount: event.target.value === "" ? null : Number(event.target.value) })} /></label>
        {([ ["interaction", "Visible interaction"], ["shotScale", "Shot scale"], ["location", "Visible setting"] ] as const).map(([key, label]) => <label key={key} className="text-sm text-fg-2">{label}<input maxLength={500} className={field} value={draft.observation[key] ?? ""} onChange={event => updateObservation({ [key]: event.target.value || null })} /></label>)}
        {([ ["actions", "Visible actions"], ["physicalState", "Physical state / damage"], ["transitions", "Change across ordered frames"], ["unknowns", "Uncertain or unshown details"] ] as const).map(([key, label]) => <label key={key} className="text-sm text-fg-2">{label} (one per line)
          <textarea rows={2} maxLength={2000} className={field} disabled={key === "transitions" && !temporal} defaultValue={draft.observation[key].join("\n")} onChange={event => updateObservation({ [key]: lines(event.target.value) })} />
          {key === "transitions" && !temporal ? <span className="text-xs text-fg-3">Ordered frame times are unavailable; temporal changes remain unverified.</span> : null}
        </label>)}
      </div>
      {scene.captionHistory?.length ? <details className="mt-4 text-sm text-fg-3"><summary className="cursor-pointer">Earlier captions ({scene.captionHistory.length})</summary><ol className="mt-2 space-y-2">{scene.captionHistory.map((entry, index) => <li key={index} className="rounded-md border border-line p-2"><span className="text-xs">{entry.source ?? "Earlier caption"}</span><p className="whitespace-pre-wrap">{entry.caption}</p></li>)}</ol></details> : null}
      <p className="mt-4 text-xs text-fg-3">Saving requires the story and its affected footage choices to be reviewed again before preview or export.</p>
      <div className="mt-4 flex justify-end gap-2"><Button type="button" onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" disabled={!draft.caption.trim()}>Save observations</Button></div>
    </form>
  </dialog>;
}
