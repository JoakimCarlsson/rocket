import { NAMED_COLORS } from "../rocket/colors";
import { DEFAULT_NAME } from "../rocket/defaults";
import { applyActions } from "../rocket/apply";
import { computeStats, peakPower } from "../rocket/stats";
import { chance, pick, randInt, type Rng } from "../rocket/random";
import type { DecorKind, RocketConfig, SizeClass } from "../rocket/types";
import type { RocketAction } from "./actions";
import { generateName } from "./names";
import type { MissionSummary } from "./provider";

/** Raw output of the local interpreter before validation. */
export interface LocalInterpretation {
  actions: RocketAction[];
  response: string;
  name?: string;
}

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  single: 1,
  two: 2,
  couple: 2,
  pair: 2,
  three: 3,
  few: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  dozen: 12,
  fifteen: 15,
  twenty: 20,
  hundred: 99,
  million: 99,
  thousand: 99,
};

const NUMBER_PATTERN = `(\\d+|${Object.keys(NUMBER_WORDS).join("|")})`;

/** Converts a digit string or number word to a number. */
function toNumber(token: string): number {
  return /^\d+$/.test(token) ? parseInt(token, 10) : NUMBER_WORDS[token] ?? 1;
}

/** Finds a number that appears shortly before one of the given nouns. */
function numberBefore(text: string, nouns: string): number | null {
  const match = text.match(new RegExp(`\\b${NUMBER_PATTERN}\\s+(?:[a-z-]+\\s+){0,2}?(?:${nouns})`));
  return match ? toNumber(match[1]) : null;
}

/** True when the text contains any of the given word stems. */
function has(text: string, pattern: RegExp): boolean {
  return pattern.test(text);
}

/** Detects an overall multiplier such as "twice as" or "triple". */
function multiplier(text: string): number {
  if (has(text, /\b(triple|three times|3x|thrice)\b/)) return 3;
  if (has(text, /\b(twice|double|two times|2x)\b/)) return 2;
  if (has(text, /\b(half|halve)\b/)) return 0.5;
  return 1;
}

/** Reads a size adjective near a noun. */
function sizeNear(text: string, nouns: string): SizeClass | undefined {
  const match = text.match(new RegExp(`\\b(tiny|small|little|mini|big|bigger|large|larger|huge|giant|enormous|massive|colossal|gigantic|absurd|ridiculous|stupidly big)\\s+(?:[a-z-]+\\s+)?(?:${nouns})`));
  if (!match) return undefined;
  const word = match[1];
  if (/tiny|mini/.test(word)) return "tiny";
  if (/small|little/.test(word)) return "small";
  if (/big|large/.test(word)) return "large";
  return "huge";
}

/** Finds colour words in order of appearance. */
function colorsIn(text: string): string[] {
  const names = Object.keys(NAMED_COLORS).sort((a, b) => b.length - a.length);
  const found: { index: number; value: string }[] = [];
  for (const name of names) {
    const re = new RegExp(`\\b${name}\\b`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (!found.some((f) => Math.abs(f.index - m!.index) < 2)) found.push({ index: m.index, value: name });
    }
  }
  return found.sort((a, b) => a.index - b.index).map((f) => f.value);
}

const DECOR_WORDS: [RegExp, DecorKind][] = [
  [/\bantenna[es]*\b/, "antenna"],
  [/\brings?\b|\bhalo\b/, "ring"],
  [/\bsolar panels?\b|\bsolar arrays?\b/, "solarPanels"],
  [/\bspik(e|es|y)\b/, "spikes"],
  [/\blights?\b|\bleds?\b|\bdisco\b|\bfairy\b/, "lights"],
  [/\bwings?\b/, "wings"],
  [/\bflags?\b/, "flag"],
  [/\bgoogly\b|\beyes\b/, "googlyEyes"],
  [/\bducks?\b|\bduckies\b/, "duck"],
  [/\bwindows?\b|\bportholes?\b/, "windows"],
  [/\b(external |extra |side )?tanks?\b/, "tank"],
  [/\bpropellers?\b|\bprops?\b|\bhelicopter\b/, "propeller"],
];

const SILLY: DecorKind[] = ["googlyEyes", "duck", "propeller", "spikes", "lights", "wings", "flag"];

type Fragment = string;

interface Context {
  text: string;
  rocket: RocketConfig;
  rng: Rng;
  actions: RocketAction[];
  fragments: Fragment[];
}

/** Adds actions and one response fragment. */
function emit(ctx: Context, fragment: string | null, ...actions: RocketAction[]): void {
  ctx.actions.push(...actions);
  if (fragment) ctx.fragments.push(fragment);
}

/**
 * Interprets natural language locally with keyword rules. It is deliberately forgiving:
 * anything it does not understand becomes a small playful change so prompts never feel ignored.
 */
export function interpretLocally(
  instruction: string,
  rocket: RocketConfig,
  rng: Rng,
  options: { mode?: "modify" | "repair"; mission?: MissionSummary } = {},
): LocalInterpretation {
  if (options.mode === "repair") return repairLocally(rocket, rng, options.mission);

  const text = ` ${instruction.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9#\s-]/g, " ").replace(/\s+/g, " ")} `;
  const ctx: Context = { text, rocket, rng, actions: [], fragments: [] };

  if (has(text, /\bsurprise\b|\bwhatever\b|\bdealers choice\b|\bgo wild\b/)) surprise(ctx);
  if (has(text, /\b(cheap|cheapest|budget|inexpensive|affordable|low cost|broke)\b/)) cheap(ctx);
  destinations(ctx);
  boosters(ctx);
  stages(ctx);
  proportions(ctx);
  engines(ctx);
  paint(ctx);
  tops(ctx);
  payloads(ctx);
  finsAndLegs(ctx);
  decorations(ctx);
  orientation(ctx);
  if (has(text, /\b(stupid|dumb|dumbest|stupidest|ridiculous|absurd|insane|unhinged|chaotic|chaos|silly|cursed|nonsense|goofy|deranged|weirder|weird)\b/)) chaos(ctx);
  if (has(text, /\b(sleek|elegant|beautiful|clean|serious|professional|classy|tasteful)\b/)) sleek(ctx);
  if (has(text, /\b(stable|stabler|safer|safe|reliable|fix it|repair)\b/)) {
    const repair = repairLocally(ctx.rocket, rng);
    emit(ctx, repair.response, ...repair.actions);
  }

  const rename = instruction.match(/(?:call it|name it|rename(?: it)?(?: to)?|named)\s+["']?([^"'.!?,]{2,40})/i);
  if (rename) emit(ctx, `Registered as ${rename[1].trim().toUpperCase()}.`, { type: "rename", name: rename[1].trim() });

  if (ctx.actions.length === 0) fallback(ctx);

  const result = applyActions(rocket, ctx.actions);
  const before = computeStats(rocket);
  const after = computeStats(result.config);
  const fragments = ctx.fragments.slice(0, 2);
  if (after.chaos - before.chaos >= 18 && chance(rng, 0.8)) fragments.push(pick(rng, CHAOS_QUIPS));
  else if (after.reliability < 30 && chance(rng, 0.5)) fragments.push(pick(rng, LOW_RELIABILITY_QUIPS));
  fragments.push(...result.notes.slice(0, 1));

  const name = rocket.name === DEFAULT_NAME && !rename ? generateName(result.config, rng) : undefined;
  return { actions: ctx.actions, response: fragments.join(" "), name };
}

const CHAOS_QUIPS = [
  "Aerodynamic dignity has left the building.",
  "The launch pad has filed a formal complaint.",
  "I am updating my résumé.",
  "Physics has been notified.",
  "Insurance will not be covering this.",
];

const LOW_RELIABILITY_QUIPS = [
  "Engineer confidence: declining.",
  "I would not stand near this.",
  "Mission control is quietly praying.",
];

/** Handles destination-themed requests such as "build a Mars rocket". */
function destinations(ctx: Context): void {
  const { text, rocket } = ctx;
  const building = has(text, /\b(build|make|design|create|give|want|need|rocket|ship|vehicle)\b/);
  if (has(text, /\b(moon|lunar)\b/)) {
    const actions: RocketAction[] = [{ type: "set_destination", value: "moon" }];
    if (building) {
      if (rocket.stages.length < 3) actions.push({ type: "add_stage", position: "top" });
      if (!rocket.legs) actions.push({ type: "set_legs", count: 4 });
      if (rocket.payload.kind !== "capsule") actions.push({ type: "set_payload", kind: "capsule", crew: 3 });
    }
    emit(ctx, pick(ctx.rng, ["Lunar package loaded. Moon or bust.", "Moon configuration ready. Cheese not included."]), ...actions);
  } else if (has(text, /\bmars\b|\bred planet\b|\bmartian\b/)) {
    const actions: RocketAction[] = [{ type: "set_destination", value: "mars" }];
    if (building) {
      while (rocket.stages.length + actions.filter((a) => a.type === "add_stage").length < 3) actions.push({ type: "add_stage", position: "top" });
      actions.push({ type: "set_payload", kind: "habitat", crew: 6 }, { type: "set_color", target: "accent", value: "#d7261e" });
      if (!rocket.legs) actions.push({ type: "set_legs", count: 4 });
    }
    emit(ctx, pick(ctx.rng, ["Mars configuration ready. Bring snacks. Lots of snacks.", "Red planet package installed. It's a long drive."]), ...actions);
  } else if (has(text, /\b(the )?sun\b(?! ?glasses)/) && !has(text, /solar panel/)) {
    emit(
      ctx,
      "Destination: the Sun. I added gold paint, which I'm told is a heat shield.",
      { type: "set_destination", value: "sun" },
      { type: "set_finish", value: "chrome" },
      { type: "set_color", target: "all", value: "gold" },
    );
  } else if (has(text, /\borbit\b/)) {
    emit(ctx, null, { type: "set_destination", value: "orbit" });
  }
}

/** Handles booster requests. */
function boosters(ctx: Context): void {
  const { text, rocket, rng } = ctx;
  if (!has(text, /\bboost(er|ers)\b|\bstrap-?ons?\b|\bsrbs?\b/)) return;
  const current = rocket.boosters.length;
  const n = numberBefore(text, "boosters?|strap-?ons?|srbs?|more");
  const size = sizeNear(text, "boosters?|strap-?ons?");
  if (has(text, /\b(no|without|remove|lose|ditch|drop|get rid of|delete|zero)\b[a-z ]*\bboosters?\b/)) {
    if (n && n < current) {
      emit(ctx, `Removed ${n} booster${n > 1 ? "s" : ""}.`, { type: "remove_boosters", count: n });
    } else {
      emit(ctx, current ? "All boosters removed. It feels lighter. Lonelier, too." : "There were no boosters. I removed them anyway.", { type: "remove_boosters" });
    }
    return;
  }
  if (has(text, /\b(fewer|less)\b[a-z ]*\bboosters?\b/)) {
    const cut = n ?? Math.max(1, Math.ceil(current / 2));
    emit(ctx, `Trimmed ${cut} boosters. The accountants cheered.`, { type: "remove_boosters", count: cut });
    return;
  }
  const way = has(text, /\b(way too many|too many|tons of|lots of|loads of|so many|all the|infinite|maximum|max)\b/);
  const mult = multiplier(text);
  let count: number;
  if (n !== null && has(text, /\b(add|more|another|extra|additional|plus)\b/)) {
    count = n;
    emit(ctx, `${n} additional booster${n > 1 ? "s" : ""} installed.`, { type: "add_boosters", count, size });
  } else if (n !== null) {
    count = n;
    emit(ctx, count === current ? `${count} boosters, as specified.` : `${count} booster${count === 1 ? "" : "s"} attached.`, { type: "set_booster_count", count, size });
  } else if (way) {
    count = randInt(rng, 10, 16);
    emit(ctx, pick(rng, [`${count} boosters attached. I stopped counting at some point.`, `Installed ${count} boosters. That's what 'too many' means, right?`]), {
      type: "set_booster_count",
      count,
      size,
    });
  } else if (mult !== 1) {
    count = Math.max(1, Math.round(Math.max(current, 2) * mult));
    emit(ctx, `Booster count ${mult > 1 ? "multiplied" : "halved"}. Now ${count}.`, { type: "set_booster_count", count, size });
  } else if (size && current > 0 && !has(text, /\b(add|more|another)\b/)) {
    emit(ctx, `Boosters resized to ${size}.`, { type: "set_booster_count", count: current, size });
  } else {
    emit(ctx, pick(rng, ["Two more boosters strapped on.", "Boosters added. Symmetry mostly preserved."]), { type: "add_boosters", count: 2, size });
  }
  const color = colorNear(text, "boosters?");
  if (color) emit(ctx, null, { type: "set_color", target: "boosters", value: color });
}

/** Handles stage count changes. */
function stages(ctx: Context): void {
  const { text, rocket } = ctx;
  if (!has(text, /\bstages?\b|\bsingle stage\b|\bsstos?\b/)) return;
  if (has(text, /\bsingle stage\b|\bssto\b|\bone stage\b/)) {
    const removals: RocketAction[] = rocket.stages.slice(1).map(() => ({ type: "remove_stage", position: "top" }) as RocketAction);
    emit(ctx, "Single stage. Bold. Possibly foolish.", ...removals);
    return;
  }
  if (has(text, /\b(remove|fewer|less|drop|lose)\b[a-z ]*\bstages?\b/)) {
    emit(ctx, "Stage removed.", { type: "remove_stage", position: "top" });
    return;
  }
  const n = numberBefore(text, "stages?");
  const target = n !== null && !has(text, /\b(add|more|another|extra)\b/) ? n : rocket.stages.length + (n ?? 1);
  const adds = Math.max(0, Math.min(6, target) - rocket.stages.length);
  if (adds === 0) return;
  emit(ctx, adds > 1 ? `${adds} stages added. It's a tower now.` : "Another stage stacked on top.", ...Array.from({ length: adds }, () => ({ type: "add_stage", position: "top" }) as RocketAction));
}

/** Handles height, width and overall size. */
function proportions(ctx: Context): void {
  const { text, rng } = ctx;
  const mult = multiplier(text);
  const strength = mult !== 1 ? mult : 1;
  if (has(text, /\b(taller|longer|stretch|stretched|higher|tall|elongate)\b/)) {
    const h = strength > 1 ? strength : 1.35;
    emit(ctx, pick(rng, ["Stretched the stack.", "Taller. Considerably taller.", "Added some vertical ambition."]), { type: "scale", target: "rocket", height: h });
  }
  if (has(text, /\b(shorter|squat|stubby|compact|stumpy)\b/)) {
    emit(ctx, "Shortened. It's cuter now.", { type: "scale", target: "rocket", height: 0.7 });
  }
  const bottomWide = has(text, /\b(bottom|base|first stage|lower)\b[a-z ]*\b(wider|fatter|thicker|bigger|broader)\b/) || has(text, /\b(wider|fatter|thicker|broader)\b[a-z ]*\b(bottom|base)\b/);
  if (bottomWide) {
    emit(ctx, "Widened the base. Very stable. Very dramatic.", { type: "scale", target: "id", id: ctx.rocket.stages[0].id, width: 1.4 });
  } else if (has(text, /\b(wider|fatter|thicker|chunkier|girthy|beefier|chonky|chonkier|thick|fat)\b/)) {
    emit(ctx, pick(rng, ["Beefed it up.", "Chunkier. The chonk is intentional."]), { type: "scale", target: "rocket", width: 1.3 });
  }
  if (has(text, /\b(thinner|skinny|skinnier|slimmer|slim|narrow|narrower|pencil)\b/)) {
    emit(ctx, "Slimmed down. Very aerodynamic, allegedly.", { type: "scale", target: "rocket", width: 0.72 });
  }
  const partNouns = "boosters?|engines?|fins?|dome|nose|windows?|eyes|ducks?|wings?|thrusters?|nozzles?";
  if (has(text, /\b(enormous|huge|massive|gigantic|giant|colossal|bigger|larger|absolute unit|mega|monstrous|titanic|big)\b/) && !sizeNear(text, partNouns)) {
    const f = strength > 1 ? strength : 1.6;
    emit(ctx, pick(rng, ["Scaled up. It now has its own weather.", "Made it enormous. We'll need a bigger hangar.", "Absolute unit mode engaged."]), {
      type: "scale",
      target: "rocket",
      height: f,
      width: Math.sqrt(f) * 1.1,
    });
  }
  if (has(text, /\b(tiny|smaller|mini|miniature|little|pocket)\b/) && !sizeNear(text, partNouns)) {
    emit(ctx, "Shrunk it. Adorable. Probably still dangerous.", { type: "scale", target: "rocket", height: 0.6, width: 0.7 });
  }
  if (mult !== 1 && !ctx.actions.some((a) => a.type === "scale") && has(text, /\b(size|big|large|tall)\b/)) {
    emit(ctx, `Scaled by ${mult}×.`, { type: "scale", target: "rocket", height: mult, width: Math.sqrt(mult) });
  }
}

/** Handles engine and thrust requests. */
function engines(ctx: Context): void {
  const { text, rng, rocket } = ctx;
  const mentions = has(text, /\b(engines?|thrust|power|powerful|nozzles?|motors?|thrusters?)\b/);
  if (!mentions) return;
  const n = numberBefore(text, "engines?|nozzles?|motors?|thrusters?");
  const style = has(text, /aerospike/) ? "aerospike" : has(text, /trumpet/) ? "trumpet" : has(text, /flared|flare/) ? "flared" : has(text, /\bbell\b/) ? "bell" : undefined;
  const weaker = has(text, /\b(less|weaker|lower|reduce|gentle|calm|softer)\b[a-z ]*\b(thrust|power|engines?)\b/);
  const stupid = has(text, /\b(stupidly|absurdly|ridiculously|insanely|obscenely|way more|unreasonably|maximum|max)\b/);
  const bigger = has(text, /\b(bigger|huge|enormous|massive|giant|large|big|more|powerful|stronger|extra)\b/);
  const current = peakPower(rocket);
  if (weaker) {
    emit(ctx, "Engines throttled down. Everyone can breathe again.", { type: "set_engines", target: "all", power: Math.max(2, current - 3) });
    return;
  }
  const action: RocketAction = { type: "set_engines", target: n !== null ? "core" : "all" };
  if (n !== null) action.count = Math.min(19, n);
  if (style) action.style = style;
  if (stupid) {
    action.power = 10;
    action.size = "huge";
  } else if (bigger) {
    action.power = Math.min(10, current + 2);
    action.size = sizeNear(text, "engines?|nozzles?") ?? "large";
  }
  const color = colorNear(text, "engines?|nozzles?|flames?");
  if (color) action.color = color;
  const fragment = stupid
    ? pick(rng, ["You asked for more thrust. I may have interpreted 'more' aggressively.", "Engines upgraded to 'geological event'."])
    : n !== null
      ? `${n} engine${n === 1 ? "" : "s"} on the core.`
      : style
        ? `Switched to ${style} nozzles. Very fashionable.`
        : pick(rng, ["Engines upgraded.", "More thrust. The ground is nervous."]);
  emit(ctx, fragment, action);
}

/** Finds a colour mentioned right before a noun, like "red boosters". */
function colorNear(text: string, nouns: string): string | undefined {
  const names = Object.keys(NAMED_COLORS).join("|");
  const before = text.match(new RegExp(`\\b(${names})\\s+(?:[a-z]+\\s+)?(?:${nouns})\\b`));
  if (before) return before[1];
  const after = text.match(new RegExp(`\\b(?:${nouns})\\s+(?:in\\s+|to\\s+|are\\s+)?(${names})\\b`));
  return after?.[1];
}

/** Handles paint, finish and pattern requests. */
function paint(ctx: Context): void {
  const { text, rng } = ctx;
  const actions: RocketAction[] = [];
  if (has(text, /\brainbow\b|\bpride\b|\bevery colou?r\b/)) {
    emit(ctx, "Rainbow paint job applied. Visible from orbit.", { type: "set_color", target: "rainbow" });
  }
  const colors = colorsIn(text).filter((c) => c !== "chrome" || !has(text, /\bchrome\b/));
  const partColor = (nouns: string) => colorNear(text, nouns);
  const nose = partColor("nose|tip|top|cone|dome");
  const fins = partColor("fins?");
  const stripes = partColor("stripes?|bands?|trim|accents?");
  const payload = partColor("capsule|payload");
  if (nose) actions.push({ type: "set_color", target: "nose", value: nose });
  if (fins) actions.push({ type: "set_color", target: "fins", value: fins });
  if (stripes) actions.push({ type: "set_color", target: "secondary", value: stripes });
  if (payload) actions.push({ type: "set_color", target: "payload", value: payload });
  const claimed = new Set([nose, fins, stripes, payload, partColor("boosters?"), partColor("engines?|nozzles?|flames?")].filter(Boolean));
  const free = colors.filter((c) => !claimed.has(c));
  const paintVerb = has(text, /\b(paint|painted|colou?r|make it|turn it|all|in|wrap|dye|spray)\b/) || free.length > 0;
  if (free.length && paintVerb) {
    actions.push({ type: "set_color", target: "all", value: free[0] });
    if (free[1]) actions.push({ type: "set_color", target: "secondary", value: free[1] });
    if (free[2]) actions.push({ type: "set_color", target: "accent", value: free[2] });
  }
  if (has(text, /\bchrome\b|\bmirror\b/)) actions.push({ type: "set_finish", value: "chrome" }, ...(free.length ? [] : [{ type: "set_color", target: "all", value: "chrome" } as RocketAction]));
  else if (has(text, /\b(metallic|metal|brushed|steel|stainless)\b/)) actions.push({ type: "set_finish", value: "metallic" });
  else if (has(text, /\b(glossy|shiny|shinier|gloss|polished|wet)\b/)) actions.push({ type: "set_finish", value: "glossy" });
  else if (has(text, /\bmatte\b|\bflat\b|\bstealth\b/)) actions.push({ type: "set_finish", value: "matte" });
  if (has(text, /\bstealth\b/) && !free.length) actions.push({ type: "set_color", target: "all", value: "black" });
  if (has(text, /\bstripe[sd]?\b|\bracing stripes?\b/)) actions.push({ type: "set_pattern", value: "stripes" });
  else if (has(text, /\bchecker(ed|board)?\b|\bchequered\b/)) actions.push({ type: "set_pattern", value: "checker" });
  else if (has(text, /\bbands?\b|\bbanded\b/)) actions.push({ type: "set_pattern", value: "bands" });
  else if (has(text, /\btwo-?tone\b|\bsplit\b|\bhalf and half\b/)) actions.push({ type: "set_pattern", value: "split" });
  else if (has(text, /\b(plain|solid)\b/)) actions.push({ type: "set_pattern", value: "solid" });
  if (actions.length) {
    const first = free[0] ?? nose ?? fins;
    emit(
      ctx,
      first
        ? pick(rng, [`Painted it ${first}.`, `Repainted in ${first}. It looks faster, which is not how physics works.`, `${first[0].toUpperCase()}${first.slice(1)} it is.`])
        : pick(rng, ["Paint job updated.", "New livery applied."]),
      ...actions,
    );
  }
}

/** Handles the top of the rocket. */
function tops(ctx: Context): void {
  const { text, rng } = ctx;
  if (has(text, /\b(dome|glass|observation|bubble|fishbowl|panoram)/)) {
    emit(ctx, pick(rng, ["Observation dome added.", "Glass dome installed. Great views, questionable pressure."]), { type: "set_top", kind: "dome" });
  } else if (has(text, /\b(needle|pointy|pointier|sharp|sharper|pointed)\b/)) {
    emit(ctx, "Nose sharpened to a fine point.", { type: "set_top", kind: "needle" });
  } else if (has(text, /\bspike on top\b|\btop spike\b|\blightning rod\b/)) {
    emit(ctx, "Spike mounted on top.", { type: "set_top", kind: "spike" });
  } else if (has(text, /\b(blunt|rounded|round nose|flat top)\b/)) {
    emit(ctx, "Blunted the nose.", { type: "set_top", kind: "blunt" });
  } else if (has(text, /\bno nose\b|\bremove the nose\b|\bopen top\b/)) {
    emit(ctx, "Nose removed. Airflow is now everyone's problem.", { type: "set_top", kind: "none" });
  } else if (has(text, /\bogive\b|\bnose cone\b/)) {
    emit(ctx, "Classic nose cone fitted.", { type: "set_top", kind: "ogive" });
  }
}

/** Handles payload and crew changes. */
function payloads(ctx: Context): void {
  const { text } = ctx;
  const crew = numberBefore(text, "crew|astronauts?|people|passengers?|seats?|tourists?|humans?|cosmonauts?");
  if (has(text, /\b(satellite|probe|telescope)\b/)) emit(ctx, "Satellite payload loaded.", { type: "set_payload", kind: "satellite" });
  else if (has(text, /\b(cargo|freight|delivery|groceries|pizza)\b/)) emit(ctx, "Cargo bay installed. Pizza delivery range: extreme.", { type: "set_payload", kind: "cargo" });
  else if (has(text, /\b(habitat|hotel|house|home|apartment|condo|station)\b/)) emit(ctx, "Habitat module installed. It has a tiny kitchen.", { type: "set_payload", kind: "habitat", crew: crew ?? 6 });
  else if (has(text, /\bfairing\b/)) emit(ctx, "Payload fairing fitted.", { type: "set_payload", kind: "fairing" });
  else if (has(text, /\b(capsule|crewed|crew)\b/) && crew === null) emit(ctx, "Crew capsule fitted.", { type: "set_payload", kind: "capsule" });
  if (crew !== null) {
    emit(ctx, crew > 8 ? `Seats for ${Math.min(12, crew)}. It's a bus now.` : `Crew set to ${crew}.`, { type: "set_payload", crew: Math.min(12, crew), ...(ctx.rocket.payload.kind === "capsule" || ctx.rocket.payload.kind === "habitat" ? {} : { kind: "capsule" as const }) });
  }
}

/** Handles fins and landing legs. */
function finsAndLegs(ctx: Context): void {
  const { text } = ctx;
  if (has(text, /\bfins?\b/)) {
    if (has(text, /\b(no|without|remove|lose|ditch)\b[a-z ]*\bfins?\b/)) emit(ctx, "Fins removed. Steering is now vibes-based.", { type: "remove_fins" });
    else {
      const shape = has(text, /\bgrid\b/) ? "grid" : has(text, /\bshark\b/) ? "shark" : has(text, /\bdelta\b/) ? "delta" : has(text, /\bswept\b/) ? "swept" : undefined;
      const n = numberBefore(text, "fins?");
      const size = sizeNear(text, "fins?") ?? (has(text, /\b(bigger|huge|giant|massive)\b/) ? "huge" : undefined);
      emit(ctx, shape === "grid" ? "Grid fins installed. Very waffle." : "Fins adjusted.", { type: "set_fins", shape, count: n ? Math.min(12, Math.max(2, n)) : undefined, size });
    }
  }
  if (has(text, /\b(legs?|landing|reusable|land itself|landable)\b/)) {
    if (has(text, /\b(no|without|remove)\b[a-z ]*\blegs?\b/)) emit(ctx, "Landing legs removed. Landing is now optional.", { type: "remove_legs" });
    else emit(ctx, "Landing legs deployed. Reusability: theoretical.", { type: "set_legs", count: numberBefore(text, "legs?") ?? 4 });
  }
}

/** Handles decorative parts. */
function decorations(ctx: Context): void {
  const { text, rng } = ctx;
  for (const [pattern, kind] of DECOR_WORDS) {
    if (!pattern.test(text)) continue;
    if (kind === "lights" && has(text, /\blight(er|weight)\b/)) continue;
    if (kind === "tank" && !has(text, /\b(external|extra|side|fuel) tanks?\b/)) continue;
    if (kind === "ring" && has(text, /\bring of boosters\b/)) continue;
    const removing = new RegExp(`\\b(no|without|remove|lose|ditch|delete|get rid of)\\b[a-z ]*${pattern.source}`).test(text);
    if (removing) {
      emit(ctx, `Removed the ${kind === "googlyEyes" ? "googly eyes. It can no longer see you" : kind}.`, { type: "remove_decor", kind });
      continue;
    }
    const n = numberBefore(text, pattern.source.replace(/\\b/g, ""));
    const attach = has(text, /\b(on top|on the top|on the nose|top of)\b/) ? "top" : has(text, /\b(on the bottom|at the base|bottom)\b/) ? "bottom" : undefined;
    const color = colorNear(text, pattern.source.replace(/\\b/g, ""));
    const count = kind === "googlyEyes" ? Math.max(1, Math.ceil((n ?? 2) / 2)) : Math.min(12, n ?? (kind === "windows" ? 4 : 1));
    emit(ctx, pick(rng, DECOR_LINES[kind]), { type: "add_decor", kind, attach, count, color, size: sizeNear(text, pattern.source.replace(/\\b/g, "")) });
  }
}

const DECOR_LINES: Record<DecorKind, string[]> = {
  antenna: ["Antenna installed. We now get 4 bars in orbit."],
  ring: ["Decorative ring fitted. Purely ceremonial."],
  solarPanels: ["Solar panels deployed. Eco-friendly-ish."],
  spikes: ["Spikes attached. Nobody touch it.", "Spikes added. For no reason whatsoever."],
  lights: ["Lights installed. It's a party now.", "LED strips fitted. Now visible from Mars."],
  wings: ["Wings attached. It is not a plane. Please stop."],
  flag: ["Flag planted. On the rocket. Before arriving."],
  googlyEyes: ["Googly eyes installed. It can see you.", "Eyes attached. It's watching."],
  duck: ["A rubber duck has been added for morale.", "Duck installed. Quack confirmed."],
  windows: ["Portholes cut. Great for sightseeing."],
  tank: ["External tanks strapped on. Extra fuel, extra chaos."],
  propeller: ["Propeller mounted on top. I have no explanation.", "Added a propeller. It will not help."],
};

/** Handles tilt and orientation. */
function orientation(ctx: Context): void {
  const { text } = ctx;
  if (has(text, /\bsideways\b|\bhorizontal\b/)) emit(ctx, "It's sideways now. I have questions.", { type: "set_tilt", degrees: 90 });
  else if (has(text, /\bupside ?down\b|\binverted\b/)) emit(ctx, "Inverted. The engines are on top. This is fine.", { type: "set_tilt", degrees: 180 });
  else if (has(text, /\b(tilt|lean|leaning|diagonal|crooked|wonky)\b/)) emit(ctx, "Tilted for style.", { type: "set_tilt", degrees: 25 });
  else if (has(text, /\b(upright|straighten|straight up|vertical)\b/)) emit(ctx, "Straightened out.", { type: "set_tilt", degrees: 0 });
}

/** Makes it wonderfully worse. */
function chaos(ctx: Context): void {
  const { rng, text, rocket } = ctx;
  const intensity = Math.min(3, multiplier(text) + (has(text, /\b(dumbest|stupidest|most|completely|totally|imaginable|possible|ever)\b/) ? 1 : 0));
  const actions: RocketAction[] = [];
  const pool = [...SILLY].sort(() => rng() - 0.5);
  for (let i = 0; i < 1 + intensity; i++) {
    actions.push({ type: "add_decor", kind: pool[i % pool.length], count: randInt(rng, 1, 3) });
  }
  if (!ctx.actions.some((a) => a.type === "add_boosters" || a.type === "set_booster_count")) {
    actions.push({ type: "add_boosters", count: 2 * intensity + randInt(rng, 1, 3), size: pick(rng, ["small", "huge", "medium"] as const) });
  }
  actions.push({ type: "set_engines", target: "all", power: Math.min(10, 7 + intensity) });
  actions.push(chance(rng, 0.5) ? { type: "set_pattern", value: "checker" } : { type: "set_color", target: "rainbow" });
  if (chance(rng, 0.35 * intensity)) actions.push({ type: "set_tilt", degrees: pick(rng, [12, -18, 25]) });
  if (chance(rng, 0.5)) actions.push({ type: "set_top", kind: pick(rng, ["dome", "spike", "needle"] as const) });
  if (intensity >= 2 && rocket.stages.length < 5) actions.push({ type: "add_stage", position: "top", height: 6, radius: 3.6 });
  emit(
    ctx,
    pick(rng, [
      "Done. I'm not putting my name on this one.",
      "Engineering principles temporarily suspended.",
      "I made it worse. On purpose. As requested.",
      "This is the dumbest thing I've ever built. I'm weirdly proud.",
    ]),
    ...actions,
  );
}

/** Removes the silliness and tidies the look. */
function sleek(ctx: Context): void {
  const kinds = new Set(ctx.rocket.decorativeParts.filter((d) => SILLY.includes(d.kind)).map((d) => d.kind));
  emit(
    ctx,
    "Tidied up. It almost looks responsible.",
    ...[...kinds].map((kind) => ({ type: "remove_decor", kind }) as RocketAction),
    { type: "set_tilt", degrees: 0 },
    { type: "set_finish", value: "glossy" },
    { type: "set_pattern", value: "solid" },
    { type: "set_top", kind: "ogive" },
  );
}

/** Builds the stripped-down budget rocket. */
function cheap(ctx: Context): void {
  const { rocket } = ctx;
  emit(
    ctx,
    pick(ctx.rng, ["Stripped to the essentials. Duct tape is now load-bearing.", "Cheapest rocket possible. The engine is second-hand."]),
    { type: "remove_boosters" },
    ...rocket.decorativeParts.map((d) => ({ type: "remove_decor", id: d.id }) as RocketAction),
    ...rocket.stages.slice(1).map(() => ({ type: "remove_stage", position: "top" }) as RocketAction),
    { type: "set_engines", target: "core", count: 1, size: "large", power: 5 },
    { type: "set_finish", value: "matte" },
    { type: "set_pattern", value: "solid" },
    { type: "set_payload", kind: "cargo", size: "small" },
    { type: "set_fins", count: 3, size: "small", shape: "tiny" },
    { type: "remove_legs" },
    { type: "scale", target: "rocket", height: 0.75, width: 0.8 },
    { type: "set_top", kind: "cone" },
    { type: "set_color", target: "all", value: "grey" },
  );
}

/** Applies a random bundle of changes. */
function surprise(ctx: Context): void {
  const { rng } = ctx;
  const options: (() => RocketAction[])[] = [
    () => [{ type: "add_boosters", count: randInt(rng, 2, 6), size: pick(rng, ["small", "large", "huge"] as const) }],
    () => [{ type: "set_top", kind: pick(rng, ["dome", "needle", "spike", "blunt"] as const) }],
    () => [{ type: "add_decor", kind: pick(rng, SILLY), count: randInt(rng, 1, 3) }],
    () => [{ type: "set_color", target: "all", value: pick(rng, Object.keys(NAMED_COLORS)) }, { type: "set_color", target: "secondary", value: pick(rng, Object.keys(NAMED_COLORS)) }],
    () => [{ type: "set_pattern", value: pick(rng, ["stripes", "checker", "bands", "split"] as const) }],
    () => [{ type: "scale", target: "rocket", height: pick(rng, [0.7, 1.4, 1.8]), width: pick(rng, [0.8, 1.2, 1.5]) }],
    () => [{ type: "set_engines", target: "all", style: pick(rng, ["aerospike", "flared", "trumpet"] as const), power: randInt(rng, 5, 10) }],
    () => [{ type: "add_stage", position: "top" }],
    () => [{ type: "set_finish", value: pick(rng, ["chrome", "glossy", "metallic"] as const) }],
    () => [{ type: "set_fins", shape: pick(rng, ["grid", "shark", "delta"] as const), size: "large" }],
  ];
  const chosen = [...options].sort(() => rng() - 0.5).slice(0, randInt(rng, 3, 5));
  emit(ctx, pick(rng, ["Surprise! I regret nothing.", "You said surprise me. I took that personally.", "Creative freedom exercised. Liberally."]), ...chosen.flatMap((fn) => fn()));
}

const FALLBACK_NOUN = { duck: "a duck", antenna: "an antenna", lights: "a light show", flag: "a flag" } as const;

/** Used when nothing was understood. */
function fallback(ctx: Context): void {
  const { rng } = ctx;
  const kind = pick(rng, ["duck", "antenna", "lights", "flag"] as const);
  emit(
    ctx,
    pick(rng, [
      `Not entirely sure what you meant, so I added ${FALLBACK_NOUN[kind]}. Standard procedure.`,
      `I didn't catch that, so I installed ${FALLBACK_NOUN[kind]}. Try describing a change, like "add six boosters".`,
    ]),
    { type: "add_decor", kind, count: 1 },
  );
}

/** Adds engine and booster changes until the fictional thrust-to-weight clears the launch bar. */
function liftFix(rocket: RocketConfig, planned: RocketAction[]): RocketAction[] {
  const steps: RocketAction[] = [
    { type: "set_engines", target: "core", size: "large", power: 7 },
    { type: "set_engines", target: "all", size: "huge", power: 8 },
    { type: "add_boosters", count: 2, size: "large" },
    { type: "scale", target: "rocket", height: 0.75 },
  ];
  const added: RocketAction[] = [];
  for (const step of steps) {
    const stats = computeStats(applyActions(rocket, [...planned, ...added]).config);
    if (stats.thrust >= stats.mass * 9.8 * 1.3) break;
    added.push(step);
  }
  return added;
}

/**
 * Local repair: reads the fictional simulation result and dials the configuration back
 * toward something the game considers stable.
 */
export function repairLocally(rocket: RocketConfig, rng: Rng, mission?: MissionSummary): LocalInterpretation {
  const actions: RocketAction[] = [];
  const done: string[] = [];
  const boosters = rocket.boosters.length;
  if (boosters > 6) {
    const cut = Math.max(2, Math.round(boosters * 0.3));
    actions.push({ type: "remove_boosters", count: cut });
    done.push(`removed ${cut} of your ${boosters} boosters`);
  }
  if (peakPower(rocket) > 7) {
    actions.push({ type: "set_engines", target: "all", power: 6 });
    done.push("throttled the engines back from 'volcano'");
  }
  if (rocket.tilt !== 0) {
    actions.push({ type: "set_tilt", degrees: 0 });
    done.push("pointed it upwards, where space is");
  }
  if (!rocket.fins || rocket.fins.size < 0.8) {
    actions.push({ type: "set_fins", count: 4, size: "medium", shape: "swept" });
    done.push("fitted proper fins");
  }
  const silly = rocket.decorativeParts.filter((d) => SILLY.includes(d.kind));
  if (silly.length) {
    const victim = silly[0];
    actions.push({ type: "remove_decor", id: victim.id });
    done.push(`confiscated the ${victim.kind === "googlyEyes" ? "googly eyes" : victim.kind}`);
  }
  const lift = liftFix(rocket, actions);
  if (lift.length) {
    actions.push(...lift);
    done.push("gave it enough shove to actually leave the ground");
  }
  if (rocket.stages.length > 4 || mission?.outcome === "stage_malfunction") {
    if (rocket.stages.length > 2) {
      actions.push({ type: "remove_stage", position: "top" });
      done.push("removed a stage nobody could explain");
    }
  }
  if (mission?.outcome === "payload_early" && rocket.payload.top === "none") {
    actions.push({ type: "set_top", kind: "ogive" });
    done.push("put the nose cone back on");
  }
  if (actions.length === 0) {
    actions.push({ type: "set_fins", size: "large" }, { type: "set_engines", target: "all", power: Math.min(8, peakPower(rocket) + 1) });
    done.push("enlarged the fins and nudged the thrust");
  }
  const summary = done.slice(0, 3).join(", ");
  const tail = pick(rng, [
    "Your engineers are furious.",
    "Fictional stability increased.",
    "It's less fun now, but it might go up.",
    "Reliability has been restored to 'plausible'.",
  ]);
  return { actions, response: `I ${summary}. ${tail}` };
}
