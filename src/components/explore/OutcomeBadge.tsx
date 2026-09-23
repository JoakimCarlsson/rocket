import type { LaunchPlan } from "@/lib/sim/simulate";

/** Small coloured badge naming a launch result. */
export function OutcomeBadge({ plan }: { plan: LaunchPlan }) {
  const tone =
    plan.report.grade === "success" ? "border-good/40 text-good" : plan.report.grade === "partial" ? "border-warn/40 text-warn" : "border-bad/40 text-bad";
  return (
    <span className={`inline-block rounded-full border bg-black/60 px-2.5 py-1 font-mono text-[9px] tracking-[0.14em] backdrop-blur ${tone}`}>
      {plan.report.headline.replace("MISSION: ", "")}
    </span>
  );
}
