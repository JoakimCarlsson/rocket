"use client";

import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { compactNumber, STAT_META } from "@/lib/format";
import type { Burn } from "@/lib/physics/api";
import { useAnalysis } from "@/lib/physics/useAnalysis";
import { jokeMeters } from "@/lib/rocket/stats";
import type { RocketConfig, SimulatedStats } from "@/lib/rocket/types";
import { AnimatedNumber } from "./AnimatedNumber";

/** Shown until the server's analysis arrives. */
const NO_STATS: SimulatedStats = {
  height: 0,
  mass: 0,
  thrust: 0,
  twr: 0,
  deltaV: 0,
  deltaVNeeded: 1,
  stability: 0,
  crew: 0,
  cost: 0,
  reliability: 0,
  chaos: 0,
};

/** Normalises a stat to 0..1 for its bar; heavy-tailed stats use a log scale. */
function fill(key: keyof SimulatedStats, stats: SimulatedStats): number {
  const value = stats[key];
  switch (key) {
    case "reliability":
    case "chaos":
      return value / 100;
    case "height":
      return Math.min(1, value / 220);
    case "twr":
      return Math.min(1, value / 3);
    case "deltaV":
      return Math.min(1, value / (stats.deltaVNeeded * 1.25));
    case "stability":
      return Math.min(1, Math.max(0, (value + 4) / 8));
    default:
      return Math.min(1, Math.log10(Math.max(1, value)) / 7);
  }
}

/** Bar colour for a stat: green when it helps the mission, amber when marginal, red when it will not work. */
function barColor(key: keyof SimulatedStats, stats: SimulatedStats): string {
  const value = stats[key];
  const tone = (good: boolean, warn: boolean) =>
    good ? "var(--good)" : warn ? "var(--warn)" : "var(--bad)";
  switch (key) {
    case "reliability":
      return tone(value > 90, value > 70);
    case "chaos":
      return value > 70 ? "var(--bad)" : "var(--accent)";
    case "twr":
      return tone(value >= 1.2 && value <= 3, value >= 1);
    case "deltaV":
      return tone(
        value >= stats.deltaVNeeded,
        value >= stats.deltaVNeeded * 0.85,
      );
    case "stability":
      return tone(value >= 0, value >= -4);
    default:
      return "rgba(236,235,231,0.55)";
  }
}

/** Right-hand panel of physics stats, the staging breakdown and joke readouts. */
export function StatsPanel({
  rocket,
  provider,
}: {
  rocket: RocketConfig;
  provider: string;
}) {
  const analysis = useAnalysis(rocket);
  const stats = analysis?.stats ?? NO_STATS;
  const phases = analysis?.staging ?? [];
  const jokes = useMemo(() => jokeMeters(stats), [stats]);
  return (
    <aside className="panel pointer-events-auto max-h-[calc(100vh-3rem)] w-[248px] overflow-y-auto rounded-2xl p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="label-xs">Simulated stats</span>
        <span className="label-xs text-faint">
          {rocket.destination.toUpperCase()}
        </span>
      </div>
      <ul className="space-y-2.5">
        {STAT_META.map((meta) => {
          const value = stats[meta.key];
          return (
            <li key={meta.key}>
              <div className="flex items-baseline justify-between font-mono text-[11px]">
                <span className="tracking-[0.14em] text-muted">
                  {meta.label}
                </span>
                <span className="text-[13px] text-text">
                  <AnimatedNumber value={value} format={meta.format} />
                  {meta.key === "deltaV" && (
                    <span className="text-[10px] text-faint">
                      {" "}
                      / {compactNumber(stats.deltaVNeeded)}
                    </span>
                  )}
                  <span className="ml-1 text-[10px] text-faint">
                    {meta.unit}
                  </span>
                </span>
              </div>
              <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-white/5">
                <motion.div
                  className="h-full rounded-full"
                  animate={{
                    width: `${Math.max(2, fill(meta.key, stats) * 100)}%`,
                    backgroundColor: barColor(meta.key, stats),
                  }}
                  transition={{ type: "spring", stiffness: 120, damping: 20 }}
                />
              </div>
            </li>
          );
        })}
      </ul>
      <StagingTable phases={phases} />
      <div className="mt-4 space-y-1.5 border-t border-line pt-3">
        {jokes.map((joke) => (
          <div
            key={joke.label}
            className="flex justify-between gap-2 font-mono text-[9.5px] tracking-[0.12em]"
          >
            <span className="text-faint">{joke.label}</span>
            <motion.span
              key={joke.value}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-right text-accent-soft"
            >
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

/** Per-burn delta-v and ignition thrust-to-weight from the rocket equation. */
function StagingTable({ phases }: { phases: Burn[] }) {
  if (!phases.length) return null;
  return (
    <div className="mt-4 border-t border-line pt-3">
      <div className="label-xs mb-1.5 flex justify-between">
        <span>Staging</span>
        <span className="text-faint">Δv · TWR</span>
      </div>
      <ul className="space-y-1 font-mono text-[10px]">
        {phases.map((phase, i) => (
          <li
            key={`${phase.label}:${i}`}
            className="grid grid-cols-[1fr_auto_auto] items-baseline gap-2"
          >
            <span className="truncate text-muted" title={phase.propellant}>
              {phase.label}
              <span className="ml-1 text-faint">{phase.propellant}</span>
            </span>
            <span className="text-text">{compactNumber(phase.deltaV)}</span>
            <span
              className={
                phase.twr < (i === 0 ? 1 : 0.5) ? "text-bad" : "text-muted"
              }
            >
              {phase.twr.toFixed(2)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Compact stat strip for phones. */
export function CompactStats({ rocket }: { rocket: RocketConfig }) {
  const stats = useAnalysis(rocket)?.stats ?? NO_STATS;
  const [open, setOpen] = useState(false);
  const shown = open
    ? STAT_META
    : STAT_META.filter((m) =>
        ["twr", "deltaV", "stability", "reliability"].includes(m.key),
      );
  return (
    <button
      onClick={() => setOpen((o) => !o)}
      className="panel pointer-events-auto grid w-full grid-cols-4 gap-x-2 gap-y-2 rounded-xl px-3 py-2 text-left"
    >
      {shown.map((meta) => (
        <div key={meta.key} className="min-w-0">
          <div className="truncate font-mono text-[8.5px] tracking-[0.12em] text-muted">
            {meta.label}
          </div>
          <div className="font-mono text-[12px]">
            <AnimatedNumber value={stats[meta.key]} format={meta.format} />
            <span className="ml-0.5 text-[8px] text-faint">{meta.unit}</span>
          </div>
        </div>
      ))}
    </button>
  );
}
