import { z } from "zod";
import { resolveColor } from "./colors";
import { createStarterRocket } from "./defaults";
import { LIMITS, clamp, clampInt } from "./limits";
import type { RocketConfig } from "./types";

const color = z.string().transform((value, ctx) => {
  const resolved = resolveColor(value);
  if (!resolved) {
    ctx.addIssue({ code: "custom", message: `Unknown colour ${value}` });
    return z.NEVER;
  }
  return resolved;
});

const id = z.string().regex(/^[a-z]{3}-[a-z0-9]{3,12}$/);

const engine = z.object({
  count: z.number(),
  size: z.number(),
  power: z.number(),
  style: z.enum(["bell", "aerospike", "flared", "trumpet"]),
  color,
});

/** Strict schema for a whole rocket, used when loading shared or stored configurations. */
export const rocketSchema = z.object({
  version: z.literal(1),
  name: z.string().max(80),
  seed: z.number(),
  destination: z.enum(["orbit", "moon", "mars", "sun", "nowhere"]),
  tilt: z.number(),
  stages: z
    .array(z.object({ id, height: z.number(), radius: z.number(), taper: z.number(), color: color.nullable(), engine }))
    .min(1)
    .max(LIMITS.stages),
  boosters: z
    .array(
      z.object({
        id,
        height: z.number(),
        radius: z.number(),
        color: color.nullable(),
        top: z.enum(["cone", "ogive", "blunt"]),
        engine,
      }),
    )
    .max(LIMITS.boosters),
  payload: z.object({
    id,
    kind: z.enum(["capsule", "fairing", "satellite", "cargo", "habitat", "none"]),
    height: z.number(),
    crew: z.number(),
    color: color.nullable(),
    top: z.enum(["cone", "ogive", "needle", "blunt", "dome", "spike", "none"]),
    topColor: color.nullable(),
  }),
  fins: z
    .object({ id, count: z.number(), size: z.number(), shape: z.enum(["delta", "swept", "grid", "tiny", "shark"]), color: color.nullable() })
    .nullable(),
  legs: z.object({ id, count: z.number(), size: z.number() }).nullable(),
  decorativeParts: z
    .array(
      z.object({
        id,
        kind: z.enum([
          "antenna",
          "ring",
          "solarPanels",
          "spikes",
          "lights",
          "wings",
          "flag",
          "googlyEyes",
          "duck",
          "windows",
          "tank",
          "propeller",
        ]),
        attach: z.enum(["top", "payload", "core", "bottom"]),
        count: z.number(),
        size: z.number(),
        color: color.nullable(),
      }),
    )
    .max(LIMITS.decor),
  appearance: z.object({
    primary: color,
    secondary: color,
    accent: color,
    finish: z.enum(["matte", "satin", "metallic", "chrome", "glossy"]),
    pattern: z.enum(["solid", "stripes", "bands", "checker", "split"]),
    glow: color,
  }),
});

/** Clamps every numeric field so any configuration stays inside renderable bounds. */
export function sanitizeRocket(config: RocketConfig): RocketConfig {
  const engineOf = (e: RocketConfig["stages"][number]["engine"]) => ({
    ...e,
    count: clampInt(e.count, [1, LIMITS.engines]),
    size: clamp(e.size, LIMITS.engineSize),
    power: clamp(e.power, LIMITS.power),
  });
  return {
    ...config,
    name: config.name.slice(0, LIMITS.nameLength),
    seed: config.seed >>> 0,
    tilt: clamp(config.tilt, LIMITS.tilt),
    stages: config.stages.slice(0, LIMITS.stages).map((s) => ({
      ...s,
      height: clamp(s.height, LIMITS.stageHeight),
      radius: clamp(s.radius, LIMITS.radius),
      taper: clamp(s.taper, [0, 0.6]),
      engine: engineOf(s.engine),
    })),
    boosters: config.boosters.slice(0, LIMITS.boosters).map((b) => ({
      ...b,
      height: clamp(b.height, LIMITS.boosterHeight),
      radius: clamp(b.radius, LIMITS.boosterRadius),
      engine: engineOf(b.engine),
    })),
    payload: {
      ...config.payload,
      height: clamp(config.payload.height, LIMITS.payloadHeight),
      crew: clampInt(config.payload.crew, LIMITS.crew),
    },
    fins: config.fins
      ? { ...config.fins, count: clampInt(config.fins.count, LIMITS.fins), size: clamp(config.fins.size, LIMITS.finSize) }
      : null,
    legs: config.legs
      ? { ...config.legs, count: clampInt(config.legs.count, LIMITS.legs), size: clamp(config.legs.size, [0.5, 3]) }
      : null,
    decorativeParts: config.decorativeParts.slice(0, LIMITS.decor).map((d) => ({
      ...d,
      count: clampInt(d.count, [1, LIMITS.decorCount]),
      size: clamp(d.size, LIMITS.decorSize),
    })),
  };
}

/** Parses untrusted data into a safe rocket, or returns null when it is not a rocket. */
export function parseRocket(data: unknown): RocketConfig | null {
  const result = rocketSchema.safeParse(data);
  return result.success ? sanitizeRocket(result.data as RocketConfig) : null;
}

/** Parses untrusted data into a rocket, falling back to the starter rocket. */
export function parseRocketOrStarter(data: unknown): RocketConfig {
  return parseRocket(data) ?? createStarterRocket();
}
