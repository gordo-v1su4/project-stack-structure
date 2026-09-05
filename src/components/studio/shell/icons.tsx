import type { SVGProps } from "react";
import type { Tab } from "../types";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 16, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      {children}
    </svg>
  );
}

/** 16px stroke glyphs for the eight acts. Drawn inline; no icon dependency. */
export const ACT_ICONS: Record<Tab, (props: IconProps) => React.JSX.Element> = {
  review: (p) => (
    <Svg {...p}>
      <path d="M8 2v7" />
      <path d="M5.5 6.5 8 9l2.5-2.5" />
      <path d="M2.5 10.5v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2" />
    </Svg>
  ),
  story: (p) => (
    <Svg {...p}>
      <path d="M3 3.5h4.5a1 1 0 0 1 1 1V13a1 1 0 0 0-1-1H3z" />
      <path d="M13 3.5H8.5a1 1 0 0 0-1 1V13a1 1 0 0 1 1-1H13z" />
    </Svg>
  ),
  split: (p) => (
    <Svg {...p}>
      <circle cx="4.5" cy="4.5" r="1.8" />
      <circle cx="4.5" cy="11.5" r="1.8" />
      <path d="m6 5.6 7.5 6.2M6 10.4l7.5-6.2" />
    </Svg>
  ),
  shuffle: (p) => (
    <Svg {...p}>
      <path d="M2.5 4.5h2.2c1 0 1.9.5 2.4 1.3l1.8 3.4c.5.8 1.4 1.3 2.4 1.3h2.2" />
      <path d="M2.5 11.5h2.2c1 0 1.9-.5 2.4-1.3M9 5.8c.5-.8 1.4-1.3 2.4-1.3h2.1" />
      <path d="m12 2.8 1.7 1.7L12 6.2M12 9.8l1.7 1.7-1.7 1.7" />
    </Svg>
  ),
  generate: (p) => (
    <Svg {...p}>
      <path d="M8 2.5 9.2 6.8 13.5 8l-4.3 1.2L8 13.5 6.8 9.2 2.5 8l4.3-1.2z" />
      <path d="M12.5 2.5v2M11.5 3.5h2" />
    </Svg>
  ),
  join: (p) => (
    <Svg {...p}>
      <rect x="2.5" y="5" width="4" height="6" rx=".8" />
      <rect x="9.5" y="5" width="4" height="6" rx=".8" />
      <path d="M6.5 8h3" />
    </Svg>
  ),
  ramp: (p) => (
    <Svg {...p}>
      <path d="M2.5 11.5c2-.2 3-6 4.5-6s2.2 4.5 3.7 4.5 1.8-3 2.8-3" />
    </Svg>
  ),
  compose: (p) => (
    <Svg {...p}>
      <path d="M8 10.5V3" />
      <path d="m5.5 5.5 2.5-2.5 2.5 2.5" />
      <path d="M2.5 10v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2" />
    </Svg>
  ),
};

export function PlayIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4.5 3.2v9.6L12.5 8z" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function PauseIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3.5" y="3" width="3" height="10" rx=".6" fill="currentColor" stroke="none" />
      <rect x="9.5" y="3" width="3" height="10" rx=".6" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function StopIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3.5" y="3.5" width="9" height="9" rx="1" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function SkipBackIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 3v10" />
      <path d="M12.5 3.5v9L6 8z" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function CommandIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5 3.5A1.5 1.5 0 1 0 3.5 5H5zM11 3.5A1.5 1.5 0 1 1 12.5 5H11zM5 12.5A1.5 1.5 0 1 1 3.5 11H5zM11 12.5a1.5 1.5 0 1 0 1.5-1.5H11z" />
      <path d="M5 5h6v6H5z" />
    </Svg>
  );
}

export function CheckIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m3.5 8.5 3 3 6-7" />
    </Svg>
  );
}

export function LockIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1" />
      <path d="M5.5 7V5.5a2.5 2.5 0 0 1 5 0V7" />
    </Svg>
  );
}
