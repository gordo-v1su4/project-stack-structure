import { useState } from "react";
import type { GeneratedStudioAsset } from "../generatedAssets";
import type { GeneratedDraftSelection } from "../generatedDraft";
import type { EditPlanPreviewSegment, MusicVideoProject } from "../musicVideoProject";
import { selectReusedTakePlacement } from "../reusedTakePlacements";

/** Existing bank and assembled-draft review remain the visual review surfaces; no extra player is mounted here. */
export function ReusedFootagePanel({ project, assets, segments, draft, onConfirm, onSelect }: {
  project: MusicVideoProject; assets: GeneratedStudioAsset[]; segments: EditPlanPreviewSegment[]; draft: GeneratedDraftSelection | null;
  onConfirm: () => Promise<void>; onSelect: (asset: GeneratedStudioAsset, segment: EditPlanPreviewSegment, sourceStart: number) => void;
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [windowIndex, setWindowIndex] = useState(0), [assetId, setAssetId] = useState("");
  const [trim, setTrim] = useState<{ key: string; value: string } | null>(null);
  if (!project.reuseSourceBaselines?.length) return null;
  const origins = project.generationScope?.body.reuseOrigins;
  const eligible = assets.filter(asset => origins?.some(origin => origin.assetId === asset.id));
  const resolvedWindowIndex = windowIndex >= 0 && windowIndex < segments.length ? windowIndex : 0;
  const segment = segments[resolvedWindowIndex], asset = eligible.find(asset => asset.id === assetId) ?? eligible[0];
  const trimKey = `${asset?.id}:${segment?.placementId}:${segment?.animaticMotion?.reviewBindingSha256 ?? ""}`;
  const trimValue = trim?.key === trimKey ? trim.value : String(asset?.trimStart ?? 0);
  const sourceStart = trimValue.trim() ? Number(trimValue) : NaN;
  let placementError: string | null = null;
  if (draft && segment && asset) {
    try { selectReusedTakePlacement(draft, project, asset, segment, sourceStart); }
    catch (failure) { placementError = failure instanceof Error ? failure.message : "This take cannot cover that window."; }
  }
  return <section className="rounded-md border border-line bg-ink-2 p-3 text-sm" aria-label="Reuse existing footage">
    <h3 className="font-medium">Reuse existing footage in this story</h3>
    {!origins ? <>
      <p className="mt-2 text-fg-3">Confirm your revised Story and Bible, then choose existing clips to use in it.</p>
      <button type="button" disabled={busy || Boolean(project.generationScope)} className="mt-2 rounded border border-line px-3 py-2" onClick={async () => {
        setBusy(true); setError(null);
        try { await onConfirm(); } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not confirm existing footage."); }
        finally { setBusy(false); }
      }}>{busy ? "Confirming…" : "Confirm revised story for existing footage"}</button>
    </> : <>
      <p className="mt-2 text-fg-3">{eligible.length} existing takes available. Choose the source trim and review its action against the current window. Animatic shots require full coverage; the original take and its identity evidence stay intact.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <label>Current window <select aria-label="Reuse story window" value={resolvedWindowIndex} onChange={event => { setWindowIndex(Number(event.target.value)); setError(null); }}>
          {segments.map((segment, index) => <option key={`${segment.placementId}:${index}`} value={index}>{segment.musicStart.toFixed(2)}–{segment.musicEnd.toFixed(2)}s · {segment.label}</option>)}
        </select></label>
        <label>Original take <select aria-label="Reuse original take" value={asset?.id ?? ""} onChange={event => { setAssetId(event.target.value); setError(null); }}>
          {eligible.map(asset => <option key={asset.id} value={asset.id}>{asset.title ?? asset.id}</option>)}
        </select></label>
        <label>Source in (seconds) <input aria-label="Reuse source in" type="number" step="any" min={asset?.trimStart ?? 0}
          value={trimValue} onChange={event => { setTrim({ key: trimKey, value: event.target.value }); setError(null); }}
          className="w-28 rounded border border-line bg-ink-1 px-2 py-1" /></label>
        {segment && Number.isFinite(sourceStart) ? <span className="self-center font-mono text-xs text-fg-3">Source {sourceStart.toFixed(3)}–{(sourceStart + segment.musicEnd - segment.musicStart).toFixed(3)}s</span> : null}
        <button type="button" disabled={!draft || !asset || !segment || Boolean(placementError)} className="rounded border border-line px-3 py-2" onClick={() => {
          setError(null);
          try { onSelect(asset!, segment!, sourceStart); } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not place this take."); }
        }}>Use take in this window</button>
      </div>
      {placementError ? <p className="mt-2 text-fg-3">{placementError}</p> : null}
      <p className="mt-2 text-fg-3">{draft?.reusedTakePlacements?.length ?? 0} current reuse placements. Use Review assembled draft and Use this draft after filling remaining windows.</p>
    </>}
    {error ? <p role="alert" className="mt-2 text-danger">{error}</p> : null}
  </section>;
}
