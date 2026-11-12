"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { reconcilePreviewSnapshot, type AnimaticPreviewSnapshot } from "./animaticPreviewSnapshot";
import { animaticImage } from "./stillAnimatic";
import { AnimaticShotThumbnail } from "./AnimaticShotThumbnail";
import { StillAnimaticPreview } from "./StillAnimaticPreview";
import { AnimaticImageViewer } from "./AnimaticImageViewer";
import { AnimaticReviewPanel } from "./AnimaticReviewPanel";
import { Button, Surface } from "./ui";
import { readReviewPreviewContext, studioReviewHref, type ReviewStage } from "./reviewPreviewContext";
import { selectSongRange, type SongRange, type SongSelection } from "./reviewSelection";
import { ReviewPreparationPanel } from "./ReviewPreparationPanel";

const CutReviewPlayer = dynamic(() => import("./CutReviewPlayer").then(module => module.CutReviewPlayer), {
  ssr: false, loading: () => <p className="py-8 text-sm text-fg-3">Loading cut player…</p>,
});
const ProjectRenderQueue = dynamic(() => import("./ProjectRenderQueue").then(module => module.ProjectRenderQueue), { ssr: false });
const ReplacementReviewPanel = dynamic(() => import("./ReplacementReviewPanel").then(module => module.ReplacementReviewPanel), { ssr: false });

export function AnimaticPreviewPage({ projectId }: { projectId: string }) {
  const [loadedSnapshot, setSnapshot] = useState<AnimaticPreviewSnapshot | null>(null), [error, setError] = useState("");
  const snapshot = loadedSnapshot?.projectId === projectId ? loadedSnapshot : null;
  const [selected, setSelected] = useState(""), [preview, setPreview] = useState<"images" | "timing" | null>(null);
  const [imageOpen, setImageOpen] = useState(false), [arrivals, setArrivals] = useState<string[]>([]);
  const [checked, setChecked] = useState("");
  const [mode, setMode] = useState<"video" | "images" | "timing">("video");
  const [selection, setSelection] = useState<SongSelection | null>(null), [multiSelect, setMultiSelect] = useState(false);
  const [initialRanges, setInitialRanges] = useState<SongRange[]>([]);
  const [viewport, setViewport] = useState<SongRange | null>(null), [initialViewport, setInitialViewport] = useState<SongRange | null>(null);
  const [returnStage, setReturnStage] = useState<ReviewStage>("story");
  const [watch, setWatch] = useState<{ nonce: number; ranges: SongRange[] } | null>(null);
  const knownImages = useRef<Map<string, string> | null>(null);
  const knownVideos = useRef<Set<string> | null>(null);
  const [videoArrivals, setVideoArrivals] = useState<string[]>([]);
  useEffect(() => {
    const incoming = readReviewPreviewContext(window.location.search);
    setReturnStage(new URLSearchParams(window.location.search).get("stage") === "draft" ? "draft" : "story");
    setSelected(incoming.shotId ?? ""); setInitialRanges(incoming.ranges);
    setViewport(incoming.viewport ?? null); setInitialViewport(incoming.viewport ?? null);
    setSelection(incoming.ranges.length ? { ranges: incoming.ranges, anchor: incoming.ranges[0] } : null);
    setSnapshot(null); knownImages.current = null; setArrivals([]); setImageOpen(false); setWatch(null); setPreview(null);
    knownVideos.current = null; setVideoArrivals([]); setMode("video");
    let active = true, timer: ReturnType<typeof setTimeout>, revision = "", busy = false;
    const controller = new AbortController();
    async function refresh() {
      if (!active || busy || document.hidden) return;
      busy = true;
      try {
        const response = await fetch(`/api/studio/projects/${encodeURIComponent(projectId)}/preview`, {
          cache: "no-store", headers: revision ? { "if-none-match": revision } : {}, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) });
        if (response.status !== 304) {
          if (!response.ok) { if ([401, 403, 404].includes(response.status) && active) { revision = ""; setSnapshot(null); } throw new Error(response.status === 401 ? "Sign in to view this project's preview." : "Preview updates could not be read. Retrying automatically."); }
          const next = await response.json() as AnimaticPreviewSnapshot;
          if (next.projectId !== projectId) throw new Error("The preview response belongs to another project.");
          if (active) {
            const images = new Map<string, string>();
            for (const shot of next.plan?.shots ?? []) {
              const image = animaticImage(next.plan!, shot, next.contextSha256);
              if (image) images.set(shot.id, image.sha256);
            }
            if (knownImages.current) {
              const arrived = [...images].filter(([id, sha]) => knownImages.current!.get(id) !== sha).map(([id]) => id);
              if (arrived.length) setArrivals(arrived);
            }
            knownImages.current = images; revision = next.revision;
            const coverage = next.cut?.coverage ?? [];
            if (knownVideos.current) {
              const arrived = coverage.filter(row => row.availableTakeIds.some(id => !knownVideos.current!.has(id))).map(row => row.shotId);
              if (arrived.length) setVideoArrivals(arrived);
            }
            knownVideos.current = new Set(coverage.flatMap(row => row.availableTakeIds));
            setSnapshot(current => reconcilePreviewSnapshot(current, next));
          }
        }
        if (active) { setError(""); setChecked(new Date().toLocaleTimeString()); }
      } catch (failure) { if (active) setError((failure as Error).message); }
      finally { busy = false; if (active) timer = setTimeout(() => void refresh(), 10_000); }
    }
    function resume() { if (!document.hidden) { clearTimeout(timer); void refresh(); } }
    void refresh(); document.addEventListener("visibilitychange", resume);
    return () => { active = false; controller.abort(); clearTimeout(timer); document.removeEventListener("visibilitychange", resume); };
  }, [projectId]);
  const plan = snapshot?.plan, context = snapshot?.contextSha256 ?? "";
  const shot = plan?.shots.find(s => s.id === selected) ?? plan?.shots[0];
  const currentImages = useMemo(() => new Map(plan?.shots.map(s => [s.id, animaticImage(plan, s, context)]) ?? []), [plan, context]);
  const ready = [...currentImages.values()].filter(Boolean).length;
  const position = shot && plan ? plan.shots.indexOf(shot) : 0;
  const requested = plan?.shots.filter(s => s.record && !currentImages.get(s.id)).map(s => s.id) ?? [];
  return <main className="min-h-screen bg-ink-0 px-3 py-6 text-fg-1 sm:px-6"><div className="mx-auto max-w-6xl space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><Link href={studioReviewHref(projectId, { stage: returnStage, shotId: selected, ranges: selection?.ranges, viewport })} className="text-xs text-fg-3 hover:text-accent">Back to studio</Link>
      <h1 className="mt-3 font-display text-3xl text-fg-0">Preview</h1><p className="mt-1 text-sm text-fg-2">{snapshot?.name ?? "Loading project…"}</p></div>
      <p role="status" className="pt-3 font-mono text-xs text-fg-3">{plan ? `${ready}/${plan.shots.length} images` : "Waiting for the shot plan"}</p></header>
    <p className="max-w-3xl text-sm text-fg-3">Review the current video cut with the master song. Missing video stays labeled as a still or timing gap; completed media is separate from cut approval.</p>
    {checked ? <p className="text-xs text-fg-3">Live · Checked {checked}{requested.length ? ` · Requested: ${requested.join(", ")}` : ""}</p> : null}
    {arrivals.length ? <p role="status" className="text-sm text-accent">New images: {arrivals.join(", ")}</p> : null}
    {videoArrivals.length ? <p role="status" className="text-sm text-accent">New video takes ready for review: {videoArrivals.join(", ")} · selection unchanged</p> : null}
    {error ? <p role="alert" className="text-sm text-warn">{error}</p> : null}
    {snapshot?.reviewSources ? <ReviewPreparationPanel key={`preparation:${projectId}`} projectId={projectId} sources={snapshot.reviewSources} /> : null}
    {snapshot ? <div className="flex flex-wrap items-center gap-2" aria-label="Preview modes">
      <Button aria-pressed={mode === "video"} onClick={() => { setMode("video"); setWatch(null); setPreview(null); }}>Current video cut</Button>
      <Button aria-pressed={mode === "images"} disabled={!plan || !snapshot.audioUrl} onClick={() => { setMode("images"); setPreview("images"); }}>Watch images</Button>
      <Button aria-pressed={mode === "timing"} disabled={!plan || !snapshot.audioUrl} onClick={() => { setMode("timing"); setPreview("timing"); }}>Play timing</Button>
    </div> : null}
    {mode === "video" && snapshot?.cut ? <Surface className="space-y-2" aria-label="Current cut review">
      <p className="text-xs text-fg-3">{snapshot.cut.selectedVideoCount}/{snapshot.cut.segments.length} windows have selected video · {snapshot.cut.availableVideoCount} current video takes available</p>
      <div className="mx-auto max-w-4xl"><CutReviewPlayer key={`${projectId}:${watch?.nonce ?? "current"}`} segments={snapshot.cut.segments} audioUrl={snapshot.audioUrl}
        plan={plan} context={context} initialRanges={watch?.ranges ?? initialRanges} autoPlay={Boolean(watch)}
        analysis={snapshot.analysis} focusedShotId={selected} onFocusShot={setSelected} initialViewport={initialViewport} onViewportChange={setViewport}
        selection={selection} onSelectionChange={setSelection} multiSelect={multiSelect} onMultiSelect={() => setMultiSelect(value => !value)} /></div>
    </Surface> : null}
    {snapshot?.cut?.targets ? <ReplacementReviewPanel key={`replacement:${projectId}`} projectId={projectId} targets={snapshot.cut.targets} ranges={selection?.ranges ?? []} /> : null}
    {snapshot ? <ProjectRenderQueue key={`queue:${projectId}`} projectId={projectId} revision={snapshot.revision} shotIds={plan?.shots.map(s => s.id) ?? []}
      onInspectShot={id => { setSelected(id); setImageOpen(true); }} /> : null}
    {snapshot?.cut?.coverage?.length ? <details className="rounded-md border border-line p-3">
      <summary className="cursor-pointer text-sm text-fg-2">Current shot coverage · ready, selected and approved</summary>
      <p className="my-2 text-xs text-fg-3">Ready counts current delivered takes. Selection controls this viewing cut. Take approval requires current evidence; scene direction and exact-cut consent are separate reviews in Story and Draft.</p>
      <div className="max-h-72 overflow-auto"><table className="w-full text-left text-xs" aria-label="Current shot coverage">
        <thead><tr><th className="p-2">Shot</th><th className="p-2">Ready takes</th><th className="p-2">Selected windows</th><th className="p-2">Approved takes</th></tr></thead>
        <tbody>{snapshot.cut.coverage.map(row => <tr key={row.shotId} className="border-t border-line">
          <th className="p-2"><button className="text-accent hover:underline" onClick={() => { setSelected(row.shotId); setImageOpen(true); }}>{row.shotId}</button></th>
          <td className="p-2">{row.availableTakeIds.length}</td><td className="p-2">{row.selectedVideoCount}</td><td className="p-2">{row.approvedTakeCount}</td>
        </tr>)}</tbody>
      </table></div>
    </details> : null}
    {plan && snapshot ? <>
      <details className="rounded-md border border-line p-3"><summary className="cursor-pointer text-sm text-fg-2">Still direction review</summary>
        <AnimaticReviewPanel snapshot={snapshot} onSaved={(revision, review, expectedRevision) => setSnapshot(current =>
          current?.revision === expectedRevision && current.plan ? { ...current, revision, plan: { ...current.plan, review } } : current)} />
      </details>
      <Surface className="min-w-0 space-y-3" aria-label="Shot preview board"><h2 className="text-sm font-medium text-fg-0">Full-song still animatic</h2>
        <ol aria-label="Timed still shots" className="grid max-h-[55vh] grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-4 lg:grid-cols-6">
          {plan.shots.map(s => <AnimaticShotThumbnail key={s.id} shot={s} fps={plan.fps} image={currentImages.get(s.id)}
            selected={Boolean(selection?.ranges.some(r => r.end > s.startFrame / plan.fps && r.start < s.endFrame / plan.fps))}
            onSelect={event => {
              setSelected(s.id); setSelection(previous => selectSongRange(previous, { start: s.startFrame / plan.fps, end: s.endFrame / plan.fps },
                { extend: event.shiftKey, toggle: event.ctrlKey || event.metaKey || multiSelect }));
              if (!event.shiftKey && !event.ctrlKey && !event.metaKey && !multiSelect) setImageOpen(true);
            }} />)}
        </ol>
      </Surface>
      {shot && snapshot.cut ? <div className="flex flex-wrap items-center gap-3"><span className="font-mono text-xs text-fg-2">{shot.id} · {shot.title}</span>
        <Button disabled={!snapshot.audioUrl} onClick={() => { setImageOpen(false); setPreview(null); setMode("video");
          setWatch(previous => ({ nonce: (previous?.nonce ?? 0) + 1, ranges: [{ start: shot.startFrame / plan.fps, end: shot.endFrame / plan.fps }] })); }}>Watch this shot</Button></div> : null}
      {shot ? <details key={shot.id} className="rounded-md border border-line bg-ink-2 p-4"><summary className="cursor-pointer text-sm text-fg-1">{shot.id} · {shot.title} · shot details</summary>
        <p className="mt-3 font-mono text-xs text-fg-3">{shot.sceneId} · frames {shot.startFrame}–{shot.endFrame} · {(shot.startFrame / plan.fps).toFixed(2)}–{(shot.endFrame / plan.fps).toFixed(2)}s</p>
        <p className="mt-3 max-w-3xl text-sm text-fg-2">{shot.prompt}</p>
        <p className="mt-3 text-xs text-fg-3">{shot.referenceAssetIds.length} named references · {shot.sourceFrame ? "Retained source frame" : shot.proof ? "Image ready for review" : shot.record ? "Image requested" : "Timing planned"}</p>
      </details> : null}
      {preview ? <StillAnimaticPreview plan={plan} context={context} audioUrl={snapshot.audioUrl} initialView={preview} onClose={() => setPreview(null)} /> : null}
      {imageOpen && shot ? <AnimaticImageViewer shot={shot} image={animaticImage(plan, shot, context)} fps={plan.fps} position={position} count={plan.shots.length}
        onPrevious={() => setSelected(plan.shots[Math.max(0, position - 1)].id)} onNext={() => setSelected(plan.shots[Math.min(plan.shots.length - 1, position + 1)].id)} onClose={() => setImageOpen(false)} /> : null}
    </> : snapshot ? <Surface><p className="text-sm text-fg-2">Prepare a timed shot plan in Story. Its colored cards and images will appear here.</p></Surface> : null}
  </div></main>;
}
