import { request } from "@/lib/api";
import type { RocketConfig, SimulatedStats } from "@/lib/rocket/types";

/** One burn of the rocket-equation staging breakdown. */
export interface Burn {
  label: string;
  deltaV: number;
  twr: number;
  burnTime: number;
  propellant: string;
}

/** A physical reason a design cannot do its mission. */
export interface DesignProblem {
  key: "twr" | "deltaV" | "stability" | "crew";
  text: string;
}

/** Everything the build panel needs about a rocket, derived by the server. */
export interface Analysis {
  stats: SimulatedStats;
  staging: Burn[];
  problems: DesignProblem[];
}

/** Something that happened during a flight, in flight seconds after ignition. */
export type FlightEventType =
  | "liftoff"
  | "maxq"
  | "booster_sep"
  | "stage_sep"
  | "fairing_sep"
  | "engine_out"
  | "booster_fail"
  | "stall"
  | "spin"
  | "payload_pop"
  | "explode"
  | "burnout"
  | "impact"
  | "orbit"
  | "wobble";

/** A timed flight event. `id` names the stage or booster involved. */
export interface FlightEvent {
  t: number;
  type: FlightEventType;
  id?: string;
}

/** One recorded point of the trajectory. */
export interface FlightSample {
  t: number;
  altitude: number;
  downrange: number;
  speed: number;
  pitch: number;
  aoa: number;
  q: number;
  mach: number;
  throttle: number;
  g: number;
  climb: number;
  ground: number;
}

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

/** One labelled row on the mission report card. */
export interface ReportRow {
  label: string;
  value: string;
}

/** The mission report card. */
export interface MissionReport {
  headline: string;
  grade: "success" | "partial" | "failure";
  rows: ReportRow[];
  quip: string;
  chaos: number;
}

/** What one stage or booster set did. */
export interface StagingRow {
  label: string;
  propellant: string;
  deltaV: number;
  burned: number;
  status: "nominal" | "engine out" | "failed" | "unused" | "spare fuel";
}

/** A compact description of a launch, used by AI repair. */
export interface MissionSummary {
  outcome: Outcome;
  headline: string;
  problems: string[];
}

/** A launch as the server flew it. */
export interface Flight {
  seed: number;
  outcome: Outcome;
  duration: number;
  altitudeKm: number;
  report: MissionReport;
  stats: SimulatedStats;
  trajectory: FlightSample[];
  milestones: FlightEvent[];
  staging: StagingRow[];
  mission: MissionSummary;
}

/** The first launch of a published rocket, flown by the server. */
export interface LaunchSummary {
  outcome: Outcome;
  headline: string;
  grade: MissionReport["grade"];
  stats: SimulatedStats;
}

/** A tuned engine size and power for one stage or booster. */
export interface EngineSetting {
  id: string;
  size: number;
  power: number;
}

const analyses = new Map<string, Promise<Analysis>>();
const ANALYSIS_CACHE = 64;

/** Asks the server to analyse a rocket. Identical rockets share one request. */
export function analyzeRocket(rocket: RocketConfig): Promise<Analysis> {
  const key = JSON.stringify(rocket);
  const cached = analyses.get(key);
  if (cached) return cached;
  const pending = request<Analysis>("/api/physics/analyze", {
    method: "POST",
    json: { rocket },
  });
  pending.catch(() => analyses.delete(key));
  analyses.set(key, pending);
  if (analyses.size > ANALYSIS_CACHE)
    analyses.delete(analyses.keys().next().value as string);
  return pending;
}

/** Asks the server to fly a rocket. The same rocket and attempt always fly the same way. */
export function launchRocket(
  rocket: RocketConfig,
  attempt: number,
): Promise<Flight> {
  return request<Flight>("/api/physics/launch", {
    method: "POST",
    json: { rocket, attempt },
  });
}

/** Asks the server for engine settings that make a random rocket flyable, and applies them. */
export async function tuneRocket(rocket: RocketConfig): Promise<RocketConfig> {
  const { engines } = await request<{ engines: EngineSetting[] }>(
    "/api/physics/tune",
    { method: "POST", json: { rocket } },
  );
  const byId = new Map(engines.map((e) => [e.id, e]));
  const tune = <
    T extends { id: string; engine: RocketConfig["stages"][number]["engine"] },
  >(
    part: T,
  ): T => {
    const setting = byId.get(part.id);
    return setting
      ? {
          ...part,
          engine: { ...part.engine, size: setting.size, power: setting.power },
        }
      : part;
  };
  return {
    ...rocket,
    stages: rocket.stages.map(tune),
    boosters: rocket.boosters.map(tune),
  };
}
