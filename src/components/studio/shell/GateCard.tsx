"use client";

import { NAV } from "../constants";
import type { PipelineStage } from "../studioPipeline";
import type { Tab } from "../types";
import { Button, Kicker } from "../ui";
import { ACT_ICONS, CheckIcon, LockIcon } from "./icons";

type GateCardProps = {
  tab: Tab;
  stages: PipelineStage[];
  reason: string | null;
  /** The act that unblocks this one, when the model knows it. */
  prerequisite: { tab: Tab; label: string } | null;
  onSelectTab: (tab: Tab) => void;
};

/**
 * A blocked act is not an empty room. The gate card names what is missing,
 * offers the one door that opens it, and lays the whole pipeline out so the
 * user can see how far the cut has come.
 */
export function GateCard({ tab, stages, reason, prerequisite, onSelectTab }: GateCardProps) {
  const stagesByKey = new Map(stages.map((stage) => [stage.key, stage]));
  const current = NAV.findIndex((item) => item.key === tab);

  return (
    <div className="grid h-full min-h-0 gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <section className="rounded-[10px] border border-line bg-ink-1 p-6">
        <Kicker tone="waiting">{prerequisite ? `Waiting on ${prerequisite.label}` : "Not ready yet"}</Kicker>
        <p className="mt-3 max-w-[30ch] font-display text-[28px] leading-[1.05] text-fg-0 [text-wrap:balance]">
          {reason ?? "This act opens once the acts before it are complete."}
        </p>
        {prerequisite ? (
          <Button variant="primary" size="lg" className="mt-6" onClick={() => onSelectTab(prerequisite.tab)} align="between">
            <span>Open {prerequisite.label}</span>
            <span aria-hidden>→</span>
          </Button>
        ) : null}
      </section>

      <section className="rounded-[10px] border border-line bg-ink-1 p-5">
        <Kicker>The cut so far</Kicker>
        <ol className="mt-3 flex flex-col">
          {NAV.map((item, index) => {
            const stage = stagesByKey.get(item.key);
            const Icon = ACT_ICONS[item.key];
            const done = Boolean(stage?.complete);
            const locked = stage ? !stage.available && !stage.complete : true;
            const isCurrent = index === current;
            return (
              <li key={item.key}>
                <button
                  type="button"
                  onClick={() => onSelectTab(item.key)}
                  className={`flex w-full items-center gap-3 border-b border-line py-2 text-left last:border-b-0 hover:text-fg-0 ${isCurrent ? "text-fg-0" : locked ? "text-fg-4" : "text-fg-2"}`}
                >
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${done ? "bg-ok text-ink-0" : isCurrent ? "border border-accent text-accent" : "border border-line-2 text-fg-4"}`}>
                    {done ? <CheckIcon size={10} strokeWidth={2.2} /> : locked ? <LockIcon size={9} /> : <Icon size={10} />}
                  </span>
                  <span className="w-[76px] shrink-0 text-[12.5px] font-medium">{item.label}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg-3">{stage?.status ?? item.sub}</span>
                  <kbd className="studio-kbd shrink-0">{index + 1}</kbd>
                </button>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
