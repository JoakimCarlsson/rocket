import type {
  EngineSpec,
  RocketConfig,
  SimulatedStats,
  Stage,
  TopKind,
} from "./types";

const TOP_HEIGHT_FACTOR: Record<TopKind, number> = {
  cone: 1.7,
  ogive: 2.1,
  needle: 3.6,
  blunt: 0.7,
  dome: 1,
  spike: 3,
  none: 0,
};

const SILLY_DECOR = new Set(["googlyEyes", "duck", "propeller", "spikes"]);

/** Returns the height of the top cap for a given core radius. */
export function topHeight(top: TopKind, radius: number): number {
  return TOP_HEIGHT_FACTOR[top] * radius;
}

/** Returns the radius of the uppermost stage, which the payload sits on. */
export function upperRadius(config: RocketConfig): number {
  const top = config.stages[config.stages.length - 1];
  return top ? top.radius * (1 - top.taper) : 2;
}

/** Returns the height of the adapter section joining two stacked stages. */
export function interstageHeight(lower: Stage, upper: Stage): number {
  return (
    1.2 +
    Math.abs(lower.radius * (1 - lower.taper) - upper.radius) * 0.9 +
    upper.engine.size * 0.6
  );
}

/** Returns the rendered height of the payload section. */
export function payloadHeight(config: RocketConfig): number {
  return config.payload.kind === "none" ? 0 : config.payload.height;
}

/** Returns the full stack height in game metres. */
export function totalHeight(config: RocketConfig): number {
  const stages = config.stages.reduce(
    (sum, stage, index) =>
      sum +
      stage.height +
      (index > 0 ? interstageHeight(config.stages[index - 1], stage) : 0),
    0,
  );
  return (
    stages +
    payloadHeight(config) +
    topHeight(config.payload.top, upperRadius(config))
  );
}

/** Returns the widest horizontal extent of the vehicle, boosters included. */
export function totalWidth(config: RocketConfig): number {
  const core = Math.max(...config.stages.map((stage) => stage.radius), 1);
  const booster = Math.max(0, ...config.boosters.map((b) => b.radius));
  return (core + booster * 2) * 2;
}

/** Fictional thrust of one engine cluster. */
function clusterThrust(engine: EngineSpec): number {
  return engine.count * engine.size * engine.size * engine.power * 400;
}

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

/**
 * Derives deliberately silly game statistics from a configuration.
 * None of these numbers model real vehicles; they exist to react to prompts.
 */
export function computeStats(config: RocketConfig): SimulatedStats {
  const height = totalHeight(config);
  const coreMass = config.stages.reduce(
    (sum, s) => sum + Math.PI * s.radius * s.radius * s.height ** 0.7 * 1.6,
    0,
  );
  const boosterMass = config.boosters.reduce(
    (sum, b) => sum + Math.PI * b.radius * b.radius * b.height ** 0.7 * 1.6,
    0,
  );
  const extraMass =
    config.payload.height * 12 +
    decorCount(config) * 3 +
    (config.legs ? 20 : 0);
  const mass = coreMass + boosterMass + extraMass;

  const liftoffThrust =
    clusterThrust(
      config.stages[0]?.engine ?? {
        count: 0,
        size: 0,
        power: 0,
        style: "bell",
        color: "",
      },
    ) + config.boosters.reduce((sum, b) => sum + clusterThrust(b.engine), 0);
  const twr = liftoffThrust / Math.max(1, mass * 9.8);

  const stageCount = config.stages.length;
  const range =
    150 * Math.min(twr, 6) ** 1.6 * 6 ** stageCount * (config.tilt ? 0.6 : 1);

  const parts =
    stageCount +
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
      mass * 0.015 +
      engineCount(config) * 6 +
      config.payload.crew * 9) *
    finishCost;

  const boosters = config.boosters.length;
  const engines = engineCount(config);
  const power = peakPower(config);
  const decor = decorCount(config);
  const sillyDecor = config.decorativeParts.filter((p) =>
    SILLY_DECOR.has(p.kind),
  ).length;
  const slenderness = height / Math.max(1, totalWidth(config));
  const tiltPenalty = Math.abs(config.tilt) / 2.5;

  let reliability = 96;
  reliability -= Math.max(0, boosters - 4) * 4.2;
  reliability -= Math.max(0, engines - 12) * 0.9;
  reliability -= Math.max(0, power - 7) * 6;
  reliability -= tiltPenalty;
  reliability -= decor * 1.4;
  reliability -= twr < 1 ? (1 - twr) * 70 : 0;
  reliability -= twr > 5 ? (twr - 5) * 3 : 0;
  reliability -= slenderness > 14 ? (slenderness - 14) * 2.5 : 0;
  reliability -= Math.max(0, stageCount - 3) * 3;
  reliability += config.fins ? 3 : -2;
  reliability = Math.round(Math.min(99, Math.max(1, reliability)));

  let chaos = 4;
  chaos += boosters * 2.6;
  chaos += decor * 3.5 + sillyDecor * 10;
  chaos += Math.max(0, power - 5) * 5;
  chaos += Math.abs(config.tilt) / 1.8;
  chaos += config.appearance.pattern === "checker" ? 6 : 0;
  chaos += (100 - reliability) * 0.35;
  chaos = Math.round(Math.min(100, Math.max(0, chaos)));

  return {
    height: Math.round(height * 10) / 10,
    mass: Math.round(mass),
    thrust: Math.round(liftoffThrust),
    crew: config.payload.crew,
    range: Math.round(range),
    cost: Math.round(cost),
    reliability,
    chaos,
  };
}

/** Returns the fictional thrust-to-weight figure the simulation relies on. */
export function thrustToWeight(stats: SimulatedStats): number {
  return stats.thrust / Math.max(1, stats.mass * 9.8);
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
