/** Hashes an integer lattice point to a repeatable value in [0, 1). */
function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smoothly interpolated value noise in [0, 1). */
export function valueNoise(x: number, y: number, seed = 0): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, seed);
  const b = hash(ix + 1, iy, seed);
  const c = hash(ix, iy + 1, seed);
  const d = hash(ix + 1, iy + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/** Fractal value noise: `octaves` layers, each twice the frequency and half the weight, in [0, 1). */
export function fbm(x: number, y: number, octaves: number, seed = 0): number {
  let sum = 0;
  let weight = 0.5;
  let total = 0;
  let frequency = 1;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * frequency, y * frequency, seed + i) * weight;
    total += weight;
    weight *= 0.5;
    frequency *= 2.03;
  }
  return sum / total;
}

/** Ridged fractal noise for sharp mountain crests, in [0, 1]. */
export function ridged(
  x: number,
  y: number,
  octaves: number,
  seed = 0,
): number {
  let sum = 0;
  let weight = 0.5;
  let total = 0;
  let frequency = 1;
  for (let i = 0; i < octaves; i++) {
    const n =
      1 - Math.abs(valueNoise(x * frequency, y * frequency, seed + i) * 2 - 1);
    sum += n * n * weight;
    total += weight;
    weight *= 0.5;
    frequency *= 2.1;
  }
  return sum / total;
}
