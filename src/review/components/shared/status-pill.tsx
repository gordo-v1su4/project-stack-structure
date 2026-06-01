import type { ReviewStatus } from "@/review/lib/store/types";
import { CheckIcon } from "./icons";

const CONFIG: Record<
  ReviewStatus,
  { label: string; color: string; check?: boolean }
> = {
  "in-review": { label: "In Review", color: "var(--accent)" },
  "needs-changes": { label: "Needs Changes", color: "var(--reject)" },
  approved: { label: "Approved", color: "var(--ok)", check: true },
};

export function StatusPill({ status }: { status: ReviewStatus }) {
  const c = CONFIG[status];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-[2px] text-[9px] uppercase tracking-[0.18em]"
      style={{
        color: c.color,
        border: `1px solid ${c.color}40`,
        background: `${c.color}10`,
      }}
    >
      {c.check ? (
        <CheckIcon width={8} height={8} />
      ) : (
        <span
          className="h-[5px] w-[5px] rounded-full"
          style={{ background: c.color }}
        />
      )}
      {c.label}
    </span>
  );
}

export function StatusDot({ status }: { status: ReviewStatus }) {
  return (
    <span
      className="h-[5px] w-[5px] shrink-0 rounded-full"
      style={{ background: CONFIG[status].color }}
    />
  );
}
