import { makeId } from "./ids";
import { BOOSTER_TOPS } from "./parts";
import {
  chance,
  createRng,
  pick,
  type Rng,
  randInt,
  randRange,
} from "./random";
import type {
  Booster,
  DecorKind,
  DecorPart,
  EngineSpec,
  Finish,
  FinShape,
  NozzleStyle,
  Pattern,
  PayloadKind,
  Propellant,
  RocketConfig,
  Stage,
  TopKind,
} from "./types";

/** Name given to rockets before the AI has christened them. */
export const DEFAULT_NAME = "UNTITLED VEHICLE";

/** Builds an engine spec with sensible defaults. */
export function createEngine(overrides: Partial<EngineSpec> = {}): EngineSpec {
  return {
    count: 1,
    size: 1,
    power: 5,
    style: "bell",
    gimbal: true,
    color: "#2a2d33",
    ...overrides,
  };
}

/** Builds a core stage with sensible defaults. */
export function createStage(
  overrides: Partial<Stage> = {},
  rng: Rng = Math.random,
): Stage {
  return {
    id: makeId("stg", rng),
    height: 20,
    radius: 2.2,
    taper: 0,
    color: null,
    propellant: "kerolox",
    engine: createEngine({ count: 1, size: 1 }),
    ...overrides,
  };
}

/** Builds a side booster with sensible defaults. */
export function createBooster(
  overrides: Partial<Booster> = {},
  rng: Rng = Math.random,
): Booster {
  return {
    id: makeId("bst", rng),
    height: 18,
    radius: 1,
    color: null,
    top: "cone",
    propellant: "solid",
    engine: createEngine({ count: 1, size: 0.8, gimbal: false }),
    ...overrides,
  };
}

/** The polished rocket shown on first visit. */
export function createStarterRocket(): RocketConfig {
  const rng = createRng(7);
  return {
    version: 1,
    name: DEFAULT_NAME,
    seed: 7,
    destination: "orbit",
    tilt: 0,
    stages: [
      createStage(
        {
          height: 30,
          radius: 2.4,
          engine: createEngine({ count: 5, size: 0.9, power: 5 }),
        },
        rng,
      ),
      createStage(
        {
          height: 14,
          radius: 2.4,
          taper: 0.12,
          engine: createEngine({ count: 1, size: 1.1, power: 4 }),
        },
        rng,
      ),
    ],
    boosters: [
      createBooster({ height: 22, radius: 1.1 }, rng),
      createBooster({ height: 22, radius: 1.1 }, rng),
    ],
    payload: {
      id: makeId("pld", rng),
      kind: "capsule",
      height: 5,
      crew: 3,
      color: null,
      top: "ogive",
      topColor: null,
      heatShield: true,
      parachutes: true,
    },
    fins: {
      id: makeId("fin", rng),
      count: 4,
      size: 1.2,
      shape: "swept",
      color: null,
    },
    legs: null,
    decorativeParts: [
      {
        id: makeId("dec", rng),
        kind: "windows",
        attach: "payload",
        count: 3,
        size: 1,
        color: null,
      },
    ],
    shapes: [],
    appearance: {
      primary: "#e9e7e2",
      secondary: "#17181c",
      accent: "#ff5b1f",
      finish: "satin",
      pattern: "bands",
      glow: "#ffb070",
    },
  };
}

const PALETTES: [string, string, string][] = [
  ["#e9e7e2", "#17181c", "#ff5b1f"],
  ["#111214", "#c9a24a", "#ffcc66"],
  ["#d8dde3", "#3355ff", "#ffffff"],
  ["#f1ede4", "#b3261e", "#1c1c1c"],
  ["#2c3a2f", "#e3d9b0", "#ff7a00"],
  ["#ff4fa3", "#fff04d", "#2cd4ff"],
  ["#9fb0bf", "#1e2a35", "#7cf2c6"],
  ["#f5f5f5", "#ff5b1f", "#101010"],
];

const FINISHES: Finish[] = ["matte", "satin", "metallic", "chrome", "glossy"];
const PATTERNS: Pattern[] = ["solid", "stripes", "bands", "checker", "split"];
const TOPS: TopKind[] = ["cone", "ogive", "needle", "blunt", "dome", "spike"];
const PAYLOADS: PayloadKind[] = [
  "capsule",
  "fairing",
  "satellite",
  "cargo",
  "habitat",
];
const NOZZLES: NozzleStyle[] = ["bell", "aerospike", "flared", "trumpet"];
const PROPELLANT_CHOICES: Propellant[] = [
  "kerolox",
  "kerolox",
  "methalox",
  "hydrolox",
];
const FINS: FinShape[] = ["delta", "swept", "grid", "tiny", "shark"];
const DECOR: DecorKind[] = [
  "antenna",
  "ring",
  "solarPanels",
  "spikes",
  "lights",
  "wings",
  "flag",
  "windows",
];

/** Builds a fully random but always valid rocket from a seed. Its engines are untuned; the server sizes them. */
export function createRandomRocket(seed: number): RocketConfig {
  const rng = createRng(seed);
  const [primary, secondary, accent] = pick(rng, PALETTES);
  const stageCount = randInt(rng, 1, 4);
  const baseRadius = randRange(rng, 1.6, 3.6);
  const stages: Stage[] = [];
  for (let i = 0; i < stageCount; i++) {
    stages.push(
      createStage(
        {
          height: randRange(rng, 10, 32) * (i === 0 ? 1.2 : 0.8),
          radius: baseRadius * (1 - i * randRange(rng, 0, 0.18)),
          taper: chance(rng, 0.3) ? randRange(rng, 0.05, 0.25) : 0,
          propellant: pick(rng, PROPELLANT_CHOICES),
          engine: createEngine({
            count: i === 0 ? pick(rng, [1, 3, 5, 7, 9]) : 1,
            size: randRange(rng, 0.7, 1.4),
            power: randInt(rng, 3, 8),
            style: pick(rng, NOZZLES),
          }),
        },
        rng,
      ),
    );
  }
  const boosterCount = pick(rng, [0, 0, 2, 2, 3, 4, 6]);
  const boosterHeight = stages[0].height * randRange(rng, 0.6, 0.95);
  const boosters = Array.from({ length: boosterCount }, () =>
    createBooster(
      {
        height: boosterHeight,
        radius: baseRadius * randRange(rng, 0.3, 0.5),
        top: pick(rng, BOOSTER_TOPS),
      },
      rng,
    ),
  );
  const decorCount = randInt(rng, 0, 3);
  const decorativeParts: DecorPart[] = Array.from(
    { length: decorCount },
    () => {
      const kind = pick(rng, DECOR);
      return {
        id: makeId("dec", rng),
        kind,
        attach:
          kind === "wings"
            ? ("bottom" as const)
            : pick(rng, ["top", "payload", "core", "bottom"] as const),
        count: randInt(rng, 1, 4),
        size: randRange(rng, 0.7, 1.4),
        color: null,
      };
    },
  );
  const payloadKind = pick(rng, PAYLOADS);
  return {
    version: 1,
    name: DEFAULT_NAME,
    seed,
    destination: pick(rng, ["orbit", "orbit", "moon", "mars"] as const),
    tilt: 0,
    stages,
    boosters,
    payload: {
      id: makeId("pld", rng),
      kind: payloadKind,
      height: randRange(rng, 4, 9),
      crew:
        payloadKind === "capsule" || payloadKind === "habitat"
          ? randInt(rng, 1, 6)
          : 0,
      color: null,
      top: pick(rng, TOPS),
      topColor: null,
      heatShield: payloadKind === "capsule" && chance(rng, 0.8),
      parachutes: payloadKind === "capsule" && chance(rng, 0.8),
    },
    fins: chance(rng, 0.7)
      ? {
          id: makeId("fin", rng),
          count: pick(rng, [3, 4, 4, 6]),
          size: randRange(rng, 0.8, 1.8),
          shape: pick(rng, FINS),
          color: null,
        }
      : null,
    legs: chance(rng, 0.3)
      ? { id: makeId("leg", rng), count: 4, size: 1 }
      : null,
    decorativeParts,
    shapes: [],
    appearance: {
      primary,
      secondary,
      accent,
      finish: pick(rng, FINISHES),
      pattern: pick(rng, PATTERNS),
      glow: pick(rng, ["#ffb070", "#7cc8ff", "#b28cff", "#8dffb0"]),
    },
  };
}
