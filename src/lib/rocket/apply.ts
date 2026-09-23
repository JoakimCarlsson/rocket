import type { RocketAction } from "../ai/actions";
import { RAINBOW } from "./colors";
import { createBooster, createEngine, createStage } from "./defaults";
import { makeId } from "./ids";
import { LIMITS, SIZE_FACTOR } from "./limits";
import { sanitizeRocket } from "./schema";
import type { Booster, EngineSpec, RocketConfig, SizeClass, Stage } from "./types";

/** Result of applying a batch of actions. */
export interface ApplyResult {
  config: RocketConfig;
  notes: string[];
}

/** Applies validated actions in order and returns a new, sanitised configuration. */
export function applyActions(config: RocketConfig, actions: RocketAction[]): ApplyResult {
  const notes: string[] = [];
  let next = structuredClone(config);
  for (const action of actions) {
    next = applyAction(next, action, notes);
  }
  return { config: sanitizeRocket(next), notes };
}

/** Returns a size multiplier, or 1 when no size is requested. */
function sizeFactor(size: SizeClass | undefined): number {
  return size ? SIZE_FACTOR[size] : 1;
}

/** Builds a booster that suits the current core. */
function templateBooster(config: RocketConfig, size: SizeClass | undefined, color: string | undefined): Booster {
  const reference = config.boosters[0];
  const core = config.stages[0];
  const f = sizeFactor(size);
  const height = (reference && !size ? reference.height : core.height * 0.72) * (size ? Math.sqrt(f) : 1);
  const radius = (reference && !size ? reference.radius : core.radius * 0.42) * f;
  return createBooster({
    height,
    radius,
    color: color ?? reference?.color ?? null,
    top: reference?.top ?? "cone",
    engine: reference ? { ...reference.engine } : createEngine({ count: 1, size: Math.min(radius * 0.8, 2), power: 5 }),
  });
}

/** Adds boosters up to the hard limit, noting when the limit is hit. */
function addBoosters(config: RocketConfig, count: number, size: SizeClass | undefined, color: string | undefined, notes: string[]): void {
  const room = LIMITS.boosters - config.boosters.length;
  if (count > room) notes.push(`Booster mounting points exhausted at ${LIMITS.boosters}.`);
  for (let i = 0; i < Math.min(count, room); i++) {
    config.boosters.push(templateBooster(config, size, color));
  }
}

/** Finds every engine spec addressed by an engine target. */
function engineTargets(config: RocketConfig, target: string, id?: string): EngineSpec[] {
  switch (target) {
    case "core":
      return config.stages.slice(0, 1).map((s) => s.engine);
    case "boosters":
      return config.boosters.map((b) => b.engine);
    case "all":
      return [...config.stages.map((s) => s.engine), ...config.boosters.map((b) => b.engine)];
    default: {
      const owner = [...config.stages, ...config.boosters].find((c) => c.id === id);
      return owner ? [owner.engine] : [];
    }
  }
}

/** Scales a stage or booster in place. */
function scaleColumn(column: Stage | Booster, h: number, w: number): void {
  column.height *= h;
  column.radius *= w;
  column.engine.size *= w;
}

/** Applies a single action. Unknown targets are ignored rather than failing the batch. */
function applyAction(config: RocketConfig, action: RocketAction, notes: string[]): RocketConfig {
  switch (action.type) {
    case "rename":
      config.name = action.name.toUpperCase();
      break;
    case "set_destination":
      config.destination = action.value;
      break;
    case "add_boosters":
      addBoosters(config, action.count, action.size, action.color, notes);
      break;
    case "remove_boosters":
      if (action.ids?.length) {
        config.boosters = config.boosters.filter((b) => !action.ids!.includes(b.id));
      } else if (action.count !== undefined) {
        config.boosters = config.boosters.slice(0, Math.max(0, config.boosters.length - action.count));
      } else {
        config.boosters = [];
      }
      break;
    case "set_booster_count": {
      const target = Math.min(action.count, LIMITS.boosters);
      if (action.size) {
        config.boosters = config.boosters.map((b) => ({ ...templateBooster(config, action.size, b.color ?? undefined), id: b.id }));
      }
      if (target < config.boosters.length) config.boosters = config.boosters.slice(0, target);
      else addBoosters(config, target - config.boosters.length, action.size, undefined, notes);
      break;
    }
    case "scale": {
      const h = action.height ?? 1;
      const w = action.width ?? 1;
      const { target } = action;
      if (target === "rocket" || target === "stages") config.stages.forEach((s) => scaleColumn(s, h, w));
      if (target === "rocket" || target === "boosters") config.boosters.forEach((b) => scaleColumn(b, h, w));
      if (target === "rocket" || target === "payload") config.payload.height *= h;
      if (target === "engines") engineTargets(config, "all").forEach((e) => (e.size *= Math.max(h, w)));
      if ((target === "rocket" || target === "fins") && config.fins) config.fins.size *= target === "rocket" ? Math.sqrt(w) : Math.max(h, w);
      if (target === "decor") config.decorativeParts.forEach((d) => (d.size *= Math.max(h, w)));
      if (target === "id" && action.id) {
        const column = [...config.stages, ...config.boosters].find((c) => c.id === action.id);
        if (column) scaleColumn(column, h, w);
        const decor = config.decorativeParts.find((d) => d.id === action.id);
        if (decor) decor.size *= Math.max(h, w);
        if (config.payload.id === action.id) config.payload.height *= h;
        if (config.fins?.id === action.id) config.fins.size *= Math.max(h, w);
      }
      break;
    }
    case "add_stage": {
      if (config.stages.length >= LIMITS.stages) {
        notes.push(`Stage limit of ${LIMITS.stages} reached.`);
        break;
      }
      if (action.position === "bottom") {
        const old = config.stages[0];
        const stage = createStage({
          height: action.height ?? old.height * 1.1,
          radius: action.radius ?? old.radius * 1.08,
          engine: { ...old.engine },
        });
        old.engine = createEngine({ count: 1, size: old.engine.size, power: old.engine.power, style: old.engine.style, color: old.engine.color });
        config.stages.unshift(stage);
      } else {
        const top = config.stages[config.stages.length - 1];
        config.stages.push(
          createStage({
            height: action.height ?? top.height * 0.7,
            radius: action.radius ?? top.radius * (1 - top.taper),
            engine: createEngine({ count: 1, size: Math.min(1.2, top.radius * 0.5), power: 4 }),
          }),
        );
      }
      break;
    }
    case "remove_stage": {
      if (config.stages.length <= 1) {
        notes.push("Kept the last stage. It is load-bearing.");
        break;
      }
      if (action.id) config.stages = config.stages.filter((s) => s.id !== action.id);
      else if (action.position === "bottom") config.stages = config.stages.slice(1);
      else config.stages = config.stages.slice(0, -1);
      break;
    }
    case "set_engines":
      engineTargets(config, action.target, action.id).forEach((engine) => {
        if (action.count !== undefined) engine.count = action.count;
        if (action.size) engine.size = SIZE_FACTOR[action.size] * (action.target === "boosters" ? 0.8 : 1);
        if (action.power !== undefined) engine.power = action.power;
        if (action.style) engine.style = action.style;
        if (action.color) engine.color = action.color;
      });
      break;
    case "set_color":
      applyColor(config, action.target, action.value, action.id);
      break;
    case "set_finish":
      config.appearance.finish = action.value;
      break;
    case "set_pattern":
      config.appearance.pattern = action.value;
      break;
    case "set_top":
      config.payload.top = action.kind;
      if (action.color) config.payload.topColor = action.color;
      else if (action.kind === "dome") config.payload.topColor = null;
      break;
    case "set_payload":
      if (action.kind) {
        config.payload.kind = action.kind;
        if (action.crew === undefined) {
          config.payload.crew = action.kind === "capsule" || action.kind === "habitat" ? Math.max(config.payload.crew, 2) : 0;
        }
      }
      if (action.crew !== undefined) config.payload.crew = action.crew;
      if (action.size) config.payload.height = 5 * SIZE_FACTOR[action.size];
      break;
    case "set_fins": {
      const fins = config.fins ?? { id: makeId("fin"), count: 4, size: 1.2, shape: "swept" as const, color: null };
      if (action.count !== undefined) fins.count = action.count;
      if (action.size) fins.size = 1.2 * SIZE_FACTOR[action.size];
      if (action.shape) fins.shape = action.shape;
      if (action.color) fins.color = action.color;
      config.fins = fins;
      break;
    }
    case "remove_fins":
      config.fins = null;
      break;
    case "set_legs": {
      const legs = config.legs ?? { id: makeId("leg"), count: 4, size: 1 };
      if (action.count !== undefined) legs.count = action.count;
      if (action.size) legs.size = SIZE_FACTOR[action.size];
      config.legs = legs;
      break;
    }
    case "remove_legs":
      config.legs = null;
      break;
    case "add_decor": {
      const attach = action.attach ?? defaultAttach(action.kind);
      const existing = config.decorativeParts.find((d) => d.kind === action.kind && d.attach === attach);
      if (existing) {
        existing.count += action.count ?? 1;
        if (action.color) existing.color = action.color;
        if (action.size) existing.size = SIZE_FACTOR[action.size];
      } else if (config.decorativeParts.length < LIMITS.decor) {
        config.decorativeParts.push({
          id: makeId("dec"),
          kind: action.kind,
          attach,
          count: action.count ?? 1,
          size: sizeFactor(action.size),
          color: action.color ?? null,
        });
      }
      break;
    }
    case "remove_decor":
      config.decorativeParts = config.decorativeParts.filter((d) =>
        action.id ? d.id !== action.id : action.kind ? d.kind !== action.kind : false,
      );
      break;
    case "set_tilt":
      config.tilt = action.degrees;
      break;
    case "remove_part":
      removePart(config, action.id, notes);
      break;
  }
  return config;
}

/** Picks where a decoration looks best when the AI did not say. */
function defaultAttach(kind: RocketConfig["decorativeParts"][number]["kind"]): RocketConfig["decorativeParts"][number]["attach"] {
  switch (kind) {
    case "antenna":
    case "flag":
    case "duck":
    case "propeller":
      return "top";
    case "windows":
    case "googlyEyes":
    case "solarPanels":
      return "payload";
    case "wings":
    case "tank":
      return "bottom";
    default:
      return "core";
  }
}

/** Applies a colour change to a named group of components. */
function applyColor(config: RocketConfig, target: string, value: string | undefined, id?: string): void {
  const a = config.appearance;
  if (target === "rainbow") {
    config.stages.forEach((s, i) => (s.color = RAINBOW[i % RAINBOW.length]));
    config.boosters.forEach((b, i) => (b.color = RAINBOW[(i + 3) % RAINBOW.length]));
    config.decorativeParts.forEach((d, i) => (d.color = RAINBOW[(i + 5) % RAINBOW.length]));
    return;
  }
  if (!value) return;
  switch (target) {
    case "all":
      a.primary = value;
      config.stages.forEach((s) => (s.color = null));
      config.boosters.forEach((b) => (b.color = null));
      config.payload.color = null;
      break;
    case "primary":
      a.primary = value;
      break;
    case "secondary":
      a.secondary = value;
      break;
    case "accent":
      a.accent = value;
      break;
    case "glow":
      a.glow = value;
      break;
    case "body":
      config.stages.forEach((s) => (s.color = value));
      break;
    case "boosters":
      config.boosters.forEach((b) => (b.color = value));
      break;
    case "engines":
      engineTargets(config, "all").forEach((e) => (e.color = value));
      break;
    case "nose":
      config.payload.topColor = value;
      break;
    case "payload":
      config.payload.color = value;
      break;
    case "fins":
      if (config.fins) config.fins.color = value;
      break;
    case "decor":
      config.decorativeParts.forEach((d) => (d.color = value));
      break;
    case "id": {
      const item = [...config.stages, ...config.boosters, ...config.decorativeParts].find((c) => c.id === id);
      if (item) item.color = value;
      if (config.payload.id === id) config.payload.color = value;
      if (config.fins && config.fins.id === id) config.fins.color = value;
      break;
    }
  }
}

/** Removes any component by id. */
function removePart(config: RocketConfig, id: string, notes: string[]): void {
  if (config.stages.some((s) => s.id === id)) {
    if (config.stages.length > 1) config.stages = config.stages.filter((s) => s.id !== id);
    else notes.push("Kept the last stage. It is load-bearing.");
  }
  config.boosters = config.boosters.filter((b) => b.id !== id);
  config.decorativeParts = config.decorativeParts.filter((d) => d.id !== id);
  if (config.fins?.id === id) config.fins = null;
  if (config.legs?.id === id) config.legs = null;
  if (config.payload.id === id) {
    config.payload.kind = "none";
    config.payload.crew = 0;
  }
}
