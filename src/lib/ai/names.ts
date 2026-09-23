import { computeStats } from "../rocket/stats";
import type { RocketConfig } from "../rocket/types";
import { pick, type Rng } from "../rocket/random";

const ADJECTIVES = [
  "ABSOLUTE",
  "LUNAR",
  "QUESTIONABLE",
  "MAGNIFICENT",
  "UNLICENSED",
  "BUDGET",
  "CHROME",
  "GRAVITY-OPTIONAL",
  "PROBABLY",
  "SUSPICIOUS",
  "DELUXE",
  "EXPERIMENTAL",
  "THUNDEROUS",
  "OVERCONFIDENT",
];

const NOUNS = [
  "UNIT",
  "SHOPPING CART",
  "PROBLEM SOLVER",
  "TAX WRITE-OFF",
  "PENCIL",
  "CATHEDRAL",
  "BANANA",
  "SKYSCRAPER",
  "LAWN DART",
  "CANDLE",
  "FIREWORK",
  "BAGUETTE",
  "SPACE BUS",
  "TOASTER",
  "MISTAKE",
  "INTERN",
];

const ROMAN = ["II", "III", "IV", "V", "VII", "IX", "XII"];

/** Invents a funny name that reacts to how the rocket looks. */
export function generateName(config: RocketConfig, rng: Rng): string {
  const stats = computeStats(config);
  const themed: string[] = [];
  if (config.boosters.length >= 10) themed.push("ABSOLUTE UNIT", "THE BOOSTER BUFFET", "TOO MANY TUBES");
  if (stats.height > 140) themed.push("THE SKY PENCIL", "VERTICAL AMBITION");
  if (stats.cost < 250) themed.push("THE TAX WRITE-OFF", "COUPON CLIPPER", "THE BUDGET MISTAKE");
  if (config.destination === "moon") themed.push("LUNAR SHOPPING CART", "MOON OR BUST", "CHEESE SEEKER");
  if (config.destination === "mars") themed.push("RED PLANET RENTAL", "MARS OR MAYBE", "DUSTY DREAMER");
  if (config.destination === "sun") themed.push("THE BAD IDEA", "SOLAR REGRET");
  if (config.tilt) themed.push("THE SIDEWAYS SITUATION", "HORIZONTAL AMBITION");
  if (stats.chaos > 70) themed.push("THE PROBLEM SOLVER", "OOPS ALL BOOSTERS", "CHAOS ENGINE");
  if (config.decorativeParts.some((d) => d.kind === "duck")) themed.push("DUCK OF DESTINY", "QUACKSTAR");
  if (config.payload.top === "dome") themed.push("THE FISHBOWL", "PANORAMA DELUXE");

  if (themed.length && rng() < 0.65) {
    const name = pick(rng, themed);
    return rng() < 0.4 ? `${name} MK ${pick(rng, ROMAN)}` : name;
  }
  const noun = pick(rng, NOUNS);
  return rng() < 0.5 ? `THE ${pick(rng, ADJECTIVES)} ${noun}` : `${pick(rng, ADJECTIVES)} ${noun} MK ${pick(rng, ROMAN)}`;
}

const HANDLES = [
  "orbitgoblin",
  "ksp_refugee",
  "thrustlord",
  "dr_kaboom",
  "nasa_intern_ish",
  "moonmoth",
  "boostermaxxer",
  "gravitydenier",
  "apogee_andy",
  "rocketsurgeon",
  "lil_payload",
  "stage_fright",
  "chaos_director",
  "duckmission",
  "fuel_is_food",
  "mr_countdown",
];

/** Picks a fake community handle. */
export function generateCreator(rng: Rng): string {
  return `@${pick(rng, HANDLES)}${rng() < 0.4 ? Math.floor(rng() * 99) : ""}`;
}
