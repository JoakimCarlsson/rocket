/** Relative size bucket used by the AI and by procedural generation. */
export type SizeClass = "tiny" | "small" | "medium" | "large" | "huge";

/** Visual shape of an engine nozzle. */
export type NozzleStyle = "bell" | "aerospike" | "flared" | "trumpet";

/** Shape of the very top of the rocket. */
export type TopKind = "cone" | "ogive" | "needle" | "blunt" | "dome" | "spike" | "none";

/** What the rocket carries under its top. */
export type PayloadKind = "capsule" | "fairing" | "satellite" | "cargo" | "habitat" | "none";

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
  color: string;
}

/** A stacked core section. Stages are ordered bottom to top. */
export interface Stage {
  id: string;
  height: number;
  radius: number;
  taper: number;
  color: string | null;
  engine: EngineSpec;
}

/** A strap-on side booster. Placement around the core follows list order. */
export interface Booster {
  id: string;
  height: number;
  radius: number;
  color: string | null;
  top: "cone" | "ogive" | "blunt";
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
  appearance: Appearance;
}

/** Game-only statistics derived from a configuration. */
export interface SimulatedStats {
  height: number;
  mass: number;
  thrust: number;
  crew: number;
  range: number;
  cost: number;
  reliability: number;
  chaos: number;
}
