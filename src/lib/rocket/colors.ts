/** Friendly colour names the AI and the local interpreter understand. */
export const NAMED_COLORS: Record<string, string> = {
  black: "#111111",
  white: "#f2f2ee",
  red: "#d7261e",
  crimson: "#a3121f",
  orange: "#ff6a1a",
  yellow: "#ffd21f",
  gold: "#d4a93a",
  golden: "#d4a93a",
  green: "#2f9e44",
  lime: "#9be33b",
  teal: "#0f9d8f",
  cyan: "#27d3ee",
  blue: "#2b59ff",
  navy: "#14235a",
  purple: "#7b3fe4",
  violet: "#8f5cff",
  pink: "#ff5fa8",
  magenta: "#e0249c",
  silver: "#c0c6cc",
  chrome: "#d7dde2",
  grey: "#7d828a",
  gray: "#7d828a",
  brown: "#6b4424",
  bronze: "#a8703a",
  copper: "#c26a3d",
  beige: "#e3d6b8",
  cream: "#f3ead2",
  camo: "#4b5a33",
  olive: "#5b6431",
  neon: "#39ff14",
  mint: "#8dffcf",
  turquoise: "#32d6c8",
  maroon: "#5c0f1a",
  rust: "#9a3b16",
  lavender: "#b8a6ff",
  indigo: "#3b2fb0",
};

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Resolves a hex code or colour name into a normalised `#rrggbb`, or null if unknown. */
export function resolveColor(input: string): string | null {
  const value = input.trim().toLowerCase();
  if (HEX.test(value)) {
    if (value.length === 4) {
      return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`;
    }
    return value;
  }
  const compact = value.replace(/[\s_-]+/g, "");
  return NAMED_COLORS[value] ?? NAMED_COLORS[compact] ?? null;
}

/** Colour cycle used for rainbow paint jobs. */
export const RAINBOW = ["#ff3b30", "#ff9500", "#ffd60a", "#34c759", "#0a84ff", "#5e5ce6", "#bf5af2"];
