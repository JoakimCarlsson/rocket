import type { MissionReport } from "@/lib/physics/api";

/** Small coloured badge naming a launch result. */
export function OutcomeBadge({
  launch,
}: {
  launch: Pick<MissionReport, "grade" | "headline">;
}) {
  const tone =
    launch.grade === "success"
      ? "border-good/40 text-good"
      : launch.grade === "partial"
        ? "border-warn/40 text-warn"
        : "border-bad/40 text-bad";
  return (
    <span
      className={`inline-block rounded-full border bg-black/60 px-2.5 py-1 font-mono text-[9px] tracking-[0.14em] backdrop-blur ${tone}`}
    >
      {launch.headline.replace("MISSION: ", "")}
    </span>
  );
}
