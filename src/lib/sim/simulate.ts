import type { MissionSummary } from "../ai/provider";
import {
  createRng,
  hashString,
  pick,
  type Rng,
  randInt,
  randRange,
} from "../rocket/random";
import { computeStats, thrustToWeight } from "../rocket/stats";
import type { RocketConfig, SimulatedStats } from "../rocket/types";

/** Every way a game launch can end. */
export type Outcome =
  | "orbit"
  | "lunar"
  | "mars"
  | "spin"
  | "booster_failure"
  | "stage_malfunction"
  | "payload_early"
  | "explode"
  | "against_all_odds"
  | "fizzle";

/** A timed moment in the launch animation, in seconds after ignition. */
export type LaunchEvent =
  | { t: number; type: "liftoff" }
  | { t: number; type: "booster_sep" }
  | { t: number; type: "stage_sep"; stageId: string }
  | { t: number; type: "booster_fail"; boosterId: string }
  | { t: number; type: "spin" }
  | { t: number; type: "payload_pop" }
  | { t: number; type: "stall"; stageId: string }
  | { t: number; type: "explode" }
  | { t: number; type: "tip_over" }
  | { t: number; type: "wobble" }
  | { t: number; type: "arrive" };

/** One labelled row on the mission report card. */
export interface ReportRow {
  label: string;
  value: string;
}

/** The dramatic card shown after a launch. */
export interface MissionReport {
  headline: string;
  grade: "success" | "partial" | "failure";
  rows: ReportRow[];
  quip: string;
  chaos: number;
}

/** Everything needed to animate and report a launch. Fully determined by rocket and seed. */
export interface LaunchPlan {
  seed: number;
  outcome: Outcome;
  duration: number;
  events: LaunchEvent[];
  altitudeKm: number;
  report: MissionReport;
  stats: SimulatedStats;
}

/** Picks a key from weighted options. */
function weighted<T extends string>(rng: Rng, weights: Record<T, number>): T {
  const entries = Object.entries(weights) as [T, number][];
  const total = entries.reduce((sum, [, w]) => sum + Math.max(0, w), 0);
  let roll = rng() * total;
  for (const [key, w] of entries) {
    roll -= Math.max(0, w);
    if (roll <= 0) return key;
  }
  return entries[0][0];
}

/**
 * Decides what happens using deliberately silly game rules. Reliability and chaos
 * skew the dice; nothing here models real vehicle behaviour.
 */
export function simulateLaunch(
  config: RocketConfig,
  attempt: number,
): LaunchPlan {
  const seed = hashString(`${JSON.stringify(config)}#${attempt}`);
  const rng = createRng(seed);
  const stats = computeStats(config);
  const twr = thrustToWeight(stats);
  const r = stats.reliability;
  const c = stats.chaos;

  let outcome: Outcome;
  if (twr < 0.8) {
    outcome = rng() < 0.35 + c / 250 ? "explode" : "fizzle";
  } else {
    const success = r ** 1.7 / 100;
    const pickOutcome = weighted(rng, {
      success,
      explode: (100 - r) * 0.12 + c * 0.05,
      spin: c * 0.035 + Math.abs(config.tilt) * 0.06 + (config.fins ? 0 : 1.6),
      booster_failure: config.boosters.length
        ? config.boosters.length * 0.22 + (100 - r) * 0.03
        : 0,
      stage_malfunction:
        config.stages.length > 1
          ? (config.stages.length - 1) * 0.7 + (100 - r) * 0.025
          : 0,
      payload_early: 0.7 + c * 0.018,
      against_all_odds: r < 45 ? 2.2 + c * 0.03 : 0,
    });
    outcome =
      pickOutcome === "success"
        ? successOutcome(config, stats, rng)
        : pickOutcome;
  }

  const events = buildEvents(config, outcome, rng);
  const duration =
    Math.max(...events.map((e) => e.t)) +
    (outcome === "explode" || outcome === "fizzle" ? 3.5 : 2.5);
  const altitudeKm = altitudeFor(outcome, events, rng);
  return {
    seed,
    outcome,
    duration,
    events,
    altitudeKm,
    report: buildReport(config, stats, outcome, altitudeKm, rng),
    stats,
  };
}

/** Upgrades a plain success to a destination-specific one when the fictional range allows. */
function successOutcome(
  config: RocketConfig,
  stats: SimulatedStats,
  rng: Rng,
): Outcome {
  if (config.destination === "moon" && (stats.range > 40000 || rng() < 0.45))
    return "lunar";
  if (config.destination === "mars" && (stats.range > 150000 || rng() < 0.3))
    return "mars";
  return "orbit";
}

/** Lays out the animation timeline for an outcome. */
function buildEvents(
  config: RocketConfig,
  outcome: Outcome,
  rng: Rng,
): LaunchEvent[] {
  const events: LaunchEvent[] = [];
  if (outcome === "fizzle") {
    events.push({ t: 1.5, type: "wobble" }, { t: 4.2, type: "tip_over" });
    if (rng() < 0.5) events.push({ t: 6.2, type: "explode" });
    return events;
  }
  events.push({ t: 1.2, type: "liftoff" });
  let t = 5.2;
  const hasBoosters = config.boosters.length > 0;
  const failBooster =
    outcome === "booster_failure" && hasBoosters
      ? pick(rng, config.boosters)
      : null;
  if (failBooster)
    events.push({
      t: randRange(rng, 2.6, 3.6),
      type: "booster_fail",
      boosterId: failBooster.id,
    });
  if (outcome === "against_all_odds") events.push({ t: 2.4, type: "wobble" });

  const endEarly: Partial<Record<Outcome, number>> = {
    explode: randRange(rng, 2.2, 7.5),
    spin: randRange(rng, 3, 5.5),
    payload_early: randRange(rng, 3.2, 6),
  };
  const cutoff = endEarly[outcome] ?? Infinity;

  if (hasBoosters && t < cutoff) {
    events.push({ t, type: "booster_sep" });
    t += 2.8;
  }
  const lowerStages = config.stages.slice(0, -1);
  const stallIndex =
    outcome === "stage_malfunction"
      ? randInt(rng, 0, Math.max(0, lowerStages.length - 1))
      : -1;
  for (let i = 0; i < lowerStages.length; i++) {
    if (t >= cutoff) break;
    events.push({ t, type: "stage_sep", stageId: lowerStages[i].id });
    if (i === stallIndex) {
      events.push({
        t: t + 1.2,
        type: "stall",
        stageId: config.stages[i + 1].id,
      });
      if (rng() < 0.5) events.push({ t: t + 4.5, type: "explode" });
      return events;
    }
    t += 3;
  }
  if (outcome === "stage_malfunction") {
    events.push({
      t: t + 0.5,
      type: "stall",
      stageId: config.stages[config.stages.length - 1].id,
    });
    return events;
  }

  switch (outcome) {
    case "explode":
      events.push({ t: cutoff, type: "explode" });
      break;
    case "spin":
      events.push({ t: cutoff, type: "spin" });
      if (rng() < 0.45) events.push({ t: cutoff + 4, type: "explode" });
      else events.push({ t: cutoff + 5, type: "arrive" });
      break;
    case "payload_early":
      events.push({ t: cutoff, type: "payload_pop" });
      events.push({ t: cutoff + 4, type: "arrive" });
      break;
    default:
      events.push({ t: t + 2.5, type: "arrive" });
  }
  return events.sort((a, b) => a.t - b.t);
}

/** Picks a fictional peak altitude for the report. */
function altitudeFor(
  outcome: Outcome,
  events: LaunchEvent[],
  rng: Rng,
): number {
  const explodeAt = events.find((e) => e.type === "explode")?.t;
  switch (outcome) {
    case "orbit":
    case "against_all_odds":
      return randInt(rng, 180, 640);
    case "lunar":
      return 384400;
    case "mars":
      return 225000000;
    case "fizzle":
      return explodeAt ? 0.004 : 0.002;
    case "explode":
      return Math.round(
        (explodeAt ?? 3) * (explodeAt ?? 3) * randRange(rng, 0.6, 1.4),
      );
    case "spin":
      return randInt(rng, 12, explodeAt ? 60 : 140);
    case "booster_failure":
      return randInt(rng, 90, 420);
    case "stage_malfunction":
      return randInt(rng, 40, 160);
    case "payload_early":
      return randInt(rng, 60, 200);
  }
}

const HEADLINES: Record<Outcome, [string, MissionReport["grade"]]> = {
  orbit: ["ORBIT ACHIEVED", "success"],
  lunar: ["MOON REACHED", "success"],
  mars: ["WELCOME TO MARS", "success"],
  against_all_odds: ["SOMEHOW SUCCESSFUL", "success"],
  booster_failure: ["MOSTLY SUCCESSFUL", "partial"],
  payload_early: ["TECHNICALLY A DELIVERY", "partial"],
  spin: ["UNEXPECTED SPIN", "partial"],
  stage_malfunction: ["STAGE MALFUNCTION", "failure"],
  explode: ["RAPID UNSCHEDULED DISASSEMBLY", "failure"],
  fizzle: ["IT DID NOT LEAVE", "failure"],
};

/** Formats an altitude in a readable, slightly dramatic way. */
export function formatAltitude(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km >= 1_000_000) return `${(km / 1_000_000).toFixed(0)} million km`;
  return `${km.toLocaleString("en-US")} km`;
}

/** Builds the mission report card. */
function buildReport(
  config: RocketConfig,
  stats: SimulatedStats,
  outcome: Outcome,
  altitudeKm: number,
  rng: Rng,
): MissionReport {
  const [headline, grade] = HEADLINES[outcome];
  const crewed = config.payload.crew > 0;
  const payload: Record<Outcome, string[]> = {
    orbit: ["Delivered", "Deployed on schedule"],
    lunar: ["On the Moon (roughly)", "Delivered to lunar vicinity"],
    mars: ["Delivered. Eventually.", "On Mars. Probably."],
    against_all_odds: ["Somehow intact", "Fine, against all reason"],
    booster_failure: ["Intact, rattled", "Mostly where it should be"],
    payload_early: [
      "Deployed early. Somewhere.",
      "Released at the wrong altitude",
    ],
    spin: ["Somehow intact", "Extremely well mixed"],
    stage_malfunction: ["In the ocean", "Returned to Earth prematurely"],
    explode: ["Scattered artistically", "Distributed across the county"],
    fizzle: ["Still on the pad", "Embarrassed"],
  };
  const crew: Record<Outcome, string[]> = {
    orbit: ["Thrilled", "Waving at the camera"],
    lunar: ["Emotional", "Taking selfies"],
    mars: ["Long-haul tired", "Asking about snacks"],
    against_all_odds: ["In disbelief", "Crying (happy)"],
    booster_failure: ["Concerned", "Filing a complaint"],
    payload_early: ["Confused", "Asking questions"],
    spin: ["Dizzy", "Nauseous but proud"],
    stage_malfunction: ["Safely ejected. Soggy.", "Swimming home"],
    explode: ["Safely ejected. Furious.", "Parachuting, unimpressed"],
    fizzle: ["Embarrassed", "Went home early"],
  };
  const succeeded = grade === "success";
  const recovery =
    config.legs && succeeded
      ? pick(rng, ["Landed! (mostly)", "Landed on the third try"])
      : pick(rng, [
          "Absolutely not",
          "Not even a little",
          "Some pieces, from the ocean",
        ]);
  const quips: Record<MissionReport["grade"], string[]> = {
    success: [
      "The engineers are pretending they expected this.",
      "Mission control is high-fiving nervously.",
      "Nobody is more surprised than me.",
    ],
    partial: [
      "We're calling this a success in the press release.",
      "The data is 'interesting'.",
      "Some of it went to space. That counts.",
    ],
    failure: [
      "On the bright side, excellent footage.",
      "We learned a lot. Mostly about fire.",
      "Let's call it a very loud test.",
    ],
  };
  return {
    headline: `MISSION: ${headline}`,
    grade,
    chaos: stats.chaos,
    quip: pick(rng, quips[grade]),
    rows: [
      { label: "ALTITUDE", value: formatAltitude(altitudeKm) },
      { label: "PAYLOAD", value: pick(rng, payload[outcome]) },
      {
        label: "CREW STATUS",
        value: crewed ? pick(rng, crew[outcome]) : "No crew. Smart.",
      },
      { label: "VEHICLE RECOVERY", value: recovery },
      { label: "CHAOS RATING", value: `${stats.chaos}/100` },
    ],
  };
}

/** Summarises a launch for the AI repair prompt. */
export function summarizeMission(
  config: RocketConfig,
  plan: LaunchPlan,
): MissionSummary {
  const problems: string[] = [];
  if (plan.stats.reliability < 50)
    problems.push(`fictional reliability ${plan.stats.reliability}%`);
  if (plan.stats.chaos > 50) problems.push(`chaos ${plan.stats.chaos}/100`);
  if (config.boosters.length > 6)
    problems.push(`${config.boosters.length} boosters`);
  if (config.tilt) problems.push(`mounted at ${config.tilt} degrees`);
  if (!config.fins) problems.push("no fins");
  if (thrustToWeight(plan.stats) < 1)
    problems.push("not enough fictional thrust to lift off");
  return { outcome: plan.outcome, headline: plan.report.headline, problems };
}
