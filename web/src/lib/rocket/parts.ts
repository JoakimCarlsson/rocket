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
