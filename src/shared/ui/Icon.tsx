import type { ReactElement } from "react";

/**
 * Every icon the pages draw, inline so each takes the colour of the text
 * around it and costs no request. Decorative only: a button showing one
 * carries its own name, so the icon is hidden from assistive technology.
 */
const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const REPEAT_ARROWS = (
  <>
    <path d="m17 2 4 4-4 4" />
    <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
    <path d="m7 22-4-4 4-4" />
    <path d="M21 13v1a4 4 0 0 1-4 4H3" />
  </>
);

const SPEAKER = <path d="M11 5 6 9H2v6h4l5 4V5z" />;

const STAR =
  "M12 2.8l2.84 5.75 6.35.93-4.6 4.48 1.09 6.32L12 17.3l-5.68 2.98 1.09-6.32-4.6-4.48 6.35-.93z";

const GLYPHS = {
  play: (
    <path
      fill="currentColor"
      d="M8 5.2v13.6a.8.8 0 0 0 1.2.7l10.6-6.8a.8.8 0 0 0 0-1.4L9.2 4.5A.8.8 0 0 0 8 5.2z"
    />
  ),
  pause: (
    <g fill="currentColor">
      <rect x="6" y="4.5" width="4.5" height="15" rx="1.2" />
      <rect x="13.5" y="4.5" width="4.5" height="15" rx="1.2" />
    </g>
  ),
  skip: (
    <g fill="currentColor">
      <path d="M5.5 5.6v12.8a.8.8 0 0 0 1.25.66l9.3-6.4a.8.8 0 0 0 0-1.32l-9.3-6.4a.8.8 0 0 0-1.25.66z" />
      <rect x="16.5" y="5" width="2.5" height="14" rx="1" />
    </g>
  ),
  shuffle: (
    <g {...STROKE}>
      <path d="M16 3h5v5" />
      <path d="M4 20 21 3" />
      <path d="M21 16v5h-5" />
      <path d="m15 15 6 6" />
      <path d="M4 4l5 5" />
    </g>
  ),
  repeat: <g {...STROKE}>{REPEAT_ARROWS}</g>,
  "repeat-one": (
    <g {...STROKE}>
      {REPEAT_ARROWS}
      <path d="M11 10.5 12.5 9.5v5" strokeWidth={1.8} />
    </g>
  ),
  volume: (
    <g {...STROKE}>
      {SPEAKER}
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M19 5a10 10 0 0 1 0 14" />
    </g>
  ),
  "volume-off": (
    <g {...STROKE}>
      {SPEAKER}
      <path d="m22 9-6 6" />
      <path d="m16 9 6 6" />
    </g>
  ),
  up: <path {...STROKE} strokeWidth={2.2} d="m6 15 6-6 6 6" />,
  down: <path {...STROKE} strokeWidth={2.2} d="m6 9 6 6 6-6" />,
  remove: <path {...STROKE} strokeWidth={2.2} d="M6 6l12 12M18 6 6 18" />,
  star: <path {...STROKE} d={STAR} />,
  "star-filled": <path {...STROKE} fill="currentColor" d={STAR} />,
  people: (
    <g {...STROKE}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </g>
  ),
  headphones: (
    <g {...STROKE}>
      <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
      <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
    </g>
  ),
  check: <path {...STROKE} strokeWidth={2.4} d="M20 6 9 17l-5-5" />,
  plus: <path {...STROKE} d="M12 5v14M5 12h14" />,
  alert: (
    <g {...STROKE}>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M12 7.5v5.5M12 16.5v.01" />
    </g>
  ),
  spinner: <path {...STROKE} strokeWidth={2.4} d="M12 3a9 9 0 1 0 9 9" />,
} satisfies Record<string, ReactElement>;

export type IconName = keyof typeof GLYPHS;

export const ICON_NAMES = Object.keys(GLYPHS) as IconName[];

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      className={className === undefined ? "icon" : `icon ${className}`}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {GLYPHS[name]}
    </svg>
  );
}
