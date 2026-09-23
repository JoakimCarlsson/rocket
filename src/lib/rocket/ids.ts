import type { Rng } from "./random";

const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

let source: Rng = Math.random;

/**
 * Creates a short component id with a readable prefix, such as `bst-k3f9a`.
 * Passing an rng, or running inside `withIdSource`, keeps ids deterministic.
 */
export function makeId(prefix: string, rng: Rng = source): string {
  let suffix = "";
  for (let i = 0; i < 5; i++) {
    suffix += ALPHABET[Math.floor(rng() * ALPHABET.length)];
  }
  return `${prefix}-${suffix}`;
}

/** Runs `fn` with ids drawn from `rng`, so seeded content produces identical ids every time. */
export function withIdSource<T>(rng: Rng, fn: () => T): T {
  const previous = source;
  source = rng;
  try {
    return fn();
  } finally {
    source = previous;
  }
}
