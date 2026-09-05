"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { COMMAND_GROUP_LABELS, filterCommands, shortcutSheet, type CommandGroup, type StudioCommand } from "./commands";

type CommandPaletteProps = {
  open: boolean;
  onClose: () => void;
  commands: StudioCommand[];
};

const GROUP_ORDER: CommandGroup[] = ["act", "transport", "navigate", "project"];

/**
 * ⌘K palette on a native <dialog>; entrance via @starting-style. Arrow keys
 * move, Enter runs, Escape closes. The list is the same command model the
 * inspector and keyboard use.
 */
export function CommandPalette({ open, onClose, commands }: CommandPaletteProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);

  const visible = useMemo(() => filterCommands(commands, query), [commands, query]);
  const grouped = useMemo(() => {
    if (query.trim()) return [{ group: null as CommandGroup | null, items: visible }];
    return GROUP_ORDER.map((group) => ({ group, items: visible.filter((command) => command.group === group) })).filter((entry) => entry.items.length > 0);
  }, [visible, query]);
  const flat = useMemo(() => grouped.flatMap((entry) => entry.items), [grouped]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      requestAnimationFrame(() => inputRef.current?.focus());
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Every close path (Escape, backdrop, run, programmatic) lands here, so the
  // next open always starts from an empty query.
  function handleClose() {
    setQuery("");
    setCursor(0);
    onClose();
  }

  function handleQueryChange(next: string) {
    setQuery(next);
    setCursor(0);
  }

  function run(command: StudioCommand) {
    if (command.disabledReason) return;
    handleClose();
    // Let the dialog close before the command mutates layout (view transitions).
    requestAnimationFrame(() => command.run());
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((current) => Math.min(flat.length - 1, current + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((current) => Math.max(0, current - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const command = flat[cursor];
      if (command) run(command);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={handleClose}
      onCancel={(event) => {
        event.preventDefault();
        handleClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) handleClose();
      }}
      aria-label="Command palette"
      className="studio-pop m-0 mx-auto mt-[12vh] w-[560px] max-w-[92vw] rounded-[12px] border border-line-2 bg-ink-2 p-0 text-fg-1 shadow-[0_30px_80px_oklch(0_0_0/0.6)] backdrop:bg-transparent open:flex open:flex-col"
    >
      <div className="flex items-center gap-3 border-b border-line px-4">
        <span className="font-display text-[18px] italic text-fg-3">›</span>
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => handleQueryChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Type a command or act…"
          aria-label="Search commands"
          className="h-12 flex-1 bg-transparent text-[14px] text-fg-0 outline-none placeholder:text-fg-4"
        />
        <kbd className="studio-kbd">esc</kbd>
      </div>
      <div className="max-h-[52vh] overflow-y-auto p-2" role="listbox" aria-activedescendant={flat[cursor]?.id}>
        {flat.length === 0 ? <div className="px-3 py-6 text-center text-[12px] text-fg-3">Nothing matches “{query}”.</div> : null}
        {grouped.map((entry) => (
          <div key={entry.group ?? "results"} className="mb-1">
            {entry.group ? (
              <div className="px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-[0.14em] text-fg-4">{COMMAND_GROUP_LABELS[entry.group]}</div>
            ) : null}
            {entry.items.map((command) => {
              const index = flat.indexOf(command);
              const active = index === cursor;
              const disabled = Boolean(command.disabledReason);
              return (
                <button
                  key={command.id}
                  id={command.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  aria-disabled={disabled}
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => run(command)}
                  className={`flex w-full items-center justify-between gap-4 rounded-md px-3 py-2 text-left transition-colors duration-[var(--duration-fast)] ${
                    active ? "bg-ink-4" : "hover:bg-ink-3"
                  } ${disabled ? "opacity-50" : ""}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] text-fg-0">{command.label}</span>
                    {command.hint ? <span className="block truncate text-[11px] text-fg-3">{command.hint}</span> : null}
                  </span>
                  {command.shortcut ? <kbd className="studio-kbd shrink-0">{command.shortcut}</kbd> : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </dialog>
  );
}

/** Sheet listing every shortcut; opened with `?` or from the palette. */
export function ShortcutSheet({ open, onClose, commands }: CommandPaletteProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);
  const rows = shortcutSheet(commands);
  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      aria-label="Keyboard shortcuts"
      className="studio-pop m-0 mx-auto mt-[14vh] w-[440px] max-w-[92vw] rounded-[12px] border border-line-2 bg-ink-2 p-0 text-fg-1 shadow-[0_30px_80px_oklch(0_0_0/0.6)]"
    >
      <div className="border-b border-line px-5 py-4">
        <h2 className="font-display text-[26px] leading-none text-fg-0">Shortcuts</h2>
        <p className="mt-1 text-[12px] text-fg-3">Single keys work when focus is not in a text field.</p>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 px-5 py-4 text-[12.5px]">
        {rows.map((row) => (
          <div key={`${row.keys}-${row.label}`} className="contents">
            <dt><kbd className="studio-kbd">{row.keys}</kbd></dt>
            <dd className="text-fg-1">{row.label}</dd>
          </div>
        ))}
      </dl>
    </dialog>
  );
}
