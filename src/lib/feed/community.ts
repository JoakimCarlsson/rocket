import { validateModelOutput } from "../ai/actions";
import { interpretLocally } from "../ai/local-interpreter";
import { generateCreator, generateName } from "../ai/names";
import { applyActions } from "../rocket/apply";
import { createRandomRocket, createStarterRocket } from "../rocket/defaults";
import { withIdSource } from "../rocket/ids";
import { createRng, hashString, pick, randInt } from "../rocket/random";
import type { RocketConfig } from "../rocket/types";
import { simulateLaunch, type LaunchPlan } from "../sim/simulate";

/** A community rocket card on the Explore feed. */
export interface FeedPost {
  id: string;
  name: string;
  creator: string;
  prompt: string;
  rocket: RocketConfig;
  likes: number;
  plan: LaunchPlan;
}

interface Seeded {
  slug: string;
  name: string;
  creator: string;
  prompts: string[];
  likes: number;
  base: "starter" | number;
}

/** Hand-written community rockets so Explore feels populated from day one. */
const SEEDED: Seeded[] = [
  { slug: "tax-write-off", name: "THE TAX WRITE-OFF", creator: "@cfo_of_space", prompts: ["Make the cheapest rocket possible", "add a flag on top"], likes: 4211, base: "starter" },
  { slug: "lunar-shopping-cart", name: "LUNAR SHOPPING CART", creator: "@moonmoth", prompts: ["Build me a lunar rocket with three boosters", "add cargo", "paint it silver with red stripes"], likes: 3890, base: "starter" },
  { slug: "absolute-unit-mk-iv", name: "ABSOLUTE UNIT MK IV", creator: "@thrustlord", prompts: ["make it enormous", "add 12 boosters", "give it stupidly powerful engines", "paint it black and gold"], likes: 9120, base: "starter" },
  { slug: "the-problem-solver", name: "THE PROBLEM SOLVER", creator: "@chaos_director", prompts: ["Make me the dumbest rocket imaginable with 12 boosters", "add googly eyes"], likes: 12044, base: "starter" },
  { slug: "duck-of-destiny", name: "DUCK OF DESTINY", creator: "@duckmission", prompts: ["put a rubber duck on top", "paint it yellow", "add a glass observation dome"], likes: 6602, base: 1201 },
  { slug: "sideways-situation", name: "THE SIDEWAYS SITUATION", creator: "@gravitydenier", prompts: ["make it sideways", "add wings", "add six boosters"], likes: 2877, base: 88 },
  { slug: "red-planet-rental", name: "RED PLANET RENTAL", creator: "@dustydreamer", prompts: ["Build a Mars rocket", "make it taller", "paint it white with red bands"], likes: 5310, base: "starter" },
  { slug: "chrome-cathedral", name: "CHROME CATHEDRAL", creator: "@shinyobjects", prompts: ["make it chrome", "make it enormous", "add a spike on top", "add lights"], likes: 4480, base: 404 },
  { slug: "the-intern", name: "THE INTERN", creator: "@nasa_intern_ish", prompts: ["make it tiny", "add a propeller", "add googly eyes"], likes: 7011, base: 12 },
  { slug: "space-bus", name: "SPACE BUS", creator: "@lil_payload", prompts: ["add a habitat with 12 passengers", "make it wider", "paint it yellow and black"], likes: 3140, base: "starter" },
  { slug: "checkerboard-regret", name: "CHECKERBOARD REGRET", creator: "@stage_fright", prompts: ["checkered black and white", "add four more boosters", "add grid fins"], likes: 1996, base: 77 },
  { slug: "solar-regret", name: "SOLAR REGRET", creator: "@apogee_andy", prompts: ["send it to the sun", "add spikes", "make it pointier"], likes: 2603, base: 3131 },
];

const PROMPT_POOL = [
  "add way too many boosters",
  "make it twice as stupid",
  "paint it pink and cyan",
  "add a glass observation dome",
  "make it enormous",
  "give it stupidly powerful engines",
  "make it sideways",
  "add googly eyes",
  "add a rubber duck",
  "surprise me",
  "make the bottom wider",
  "add 3 stages",
  "make it chrome",
  "add wings",
  "checkered racing stripes",
  "make it tiny",
  "add landing legs",
  "build a moon rocket",
  "build a Mars rocket",
  "add a propeller",
  "make it look completely ridiculous",
  "add spikes and lights",
  "make it cheaper",
  "add six boosters",
  "paint it matte black",
  "give it aerospike engines",
];

/** Runs prompts through the local interpreter to grow a rocket exactly as a player would. */
function growRocket(base: RocketConfig, prompts: string[], seed: number): RocketConfig {
  const rng = createRng(seed);
  let rocket = base;
  for (const prompt of prompts) {
    const raw = interpretLocally(prompt, rocket, rng);
    const valid = validateModelOutput(raw, "local");
    rocket = applyActions(rocket, valid.actions).config;
  }
  return rocket;
}

/** Builds a hand-written community post. */
function seededPost(entry: Seeded): FeedPost {
  const seed = hashString(entry.slug);
  const rocket = withIdSource(createRng(seed ^ 0x5bd1e995), () => {
    const base = entry.base === "starter" ? createStarterRocket() : createRandomRocket(entry.base);
    const grown = growRocket(base, entry.prompts, seed);
    return { ...grown, name: entry.name, seed };
  });
  return {
    id: `c-${entry.slug}`,
    name: entry.name,
    creator: entry.creator,
    prompt: entry.prompts.join(" → "),
    rocket,
    likes: entry.likes,
    plan: simulateLaunch(rocket, 1),
  };
}

/** Builds a procedurally generated post for infinite scrolling. */
function generatedPost(index: number): FeedPost {
  const seed = hashString(`feed-${index}`);
  const rng = createRng(seed);
  const prompts = Array.from({ length: randInt(rng, 1, 3) }, () => pick(rng, PROMPT_POOL));
  const rocket = withIdSource(createRng(seed ^ 0x5bd1e995), () => {
    const grown = growRocket(createRandomRocket(seed), prompts, seed);
    return { ...grown, name: generateName(grown, rng), seed };
  });
  return {
    id: `g-${index}`,
    name: rocket.name,
    creator: generateCreator(rng),
    prompt: prompts.join(" → "),
    rocket,
    likes: Math.floor(Math.pow(rng(), 3) * 9000) + randInt(rng, 3, 90),
    plan: simulateLaunch(rocket, 1),
  };
}

const cache = new Map<string, FeedPost>();

/** Returns a page of the infinite feed. The first page starts with the hand-written rockets. */
export function feedPage(page: number, size = 12): FeedPost[] {
  const posts: FeedPost[] = [];
  for (let i = page * size; i < (page + 1) * size; i++) {
    const id = i < SEEDED.length ? `c-${SEEDED[i].slug}` : `g-${i - SEEDED.length}`;
    const post = getPost(id);
    if (post) posts.push(post);
  }
  return posts;
}

/** Resolves a community post id (`c-…` or `g-…`). */
export function getPost(id: string): FeedPost | null {
  const hit = cache.get(id);
  if (hit) return hit;
  let post: FeedPost | null = null;
  if (id.startsWith("c-")) {
    const entry = SEEDED.find((s) => `c-${s.slug}` === id);
    post = entry ? seededPost(entry) : null;
  } else if (/^g-\d{1,6}$/.test(id)) {
    post = generatedPost(parseInt(id.slice(2), 10));
  }
  if (post) cache.set(id, post);
  return post;
}
