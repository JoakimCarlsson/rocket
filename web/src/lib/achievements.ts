import type { RocketConfig, SimulatedStats } from "./rocket/types";
import type { LaunchPlan } from "./sim/playback";

/** An unlockable joke badge. */
export interface Achievement {
  id: string;
  title: string;
  description: string;
}

/** Every achievement in the game. */
export const ACHIEVEMENTS: Achievement[] = [
  {
    id: "too_many_boosters",
    title: "TOO MANY BOOSTERS",
    description: "Strap ten or more boosters to one rocket.",
  },
  {
    id: "questionable",
    title: "QUESTIONABLE ENGINEERING",
    description: "Drop fictional reliability below 35%.",
  },
  {
    id: "sideways",
    title: "WHY IS IT SIDEWAYS?",
    description: "Tilt the rocket 45° or more.",
  },
  {
    id: "moon_or_bust",
    title: "MOON OR BUST",
    description: "Point a rocket at the Moon.",
  },
  {
    id: "against_all_odds",
    title: "AGAINST ALL ODDS",
    description: "Succeed with a design that should not work.",
  },
  {
    id: "absolute_unit",
    title: "ABSOLUTE UNIT",
    description: "Build a rocket taller than 150 m.",
  },
  {
    id: "kaboom",
    title: "EXCELLENT FOOTAGE",
    description: "Experience a rapid unscheduled disassembly.",
  },
  {
    id: "quack",
    title: "MORALE OFFICER",
    description: "Install a rubber duck.",
  },
  {
    id: "sculptor",
    title: "MODERN ART",
    description: "Sculpt a rocket out of eight or more shapes.",
  },
  {
    id: "flying_sculpture",
    title: "IT FLIES, SOMEHOW",
    description: "Reach orbit with a sculpted rocket.",
  },
  { id: "orbit", title: "OFFICIALLY IN SPACE", description: "Reach orbit." },
];

/** Returns ids of achievements earned by a configuration and its server-derived stats. */
export function configAchievements(
  config: RocketConfig,
  stats: SimulatedStats,
): string[] {
  const earned: string[] = [];
  if (config.boosters.length >= 10) earned.push("too_many_boosters");
  if (stats.reliability < 35) earned.push("questionable");
  if (Math.abs(config.tilt) >= 45) earned.push("sideways");
  if (config.destination === "moon") earned.push("moon_or_bust");
  if (stats.height > 150) earned.push("absolute_unit");
  if (
    config.decorativeParts.some((d) => d.kind === "duck") ||
    config.shapes.some((s) => /duck/i.test(s.label))
  )
    earned.push("quack");
  if (config.shapes.length >= 8) earned.push("sculptor");
  return earned;
}

/** Returns ids of achievements earned by a launch of a configuration. */
export function launchAchievements(
  plan: LaunchPlan,
  config: RocketConfig,
): string[] {
  const earned: string[] = [];
  if (
    plan.outcome === "against_all_odds" ||
    (plan.report.grade === "success" && plan.stats.reliability < 40)
  )
    earned.push("against_all_odds");
  if (plan.events.some((e) => e.type === "explode" || e.type === "impact"))
    earned.push("kaboom");
  if (plan.report.grade === "success") earned.push("orbit");
  if (plan.report.grade === "success" && config.shapes.length >= 4)
    earned.push("flying_sculpture");
  return earned;
}

/** Looks up an achievement by id. */
export function achievementById(id: string): Achievement | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}
