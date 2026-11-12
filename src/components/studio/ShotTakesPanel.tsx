"use client";
import { useMemo, useState } from "react";
import type { GeneratedStudioAsset } from "./generatedAssets";
import type { GeneratedDraftSelection } from "./generatedDraft";
import type { EditPlanPreviewSegment } from "./musicVideoProject";
import { listShotTakes, shotTakeTargetKey } from "./shotTakeReview";
import { LiveDraftTakeViewer } from "./panels/LiveDraftTakeViewer";
import { Button, Kicker } from "./ui";
import { ReviewVideoHover } from "./ReviewVideoHover";

export type ShotTakesPanelProps = { projectId: string; target: EditPlanPreviewSegment; assets: GeneratedStudioAsset[];
  draft: GeneratedDraftSelection | null; canEdit: boolean;
  onUse: (assetId: string, targetKey: string, revision: number) => void };

export function ShotTakesPanel({ projectId, target, assets, draft, canEdit, onUse }: ShotTakesPanelProps) {
  const key = shotTakeTargetKey(projectId, target);
  const [opened, setOpened] = useState<{ key: string; id: string } | null>(null), [limit, setLimit] = useState(12);
  const rows = useMemo(() => listShotTakes(target, assets, draft), [target, assets, draft]);
  return <section className="space-y-2" aria-label="Shot takes">
    <Kicker>Shot takes · {target.animaticShotId ?? target.label}</Kicker>
    <p className="text-xs text-fg-3">Versions for this exact shot · {target.musicStart.toFixed(2)}–{target.musicEnd.toFixed(2)}s. Inspecting keeps the cut unchanged. Use for this shot changes Draft selection; approval stays separate.</p>
    {!canEdit ? <p className="text-xs text-warn">Confirm the current Story before changing Draft selection.</p> : null}
    {!rows.length ? <p className="text-xs text-fg-3">No saved video takes match this shot&apos;s current plan and references.</p> : null}
    {rows.slice(0, limit).map(row => <div key={row.asset.id} className="space-y-2 border-b border-line py-2">
      <ReviewVideoHover videoUrl={row.playbackUrl} start={row.asset.trimStart ?? 0} end={(row.asset.trimStart ?? 0) + target.musicEnd - target.musicStart} hideChildrenWhenReady posterWhenVisible
        className="relative aspect-video w-full max-w-xs rounded-sm border border-line bg-ink-0 focus-visible:outline-2 focus-visible:outline-accent"
        buttonProps={{ type: "button", "aria-label": `Inspect take: ${row.asset.title ?? row.asset.id}`, onClick: () => setOpened({ key, id: row.asset.id }) }}>
        <span className="pointer-events-none absolute inset-x-0 top-2 text-center text-xs text-fg-3">Hover to preview · click to inspect</span>
      </ReviewVideoHover>
      <p className="text-xs text-fg-1">{row.asset.title ?? row.asset.id} · {row.selected ? "Selected in Draft" : "Available"} · {row.asset.reviewStatus ?? "pending"}</p>
      <div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => setOpened(opened?.key === key && opened.id === row.asset.id ? null : { key, id: row.asset.id })}>
        {opened?.key === key && opened.id === row.asset.id ? "Close take" : "Inspect take"}</Button>
        <Button size="sm" disabled={!canEdit || Boolean(row.block) || row.selected} reason={row.block}
          onClick={() => onUse(row.asset.id, key, draft?.planSignature === target.planSignature ? draft?.revision ?? 0 : 0)}>Use for this shot</Button></div>
      {row.block ? <p className="text-xs text-warn">{row.block}</p> : null}
      {opened?.key === key && opened.id === row.asset.id ? <LiveDraftTakeViewer key={`${key}:${row.asset.id}`} asset={row.asset} playbackUrl={row.playbackUrl} /> : null}
    </div>)}
    {rows.length > limit ? <Button size="sm" onClick={() => setLimit(n => n + 12)}>Show more shot takes</Button> : null}
  </section>;
}
