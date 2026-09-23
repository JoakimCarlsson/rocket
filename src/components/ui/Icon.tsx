const PATHS = {
  undo: "M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11",
  redo: "m15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13",
  reset: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5",
  dice: "M4 4h16v16H4zM8.5 8.5h.01M15.5 15.5h.01M15.5 8.5h.01M8.5 15.5h.01M12 12h.01",
  explore: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM15.5 8.5l-2 5-5 2 2-5 5-2Z",
  share: "M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13",
  sound: "M11 5 6 9H2v6h4l5 4V5ZM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14",
  mute: "M11 5 6 9H2v6h4l5 4V5ZM22 9l-6 6M16 9l6 6",
  tag: "M3 12V3h9l9 9-9 9-9-9ZM7.5 7.5h.01",
  send: "M5 12h14M13 6l6 6-6 6",
  rocket: "M5 19c1-3 2.5-4.5 4-5M14.5 3.5c3 0 6 3 6 6-2 4-6 7.5-9 8.5l-5-5c1-3 4.5-7 8-9.5ZM15 9h.01",
  close: "M6 6l12 12M18 6 6 18",
  menu: "M4 7h16M4 12h16M4 17h16",
  heart: "M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z",
  wrench: "M14.7 6.3a4 4 0 0 0 5 5L21 13l-8 8-3-3 8-8-1.3-1.3a4 4 0 0 0-5-5l2.8 2.8-2.1 2.1-2.8-2.8",
  remix: "M4 7h11l-3-3M20 17H9l3 3M4 7v4M20 17v-4",
  download: "M12 3v12M7 10l5 5 5-5M4 20h16",
  copy: "M8 8h12v12H8zM4 16V4h12",
} as const;

/** Name of a built-in stroke icon. */
export type IconName = keyof typeof PATHS;

/** Minimal stroke icon set, drawn inline so nothing is fetched. */
export function Icon({ name, size = 16, className = "" }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={PATHS[name]} />
    </svg>
  );
}
