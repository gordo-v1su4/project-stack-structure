import type { SVGProps } from "react";

const base = {
  width: 14,
  height: 14,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export const PlayIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M4 3l9 5-9 5V3z" fill="currentColor" stroke="none" />
  </svg>
);

export const PauseIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <rect x="4" y="3" width="3" height="10" fill="currentColor" stroke="none" />
    <rect x="9" y="3" width="3" height="10" fill="currentColor" stroke="none" />
  </svg>
);

export const FrameBackIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M12 3v10" />
    <path d="M10 8L4 3v10l6-5z" fill="currentColor" stroke="none" />
  </svg>
);

export const FrameFwdIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M4 3v10" />
    <path d="M6 8l6-5v10L6 8z" fill="currentColor" stroke="none" />
  </svg>
);

export const LoopIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M3 8a5 5 0 015-5h2l-1.5-1.5M13 8a5 5 0 01-5 5H6l1.5 1.5" />
  </svg>
);

export const UploadIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M8 11V3M5 6l3-3 3 3" />
    <path d="M3 11v2h10v-2" />
  </svg>
);

export const PenIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M11 2l3 3-8 8-3 1 1-3 7-7z" />
  </svg>
);

export const ArrowIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M3 13L13 3M7 3h6v6" />
  </svg>
);

export const BoxIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <rect x="3" y="4" width="10" height="8" />
  </svg>
);

export const TextIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M4 4h8M8 4v9" />
  </svg>
);

export const SelectIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M3 3l5 11 2-5 5-2L3 3z" />
  </svg>
);

export const CheckIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M3 8l3 3 7-7" />
  </svg>
);

export const CloseIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);

export const TrashIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M3 4h10M6 4V2.5h4V4M5 4l.5 9h5l.5-9" />
  </svg>
);

export const PosterIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <rect x="2.5" y="3" width="11" height="10" rx="1" />
    <circle cx="6" cy="6.5" r="1" />
    <path d="M3 11l3-3 3 3 2-2 2 2" />
  </svg>
);

/** The SVS Studio 2x2 pixel logo mark. */
export function LogoMark({ size = 14 }: { size?: number }) {
  const cell = (size - 2) / 2;
  return (
    <div
      className="grid grid-cols-2 gap-[2px]"
      style={{ width: size, height: size }}
    >
      {[0, 1, 2, 3].map((i) => {
        const diag = i === 0 || i === 3;
        return (
          <div
            key={i}
            style={{
              width: cell,
              height: cell,
              background: diag ? "var(--accent)" : "#2a2a2a",
            }}
          />
        );
      })}
    </div>
  );
}
