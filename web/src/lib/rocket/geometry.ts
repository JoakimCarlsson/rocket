import type { DecorAttach, RocketConfig, Stage, TopKind } from "./types";

const TOP_HEIGHT_FACTOR: Record<TopKind, number> = {
  cone: 1.7,
  ogive: 2.1,
  needle: 3.6,
  blunt: 0.7,
  dome: 1,
  spike: 3,
  none: 0,
};

/** Vertical extent of one core stage body, measured from the bottom of the first stage. */
export interface StackSection {
  stage: Stage;
  index: number;
  base: number;
  top: number;
  rBottom: number;
  rTop: number;
}

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

/** Returns the radius at the top of the payload section, where the nose sits. */
export function payloadTopRadius(config: RocketConfig): number {
  const r = upperRadius(config);
  switch (config.payload.kind) {
    case "capsule":
      return r * 0.58;
    case "fairing":
      return r * 1.12;
    case "satellite":
      return r * 0.75;
    default:
      return r;
  }
}

/** Places every core stage body on the stack, bottom to top. */
export function stackSections(config: RocketConfig): StackSection[] {
  const sections: StackSection[] = [];
  let y = 0;
  config.stages.forEach((stage, index) => {
    if (index > 0) y += interstageHeight(config.stages[index - 1], stage);
    sections.push({
      stage,
      index,
      base: y,
      top: y + stage.height,
      rBottom: stage.radius,
      rTop: stage.radius * (1 - stage.taper),
    });
    y += stage.height;
  });
  return sections;
}

/** Returns the height of the top of the core stack, where the payload begins. */
export function coreTop(config: RocketConfig): number {
  const sections = stackSections(config);
  return sections[sections.length - 1]?.top ?? 0;
}

/** Returns the full stack height in metres. */
export function totalHeight(config: RocketConfig): number {
  return (
    coreTop(config) +
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

/** Fin planform: how far each fin sticks out and how long its root is. */
export function finGeometry(config: RocketConfig): {
  span: number;
  rootChord: number;
} {
  const bottom = config.stages[0];
  const size = config.fins?.size ?? 0;
  return {
    span: size * bottom.radius * 0.9,
    rootChord: Math.min(bottom.height * 0.5, size * bottom.radius * 2.2),
  };
}

/** Returns the height a decoration attaches at. */
export function decorAnchor(config: RocketConfig, attach: DecorAttach): number {
  const core = coreTop(config);
  switch (attach) {
    case "top":
      return totalHeight(config);
    case "payload":
      return core + payloadHeight(config) * 0.5;
    case "core":
      return core * 0.55;
    case "bottom":
      return Math.min(core * 0.18, 6);
  }
}

/** Returns the index of the stage whose body covers a height, or null for the payload section. */
export function stageIndexAt(
  config: RocketConfig,
  height: number,
): number | null {
  const section = stackSections(config).find((s) => height <= s.top);
  return section ? section.index : null;
}
