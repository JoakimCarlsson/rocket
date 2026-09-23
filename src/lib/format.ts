/** Formats large numbers compactly, e.g. 12400 → "12.4K". */
export function compactNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e4) return `${(value / 1e3).toFixed(1)}K`;
  return Math.round(value).toLocaleString("en-US");
}

/** Display metadata for each fictional stat. */
export const STAT_META = [
  { key: "height", label: "HEIGHT", unit: "m", format: (v: number) => v.toFixed(1) },
  { key: "mass", label: "MASS", unit: "t", format: compactNumber },
  { key: "thrust", label: "THRUST", unit: "kN", format: compactNumber },
  { key: "crew", label: "CREW", unit: "", format: (v: number) => String(Math.round(v)) },
  { key: "range", label: "RANGE", unit: "km", format: compactNumber },
  { key: "cost", label: "COST", unit: "$M", format: compactNumber },
  { key: "reliability", label: "RELIABILITY", unit: "%", format: (v: number) => String(Math.round(v)) },
  { key: "chaos", label: "CHAOS", unit: "/100", format: (v: number) => String(Math.round(v)) },
] as const;
