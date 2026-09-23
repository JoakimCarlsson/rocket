"use client";

import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { STAT_META } from "@/lib/format";
import { computeStats, jokeMeters } from "@/lib/rocket/stats";
import type { RocketConfig, SimulatedStats } from "@/lib/rocket/types";
import { AnimatedNumber } from "./AnimatedNumber";

/** Normalises a stat to 0..1 for its bar; heavy-tailed stats use a log scale. */
function fill(key: keyof SimulatedStats, value: number): number {
  switch (key) {
    case "reliability":
    case "chaos":
      return value / 100;
    case "height":
      return Math.min(1, value / 220);
    case "crew":
      return Math.min(1, value / 12);
    default:
      return Math.min(1, Math.log10(Math.max(1, value)) / 7);
  }
}

/** Bar colour for a stat. */
function barColor(key: keyof SimulatedStats, value: number): string {
  if (key === "reliability") return value > 70 ? "var(--good)" : value > 40 ? "var(--warn)" : "var(--bad)";
  if (key === "chaos") return value > 70 ? "var(--bad)" : "var(--accent)";
  return "rgba(236,235,231,0.55)";
}

/** Right-hand panel of fictional stats with joke readouts. */
export function StatsPanel({ rocket, provider }: { rocket: RocketConfig; provider: string }) {
  const stats = useMemo(() => computeStats(rocket), [rocket]);
  const jokes = useMemo(() => jokeMeters(stats), [stats]);
  return (
    <aside className="panel pointer-events-auto w-[248px] rounded-2xl p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="label-xs">Simulated stats</span>
        <span className="label-xs text-faint">fictional</span>
      </div>
      <ul className="space-y-2.5">
        {STAT_META.map((meta) => {
          const value = stats[meta.key];
          return (
            <li key={meta.key}>
              <div className="flex items-baseline justify-between font-mono text-[11px]">
                <span className="tracking-[0.14em] text-muted">{meta.label}</span>
                <span className="text-[13px] text-text">
                  <AnimatedNumber value={value} format={meta.format} />
                  <span className="ml-1 text-[10px] text-faint">{meta.unit}</span>
                </span>
              </div>
              <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-white/5">
                <motion.div
                  className="h-full rounded-full"
                  animate={{ width: `${Math.max(2, fill(meta.key, value) * 100)}%`, backgroundColor: barColor(meta.key, value) }}
                  transition={{ type: "spring", stiffness: 120, damping: 20 }}
                />
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 space-y-1.5 border-t border-line pt-3">
        {jokes.map((joke) => (
          <div key={joke.label} className="flex justify-between gap-2 font-mono text-[9.5px] tracking-[0.12em]">
            <span className="text-faint">{joke.label}</span>
            <motion.span key={joke.value} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="text-right text-accent-soft">
              {joke.value}
            </motion.span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-good" />
        <span className="label-xs">AI · {provider}</span>
      </div>
    </aside>
  );
}

/** Compact stat strip for phones. */
export function CompactStats({ rocket }: { rocket: RocketConfig }) {
  const stats = useMemo(() => computeStats(rocket), [rocket]);
  const [open, setOpen] = useState(false);
  const shown = open ? STAT_META : STAT_META.filter((m) => ["height", "thrust", "reliability", "chaos"].includes(m.key));
  return (
    <button onClick={() => setOpen((o) => !o)} className="panel pointer-events-auto grid w-full grid-cols-4 gap-x-2 gap-y-2 rounded-xl px-3 py-2 text-left">
      {shown.map((meta) => (
        <div key={meta.key} className="min-w-0">
          <div className="truncate font-mono text-[8.5px] tracking-[0.12em] text-muted">{meta.label}</div>
          <div className="font-mono text-[12px]">
            <AnimatedNumber value={stats[meta.key]} format={meta.format} />
            <span className="ml-0.5 text-[8px] text-faint">{meta.unit}</span>
          </div>
        </div>
      ))}
    </button>
  );
}
