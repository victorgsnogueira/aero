import type { CSSProperties } from 'react';

const PATHS = {
  overview: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  scan: 'M4 8V4h4 M16 4h4v4 M20 16v4h-4 M8 20H4v-4 M8 12h8 M12 8v8',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M13 7a4 4 0 1 1-8 0a4 4 0 0 1 8 0',
  map: 'm3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z M9 3v15 M15 6v15',
  pin: 'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0 M15 10a3 3 0 1 1-6 0a3 3 0 0 1 6 0',
  campaign: 'm3 11 18-7v16L3 14z M7 15l2 6h4l-2-5',
  offer: 'M20 13 11 22 2 13V2h11l9 9z M7 7h.01',
  inbox: 'M4 4h16l2 12v4H2v-4z M2 16h6l2 3h4l2-3h6',
  pipeline: 'M4 4h4v16H4z M10 4h4v10h-4z M16 4h4v6h-4z',
  document: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M8 13h8 M8 17h5',
  settings: 'M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8 M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z',
  arrow: 'M4 12h16 m-6-6 6 6-6 6',
  chevron: 'm9 5 7 7-7 7',
  check: 'm5 12 4 4L19 6',
  sort: 'M8 4v16 m-3-3 3 3 3-3 M16 20V4 m-3 3 3-3 3 3',
  sortAsc: 'M12 20V4 m-5 5 5-5 5 5',
  sortDesc: 'M12 4v16 m-5-5 5 5 5-5',
  circle: 'M21 12a9 9 0 1 1-18 0a9 9 0 0 1 18 0',
  complete: 'M21 11v1a9 9 0 1 1-5-8 M9 11l3 3L22 4',
  clock: 'M21 12a9 9 0 1 1-18 0a9 9 0 0 1 18 0 M12 7v5l3 2',
  pause: 'M8 5v14 M16 5v14',
  cancelled: 'M21 12a9 9 0 1 1-18 0a9 9 0 0 1 18 0 M8 8l8 8 M16 8l-8 8',
  alert: 'm12 3 10 18H2z M12 9v4 M12 17h.01',
  message: 'M21 15a3 3 0 0 1-3 3H8l-5 4V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3z M7 8h10 M7 12h6',
  filter: 'M4 6h16 M7 12h10 M10 18h4',
  sun: 'M16 12a4 4 0 1 1-8 0a4 4 0 0 1 8 0 M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1.5 1.5 M17.5 17.5 19 19 M5 19l1.5-1.5 M17.5 6.5 19 5',
  moon: 'M21 12.8A9 9 0 0 1 11.2 3 9 9 0 1 0 21 12.8z',
  attach: 'm21 11-9 9a6 6 0 0 1-8-8L14 2a4 4 0 0 1 6 6L9 19a2 2 0 0 1-3-3l10-10',
  more: 'M5 12h.01 M12 12h.01 M19 12h.01',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = '', style }: { name: IconName; className?: string; style?: CSSProperties }) {
  return (
    <svg
      className={`ui-icon ${className}`}
      style={style}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
