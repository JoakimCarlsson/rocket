/** Deterministic pseudo-random generator returning floats in [0, 1). */
export type Rng = () => number;

/**
 * Creates a mulberry32 generator from a 32-bit seed so rockets, feeds and
 * launches replay identically from the same seed.
 */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hashes a string into a 32-bit unsigned seed. */
export function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Returns a random integer in [min, max]. */
export function randInt(rng: Rng, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

/** Returns a random float in [min, max). */
export function randRange(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

/** Picks one element uniformly from a non-empty list. */
export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

/** Returns true with the given probability. */
export function chance(rng: Rng, probability: number): boolean {
  return rng() < probability;
}

/** Creates a fresh random 32-bit seed. */
export function newSeed(): number {
  return Math.floor(Math.random() * 4294967296) >>> 0;
}
