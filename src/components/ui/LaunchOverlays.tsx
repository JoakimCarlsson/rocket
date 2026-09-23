"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { LaunchCue, Telemetry } from "@/components/three/LaunchScene";
import { achievementById } from "@/lib/achievements";
import type { LaunchPlan } from "@/lib/sim/simulate";
import { Icon } from "./Icon";

/** Full-screen wipe between the bay and the pad. Calls `onDone` once the screen is covered. */
export function TransitionOverlay({ name, onDone }: { name: string; onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, 1250);
    return () => clearTimeout(timer);
  }, [onDone]);
  return (
    <motion.div className="fixed inset-0 z-40 grid place-items-center overflow-hidden bg-black" initial={{ clipPath: "inset(50% 0 50% 0)" }} animate={{ clipPath: "inset(0% 0 0% 0)" }} transition={{ duration: 0.55, ease: [0.7, 0, 0.3, 1] }}>
      <motion.div initial={{ opacity: 0, letterSpacing: "0.6em" }} animate={{ opacity: 1, letterSpacing: "0.2em" }} transition={{ delay: 0.3, duration: 0.8 }} className="text-center">
        <div className="label-xs mb-3 text-accent">Transferring to pad 39-X</div>
        <div className="font-display text-3xl font-extrabold sm:text-5xl">{name}</div>
        <div className="mx-auto mt-5 h-px w-56 overflow-hidden bg-white/10">
          <motion.div className="h-full bg-accent" initial={{ width: 0 }} animate={{ width: "100%" }} transition={{ duration: 1, ease: "easeInOut" }} />
        </div>
      </motion.div>
    </motion.div>
  );
}

const CUE_BANNERS: Partial<Record<LaunchCue, { text: string; tone: "ok" | "warn" | "bad" }>> = {
  ignition: { text: "IGNITION", tone: "ok" },
  liftoff: { text: "LIFTOFF", tone: "ok" },
  booster_sep: { text: "BOOSTER SEPARATION", tone: "ok" },
  stage_sep: { text: "STAGE SEPARATION", tone: "ok" },
  booster_fail: { text: "BOOSTER FAILURE", tone: "bad" },
  spin: { text: "ANOMALY: UNEXPECTED SPIN", tone: "warn" },
  wobble: { text: "WOBBLE DETECTED", tone: "warn" },
  payload_pop: { text: "PAYLOAD DEPLOYED (EARLY)", tone: "warn" },
  stall: { text: "ENGINE STALL", tone: "bad" },
  explode: { text: "RAPID UNSCHEDULED DISASSEMBLY", tone: "bad" },
  tip_over: { text: "IT IS FALLING OVER", tone: "bad" },
  arrive: { text: "NOMINAL-ISH", tone: "ok" },
};

/** Heads-up display during launch: countdown, event banners and live telemetry. */
export function LaunchHUD({ cue, telemetry, plan, onSkip }: { cue: { value: LaunchCue; id: number } | null; telemetry: { current: Telemetry }; plan: LaunchPlan; onSkip: () => void }) {
  const [readout, setReadout] = useState<Telemetry>({ altitude: 0, speed: 0, t: -3 });
  const frame = useRef(0);
  useEffect(() => {
    const tick = () => {
      setReadout({ ...telemetry.current });
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [telemetry]);

  const count = cue?.value.startsWith("count:") ? cue.value.slice(6) : null;
  const banner = cue ? CUE_BANNERS[cue.value] : undefined;
  const arrived = cue?.value === "arrive" ? (plan.outcome === "lunar" ? "LUNAR TRAJECTORY CONFIRMED" : plan.outcome === "mars" ? "MARS TRANSFER CONFIRMED" : "ORBIT ACHIEVED") : null;
  const t = readout.t;

  return (
    <div className="pointer-events-none fixed inset-0 z-30">
      <AnimatePresence>
        {count && (
          <motion.div key={count} initial={{ opacity: 0, scale: 1.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.7 }} transition={{ duration: 0.35 }} className="absolute inset-0 grid place-items-center">
            <span className="font-display text-[28vw] leading-none font-extrabold text-white/90 [text-shadow:0_0_80px_rgba(255,91,31,0.5)] sm:text-[180px]">{count}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {banner && cue && (
          <motion.div key={cue.id} initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="absolute top-[18%] right-0 left-0 text-center">
            <span className={`inline-block border-y px-6 py-2 font-mono text-[13px] tracking-[0.35em] backdrop-blur-sm sm:text-[15px] ${banner.tone === "bad" ? "border-bad/50 bg-bad/15 text-bad" : banner.tone === "warn" ? "border-warn/40 bg-warn/10 text-warn" : "border-white/20 bg-black/30 text-text"}`}>
              {arrived ?? banner.text}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="absolute bottom-6 left-4 font-mono text-[11px] tracking-[0.14em] text-text/80 sm:left-8">
        <div className="label-xs mb-1 text-accent">Telemetry · fictional</div>
        <div>T{t < 0 ? "−" : "+"}{Math.abs(t).toFixed(1)}s</div>
        <div>ALT {Math.round(readout.altitude * 0.4).toLocaleString("en-US")} M</div>
        <div>VEL {Math.round(readout.speed * 3.6).toLocaleString("en-US")} KM/H</div>
      </div>

      <button onClick={onSkip} className="pointer-events-auto absolute right-4 bottom-6 rounded-lg border border-white/15 bg-black/40 px-3 py-2 font-mono text-[10px] tracking-[0.18em] text-muted backdrop-blur hover:text-text sm:right-8">
        SKIP TO REPORT
      </button>
    </div>
  );
}

/** Props for the mission result card. */
export interface MissionReportProps {
  plan: LaunchPlan;
  name: string;
  busy: boolean;
  onRemix: () => void;
  onRepair: () => void;
  onAgain: () => void;
  onNew: () => void;
  onShare: () => void;
}

/** Dramatic mission result card. */
export function MissionReportCard({ plan, name, busy, onRemix, onRepair, onAgain, onNew, onShare }: MissionReportProps) {
  const { report } = plan;
  const tone = report.grade === "success" ? "text-good" : report.grade === "partial" ? "text-warn" : "text-bad";
  const failed = report.grade !== "success";
  return (
    <motion.div className="fixed inset-0 z-30 grid place-items-center bg-black/35 p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 140, damping: 18, delay: 0.1 }}
        className="panel w-full max-w-[460px] overflow-hidden rounded-3xl"
      >
        <div className="border-b border-line px-6 pt-6 pb-5">
          <div className="label-xs flex justify-between">
            <span>Mission report</span>
            <span className="text-faint">{name}</span>
          </div>
          <motion.h2 initial={{ opacity: 0, letterSpacing: "0.3em" }} animate={{ opacity: 1, letterSpacing: "0em" }} transition={{ delay: 0.3, duration: 0.6 }} className={`mt-3 font-display text-[26px] leading-[1.05] font-extrabold ${tone}`}>
            {report.headline}
          </motion.h2>
        </div>
        <dl className="divide-y divide-line px-6">
          {report.rows.map((row, i) => (
            <motion.div key={row.label} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.45 + i * 0.08 }} className="flex items-baseline justify-between gap-4 py-2.5">
              <dt className="label-xs">{row.label}</dt>
              <dd className="text-right text-[14px]">{row.value}</dd>
            </motion.div>
          ))}
        </dl>
        <p className="px-6 pt-2 pb-5 font-mono text-[11.5px] text-muted">“{report.quip}”</p>
        <div className="grid grid-cols-2 gap-2 border-t border-line p-3">
          {failed ? (
            <button onClick={onRepair} disabled={busy} className="col-span-2 flex h-12 items-center justify-center gap-2 rounded-xl bg-accent font-display text-[13px] font-bold tracking-[0.1em] text-black disabled:opacity-50">
              <Icon name="wrench" size={16} /> REPAIR WITH AI
            </button>
          ) : (
            <button onClick={onShare} className="col-span-2 flex h-12 items-center justify-center gap-2 rounded-xl bg-accent font-display text-[13px] font-bold tracking-[0.1em] text-black">
              <Icon name="share" size={16} /> SHARE THIS TRIUMPH
            </button>
          )}
          <ReportButton icon="remix" label="REMIX ROCKET" onClick={onRemix} />
          <ReportButton icon="rocket" label="LAUNCH AGAIN" onClick={onAgain} />
          <ReportButton icon="reset" label="NEW ROCKET" onClick={onNew} />
          {failed ? <ReportButton icon="share" label="SHARE" onClick={onShare} /> : <ReportButton icon="wrench" label="REPAIR WITH AI" onClick={onRepair} />}
        </div>
      </motion.div>
    </motion.div>
  );
}

/** Secondary report action. */
function ReportButton({ icon, label, onClick }: { icon: Parameters<typeof Icon>[0]["name"]; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex h-11 items-center justify-center gap-2 rounded-xl border border-line font-mono text-[10.5px] tracking-[0.14em] text-muted transition hover:border-line-strong hover:text-text">
      <Icon name={icon} size={14} />
      {label}
    </button>
  );
}

/** Achievement toasts that slide in at the top. */
export function AchievementToasts({ ids, onDismiss }: { ids: string[]; onDismiss: (id: string) => void }) {
  useEffect(() => {
    if (!ids.length) return;
    const timer = setTimeout(() => onDismiss(ids[0]), 3600);
    return () => clearTimeout(timer);
  }, [ids, onDismiss]);
  const current = ids[0] ? achievementById(ids[0]) : undefined;
  return (
    <div className="pointer-events-none fixed top-4 right-0 left-0 z-50 flex justify-center px-4">
      <AnimatePresence>
        {current && (
          <motion.div key={current.id} initial={{ opacity: 0, y: -30, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -20 }} className="panel flex items-center gap-3 rounded-2xl border-accent/40 py-2.5 pr-5 pl-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent font-display text-lg font-extrabold text-black">★</span>
            <div>
              <div className="label-xs text-accent">Achievement unlocked</div>
              <div className="font-display text-[14px] font-bold">{current.title}</div>
              <div className="text-[11px] text-muted">{current.description}</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
