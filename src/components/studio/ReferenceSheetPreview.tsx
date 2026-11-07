"use client";

import { useId, useRef } from "react";

/** Inspect a whole reference sheet without changing its identity or selection. */
export function ReferenceSheetPreview({ src, name }: { src: string; name: string }) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={`Inspect ${name} reference sheet`}
        aria-haspopup="dialog"
        title="Click to enlarge"
        onClick={() => dialog.current?.showModal()}
        className="block h-full w-full cursor-zoom-in rounded-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={name} className="h-full w-full object-contain" loading="lazy" decoding="async" />
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        onClose={() => trigger.current?.focus()}
        onClick={(event) => {
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
        className="m-auto max-h-[96dvh] w-[96vw] max-w-[1600px] overflow-hidden rounded-md border border-line-2 bg-ink-1 p-0 text-fg-1 shadow-2xl backdrop:bg-ink-0/90"
      >
        <div className="flex max-h-[96dvh] flex-col">
          <header className="flex shrink-0 items-center justify-between gap-4 border-b border-line px-4 py-3">
            <div className="min-w-0">
              <h2 id={titleId} className="truncate text-sm font-medium">{name}</h2>
              <p className="text-[10px] text-fg-3">Click the image to close</p>
            </div>
            <button type="button" onClick={() => dialog.current?.close()} className="shrink-0 rounded-sm border border-line-2 px-3 py-1 text-xs text-fg-2 hover:border-accent hover:text-fg-0 focus-visible:outline-2 focus-visible:outline-accent">
              Close
            </button>
          </header>
          <button
            type="button"
            aria-label={`Close ${name} enlarged preview`}
            onClick={() => dialog.current?.close()}
            className="flex min-h-0 cursor-zoom-out items-center justify-center bg-ink-0 p-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={`${name} full reference sheet`} className="max-h-[calc(96dvh-88px)] w-full object-contain" decoding="async" />
          </button>
        </div>
      </dialog>
    </>
  );
}
