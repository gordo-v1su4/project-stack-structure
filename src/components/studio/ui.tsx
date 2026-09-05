"use client";

import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

/**
 * Small shared primitives for the studio shell. Colors come from the
 * `@theme` tokens in globals.css (ink-*, line*, fg-*, accent, ok, warn,
 * danger, review). Keep this file tiny: panels should compose these rather
 * than reinvent chrome.
 */

export type StatusTone = "ready" | "processing" | "failed" | "waiting" | "review";

export const TONE_DOT: Record<StatusTone, string> = {
  ready: "bg-ok",
  processing: "bg-warn",
  failed: "bg-danger",
  waiting: "bg-line-3",
  review: "bg-review",
};

export const TONE_TEXT: Record<StatusTone, string> = {
  ready: "text-ok",
  processing: "text-warn",
  failed: "text-danger",
  waiting: "text-fg-3",
  review: "text-review",
};

export const TONE_BORDER: Record<StatusTone, string> = {
  ready: "border-ok-lo",
  processing: "border-warn-lo",
  failed: "border-danger-lo",
  waiting: "border-line",
  review: "border-review-lo",
};

export const TONE_TINT: Record<StatusTone, string> = {
  ready: "bg-ok-tint",
  processing: "bg-warn-tint",
  failed: "bg-danger-tint",
  waiting: "bg-ink-1",
  review: "bg-review-tint",
};

export function StatusDot({ tone, pulse = false, className = "" }: { tone: StatusTone; pulse?: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${TONE_DOT[tone]} ${pulse && tone === "processing" ? "animate-pulse" : ""} ${className}`}
    />
  );
}

/** Uppercase micro-label. Use sparingly — one per section, not per row. */
export function Kicker({ children, tone, className = "" }: { children: ReactNode; tone?: StatusTone | "accent"; className?: string }) {
  const color = tone === "accent" ? "text-accent" : tone ? TONE_TEXT[tone] : "text-fg-3";
  return <div className={`text-[10px] font-medium uppercase tracking-[0.14em] ${color} ${className}`}>{children}</div>;
}

type SurfaceProps = HTMLAttributes<HTMLElement> & {
  as?: "div" | "section" | "aside";
  tone?: StatusTone;
  inset?: boolean;
  padded?: boolean;
};

/** Bordered panel. `tone` tints the border/background for status callouts. */
export function Surface({ as = "section", tone, inset = false, padded = true, className = "", children, ...rest }: SurfaceProps) {
  const Component = as;
  const base = tone ? `${TONE_BORDER[tone]} ${TONE_TINT[tone]}` : inset ? "border-line bg-ink-0" : "border-line bg-ink-2";
  return (
    <Component className={`rounded-md border ${base} ${padded ? "p-4" : ""} ${className}`} {...rest}>
      {children}
    </Component>
  );
}

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success";
export type ButtonSize = "sm" | "md" | "lg";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shown as a tooltip and used as the visible label when disabled with `showReason`. */
  reason?: string | null;
  showReason?: boolean;
};

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-accent text-white hover:bg-accent-hi active:bg-accent-lo border-transparent shadow-[0_1px_0_rgba(255,255,255,0.08)_inset]",
  secondary: "bg-ink-3 text-fg-0 hover:bg-ink-4 border-line-2 hover:border-line-3",
  ghost: "bg-transparent text-fg-2 hover:text-fg-0 hover:bg-ink-3 border-transparent",
  danger: "bg-transparent text-danger hover:bg-danger-tint border-danger-lo",
  success: "bg-ok-lo text-fg-0 hover:bg-ok border-transparent",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-[11px] gap-1.5",
  md: "h-8 px-3.5 text-[12px] gap-2",
  lg: "h-10 px-5 text-[13px] gap-2 font-semibold",
};

export function Button({ variant = "secondary", size = "md", reason, showReason = false, className = "", disabled, title, children, ...rest }: ButtonProps) {
  const isDisabled = Boolean(disabled);
  return (
    <button
      type="button"
      disabled={isDisabled}
      title={title ?? (isDisabled && reason ? reason : undefined)}
      className={`inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-md border font-medium leading-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent/70 ${SIZE[size]} ${
        isDisabled ? "cursor-not-allowed border-line bg-ink-3 text-fg-4" : VARIANT[variant]
      } ${className}`}
      {...rest}
    >
      {isDisabled && showReason && reason ? reason : children}
    </button>
  );
}

/** Inline key/value for compact metadata rows. */
export function Meta({ label, value, className = "" }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 text-[11px] ${className}`}>
      <span className="text-fg-3">{label}</span>
      <span className="truncate font-mono text-fg-1">{value}</span>
    </div>
  );
}

/** Thin progress bar. */
export function ProgressBar({ value, tone = "processing", className = "" }: { value: number; tone?: StatusTone; className?: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className={`h-[3px] w-full overflow-hidden rounded-full bg-ink-4 ${className}`}>
      <div className={`h-full ${tone === "ready" ? "bg-ok" : "bg-accent"} transition-[width] duration-300`} style={{ width: `${clamped}%` }} />
    </div>
  );
}
