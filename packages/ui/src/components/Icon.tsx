import type { SVGProps } from 'react';

/**
 * A small hand-drawn icon set (24px grid, 1.6 stroke) so the product does not look like every
 * other template. Add paths here rather than pulling in an icon library.
 */
const PATHS = {
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7',
  chevronLeft: 'M15 5l-7 7 7 7',
  chevronRight: 'M9 5l7 7-7 7',
  chevronDown: 'M5 9l7 7 7-7',
  arrowLeft: 'M20 12H5m6-6l-6 6 6 6',
  arrowRight: 'M4 12h15m-6-6l6 6-6 6',
  bag: 'M5 8h14l-1.2 11.2a2 2 0 01-2 1.8H8.2a2 2 0 01-2-1.8L5 8zm4 0V7a3 3 0 016 0v1',
  bowl: 'M3 11h18a9 9 0 01-18 0zm5-4c0-1.5 1-2 1-3.5M12 7c0-1.5 1-2 1-3.5M16 7c0-1.5 1-2 1-3.5',
  cup: 'M5 8h11v6a5 5 0 01-5 5h-1a5 5 0 01-5-5V8zm11 2h1.5a2.5 2.5 0 010 5H16M8 3.5c0 1 .8 1.5.8 2.5M11.5 3.5c0 1 .8 1.5.8 2.5',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zm-7.5 8a7.5 7.5 0 0115 0',
  menu: 'M4 7h16M4 12h16M4 17h10',
  receipt: 'M6 3h12v18l-2.5-1.5L13 21l-2-1.5L9 21l-2.5-1.5L6 21V3zm3.5 5h5m-5 4h5m-5 4h3',
  wallet:
    'M4 7.5A2.5 2.5 0 016.5 5H18v3M4 7.5V17a2 2 0 002 2h13a1 1 0 001-1v-9a1 1 0 00-1-1H6.5A2.5 2.5 0 014 7.5zM16 13.5h.01',
  box: 'M4 8l8-4 8 4v8l-8 4-8-4V8zm0 0l8 4 8-4m-8 4v8',
  star: 'M12 4l2.4 5 5.3.6-3.9 3.6 1 5.3L12 16l-4.8 2.5 1-5.3-3.9-3.6 5.3-.6L12 4z',
  flame:
    'M12 21c-4 0-6.5-2.7-6.5-6.3 0-3.2 2.2-5 3.6-7.3.4 1.6 1.4 2.6 2.4 3 .1-2.6 1.3-5.3 3.5-7.4.3 3 3.5 5.7 3.5 10.2 0 4.8-2.7 7.8-6.5 7.8z',
  clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zm0-13v4.5l3 2',
  calendar: 'M4 7a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V7zm0 4h16M8 3v4m8-4v4',
  qr: 'M4 4h6v6H4V4zm10 0h6v6h-6V4zM4 14h6v6H4v-6zm10 0h2v2h-2v-2zm4 0h2v2h-2zm-4 4h2v2h-2zm4 0h2v2h-2zM16 16h2v2h-2z',
  gift: 'M4 11h16v9H4v-9zm-1-4h18v4H3V7zm9 0v13M12 7c-1.5-3.5-5-3.5-5-1.5S9.5 7 12 7zm0 0c1.5-3.5 5-3.5 5-1.5S14.5 7 12 7z',
  sparkle:
    'M12 3l1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6L12 3zM19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16z',
  scale: 'M5 20h14l-1.5-12h-11L5 20zm7-12a3 3 0 100-6 3 3 0 000 6zm0-1.5V5',
  heart: 'M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0112 7a4.3 4.3 0 017.5 2.8C19.5 15.4 12 20 12 20z',
  logout: 'M15 4h3a2 2 0 012 2v12a2 2 0 01-2 2h-3M10 16l-4-4 4-4M6 12h10',
  copy: 'M9 9h10v11H9V9zm-4 6V4h10',
  info: 'M12 21a9 9 0 100-18 9 9 0 000 18zm0-10v6m0-9.5v.5',
  alert: 'M12 4l9 16H3l9-16zm0 6v4m0 3v.5',
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14zm5-2l4.5 4.5',
  filter: 'M4 6h16M7 12h10m-7 6h4',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zm10-14l4 4',
  trash: 'M5 7h14M10 7V4h4v3m-7 0l1 13h8l1-13',
  bell: 'M6 16V11a6 6 0 0112 0v5l1.5 2h-15L6 16zm4 4a2 2 0 004 0',
  chart: 'M4 20V4m0 16h16M8 16v-5m4 5V8m4 8v-3',
  store:
    'M4 9l1.5-5h13L20 9M4 9h16M4 9a2.7 2.7 0 005.3 0 2.7 2.7 0 005.4 0 2.7 2.7 0 005.3 0M5 11v9h14v-9M10 20v-5h4v5',
  users:
    'M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zm-6 9a6 6 0 0112 0m1.5-9a3 3 0 100-6m1.5 15a5 5 0 00-3-4.6',
  settings:
    'M12 15a3 3 0 100-6 3 3 0 000 6zm7.4-3a7.4 7.4 0 00-.1-1.3l2-1.5-2-3.4-2.3.9a7.6 7.6 0 00-2.2-1.3L14.4 3h-4l-.4 2.4a7.6 7.6 0 00-2.2 1.3l-2.3-.9-2 3.4 2 1.5a7.4 7.4 0 000 2.6l-2 1.5 2 3.4 2.3-.9c.7.5 1.4 1 2.2 1.3l.4 2.4h4l.4-2.4c.8-.3 1.5-.8 2.2-1.3l2.3.9 2-3.4-2-1.5c.1-.4.1-.9.1-1.3z',
  message: 'M4 5h16v11H9l-5 4V5z',
  leaf: 'M5 19c0-8 5-14 15-14 0 10-6 15-14 15m-1-1c3-4 6-7 10-9',
  printer:
    'M7 9V4h10v5M7 17H5a1 1 0 01-1-1v-6a1 1 0 011-1h14a1 1 0 011 1v6a1 1 0 01-1 1h-2m-10-3h10v6H7v-6z',
  truck:
    'M3 6h11v10H3V6zm11 4h4l3 3v3h-7v-6zM7 19a2 2 0 100-4 2 2 0 000 4zm10 0a2 2 0 100-4 2 2 0 000 4z',
  layers: 'M12 4l9 5-9 5-9-5 9-5zm-9 9l9 5 9-5',
  play: 'M8 5l11 7-11 7V5z',
  undo: 'M9 7L5 11l4 4M5 11h9a5 5 0 010 10h-2',
  refresh: 'M20 12a8 8 0 01-14.3 4.9M4 12a8 8 0 0114.3-4.9M18 3v4h-4M6 21v-4h4',
  upload: 'M12 16V4m-5 5l5-5 5 5M4 20h16',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 20,
  ...rest
}: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
