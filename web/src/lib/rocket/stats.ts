import { totalHeight, totalWidth } from "./geometry";
import {
  allOwners,
  attachedMass,
  type BurnPhase,
  buildVehicle,
  burnPhases,
  DELTA_V_NEEDED,
  failureRisks,
  fullTanks,
  G0,
  hardwareReliability,
  staticMargin,
  thrustAt,
} from "./physics";
import type { RocketConfig, SimulatedStats } from "./types";

const SILLY_DECOR = new Set(["googlyEyes", "duck", "propeller", "spikes"]);

/** Counts every engine on the vehicle. */
export function engineCount(config: RocketConfig): number {
  return (
    config.stages.reduce((sum, stage) => sum + stage.engine.count, 0) +
    config.boosters.reduce((sum, booster) => sum + booster.engine.count, 0)
  );
}

/** Returns the most powerful engine setting on the vehicle. */
export function peakPower(config: RocketConfig): number {
  return Math.max(
    ...config.stages.map((stage) => stage.engine.power),
    ...config.boosters.map((booster) => booster.engine.power),
  );
}

/** Counts how many individual decorations are attached. */
export function decorCount(config: RocketConfig): number {
  return config.decorativeParts.reduce((sum, part) => sum + part.count, 0);
}

/** Returns the rocket-equation breakdown of every burn, bottom stage first. */
export function stagingBreakdown(config: RocketConfig): BurnPhase[] {
  return burnPhases(buildVehicle(config));
}

/**
 * Derives the vehicle's statistics from the physics model: mass, liftoff thrust,
 * delta-v, static stability and hardware reliability. Chaos stays a joke meter.
 */
export function computeStats(config: RocketConfig): SimulatedStats {
  const vehicle = buildVehicle(config);
  const attached = allOwners(vehicle);
  const tanks = fullTanks(vehicle);
  const mass = attachedMass(vehicle, attached, tanks);
  const liftoffThrust = [vehicle.stages[0], ...vehicle.boosters]
    .filter(Boolean)
    .reduce((sum, g) => sum + thrustAt(g.perf, 1) * g.engines, 0);
  const twr = liftoffThrust / (mass * G0);
  const deltaV = burnPhases(vehicle).reduce((sum, p) => sum + p.deltaV, 0);
  const reliability = Math.round(
    Math.min(
      99,
      Math.max(1, hardwareReliability(failureRisks(config, vehicle))),
    ),
  );

  const parts =
    config.stages.length +
    config.boosters.length +
    (config.fins ? 1 : 0) +
    (config.legs ? 1 : 0) +
    config.decorativeParts.length;
  const finishCost = {
    matte: 1,
    satin: 1.1,
    metallic: 1.25,
    chrome: 1.8,
    glossy: 1.15,
  }[config.appearance.finish];
  const cost =
    (parts * 14 +
      mass * 0.00002 +
      engineCount(config) * 6 +
      config.payload.crew * 9) *
    finishCost *
    (config.legs ? 0.8 : 1);

  const decor = decorCount(config);
  const sillyDecor = config.decorativeParts.filter((p) =>
    SILLY_DECOR.has(p.kind),
  ).length;
  let chaos = 4;
  chaos += config.boosters.length * 2.6;
  chaos += decor * 3.5 + sillyDecor * 10;
  chaos += Math.max(0, peakPower(config) - 5) * 5;
  chaos += Math.abs(config.tilt) / 1.8;
  chaos += config.appearance.pattern === "checker" ? 6 : 0;
  chaos += (100 - reliability) * 0.35;
  chaos += Math.max(0, totalHeight(config) / totalWidth(config) - 14) * 1.5;
  chaos = Math.round(Math.min(100, Math.max(0, chaos)));

  return {
    height: Math.round(vehicle.height * 10) / 10,
    mass: Math.round(mass / 100) / 10,
    thrust: Math.round(liftoffThrust / 1000),
    twr: Math.round(twr * 100) / 100,
    deltaV: Math.round(deltaV),
    deltaVNeeded: DELTA_V_NEEDED[config.destination],
    stability: Math.round(staticMargin(vehicle, attached, tanks) * 10) / 10,
    crew: config.payload.crew,
    cost: Math.round(cost),
    reliability,
    chaos,
  };
}

/** Tongue-in-cheek readouts shown under the stats. These are jokes, not assessments. */
export function jokeMeters(
  stats: SimulatedStats,
): { label: string; value: string }[] {
  const confidence =
    stats.reliability > 85
      ? "SMUG"
      : stats.reliability > 70
        ? "CAUTIOUS"
        : stats.reliability > 50
          ? "DECLINING"
          : stats.reliability > 30
            ? "IN FREEFALL"
            : "ON VACATION";
  const regulatory =
    stats.chaos < 15
      ? "GRUDGINGLY YES"
      : stats.chaos < 35
        ? "UNDER REVIEW"
        : stats.chaos < 60
          ? "PENDING"
          : stats.chaos < 85
            ? "PENDING FOREVER"
            : "THEY STOPPED ANSWERING";
  const commonSense = Math.max(
    0,
    Math.min(
      100,
      Math.round(100 - stats.chaos * 0.95 - (100 - stats.reliability) * 0.2),
    ),
  );
  return [
    { label: "ENGINEER CONFIDENCE", value: confidence },
    { label: "REGULATORY APPROVAL", value: regulatory },
    { label: "COMMON SENSE", value: `${commonSense}%` },
  ];
}
