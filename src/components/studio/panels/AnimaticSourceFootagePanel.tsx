import { useState } from "react";
import { createSourceClipCandidate, sourceClipBinding } from "../sourceClipSelection";
import type { GeneratedStudioAsset } from "../generatedAssets";
import type { EditPlanPreviewSegment } from "../musicVideoProject";
import type { StillAnimaticPlan } from "../stillAnimatic";
import type { UploadedVideoSource } from "../types";
import { Button, Surface } from "../ui";

export function AnimaticSourceFootagePanel({ sources, segments, plan, onSelect }: {
  sources: UploadedVideoSource[]; segments: EditPlanPreviewSegment[]; plan?: StillAnimaticPlan;
  onSelect: (asset: GeneratedStudioAsset) => void;
}) {
  const [shotId, setShotId] = useState(""), [sourceId, setSourceId] = useState<number | null>(null);
  const [trim, setTrim] = useState<{ key: string; value: string } | null>(null);
  const [decoded, setDecoded] = useState<{ key: string; duration: number } | null>(null);
  const [error, setError] = useState("");
  const shots = segments.filter(segment => segment.animaticShotId);
  if (!shots.length) return null;
  const shot = shots.find(segment => segment.animaticShotId === shotId) ?? shots.find(segment => segment.animaticRetainedSource) ?? shots[0];
  const hint = plan?.shots.find(item => item.id === shot.animaticShotId)?.sourceFrame;
  const source = sources.find(item => item.id === sourceId) ?? sources.find(item => item.id === hint?.sourceId) ?? sources[0];
  const sourceKey = source ? sourceClipBinding(source) : "";
  const trimKey = `${sourceKey}:${shot.animaticMotion?.bindingSha256}:${shot.animaticMotion?.reviewBindingSha256}`;
  const trimValue = trim?.key === trimKey ? trim.value : "0", sourceStart = trimValue.trim() ? Number(trimValue) : NaN;
  const duration = decoded?.key === sourceKey ? decoded.duration : undefined;
  const durable = source?.storageStatus === "uploaded" && source.storageBucket && source.storagePath && !source.uploadChunks?.chunks.length;
  const url = durable ? `/api/storage/media?${new URLSearchParams({ bucket: source.storageBucket!, objectKey: source.storagePath! })}` : "";
  let blocked = "";
  if (!source) blocked = "Add existing footage in Setup to use it here.";
  else if (!shot.animaticMotion) blocked = "Review the complete current animatic before selecting footage.";
  else if (!durable) blocked = "This source needs a completed single-file upload before selection.";
  else if (!duration) blocked = "Load the source preview to check its duration.";
  else if (!Number.isFinite(sourceStart) || sourceStart < 0 || sourceStart + shot.musicEnd - shot.musicStart > duration + 1e-6) blocked = "Choose a source trim long enough for this complete shot.";
  return <Surface className="min-w-0 space-y-3" aria-label="Existing source footage for animatic">
    <h3 className="text-sm font-medium text-fg-0">Use existing source footage</h3>
    <p className="text-sm text-fg-3">Preview the action, choose its source in point, then review it in the assembled draft.</p>
    <div className="flex flex-wrap gap-3">
      <label className="min-w-0 text-xs text-fg-3">Animatic shot<select aria-label="Source footage animatic shot" value={shot.animaticShotId}
        onChange={event => { setShotId(event.target.value); setError(""); }} className="mt-1 block max-w-full rounded-md border border-line bg-ink-1 p-2 text-sm text-fg-1">
        {shots.map(item => <option key={item.animaticShotId} value={item.animaticShotId}>{item.label} · {(item.musicEnd - item.musicStart).toFixed(3)}s</option>)}
      </select></label>
      <label className="min-w-0 text-xs text-fg-3">Project source<select aria-label="Existing project source" value={source?.id ?? ""}
        onChange={event => { setSourceId(Number(event.target.value)); setError(""); }} className="mt-1 block max-w-full rounded-md border border-line bg-ink-1 p-2 text-sm text-fg-1">
        {!source ? <option value="">No source footage</option> : null}
        {sources.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
    </div>
    {hint ? <p className="text-xs text-fg-3">The still reference came from source {hint.sourceId + 1} at {hint.sourceSecond.toFixed(3)}s. Choose the actual motion trim below.</p> : null}
    {url ? <video key={sourceKey} src={url} controls preload="metadata" className="max-h-64 w-full rounded-md bg-ink-0"
      onLoadedMetadata={event => { const value = event.currentTarget.duration; setDecoded(Number.isFinite(value) && value > 0 ? { key: sourceKey, duration: value } : null); }}
      onError={() => { setDecoded(null); setError("The stored source could not be decoded. Selection is unavailable."); }} /> : null}
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-xs text-fg-3">Source in (seconds)<input aria-label="Source footage in" type="number" min={0} step="any" value={trimValue}
        onChange={event => { setTrim({ key: trimKey, value: event.target.value }); setError(""); }} className="mt-1 block w-32 rounded-md border border-line bg-ink-1 p-2 text-sm text-fg-1" /></label>
      <span className="font-mono text-xs text-fg-3">{duration ? `${duration.toFixed(3)}s browser duration` : "Duration unchecked"}{Number.isFinite(sourceStart) ? ` · Out ${(sourceStart + shot.musicEnd - shot.musicStart).toFixed(3)}s` : ""}</span>
      <Button type="button" disabled={Boolean(blocked)} reason={blocked} onClick={() => {
        setError(""); try { if (!source || !duration || blocked) throw new Error(blocked); onSelect(createSourceClipCandidate(source, shot, sourceStart, duration)); }
        catch (failure) { setError(failure instanceof Error ? failure.message : "The source selection could not be prepared."); }
      }}>Use source in this shot</Button>
    </div>
    {blocked ? <p className="text-xs text-fg-3">{blocked}</p> : null}
    {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
  </Surface>;
}
