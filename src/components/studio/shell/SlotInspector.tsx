"use client";

import { fmt } from "../math";
import { Button, Kicker } from "../ui";
import type { SlotEvidence } from "./spineSlots";

type SlotInspectorProps = {
  evidence: SlotEvidence;
  onClose: () => void;
  onPlayFrom: (seconds: number) => void;
  onSelectTake: (sectionId: string, momentId: string) => void;
  /** Send an approved generated shot back to review; the slot falls back to footage. */
  onReopenGenerated: (assetId: string) => void;
  onOpenGenerate: () => void;
};

/**
 * Evidence for the selected cut: what plays, why it was chosen, the lyric
 * under it, and the takes that could replace it. Actions are the same ones
 * Match and Generate expose — this is a faster door, not a new model.
 */
export function SlotInspector({ evidence, onClose, onPlayFrom, onSelectTake, onReopenGenerated, onOpenGenerate }: SlotInspectorProps) {
  const { slot, moment, caption, lyrics, match, takes, generated } = evidence;
  const alternates = takes.filter((take) => !take.selected);

  return (
    <section aria-label="Selected cut" className="rounded-[10px] border border-line bg-ink-0">
      <div className="relative aspect-video overflow-hidden rounded-t-[10px] bg-ink-2">
        {slot.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- object URLs and gateway thumbnails
          <img src={slot.thumbnailUrl} alt="" className="h-full w-full object-cover" />
        ) : null}
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-[linear-gradient(0deg,oklch(0_0_0/0.8),transparent)] p-3">
          <div className="min-w-0">
            <Kicker tone={slot.kind === "generated" ? "accent" : undefined}>{slot.kind === "generated" ? "Generated shot" : "Footage"} · {slot.sectionLabel}</Kicker>
            <p className="mt-1 truncate text-[13px] font-medium text-fg-0">{slot.label}</p>
          </div>
          <span className="shrink-0 font-mono text-[11px] text-fg-1">{fmt(slot.start)}–{fmt(slot.end)}</span>
        </div>
        <button type="button" onClick={onClose} aria-label="Deselect cut" className="studio-hud absolute right-2 top-2 rounded-md px-2 py-1 text-[11px] text-fg-1 hover:text-fg-0">
          Esc
        </button>
      </div>

      <div className="flex flex-col gap-4 p-4">
        <div className="flex gap-2">
          <Button variant="primary" size="md" onClick={() => onPlayFrom(slot.start)} className="flex-1">Play from here</Button>
          {generated ? (
            <Button variant="secondary" size="md" onClick={() => onReopenGenerated(generated.id)} title="Send this shot back to review; the slot returns to matched footage">Revert</Button>
          ) : (
            <Button variant="secondary" size="md" onClick={onOpenGenerate} title="Generate a replacement for this cut">Generate</Button>
          )}
        </div>

        {lyrics.length ? (
          <blockquote className="border-l-2 border-accent/60 pl-3 font-display text-[17px] italic leading-[1.3] text-fg-0">
            {lyrics.join(" ")}
          </blockquote>
        ) : null}

        {generated ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-[11px]">
            <dt className="text-fg-3">Model</dt><dd className="truncate text-fg-1">{generated.model}</dd>
            <dt className="text-fg-3">Provider</dt><dd className="text-fg-1">{generated.provider}</dd>
            {generated.prompt ? (<><dt className="text-fg-3">Prompt</dt><dd className="line-clamp-3 text-fg-2">{generated.prompt}</dd></>) : null}
          </dl>
        ) : null}

        {caption ? (
          <div>
            <Kicker>What the shot shows</Kicker>
            <p className="mt-1 text-[12.5px] leading-5 text-fg-2">{caption}</p>
          </div>
        ) : null}

        {match ? (
          <div>
            <div className="flex items-baseline justify-between">
              <Kicker>Why it was chosen</Kicker>
              <span className="font-mono text-[12px] text-fg-0">{Math.round(match.score * 100)}%</span>
            </div>
            <ul className="mt-1.5 flex flex-col gap-1">
              {[
                ["Lyric ↔ caption", match.lyricCaptionScore],
                ["Meaning", match.semanticScore],
                ["Action", match.actionIntentScore],
                ["Motion", match.motionContinuityScore],
                ["Length fit", match.durationFitScore],
              ].map(([label, value]) => (
                <li key={label as string} className="grid grid-cols-[92px_1fr_32px] items-center gap-2 text-[11px]">
                  <span className="text-fg-3">{label}</span>
                  <span className="h-[3px] overflow-hidden rounded-full bg-ink-3"><span className="block h-full rounded-full bg-fg-2" style={{ width: `${Math.round((value as number) * 100)}%` }} /></span>
                  <span className="text-right font-mono text-fg-2">{Math.round((value as number) * 100)}</span>
                </li>
              ))}
            </ul>
            {match.reasons.length ? <p className="mt-2 text-[11.5px] leading-5 text-fg-3">{match.reasons.slice(0, 2).join(" · ")}</p> : null}
          </div>
        ) : moment ? null : (
          <p className="text-[12px] leading-5 text-fg-3">No matched footage for this cut yet. Run Match, or generate a shot.</p>
        )}

        {alternates.length ? (
          <div>
            <Kicker>Other takes</Kicker>
            <ul className="mt-1.5 flex flex-col">
              {alternates.map((take) => (
                <li key={take.moment.id}>
                  <button
                    type="button"
                    onClick={() => onSelectTake(slot.sectionId, take.moment.id)}
                    className="flex w-full items-center gap-2.5 border-b border-line py-1.5 text-left last:border-b-0 hover:bg-ink-2"
                  >
                    {take.frameUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- gateway thumbnails
                      <img src={take.frameUrl} alt="" className="h-9 w-16 shrink-0 rounded-[4px] object-cover" />
                    ) : (
                      <span className="h-9 w-16 shrink-0 rounded-[4px] bg-ink-3" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] text-fg-1">{take.moment.label}</span>
                      <span className="block truncate text-[11px] text-fg-3">{take.reason}</span>
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-fg-2">{take.scorePercent}%</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}
