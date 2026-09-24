/** Relative size bucket used by the AI and by procedural generation. */
export type SizeClass = "tiny" | "small" | "medium" | "large" | "huge";

/** Visual shape of an engine nozzle. */
export type NozzleStyle = "bell" | "aerospike" | "flared" | "trumpet";

/** What a stage or booster burns. Sets density, efficiency and whether it can throttle. */
export type Propellant = "solid" | "kerolox" | "methalox" | "hydrolox";

/** Shape of the very top of the rocket. */
export type TopKind =
  | "cone"
  | "ogive"
  | "needle"
  | "blunt"
  | "dome"
  | "spike"
  | "round"
  | "bulb"
  | "none";

/** Shape of a side booster's cap. */
export type BoosterTop = "cone" | "ogive" | "blunt" | "round";

/** What the rocket carries under its top. */
export type PayloadKind =
  | "capsule"
  | "fairing"
  | "satellite"
  | "cargo"
  | "habitat"
  | "none";

/** Surface material style applied across the vehicle. */
export type Finish = "matte" | "satin" | "metallic" | "chrome" | "glossy";

/** Paint pattern for body sections. */
export type Pattern = "solid" | "stripes" | "bands" | "checker" | "split";

/** Fin silhouette. */
export type FinShape = "delta" | "swept" | "grid" | "tiny" | "shark";

/** Where the simulated mission is headed. */
export type Destination = "orbit" | "moon" | "mars" | "sun" | "nowhere";

/** Decorative add-ons that can be attached anywhere on the rocket. */
export type DecorKind =
  | "antenna"
  | "ring"
  | "solarPanels"
  | "spikes"
  | "lights"
  | "wings"
  | "flag"
  | "googlyEyes"
  | "duck"
  | "windows"
  | "tank"
  | "propeller";

/** Engine cluster mounted under a stage or booster. */
export interface EngineSpec {
  count: number;
  size: number;
  power: number;
  style: NozzleStyle;
  gimbal: boolean;
  color: string;
}

/** A stacked core section. Stages are ordered bottom to top. */
export interface Stage {
  id: string;
  height: number;
  radius: number;
  taper: number;
  color: string | null;
  propellant: Propellant;
  engine: EngineSpec;
}

/** A strap-on side booster. Placement around the core follows list order. */
export interface Booster {
  id: string;
  height: number;
  radius: number;
  color: string | null;
  top: BoosterTop;
  propellant: Propellant;
  engine: EngineSpec;
}

/** The payload section and the cap on top of it. */
export interface Payload {
  id: string;
  kind: PayloadKind;
  height: number;
  crew: number;
  color: string | null;
  top: TopKind;
  topColor: string | null;
  heatShield: boolean;
  parachutes: boolean;
}

/** A set of fins around the bottom stage. */
export interface FinSet {
  id: string;
  count: number;
  size: number;
  shape: FinShape;
  color: string | null;
}

/** Landing legs around the bottom stage. */
export interface LegSet {
  id: string;
  count: number;
  size: number;
}

/** Target a decorative part attaches to. */
export type DecorAttach = "top" | "payload" | "core" | "bottom";

/** A single decorative part. */
export interface DecorPart {
  id: string;
  kind: DecorKind;
  attach: DecorAttach;
  count: number;
  size: number;
  color: string | null;
}

/** Primitive a sculpted shape is made from. */
export type ShapeKind =
  | "sphere"
  | "hemisphere"
  | "capsule"
  | "cylinder"
  | "cone"
  | "box"
  | "torus"
  | "wedge"
  | "star"
  | "heart"
  | "smile";

/** Surface of a sculpted shape. */
export type ShapeMaterial = "paint" | "chrome" | "glass" | "glow";

/**
 * A freeform sculpted primitive, the building block for turning a rocket into a duck,
 * a hot dog or anything else. `up` is metres from the attach anchor, `angle` is degrees
 * around the axis from the front (90 = right), and `out` is the distance of its centre
 * from the axis in metres. `count` repeats the shape evenly
 * around the axis and `mirror` adds a mirror image on the other side.
 */
export interface ShapePart {
  id: string;
  label: string;
  shape: ShapeKind;
  attach: DecorAttach;
  up: number;
  angle: number;
  out: number;
  width: number;
  height: number;
  depth: number;
  pitch: number;
  yaw: number;
  roll: number;
  count: number;
  mirror: boolean;
  material: ShapeMaterial;
  color: string | null;
}

/** Global look of the vehicle. */
export interface Appearance {
  primary: string;
  secondary: string;
  accent: string;
  finish: Finish;
  pattern: Pattern;
  glow: string;
}

/** Complete, serializable rocket configuration. */
export interface RocketConfig {
  version: 1;
  name: string;
  seed: number;
  destination: Destination;
  tilt: number;
  stages: Stage[];
  boosters: Booster[];
  payload: Payload;
  fins: FinSet | null;
  legs: LegSet | null;
  decorativeParts: DecorPart[];
  shapes: ShapePart[];
  appearance: Appearance;
}

/** Statistics derived from a configuration by the physics model. */
export interface SimulatedStats {
  height: number;
  mass: number;
  thrust: number;
  twr: number;
  deltaV: number;
  deltaVNeeded: number;
  stability: number;
  crew: number;
  cost: number;
  reliability: number;
  chaos: number;
}
