import {
  decorAnchor,
  finGeometry,
  interstageHeight,
  payloadHeight,
  payloadTopRadius,
  topHeight,
} from "./geometry";
import { FAIRING_OWNER, PROPELLANT_LABELS, UPPER_OWNER } from "./parts";
import type { DecorPart, EngineSpec, RocketConfig, Stage } from "./types";

/** Every primitive the renderer knows how to draw. */
export type PartKind =
  | "body"
  | "interstage"
  | "trim"
  | "engine"
  | "booster"
  | "boosterTop"
  | "strut"
  | "payload"
  | "top"
  | "fin"
  | "leg"
  | "antenna"
  | "ring"
  | "solarPanel"
  | "spike"
  | "light"
  | "wing"
  | "flag"
  | "googlyEye"
  | "duck"
  | "window"
  | "tank"
  | "propeller";

/** A positioned renderable piece. Segment names group parts that separate together during launch. */
export interface PlacedPart {
  key: string;
  sourceId: string;
  kind: PartKind;
  segment: string;
  variant: string;
  position: [number, number, number];
  rotation: [number, number, number];
  dims: { h: number; r: number; r2: number; s: number };
  color: string;
  color2: string;
}

/** A technical callout anchored somewhere on the vehicle. */
export interface PartLabel {
  key: string;
  title: string;
  detail: string;
  position: [number, number, number];
  side: "left" | "right";
}

/** A thrust source used for flames, glow and smoke. */
export interface Nozzle {
  segment: string;
  position: [number, number, number];
  radius: number;
  power: number;
}

/** Output of procedural generation: everything the scene needs to draw the rocket. */
export interface RocketLayout {
  parts: PlacedPart[];
  labels: PartLabel[];
  nozzles: Nozzle[];
  height: number;
  minY: number;
  radius: number;
  width: number;
  segments: string[];
}

/** Returns the segment key for a core stage. */
export function stageSegment(stage: Stage): string {
  return `stage:${stage.id}`;
}

/** Returns the segment key for a side booster. */
export function boosterSegment(id: string): string {
  return `booster:${id}`;
}

/** Segment containing the payload, top and anything attached to them. */
export const UPPER_SEGMENT = UPPER_OWNER;

/** Segment holding a payload fairing and its nose, jettisoned above the atmosphere. */
export const FAIRING_SEGMENT = FAIRING_OWNER;

/** Returns the height of an engine bell for a given engine size. */
export function bellHeight(engine: EngineSpec): number {
  return engine.size * 1.7;
}

/** Arranges engine positions inside a circle of the given radius. */
function clusterPositions(
  count: number,
  radius: number,
  size: number,
): [number, number][] {
  if (count <= 1) return [[0, 0]];
  const spots: [number, number][] = [];
  const center = count >= 5 && count % 2 === 1 ? 1 : 0;
  if (center) spots.push([0, 0]);
  const ringCount = count - center;
  const ringRadius = Math.max(radius * 0.62, size * 0.9);
  const inner = ringCount > 10 ? Math.floor(ringCount / 3) : 0;
  const outer = ringCount - inner;
  for (let i = 0; i < inner; i++) {
    const a = (i / inner) * Math.PI * 2;
    spots.push([
      Math.cos(a) * ringRadius * 0.45,
      Math.sin(a) * ringRadius * 0.45,
    ]);
  }
  for (let i = 0; i < outer; i++) {
    const a = (i / outer) * Math.PI * 2 + Math.PI / outer;
    spots.push([Math.cos(a) * ringRadius, Math.sin(a) * ringRadius]);
  }
  return spots;
}

interface StackEntry {
  stage: Stage;
  base: number;
  top: number;
  rBottom: number;
  rTop: number;
}

/**
 * Turns a rocket configuration into positioned primitives.
 * The origin sits at the bottom centre of the first stage body; engines hang below it.
 */
export function layoutRocket(config: RocketConfig): RocketLayout {
  const { appearance } = config;
  const parts: PlacedPart[] = [];
  const labels: PartLabel[] = [];
  const nozzles: Nozzle[] = [];
  const stack: StackEntry[] = [];

  const push = (
    part: Omit<PlacedPart, "rotation" | "color2" | "variant"> &
      Partial<PlacedPart>,
  ) => {
    parts.push({
      rotation: [0, 0, 0],
      color2: appearance.secondary,
      variant: "",
      ...part,
    });
  };

  let y = 0;
  config.stages.forEach((stage, index) => {
    const segment = stageSegment(stage);
    if (index > 0) {
      const lower = stack[index - 1];
      const h = interstageHeight(lower.stage, stage);
      push({
        key: `${lower.stage.id}:interstage`,
        sourceId: lower.stage.id,
        kind: "interstage",
        segment: stageSegment(lower.stage),
        position: [0, y, 0],
        dims: { h, r: stage.radius, r2: lower.rTop, s: 1 },
        color: appearance.secondary,
        color2: appearance.accent,
      });
      y += h;
    }
    const rBottom = stage.radius;
    const rTop = stage.radius * (1 - stage.taper);
    stack.push({ stage, base: y, top: y + stage.height, rBottom, rTop });
    push({
      key: `${stage.id}:body`,
      sourceId: stage.id,
      kind: "body",
      segment,
      variant: appearance.pattern,
      position: [0, y, 0],
      dims: { h: stage.height, r: rTop, r2: rBottom, s: index },
      color: stage.color ?? appearance.primary,
      color2: appearance.secondary,
    });
    push({
      key: `${stage.id}:trim`,
      sourceId: stage.id,
      kind: "trim",
      segment,
      position: [0, y + stage.height - 0.35, 0],
      dims: { h: 0.35, r: rTop * 1.015, r2: rTop * 1.015, s: 1 },
      color: appearance.accent,
    });

    const bell = bellHeight(stage.engine);
    const spots = clusterPositions(
      stage.engine.count,
      rBottom,
      stage.engine.size,
    );
    spots.forEach(([x, z], engineIndex) => {
      push({
        key: `${stage.id}:engine:${engineIndex}`,
        sourceId: stage.id,
        kind: "engine",
        segment,
        variant: stage.engine.style,
        position: [x, y - bell + 0.05, z],
        dims: {
          h: bell,
          r: stage.engine.size * 0.72,
          r2: stage.engine.size * 0.3,
          s: stage.engine.power,
        },
        color: stage.engine.color,
        color2: appearance.glow,
      });
      nozzles.push({
        segment,
        position: [x, y - bell, z],
        radius: stage.engine.size * 0.7,
        power: stage.engine.power,
      });
    });

    labels.push({
      key: `${stage.id}:label`,
      title: `STAGE ${index + 1}`,
      detail: `${stage.height.toFixed(1)}M · ${stage.engine.count}× ${stage.engine.style.toUpperCase()} · ${PROPELLANT_LABELS[stage.propellant]}`,
      position: [rBottom + 0.4, y + stage.height * 0.55, 0],
      side: index % 2 === 0 ? "right" : "left",
    });
    y += stage.height;
  });

  const bottom = stack[0];
  const coreTopY = y;
  const upper = stack[stack.length - 1];
  const upperR = upper?.rTop ?? 2;

  const radiusAt = (height: number): number => {
    for (const entry of stack) {
      if (height >= entry.base && height <= entry.top) {
        const t =
          (height - entry.base) / Math.max(0.001, entry.top - entry.base);
        return entry.rBottom + (entry.rTop - entry.rBottom) * t;
      }
    }
    return height > coreTopY ? upperR : (bottom?.rBottom ?? 2);
  };
  const segmentAt = (height: number): string => {
    for (const entry of stack) {
      if (height <= entry.top) return stageSegment(entry.stage);
    }
    return UPPER_SEGMENT;
  };

  layoutBoosters(config, bottom, push, nozzles, labels);

  const pHeight = payloadHeight(config);
  const payload = config.payload;
  let payloadTopR = upperR;
  const shellSegment =
    payload.kind === "fairing" ? FAIRING_SEGMENT : UPPER_SEGMENT;
  if (payload.kind !== "none") {
    const r2 = upperR;
    const r = payloadTopRadius(config);
    payloadTopR = r;
    push({
      key: `${payload.id}:payload`,
      sourceId: payload.id,
      kind: "payload",
      segment: shellSegment,
      variant: payload.kind,
      position: [0, y, 0],
      dims: { h: pHeight, r, r2, s: payload.crew },
      color: payload.color ?? appearance.primary,
      color2: appearance.secondary,
    });
    if (payload.kind === "fairing")
      push({
        key: `${payload.id}:cargo`,
        sourceId: payload.id,
        kind: "payload",
        segment: UPPER_SEGMENT,
        variant: "cargo",
        position: [0, y + 0.2, 0],
        dims: { h: pHeight * 0.75, r: upperR * 0.7, r2: upperR * 0.7, s: 0 },
        color: appearance.accent,
        color2: appearance.secondary,
      });
    if (payload.heatShield)
      push({
        key: `${payload.id}:shield`,
        sourceId: payload.id,
        kind: "trim",
        segment: UPPER_SEGMENT,
        position: [0, y, 0],
        dims: { h: 0.5, r: r2 * 1.03, r2: r2 * 1.03, s: 1 },
        color: "#4a2e1f",
      });
    if (payload.parachutes)
      push({
        key: `${payload.id}:chutes`,
        sourceId: payload.id,
        kind: "trim",
        segment: shellSegment,
        position: [0, y + pHeight - 0.7, 0],
        dims: { h: 0.6, r: r * 1.05, r2: r * 1.05, s: 1 },
        color: "#ff8a2a",
      });
    const extras = [
      payload.crew ? `CREW ${payload.crew}` : "",
      payload.heatShield ? "SHIELD" : "",
      payload.parachutes ? "CHUTES" : "",
    ].filter(Boolean);
    labels.push({
      key: `${payload.id}:label`,
      title: "PAYLOAD",
      detail: [payload.kind.toUpperCase(), ...extras].join(" · "),
      position: [Math.max(r, r2) + 0.4, y + pHeight * 0.5, 0],
      side: "left",
    });
    y += pHeight;
  }

  const tHeight = topHeight(payload.top, upperR);
  if (payload.top !== "none") {
    push({
      key: `${payload.id}:top`,
      sourceId: payload.id,
      kind: "top",
      segment: shellSegment,
      variant: payload.top,
      position: [0, y, 0],
      dims: { h: tHeight, r: payloadTopR, r2: payloadTopR, s: 1 },
      color:
        payload.topColor ??
        (payload.top === "dome" ? "#bfe6ff" : appearance.secondary),
      color2: appearance.accent,
    });
    labels.push({
      key: `${payload.id}:toplabel`,
      title: payload.top === "dome" ? "OBSERVATION DOME" : "NOSE",
      detail: payload.top.toUpperCase(),
      position: [payloadTopR * 0.6 + 0.4, y + tHeight * 0.4, 0],
      side: "right",
    });
  }
  const height = y + tHeight;

  if (config.fins && bottom) {
    const fins = config.fins;
    const offset = config.boosters.length
      ? Math.PI / Math.max(2, fins.count)
      : 0;
    const { span, rootChord: finHeight } = finGeometry(config);
    for (let i = 0; i < fins.count; i++) {
      const a = offset + (i / fins.count) * Math.PI * 2;
      push({
        key: `${fins.id}:${i}`,
        sourceId: fins.id,
        kind: "fin",
        segment: stageSegment(bottom.stage),
        variant: fins.shape,
        position: [
          Math.cos(a) * bottom.rBottom * 0.96,
          0,
          Math.sin(a) * bottom.rBottom * 0.96,
        ],
        rotation: [0, -a, 0],
        dims: { h: finHeight, r: span, r2: 0, s: fins.size },
        color: fins.color ?? appearance.secondary,
        color2: appearance.accent,
      });
    }
  }

  if (config.legs && bottom) {
    const legs = config.legs;
    const drop = bellHeight(bottom.stage.engine) + 0.6;
    for (let i = 0; i < legs.count; i++) {
      const a = Math.PI / legs.count + (i / legs.count) * Math.PI * 2;
      push({
        key: `${legs.id}:${i}`,
        sourceId: legs.id,
        kind: "leg",
        segment: stageSegment(bottom.stage),
        position: [
          Math.cos(a) * bottom.rBottom,
          3.2 * legs.size,
          Math.sin(a) * bottom.rBottom,
        ],
        rotation: [0, -a, 0],
        dims: {
          h: 3.2 * legs.size + drop,
          r: 2.4 * legs.size,
          r2: 0,
          s: legs.size,
        },
        color: appearance.secondary,
        color2: appearance.accent,
      });
    }
  }

  config.decorativeParts.forEach((decor) => {
    layoutDecor(
      decor,
      decorAnchor(config, decor.attach),
      decor.attach,
      radiusAt,
      segmentAt,
      push,
      appearance,
      height,
      payloadTopR,
    );
  });

  const minY = Math.min(
    0,
    ...parts
      .filter((p) => p.kind === "engine" || p.kind === "leg")
      .map((p) =>
        p.kind === "leg" ? p.position[1] - p.dims.h : p.position[1],
      ),
  );
  const coreRadius = Math.max(...stack.map((s) => s.rBottom), 1);
  const extent = Math.max(
    coreRadius,
    ...parts
      .filter(
        (p) => p.kind === "booster" || p.kind === "wing" || p.kind === "fin",
      )
      .map((p) => Math.hypot(p.position[0], p.position[2]) + p.dims.r),
  );
  const segments = Array.from(new Set(parts.map((p) => p.segment)));

  return {
    parts,
    labels,
    nozzles,
    height,
    minY,
    radius: coreRadius,
    width: extent * 2,
    segments,
  };
}

type Push = (
  part: Omit<PlacedPart, "rotation" | "color2" | "variant"> &
    Partial<PlacedPart>,
) => void;

/** Places boosters in concentric rings around the bottom stage. */
function layoutBoosters(
  config: RocketConfig,
  bottom: StackEntry | undefined,
  push: Push,
  nozzles: Nozzle[],
  labels: PartLabel[],
): void {
  if (!bottom || config.boosters.length === 0) return;
  const { appearance } = config;
  const core = bottom.rBottom;
  let index = 0;
  let ring = 0;
  let distance = core;
  while (index < config.boosters.length) {
    const sample = config.boosters[index];
    distance += sample.radius + (ring === 0 ? 0.08 : sample.radius * 0.2);
    const capacity = Math.max(
      2,
      Math.floor((Math.PI * 2 * distance) / (sample.radius * 2.15)),
    );
    const inRing = Math.min(capacity, config.boosters.length - index);
    const offset =
      ring * (Math.PI / Math.max(inRing, 1)) + (inRing === 2 ? 0 : Math.PI / 2);
    for (let i = 0; i < inRing; i++, index++) {
      const booster = config.boosters[index];
      const segment = boosterSegment(booster.id);
      const a = offset + (i / inRing) * Math.PI * 2;
      const x = Math.cos(a) * distance;
      const z = Math.sin(a) * distance;
      const lift = ring * 1.2;
      const color = booster.color ?? appearance.primary;
      push({
        key: `${booster.id}:body`,
        sourceId: booster.id,
        kind: "booster",
        segment,
        position: [x, lift, z],
        dims: {
          h: booster.height,
          r: booster.radius,
          r2: booster.radius,
          s: ring,
        },
        color,
        color2: appearance.secondary,
      });
      push({
        key: `${booster.id}:top`,
        sourceId: booster.id,
        kind: "boosterTop",
        segment,
        variant: booster.top,
        position: [x, lift + booster.height, z],
        dims: {
          h: booster.radius * (booster.top === "blunt" ? 1 : 2.6),
          r: booster.radius,
          r2: booster.radius,
          s: 1,
        },
        color: appearance.secondary,
        color2: appearance.accent,
      });
      const inward =
        ring === 0 ? distance - booster.radius - core : booster.radius * 0.5;
      [0.25, 0.8].forEach((t, strutIndex) => {
        push({
          key: `${booster.id}:strut:${strutIndex}`,
          sourceId: booster.id,
          kind: "strut",
          segment,
          position: [
            Math.cos(a) * (distance - booster.radius),
            lift + booster.height * t,
            Math.sin(a) * (distance - booster.radius),
          ],
          rotation: [0, -a, 0],
          dims: { h: Math.max(0.15, inward + 0.2), r: 0.14, r2: 0.14, s: 1 },
          color: appearance.secondary,
        });
      });
      const bell = bellHeight(booster.engine);
      clusterPositions(
        booster.engine.count,
        booster.radius,
        booster.engine.size,
      ).forEach(([ex, ez], engineIndex) => {
        push({
          key: `${booster.id}:engine:${engineIndex}`,
          sourceId: booster.id,
          kind: "engine",
          segment,
          variant: booster.engine.style,
          position: [x + ex, lift - bell + 0.05, z + ez],
          dims: {
            h: bell,
            r: booster.engine.size * 0.72,
            r2: booster.engine.size * 0.3,
            s: booster.engine.power,
          },
          color: booster.engine.color,
          color2: appearance.glow,
        });
        nozzles.push({
          segment,
          position: [x + ex, lift - bell, z + ez],
          radius: booster.engine.size * 0.7,
          power: booster.engine.power,
        });
      });
    }
    distance += sample.radius;
    ring++;
  }
  const first = config.boosters[0];
  labels.push({
    key: "boosters:label",
    title: `BOOSTERS ×${config.boosters.length}`,
    detail: `${first.height.toFixed(0)}M · ${first.top.toUpperCase()}`,
    position: [-distance, first.height * 0.7, 0],
    side: "left",
  });
}

/** Places one decorative part (which may expand into several primitives). */
function layoutDecor(
  decor: DecorPart,
  anchorY: number,
  attach: DecorPart["attach"],
  radiusAt: (y: number) => number,
  segmentAt: (y: number) => string,
  push: Push,
  appearance: RocketConfig["appearance"],
  height: number,
  topRadius: number,
): void {
  const color = decor.color ?? appearance.accent;
  const s = decor.size;
  const onTop = attach === "top";
  const segment =
    onTop || attach === "payload" ? UPPER_SEGMENT : segmentAt(anchorY);
  const base = {
    sourceId: decor.id,
    segment,
    color,
    color2: appearance.secondary,
  };
  const r = onTop ? topRadius * 0.3 : radiusAt(anchorY);
  const around = (n: number, fn: (a: number, i: number) => void) => {
    for (let i = 0; i < n; i++) fn((i / n) * Math.PI * 2, i);
  };

  switch (decor.kind) {
    case "antenna":
      around(decor.count, (a, i) => {
        const pos: [number, number, number] = onTop
          ? [
              Math.cos(a) * r * (decor.count > 1 ? 1 : 0),
              height - 0.3,
              Math.sin(a) * r * (decor.count > 1 ? 1 : 0),
            ]
          : [Math.cos(a) * r, anchorY, Math.sin(a) * r];
        push({
          ...base,
          key: `${decor.id}:${i}`,
          kind: "antenna",
          position: pos,
          rotation: onTop ? [0, 0, 0] : [0, -a, -Math.PI / 2.4],
          dims: { h: 4 * s, r: 0.08 * s, r2: 0, s },
        });
      });
      break;
    case "ring":
      for (let i = 0; i < decor.count; i++) {
        const ry = onTop
          ? height - 1 - i * 1.2
          : anchorY + (i - (decor.count - 1) / 2) * 2.2 * s;
        push({
          ...base,
          key: `${decor.id}:${i}`,
          kind: "ring",
          position: [0, ry, 0],
          dims: { h: 0.3 * s, r: radiusAt(ry) + 0.25 * s, r2: 0, s },
        });
      }
      break;
    case "solarPanels":
      for (let i = 0; i < decor.count; i++) {
        [0, Math.PI].forEach((a, side) => {
          const py = anchorY + (i - (decor.count - 1) / 2) * 2.6 * s;
          push({
            ...base,
            key: `${decor.id}:${i}:${side}`,
            kind: "solarPanel",
            position: [
              Math.cos(a + i) * radiusAt(py),
              py,
              Math.sin(a + i) * radiusAt(py),
            ],
            rotation: [0, -(a + i), 0],
            dims: { h: 1.8 * s, r: 5 * s, r2: 0, s },
            color: "#1b2a4a",
            color2: color,
          });
        });
      }
      break;
    case "spikes":
      for (let row = 0; row < Math.max(1, Math.ceil(decor.count / 3)); row++) {
        const py = anchorY + row * 2 * s;
        around(8, (a, i) => {
          push({
            ...base,
            key: `${decor.id}:${row}:${i}`,
            kind: "spike",
            position: [
              Math.cos(a) * radiusAt(py),
              py,
              Math.sin(a) * radiusAt(py),
            ],
            rotation: [0, -a, -Math.PI / 2],
            dims: { h: 1.6 * s, r: 0.35 * s, r2: 0, s },
          });
        });
      }
      break;
    case "lights":
      for (let row = 0; row < decor.count; row++) {
        const py = anchorY + row * 1.6 - decor.count * 0.8;
        around(10, (a, i) => {
          push({
            ...base,
            key: `${decor.id}:${row}:${i}`,
            kind: "light",
            position: [
              Math.cos(a) * radiusAt(py),
              py,
              Math.sin(a) * radiusAt(py),
            ],
            dims: { h: 0, r: 0.22 * s, r2: 0, s: row * 10 + i },
          });
        });
      }
      break;
    case "wings":
      [0, Math.PI].forEach((a, i) => {
        push({
          ...base,
          key: `${decor.id}:${i}`,
          kind: "wing",
          position: [
            Math.cos(a) * r * 0.95,
            anchorY - 3 * s,
            Math.sin(a) * r * 0.95,
          ],
          rotation: [0, -a, 0],
          dims: { h: 7 * s, r: 6 * s, r2: 0, s },
        });
      });
      break;
    case "flag":
      push({
        ...base,
        key: `${decor.id}:0`,
        kind: "flag",
        position: onTop ? [0, height - 0.2, 0] : [r, anchorY, 0],
        rotation: onTop ? [0, 0, 0] : [0, 0, -Math.PI / 2.5],
        dims: { h: 4 * s, r: 1.8 * s, r2: 0, s },
      });
      break;
    case "googlyEyes":
      for (let i = 0; i < decor.count; i++) {
        [-0.35, 0.35].forEach((a, side) => {
          const py = anchorY + i * 2.2 * s;
          const rr = onTop ? topRadius * 0.9 : radiusAt(py);
          const ey = onTop ? height * 0.93 - i * 1.5 : py;
          const phi = a + Math.PI / 2;
          push({
            ...base,
            key: `${decor.id}:${i}:${side}`,
            kind: "googlyEye",
            position: [Math.cos(phi) * rr, ey, Math.sin(phi) * rr],
            rotation: [0, -phi + Math.PI / 2, 0],
            dims: {
              h: 0,
              r: 0.8 * s * Math.max(0.6, rr / 2.4),
              r2: 0,
              s: i + side,
            },
            color: "#ffffff",
            color2: "#0b0b0c",
          });
        });
      }
      break;
    case "duck":
      for (let i = 0; i < decor.count; i++) {
        const a = (i / decor.count) * Math.PI * 2;
        const pos: [number, number, number] = onTop
          ? [0, height - 0.1 + i * 2.6 * s, 0]
          : [Math.cos(a) * (r + 0.9 * s), anchorY, Math.sin(a) * (r + 0.9 * s)];
        push({
          ...base,
          key: `${decor.id}:${i}`,
          kind: "duck",
          position: pos,
          rotation: [0, -a + Math.PI / 2, 0],
          dims: { h: 0, r: s, r2: 0, s },
          color: decor.color ?? "#ffd21f",
          color2: "#ff8a00",
        });
      }
      break;
    case "windows":
      for (let i = 0; i < decor.count; i++) {
        const a = Math.PI / 2 + (i - (decor.count - 1) / 2) * 0.42;
        const py = anchorY;
        const rr = radiusAt(py);
        push({
          ...base,
          key: `${decor.id}:${i}`,
          kind: "window",
          position: [Math.cos(a) * rr, py, Math.sin(a) * rr],
          rotation: [0, -a + Math.PI / 2, 0],
          dims: { h: 0, r: 0.45 * s, r2: 0, s },
          color: "#0c1a24",
          color2: appearance.glow,
        });
      }
      break;
    case "tank":
      for (let i = 0; i < decor.count; i++) {
        const a = Math.PI * 0.25 + (i / decor.count) * Math.PI * 2;
        const rr = radiusAt(anchorY);
        push({
          ...base,
          key: `${decor.id}:${i}`,
          kind: "tank",
          position: [
            Math.cos(a) * (rr + 0.7 * s),
            anchorY - 3 * s,
            Math.sin(a) * (rr + 0.7 * s),
          ],
          dims: { h: 6 * s, r: 0.7 * s, r2: 0, s },
        });
      }
      break;
    case "propeller":
      push({
        ...base,
        key: `${decor.id}:0`,
        kind: "propeller",
        position: onTop ? [0, height, 0] : [0, anchorY, 0],
        dims: { h: 0, r: 3.5 * s, r2: 0, s },
      });
      break;
  }
}
