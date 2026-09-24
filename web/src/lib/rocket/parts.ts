import type { Propellant } from "./types";

/** Segment key for the payload, nose and anything attached to them. */
export const UPPER_OWNER = "upper";

/** Segment key for a jettisonable payload fairing. */
export const FAIRING_OWNER = "fairing";

/** Display names for each propellant. */
export const PROPELLANT_LABELS: Record<Propellant, string> = {
  solid: "SOLID",
  kerolox: "KEROLOX",
  methalox: "METHALOX",
  hydrolox: "HYDROLOX",
};

/** Every nose cap the payload can wear. */
export const TOP_KINDS = [
  "cone",
  "ogive",
  "needle",
  "blunt",
  "dome",
  "spike",
  "round",
  "bulb",
  "none",
] as const;

/** Every cap a side booster can wear. */
export const BOOSTER_TOPS = ["cone", "ogive", "blunt", "round"] as const;

/** Every primitive a sculpted shape can be. */
export const SHAPE_KINDS = [
  "sphere",
  "hemisphere",
  "capsule",
  "cylinder",
  "cone",
  "box",
  "torus",
  "wedge",
  "star",
  "heart",
  "smile",
] as const;

/** Every surface a sculpted shape can have. */
export const SHAPE_MATERIALS = ["paint", "chrome", "glass", "glow"] as const;

/** Every place a decoration or shape can attach. */
export const ATTACH_POINTS = ["top", "payload", "core", "bottom"] as const;
