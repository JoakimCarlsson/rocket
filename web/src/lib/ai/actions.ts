import { z } from "zod";
import { resolveColor } from "../rocket/colors";

const color = z.string().transform((value, ctx) => {
  const resolved = resolveColor(value);
  if (!resolved) {
    ctx.addIssue({ code: "custom", message: `Unknown colour ${value}` });
    return z.NEVER;
  }
  return resolved;
});

/** Maps a numeric size factor, which models sometimes send, onto the nearest size bucket. */
function sizeFromNumber(value: unknown): unknown {
  if (typeof value !== "number") return value;
  if (value < 0.6) return "tiny";
  if (value < 0.9) return "small";
  if (value < 1.2) return "medium";
  if (value < 1.7) return "large";
  return "huge";
}

const size = z.preprocess(
  sizeFromNumber,
  z.enum(["tiny", "small", "medium", "large", "huge"]),
);
const factor = z.number().min(0.1).max(6);
const count = z.number().int().min(0).max(50);
const componentId = z.string().max(24);

const propellant = z.enum(["solid", "kerolox", "methalox", "hydrolox"]);

const decorKind = z.enum([
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
]);

/**
 * Every modification the AI may request. The model only ever produces data that matches
 * one of these shapes; nothing it returns is executed.
 */
export const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("rename"), name: z.string().min(1).max(40) }),
  z.object({
    type: z.literal("set_destination"),
    value: z.enum(["orbit", "moon", "mars", "sun", "nowhere"]),
  }),
  z.object({
    type: z.literal("add_boosters"),
    count: count.min(1),
    size: size.optional(),
    color: color.optional(),
  }),
  z.object({
    type: z.literal("remove_boosters"),
    count: count.optional(),
    ids: z.array(componentId).max(24).optional(),
  }),
  z.object({
    type: z.literal("set_booster_count"),
    count,
    size: size.optional(),
  }),
  z.object({
    type: z.literal("scale"),
    target: z.enum([
      "rocket",
      "stages",
      "boosters",
      "payload",
      "engines",
      "fins",
      "decor",
      "id",
    ]),
    id: componentId.optional(),
    height: factor.optional(),
    width: factor.optional(),
  }),
  z.object({
    type: z.literal("add_stage"),
    position: z.enum(["top", "bottom"]).optional(),
    height: z.number().min(2).max(90).optional(),
    radius: z.number().min(0.5).max(12).optional(),
  }),
  z.object({
    type: z.literal("remove_stage"),
    id: componentId.optional(),
    position: z.enum(["top", "bottom"]).optional(),
  }),
  z.object({
    type: z.literal("set_engines"),
    target: z.enum(["core", "boosters", "all", "id"]),
    id: componentId.optional(),
    count: count.min(1).max(19).optional(),
    size: size.optional(),
    power: z.number().min(1).max(10).optional(),
    style: z.enum(["bell", "aerospike", "flared", "trumpet"]).optional(),
    gimbal: z.boolean().optional(),
    color: color.optional(),
  }),
  z.object({
    type: z.literal("set_propellant"),
    target: z.enum(["core", "upper", "stages", "boosters", "all", "id"]),
    id: componentId.optional(),
    value: propellant,
  }),
  z.object({
    type: z.literal("set_color"),
    target: z.enum([
      "all",
      "primary",
      "secondary",
      "accent",
      "glow",
      "body",
      "boosters",
      "engines",
      "nose",
      "payload",
      "fins",
      "decor",
      "rainbow",
      "id",
    ]),
    id: componentId.optional(),
    value: color.optional(),
  }),
  z.object({
    type: z.literal("set_finish"),
    value: z.enum(["matte", "satin", "metallic", "chrome", "glossy"]),
  }),
  z.object({
    type: z.literal("set_pattern"),
    value: z.enum(["solid", "stripes", "bands", "checker", "split"]),
  }),
  z.object({
    type: z.literal("set_top"),
    kind: z.enum(["cone", "ogive", "needle", "blunt", "dome", "spike", "none"]),
    color: color.optional(),
  }),
  z.object({
    type: z.literal("set_payload"),
    kind: z
      .enum(["capsule", "fairing", "satellite", "cargo", "habitat", "none"])
      .optional(),
    crew: z.number().int().min(0).max(12).optional(),
    size: size.optional(),
    heatShield: z.boolean().optional(),
    parachutes: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("set_fins"),
    count: z.number().int().min(2).max(12).optional(),
    size: size.optional(),
    shape: z.enum(["delta", "swept", "grid", "tiny", "shark"]).optional(),
    color: color.optional(),
  }),
  z.object({ type: z.literal("remove_fins") }),
  z.object({
    type: z.literal("set_legs"),
    count: z.number().int().min(3).max(8).optional(),
    size: size.optional(),
  }),
  z.object({ type: z.literal("remove_legs") }),
  z.object({
    type: z.literal("add_decor"),
    kind: decorKind,
    attach: z.enum(["top", "payload", "core", "bottom"]).optional(),
    count: z.number().int().min(1).max(12).optional(),
    size: size.optional(),
    color: color.optional(),
  }),
  z.object({
    type: z.literal("remove_decor"),
    id: componentId.optional(),
    kind: decorKind.optional(),
  }),
  z.object({
    type: z.literal("set_tilt"),
    degrees: z.number().min(-180).max(180),
  }),
  z.object({ type: z.literal("remove_part"), id: componentId }),
]);

/** A validated rocket modification. */
export type RocketAction = z.infer<typeof actionSchema>;

/** All action type names, handy for prompts and documentation. */
export const ACTION_TYPES = actionSchema.options.map(
  (option) => option.shape.type.value,
);

/** What an AI provider returns after interpreting an instruction. */
export interface AIResult {
  actions: RocketAction[];
  response: string;
  suggestedName?: string;
  rejected: number;
  provider: string;
}

const MAX_ACTIONS = 24;

/**
 * Validates raw model output. Each action is checked on its own so one bad entry
 * does not throw away the rest; anything unrecognised is dropped and counted.
 */
export function validateModelOutput(raw: unknown, provider: string): AIResult {
  const envelope = z
    .object({
      actions: z.array(z.unknown()).default([]),
      response: z.string().default(""),
      name: z.string().nullish(),
    })
    .safeParse(raw);
  if (!envelope.success) {
    return { actions: [], response: "", rejected: 1, provider };
  }
  const actions: RocketAction[] = [];
  let rejected = 0;
  for (const candidate of envelope.data.actions.slice(0, MAX_ACTIONS)) {
    const parsed = actionSchema.safeParse(targetById(stripNulls(candidate)));
    if (parsed.success) actions.push(parsed.data);
    else rejected++;
  }
  rejected += Math.max(0, envelope.data.actions.length - MAX_ACTIONS);
  const name = envelope.data.name?.trim().slice(0, 40);
  return {
    actions,
    response: envelope.data.response.trim().slice(0, 240),
    suggestedName: name ? name.toUpperCase() : undefined,
    rejected,
    provider,
  };
}

/** Removes null-valued keys so optional fields sent as null by a model still validate. */
function stripNulls(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== null),
  );
}

const COMPONENT_ID = /^[a-z]{3}-[a-z0-9]{3,12}$/;
const GROUP_TARGETS = new Set([
  "rocket",
  "stages",
  "boosters",
  "all",
  "engines",
]);

/**
 * Models often put a component id in `target`, or pair a whole-group target with an id.
 * Both mean "this one component", so they are rewritten to `target: "id"`.
 */
function targetById(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const action = value as Record<string, unknown>;
  if (typeof action.target !== "string") return value;
  if (COMPONENT_ID.test(action.target))
    return { ...action, target: "id", id: action.target };
  if (
    typeof action.id === "string" &&
    COMPONENT_ID.test(action.id) &&
    GROUP_TARGETS.has(action.target)
  )
    return { ...action, target: "id" };
  return value;
}
