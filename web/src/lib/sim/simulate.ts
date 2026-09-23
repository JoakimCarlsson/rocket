import type { MissionSummary } from "../ai/provider";
import {
  allOwners,
  buildVehicle,
  burnPhases,
  fullTanks,
  PROPELLANTS,
  staticMargin,
} from "../rocket/physics";
import { createRng, hashString, pick, type Rng } from "../rocket/random";
import { computeStats } from "../rocket/stats";
import type {
  Destination,
  RocketConfig,
  SimulatedStats,
} from "../rocket/types";
import {
  type FlightEvent,
  type FlightResult,
  type FlightSample,
  flyRocket,
} from "./flight";

/** Every way a launch can end. */
export type Outcome =
  | "orbit"
  | "lunar"
  | "mars"
  | "solar"
  | "hop"
  | "parked"
  | "escape"
  | "suborbital"
  | "booster_failure"
  | "against_all_odds"
  | "payload_early"
  | "stage_malfunction"
  | "spin"
  | "breakup"
  | "crash"
  | "explode"
  | "fizzle";

/** A timed moment in the launch animation, in seconds after ignition. */
export type LaunchEvent =
  | { t: number; type: "liftoff" }
  | { t: number; type: "maxq" }
  | { t: number; type: "booster_sep" }
  | { t: number; type: "stage_sep"; stageId: string }
  | { t: number; type: "fairing_sep" }
  | { t: number; type: "engine_out"; groupId: string }
  | { t: number; type: "booster_fail"; boosterId: string }
  | { t: number; type: "spin" }
  | { t: number; type: "payload_pop" }
  | { t: number; type: "stall"; stageId: string }
  | { t: number; type: "burnout" }
  | { t: number; type: "explode" }
  | { t: number; type: "impact" }
  | { t: number; type: "tip_over" }
  | { t: number; type: "wobble" }
  | { t: number; type: "arrive" };

/** One labelled row on the mission report card. */
export interface ReportRow {
  label: string;
  value: string;
}

/** What one stage or booster set did, for the staging breakdown. */
export interface StagingRow {
  label: string;
  propellant: string;
  deltaV: number;
  burned: number;
  status: "nominal" | "engine out" | "failed" | "unused" | "spare fuel";
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
  trajectory: FlightSample[];
  milestones: FlightEvent[];
  timeScale: number;
  staging: StagingRow[];
}

const LIFTOFF_AT = 1.2;
const MIN_EVENT_GAP = 0.6;

/** Runs the physics flight for a rocket and turns it into an animated, reported launch. */
export function simulateLaunch(
  config: RocketConfig,
  attempt: number,
): LaunchPlan {
  const seed = hashString(`${JSON.stringify(config)}#${attempt}`);
  const rng = createRng(seed);
  const stats = computeStats(config);
  const flight = flyRocket(config, rng, stats.chaos);
  const outcome = outcomeOf(config, flight, stats);
  const timeScale = Math.min(1.1, 22 / Math.sqrt(Math.max(1, flight.duration)));
  const events =
    outcome === "fizzle"
      ? padEvents(rng)
      : animateEvents(flight.events, outcome, timeScale, flight);
  const last = Math.max(...events.map((e) => e.t));
  const fiery = outcome === "explode" || outcome === "fizzle";
  return {
    seed,
    outcome,
    duration:
      last + (fiery || events.some((e) => e.type === "impact") ? 3.5 : 2.5),
    events,
    altitudeKm: flight.maxAltitude / 1000,
    report: buildReport(config, stats, outcome, flight, rng),
    stats,
    trajectory: flight.samples,
    milestones: flight.events,
    timeScale,
    staging: stagingRows(config, flight),
  };
}

/** Converts animation seconds after ignition to flight seconds. */
export function flightTime(plan: LaunchPlan, animationTime: number): number {
  const t = Math.max(0, animationTime - LIFTOFF_AT) / plan.timeScale;
  return t * t;
}

/** Converts flight seconds to animation seconds after ignition. */
function animationTime(flightSeconds: number, timeScale: number): number {
  return LIFTOFF_AT + timeScale * Math.sqrt(Math.max(0, flightSeconds));
}

/** Interpolates altitude (m) and speed (m/s) from the trajectory at an animation time. */
export function telemetryAt(
  plan: LaunchPlan,
  animationSeconds: number,
): { altitude: number; speed: number; pitch: number } {
  const samples = plan.trajectory;
  if (!samples.length || animationSeconds <= LIFTOFF_AT)
    return { altitude: 0, speed: 0, pitch: 0 };
  const t = flightTime(plan, animationSeconds);
  const i = samples.findIndex((s) => s.t >= t);
  if (i <= 0) {
    const s = samples[i < 0 ? samples.length - 1 : 0];
    const f = i === 0 ? t / Math.max(0.001, s.t) : 1;
    return { altitude: s.altitude * f, speed: s.speed * f, pitch: s.pitch };
  }
  const a = samples[i - 1];
  const b = samples[i];
  const f = (t - a.t) / Math.max(0.001, b.t - a.t);
  return {
    altitude: a.altitude + (b.altitude - a.altitude) * f,
    speed: a.speed + (b.speed - a.speed) * f,
    pitch: a.pitch + (b.pitch - a.pitch) * f,
  };
}

const GOAL_OUTCOME: Record<Destination, Outcome> = {
  orbit: "orbit",
  moon: "lunar",
  mars: "mars",
  sun: "solar",
  nowhere: "hop",
};

/** Maps the physical end of a flight onto a game outcome. */
function outcomeOf(
  config: RocketConfig,
  flight: FlightResult,
  stats: SimulatedStats,
): Outcome {
  switch (flight.end) {
    case "pad":
      return "fizzle";
    case "goal":
      if (flight.events.some((e) => e.type === "booster_fail"))
        return "booster_failure";
      if (stats.reliability < 45) return "against_all_odds";
      return GOAL_OUTCOME[config.destination];
    case "orbit":
      return "parked";
    case "escape":
      return "escape";
    case "suborbital":
      return "suborbital";
    case "payload":
      return "payload_early";
    case "stall":
      return "stage_malfunction";
    case "spin":
      return "spin";
    case "breakup":
      return "breakup";
    case "explode":
      return "explode";
    case "crash":
      return "crash";
  }
}

/** The pad sequence for a rocket that cannot lift itself. */
function padEvents(rng: Rng): LaunchEvent[] {
  const events: LaunchEvent[] = [
    { t: 1.5, type: "wobble" },
    { t: 4.2, type: "tip_over" },
  ];
  if (rng() < 0.5) events.push({ t: 6.2, type: "explode" });
  return events;
}

/** Converts flight events into animation cues on a compressed clock. */
function animateEvents(
  flightEvents: FlightEvent[],
  outcome: Outcome,
  timeScale: number,
  flight: FlightResult,
): LaunchEvent[] {
  const events: LaunchEvent[] = [];
  let previous = 0;
  const at = (t: number) => {
    const next = Math.max(
      animationTime(t, timeScale),
      previous + MIN_EVENT_GAP,
    );
    previous = next;
    return next;
  };
  for (const e of flightEvents) {
    const id = e.id ?? "";
    switch (e.type) {
      case "liftoff":
        events.push({ t: (previous = LIFTOFF_AT), type: "liftoff" });
        break;
      case "stage_sep":
        events.push({ t: at(e.t), type: "stage_sep", stageId: id });
        break;
      case "stall":
        events.push({ t: at(e.t), type: "stall", stageId: id });
        break;
      case "engine_out":
        events.push({ t: at(e.t), type: "engine_out", groupId: id });
        break;
      case "booster_fail":
        events.push({ t: at(e.t), type: "booster_fail", boosterId: id });
        break;
      case "orbit":
        break;
      case "maxq":
      case "booster_sep":
      case "fairing_sep":
      case "spin":
      case "payload_pop":
      case "burnout":
      case "explode":
      case "impact":
      case "wobble":
        events.push({ t: at(e.t), type: e.type });
        break;
    }
  }
  const ended = events.some((e) => e.type === "explode" || e.type === "impact");
  if (!ended && GRADES[outcome][1] !== "failure")
    events.push({ t: at(flight.duration) + 0.4, type: "arrive" });
  return events.sort((a, b) => a.t - b.t);
}

const GRADES: Record<Outcome, [string, MissionReport["grade"]]> = {
  orbit: ["ORBIT ACHIEVED", "success"],
  lunar: ["MOON REACHED", "success"],
  mars: ["WELCOME TO MARS", "success"],
  solar: ["FALLING INTO THE SUN", "success"],
  hop: ["HOP COMPLETE", "success"],
  against_all_odds: ["SOMEHOW SUCCESSFUL", "success"],
  booster_failure: ["MOSTLY SUCCESSFUL", "partial"],
  parked: ["PARKED IN ORBIT", "partial"],
  escape: ["ESCAPED EARTH, MISSED TARGET", "partial"],
  suborbital: ["SPACE, BRIEFLY", "partial"],
  payload_early: ["TECHNICALLY A DELIVERY", "partial"],
  stage_malfunction: ["STAGE MALFUNCTION", "failure"],
  spin: ["LOSS OF CONTROL", "failure"],
  breakup: ["AERODYNAMIC DISASSEMBLY", "failure"],
  crash: ["OUT OF PUFF", "failure"],
  explode: ["RAPID UNSCHEDULED DISASSEMBLY", "failure"],
  fizzle: ["IT DID NOT LEAVE", "failure"],
};

/** Formats an altitude in a readable, slightly dramatic way. */
export function formatAltitude(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km >= 1_000_000) return `${(km / 1_000_000).toFixed(0)} million km`;
  return `${Math.round(km).toLocaleString("en-US")} km`;
}

/** Describes where the vehicle ended up. */
function whereabouts(outcome: Outcome, flight: FlightResult): string {
  if (outcome === "lunar") return "Trans-lunar injection";
  if (flight.excessSpeed > 0)
    return `Escape, v∞ ${(flight.excessSpeed / 1000).toFixed(1)} km/s`;
  if (
    flight.perigee !== null &&
    flight.apogee !== null &&
    flight.perigee > 100_000
  )
    return `${formatAltitude(flight.perigee / 1000)} × ${formatAltitude(flight.apogee / 1000)}`;
  return `Peak ${formatAltitude(flight.maxAltitude / 1000)}`;
}

/** Builds the mission report card. */
function buildReport(
  config: RocketConfig,
  stats: SimulatedStats,
  outcome: Outcome,
  flight: FlightResult,
  rng: Rng,
): MissionReport {
  const [headline, grade] = GRADES[outcome];
  const { payload } = config;
  const crewed = payload.crew > 0;
  const succeeded = grade === "success";
  const cargo: Partial<Record<Outcome, string[]>> = {
    lunar: ["On its way to the Moon", "Moon-bound, three days out"],
    mars: ["Mars-bound. Seven months.", "On a Mars transfer"],
    solar: ["Falling into the Sun. On purpose.", "Extremely warm"],
    hop: ["Went up, came down", "Briefly in space"],
    parked: ["Delivered to the wrong orbit", "Waiting for a lift"],
    escape: ["Orbiting the Sun instead", "Lost to deep space"],
    suborbital: ["Saw space, came back", "Brief weightlessness achieved"],
    payload_early: [
      "Deployed early. Somewhere.",
      "Released at the wrong altitude",
    ],
    booster_failure: ["Intact, rattled", "Mostly where it should be"],
    stage_malfunction: ["In the ocean", "Returned to Earth prematurely"],
    spin: ["Extremely well mixed", "Distributed over a wide area"],
    breakup: ["Shredded by the air", "Now confetti"],
    crash: ["Returned to Earth. Firmly.", "Lithobraked"],
    explode: ["Scattered artistically", "Distributed across the county"],
    fizzle: ["Still on the pad", "Embarrassed"],
  };
  const payloadRow = cargo[outcome]
    ? pick(rng, cargo[outcome])
    : pick(rng, ["Delivered", "Deployed on schedule"]);

  const g = flight.maxG;
  let crewRow = "No crew. Smart.";
  if (crewed) {
    if (succeeded || grade === "partial") {
      const ride =
        g > 8
          ? `Flattened at ${g.toFixed(1)} g`
          : g > 5
            ? "Heavy but fine"
            : "Comfortable";
      const home =
        payload.heatShield && payload.parachutes
          ? "can come home"
          : payload.heatShield
            ? "no parachutes for the way home"
            : "no heat shield, so they live there now";
      crewRow = `${ride}, ${home}`;
    } else if (outcome === "fizzle") {
      crewRow = "Embarrassed, went home early";
    } else {
      crewRow = payload.parachutes
        ? pick(rng, [
            "Aborted and parachuted. Furious.",
            "Safely ejected. Soggy.",
          ])
        : "No parachutes. Deeply unimpressed.";
    }
  }

  const landed = config.legs && flight.firstStageLanded;
  const recovery = landed
    ? "First stage landed"
    : config.legs
      ? "First stage tried to land"
      : "Nothing. It's all in the ocean";

  const anomalies: string[] = [];
  if (flight.engineOuts)
    anomalies.push(
      `${flight.engineOuts} engine${flight.engineOuts > 1 ? "s" : ""} out`,
    );
  if (flight.events.some((e) => e.type === "booster_fail"))
    anomalies.push("booster failure");
  if (flight.events.some((e) => e.type === "spin"))
    anomalies.push("lost control");
  if (flight.events.some((e) => e.type === "stall"))
    anomalies.push("stage did not light");

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
  const rows: ReportRow[] = [
    { label: "ALTITUDE", value: whereabouts(outcome, flight) },
    { label: "MAX-Q", value: `${(flight.maxQ / 1000).toFixed(1)} kPa` },
    { label: "PEAK LOAD", value: `${flight.maxG.toFixed(1)} g` },
    {
      label: "Δv SPENT",
      value: `${Math.round(flight.deltaVUsed).toLocaleString("en-US")} m/s`,
    },
    { label: "PAYLOAD", value: payloadRow },
    { label: "CREW STATUS", value: crewRow },
    { label: "RECOVERY", value: recovery },
  ];
  if (anomalies.length)
    rows.push({ label: "ANOMALIES", value: anomalies.join(", ") });
  return {
    headline: `MISSION: ${headline}`,
    grade,
    chaos: stats.chaos,
    quip: pick(rng, quips[grade]),
    rows,
  };
}

/** Summarises what each stage did against its rocket-equation budget. */
function stagingRows(config: RocketConfig, flight: FlightResult): StagingRow[] {
  const phases = burnPhases(buildVehicle(config));
  const deltaVOf = (label: string) =>
    phases
      .filter((p) => p.label === label || p.label.startsWith(`${label} +`))
      .reduce((sum, p) => sum + p.deltaV, 0);
  const engineOuts = new Set(
    flight.events.filter((e) => e.type === "engine_out").map((e) => e.id),
  );
  const rows: StagingRow[] = config.stages.map((stage, i) => {
    const usage = flight.usage.find((u) => u.key === `stage:${stage.id}`);
    const burned = Math.max(0, Math.min(1, usage?.burned ?? 0));
    return {
      label: `STAGE ${i + 1}`,
      propellant: PROPELLANTS[stage.propellant].label,
      deltaV: deltaVOf(`S${i + 1}`),
      burned,
      status: usage?.failed
        ? "failed"
        : engineOuts.has(stage.id)
          ? "engine out"
          : !usage?.ignited || burned < 0.01
            ? "unused"
            : burned < 0.97
              ? "spare fuel"
              : "nominal",
    };
  });
  if (config.boosters.length) {
    const usages = flight.usage.filter((u) => u.key.startsWith("booster:"));
    const burned =
      usages.reduce((sum, u) => sum + Math.max(0, Math.min(1, u.burned)), 0) /
      usages.length;
    rows.unshift({
      label: `BOOSTERS ×${config.boosters.length}`,
      propellant: PROPELLANTS[config.boosters[0].propellant].label,
      deltaV: 0,
      burned,
      status: usages.some((u) => u.failed)
        ? "failed"
        : burned < 0.97
          ? "spare fuel"
          : "nominal",
    });
  }
  return rows;
}

/** Summarises a launch for the AI repair prompt, naming the physical causes. */
export function summarizeMission(
  config: RocketConfig,
  plan: LaunchPlan,
): MissionSummary {
  const { stats } = plan;
  const problems: string[] = [];
  const vehicle = buildVehicle(config);
  if (stats.twr < 1.15)
    problems.push(`liftoff thrust-to-weight ${stats.twr} (wants 1.2 to 1.6)`);
  if (stats.deltaV < stats.deltaVNeeded)
    problems.push(
      `delta-v ${stats.deltaV} m/s of ${stats.deltaVNeeded} m/s needed for ${config.destination}`,
    );
  const margin = staticMargin(vehicle, allOwners(vehicle), fullTanks(vehicle));
  if (plan.outcome === "spin")
    problems.push(
      `lost aerodynamic control: static margin ${margin.toFixed(1)} calibers${vehicle.stages.some((s) => s.gimbal) ? "" : ", no gimballed engines"}`,
    );
  if (plan.outcome === "breakup")
    problems.push(
      "dynamic pressure exceeded what the structure takes: too slender or too fast low down",
    );
  if (plan.outcome === "stage_malfunction")
    problems.push("an upper stage failed to ignite");
  if (plan.outcome === "explode")
    problems.push("hardware failure; high engine power raises the odds");
  if (plan.outcome === "payload_early")
    problems.push(
      "payload came loose; silly decorations and a missing nose make that likelier",
    );
  if (config.stages[0]?.engine.style === "flared")
    problems.push(
      "vacuum-flared nozzles on the first stage lose thrust at sea level",
    );
  if (stats.reliability < 60)
    problems.push(`hardware reliability ${stats.reliability}%`);
  if (config.tilt) problems.push(`mounted at ${config.tilt} degrees`);
  if (config.payload.crew > 0 && !config.payload.heatShield)
    problems.push("crew has no heat shield");
  return { outcome: plan.outcome, headline: plan.report.headline, problems };
}
