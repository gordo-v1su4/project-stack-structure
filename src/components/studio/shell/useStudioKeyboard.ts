"use client";

import { useEffect } from "react";
import { NAV } from "../constants";
import type { Tab } from "../types";

type KeyboardHandlers = {
  onCommandPalette: () => void;
  onSelectTab: (tab: Tab) => void;
  onTogglePlayback: () => void;
  onStopPlayback: () => void;
  onSecondary: () => void;
  onShortcuts: () => void;
  /** `[` / `]` step the selected cut on the spine; Escape clears it. */
  onStepSlot: (direction: -1 | 1) => void;
  onClearSlot: () => void;
  /** When true, single-key shortcuts are suspended (palette or dialog open). */
  suspended: boolean;
};

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return Boolean(target.closest("dialog[open], [role='dialog']"));
}

/**
 * Global keyboard map. ⌘K always opens the palette; the single-key map only
 * fires when focus is not in a text control or dialog.
 */
export function useStudioKeyboard(handlers: KeyboardHandlers) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "k") {
        event.preventDefault();
        handlers.onCommandPalette();
        return;
      }
      if (handlers.suspended || meta || event.altKey || isTypingTarget(event.target)) return;

      switch (event.key) {
        case " ":
          event.preventDefault();
          handlers.onTogglePlayback();
          return;
        case "k":
        case "K":
          handlers.onStopPlayback();
          return;
        case "p":
        case "P":
          handlers.onSecondary();
          return;
        case "?":
          handlers.onShortcuts();
          return;
        case "[":
          handlers.onStepSlot(-1);
          return;
        case "]":
          handlers.onStepSlot(1);
          return;
        case "Escape":
          handlers.onClearSlot();
          return;
        default:
          break;
      }
      const digit = Number(event.key);
      if (Number.isInteger(digit) && digit >= 1 && digit <= NAV.length) {
        const item = NAV[digit - 1];
        if (item) handlers.onSelectTab(item.key);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handlers]);
}
