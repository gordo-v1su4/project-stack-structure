"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { AnimaticPreviewSnapshot } from "./animaticPreviewSnapshot";
import { animaticImage } from "./stillAnimatic";
import type { AnimaticShot } from "./stillAnimatic";
import type { H3StillImage } from "@/lib/h3StillJobStore";
import { stillMediaUrl } from "./h3StillClient";
import { AnimaticTimingCard, animaticShotColor } from "./AnimaticShotIdentity";
import { StillAnimaticPreview } from "./StillAnimaticPreview";
import { Button, Surface } from "./ui";

/** Images are mounted only near the scroll viewport, including after live updates. */
function ShotThumbnail({ shot, fps, image, selected, onSelect }: { shot: AnimaticShot; fps: number;
  image?: H3StillImage; selected: boolean; onSelect: () => void }) {
  const element = useRef<HTMLLIElement>(null), [visible, setVisible] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(entries => setVisible(entries[0].isIntersecting), { rootMargin: "120px" });
    if (element.current) observer.observe(element.current);
    return () => observer.disconnect();
  }, []);
  return <li ref={element} className="min-w-0"><button type="button" onClick={onSelect} aria-pressed={selected}
    className={`block w-full overflow-hidden rounded-md border text-left focus-visible:outline-2 focus-visible:outline-accent ${selected ? "border-accent" : "border-line"}`}>
    <div className="relative aspect-video overflow-hidden" style={{ backgroundColor: animaticShotColor(shot.id) }}>
      {image && visible ? <>
        {/* eslint-disable-next-line @next/next/no-img-element -- exact owned image; viewport-bounded thumbnails */}
        <img src={stillMediaUrl(image)} alt={`${shot.id}: ${shot.title}`} loading="lazy" decoding="async" className="h-full w-full object-contain" />
        <span className="absolute bottom-1 left-1 rounded-sm border-l-4 bg-ink-0/90 px-1.5 py-1 font-mono text-xs text-fg-0" style={{ borderLeftColor: animaticShotColor(shot.id) }}>{shot.id}</span>
      </> : <AnimaticTimingCard shot={shot} fps={fps} compact />}
    </div>
    <div className="space-y-1 p-2"><p className="truncate text-xs text-fg-1">{shot.title}</p>
      <p className="font-mono text-xs text-fg-3">{((shot.endFrame - shot.startFrame) / fps).toFixed(2)}s · {image ? "Image ready" : shot.record ? "Image requested" : "Timing card"}</p></div>
  </button></li>;
}

export function AnimaticPreviewPage({ projectId }: { projectId: string }) {
  const [snapshot, setSnapshot] = useState<AnimaticPreviewSnapshot | null>(null), [error, setError] = useState("");
  const [selected, setSelected] = useState(""), [preview, setPreview] = useState<"images" | "timing" | null>(null);
  useEffect(() => {
    let active = true, timer: ReturnType<typeof setTimeout>, revision = "", busy = false;
    const controller = new AbortController();
    async function refresh() {
      if (!active || busy || document.hidden) return;
      busy = true;
      try {
        const response = await fetch(`/api/studio/projects/${encodeURIComponent(projectId)}/preview`, {
          cache: "no-store", headers: revision ? { "if-none-match": revision } : {}, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) });
        if (response.status !== 304) {
          if (!response.ok) { if (response.status === 401 && active) { revision = ""; setSnapshot(null); } throw new Error(response.status === 401 ? "Sign in to view this project's preview." : "Preview updates could not be read. Retrying automatically."); }
          const next = await response.json() as AnimaticPreviewSnapshot;
          if (next.projectId !== projectId) throw new Error("The preview response belongs to another project.");
          if (active) { revision = next.revision; setSnapshot(next); }
        }
        if (active) setError("");
      } catch (failure) { if (active) setError((failure as Error).message); }
      finally { busy = false; if (active) timer = setTimeout(() => void refresh(), 10_000); }
    }
    function resume() { if (!document.hidden) { clearTimeout(timer); void refresh(); } }
    void refresh(); document.addEventListener("visibilitychange", resume);
    return () => { active = false; controller.abort(); clearTimeout(timer); document.removeEventListener("visibilitychange", resume); };
  }, [projectId]);
  const plan = snapshot?.plan, context = snapshot?.contextSha256 ?? "";
  const shot = plan?.shots.find(s => s.id === selected) ?? plan?.shots[0];
  const ready = plan?.shots.filter(s => animaticImage(plan, s, context)).length ?? 0;
  return <main className="min-h-screen bg-ink-0 px-3 py-6 text-fg-1 sm:px-6"><div className="mx-auto max-w-6xl space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><Link href="/" className="text-xs text-fg-3 hover:text-accent">Back to studio</Link>
      <h1 className="mt-3 font-display text-3xl text-fg-0">Preview</h1><p className="mt-1 text-sm text-fg-2">{snapshot?.name ?? "Loading project…"}</p></div>
      <p role="status" className="pt-3 font-mono text-xs text-fg-3">{plan ? `${ready}/${plan.shots.length} images` : "Waiting for the shot plan"}</p></header>
    <p className="max-w-2xl text-sm text-fg-3">Play the colored cards to feel the cuts. Images appear here as they finish, with the same shot numbers and labels.</p>
    {error ? <p role="alert" className="text-sm text-warn">{error}</p> : null}
    {plan && snapshot ? <>
      <div className="flex flex-wrap items-center gap-3"><Button variant="primary" disabled={!snapshot.audioUrl} onClick={() => setPreview("timing")}>Play timing</Button>
        <Button disabled={!snapshot.audioUrl} onClick={() => setPreview("images")}>Watch images</Button>
        <span className="text-xs text-fg-3">{snapshot.songLabel}</span></div>
      <Surface className="min-w-0 space-y-3" aria-label="Shot preview board"><h2 className="text-sm font-medium text-fg-0">Full-song still animatic</h2>
        <ol aria-label="Timed still shots" className="grid max-h-[55vh] grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-4 lg:grid-cols-6">
          {plan.shots.map(s => <ShotThumbnail key={s.id} shot={s} fps={plan.fps} image={animaticImage(plan, s, context)} selected={s.id === shot?.id} onSelect={() => setSelected(s.id)} />)}
        </ol>
      </Surface>
      {shot ? <details key={shot.id} className="rounded-md border border-line bg-ink-2 p-4"><summary className="cursor-pointer text-sm text-fg-1">{shot.id} · {shot.title} · shot details</summary>
        <p className="mt-3 font-mono text-xs text-fg-3">{shot.sceneId} · frames {shot.startFrame}–{shot.endFrame} · {(shot.startFrame / plan.fps).toFixed(2)}–{(shot.endFrame / plan.fps).toFixed(2)}s</p>
        <p className="mt-3 max-w-3xl text-sm text-fg-2">{shot.prompt}</p>
        <p className="mt-3 text-xs text-fg-3">{shot.referenceAssetIds.length} named references · {shot.sourceFrame ? "Retained source frame" : shot.proof ? "Image ready for review" : shot.record ? "Image requested" : "Timing planned"}</p>
      </details> : null}
      {preview ? <StillAnimaticPreview plan={plan} context={context} audioUrl={snapshot.audioUrl} initialView={preview} onClose={() => setPreview(null)} /> : null}
    </> : snapshot ? <Surface><p className="text-sm text-fg-2">Prepare a timed shot plan in Story. Its colored cards and images will appear here.</p></Surface> : null}
  </div></main>;
}
