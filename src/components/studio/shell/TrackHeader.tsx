"use client";

type TrackHeaderProps = {
  headline: string;
  meta: string | null;
  next?: string | null;
};

/** Compact song identity above the beat spine — workspace chrome, not a hero title. */
export function TrackHeader({ headline, meta, next }: TrackHeaderProps) {
  return (
    <header className="flex shrink-0 items-baseline justify-between gap-4 pb-1">
      <div className="min-w-0">
        <h1 className="truncate font-mono text-[13px] font-medium tracking-[0.01em] text-fg-3">{headline}</h1>
        {meta ? <p className="mt-0.5 font-mono text-[11px] text-fg-4">{meta}</p> : null}
      </div>
      {next ? (
        <p className="max-w-[28ch] shrink-0 text-right text-[11px] leading-4 text-fg-4">
          <span className="text-fg-3">Next · </span>
          {next}
        </p>
      ) : null}
    </header>
  );
}
