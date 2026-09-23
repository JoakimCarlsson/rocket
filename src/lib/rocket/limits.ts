import type { SizeClass } from "./types";

/** Hard bounds that keep any configuration renderable and fun rather than broken. */
export const LIMITS = {
  boosters: 24,
  stages: 6,
  engines: 19,
  decor: 30,
  decorCount: 12,
  stageHeight: [3, 90] as const,
  radius: [0.6, 12] as const,
  boosterHeight: [4, 80] as const,
  boosterRadius: [0.4, 6] as const,
  payloadHeight: [2, 30] as const,
  engineSize: [0.3, 3.5] as const,
  power: [1, 10] as const,
  crew: [0, 12] as const,
  fins: [2, 12] as const,
  finSize: [0.3, 4] as const,
  legs: [3, 8] as const,
  decorSize: [0.2, 4] as const,
  tilt: [-180, 180] as const,
  nameLength: 40,
};

/** Multipliers for size buckets used by the AI and generation code. */
export const SIZE_FACTOR: Record<SizeClass, number> = {
  tiny: 0.5,
  small: 0.75,
  medium: 1,
  large: 1.4,
  huge: 2,
};

/** Clamps a number into a closed range, mapping NaN to the minimum. */
export function clamp(value: number, range: readonly [number, number]): number {
  if (!Number.isFinite(value)) return range[0];
  return Math.min(range[1], Math.max(range[0], value));
}

/** Clamps and rounds a number to an integer in range. */
export function clampInt(
  value: number,
  range: readonly [number, number],
): number {
  return Math.round(clamp(value, range));
}
