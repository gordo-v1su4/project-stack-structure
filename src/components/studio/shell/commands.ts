import { NAV } from "../constants";
import type { StageHeaderModel } from "../stageActions";
import type { PipelineStage } from "../studioPipeline";
import type { Tab } from "../types";

/**
 * Pure model for the command palette and keyboard map. Everything the shell
 * can do is a command here; the palette, the inspector buttons, and the
 * keyboard shortcuts all execute the same list.
 */

export type CommandGroup = "act" | "navigate" | "transport" | "project";

export interface StudioCommand {
  id: string;
  label: string;
  /** Secondary line: what the command does or why it is disabled. */
  hint: string | null;
  group: CommandGroup;
  /** Display-only shortcut, e.g. "⌘K", "Space", "3". */
  shortcut: string | null;
  disabledReason: string | null;
  run: () => void;
}

export interface CommandInput {
  activeTab: Tab;
  stages: PipelineStage[];
  model: StageHeaderModel | null;
  transport: { available: boolean; isPlaying: boolean; label: string } | null;
  onSelectTab: (tab: Tab) => void;
  onPrimary: () => void;
  onSecondary: () => void;
  onTogglePlayback: () => void;
  onStopPlayback: () => void;
  onOpenShortcuts: () => void;
}

export function buildStudioCommands(input: CommandInput): StudioCommand[] {
  const commands: StudioCommand[] = [];
  const model = input.model;

  if (model?.primary) {
    commands.push({
      id: "act:primary",
      label: model.primary.label,
      hint: model.primary.disabledReason ?? (model.primary.kind === "continue" ? "Advance to the next act" : "Open the act that is missing"),
      group: "act",
      shortcut: null,
      disabledReason: model.primary.disabledReason,
      run: input.onPrimary,
    });
  }
  if (model?.secondary) {
    commands.push({
      id: "act:secondary",
      label: model.secondary.label,
      hint: model.secondary.disabledReason ?? "Render a playable cut into the monitor",
      group: "act",
      shortcut: model.secondary.disabledReason ? null : "P",
      disabledReason: model.secondary.disabledReason,
      run: input.onSecondary,
    });
  }

  if (input.transport?.available) {
    commands.push({
      id: "transport:toggle",
      label: input.transport.isPlaying ? "Pause" : "Play",
      hint: input.transport.label,
      group: "transport",
      shortcut: "Space",
      disabledReason: null,
      run: input.onTogglePlayback,
    });
    commands.push({
      id: "transport:stop",
      label: "Stop and return to start",
      hint: input.transport.label,
      group: "transport",
      shortcut: "K",
      disabledReason: null,
      run: input.onStopPlayback,
    });
  }

  const stagesByKey = new Map(input.stages.map((stage) => [stage.key, stage]));
  NAV.forEach((item, index) => {
    const stage = stagesByKey.get(item.key);
    const isActive = item.key === input.activeTab;
    commands.push({
      id: `go:${item.key}`,
      label: `Go to ${item.label}`,
      hint: isActive ? "Current act" : stage?.status ?? item.sub,
      group: "navigate",
      shortcut: String(index + 1),
      disabledReason: isActive ? "Already here" : null,
      run: () => input.onSelectTab(item.key),
    });
  });

  commands.push({
    id: "project:shortcuts",
    label: "Keyboard shortcuts",
    hint: "Everything the studio answers to",
    group: "project",
    shortcut: "?",
    disabledReason: null,
    run: input.onOpenShortcuts,
  });

  return commands;
}

/** Case-insensitive subsequence match so "gm" finds "Go to Match". */
export function filterCommands(commands: StudioCommand[], query: string): StudioCommand[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return commands;
  return commands
    .map((command) => ({ command, score: matchScore(`${command.label} ${command.hint ?? ""}`.toLowerCase(), needle) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.command);
}

function matchScore(haystack: string, needle: string): number {
  if (haystack.includes(needle)) return 1000 - haystack.indexOf(needle);
  let hi = 0;
  let score = 0;
  for (const char of needle) {
    const at = haystack.indexOf(char, hi);
    if (at === -1) return 0;
    score += at === hi ? 3 : 1;
    hi = at + 1;
  }
  return score;
}

export const COMMAND_GROUP_LABELS: Record<CommandGroup, string> = {
  act: "This act",
  transport: "Transport",
  navigate: "Go to",
  project: "Studio",
};

/** Ordered shortcut sheet, derived from the same command list. */
export function shortcutSheet(commands: StudioCommand[]): { keys: string; label: string }[] {
  const rows = commands
    .filter((command) => command.shortcut)
    .map((command) => ({ keys: command.shortcut as string, label: command.label }));
  return [
    { keys: "⌘K", label: "Command palette" },
    ...rows,
    { keys: "[ ]", label: "Previous / next cut on the spine" },
    { keys: "Esc", label: "Deselect cut" },
  ];
}
