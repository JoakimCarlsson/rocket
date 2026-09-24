import type { Flight, FlightSample } from "@/lib/physics/api";

/** A timed moment in the launch animation, in seconds after ignition. */
export type LaunchEvent =
  | { t: number; type: "liftoff" }
  | { t: number; type: "maxq" }
  | { t: number; type: "booster_sep" }
  | { t: number; type: "stage_sep"; stageId: string }
  | { t: number; type: "fairing_sep" }
  | { t: number; type: "engine_out"; groupId: string }
  | { t: number; type: "booster_fail"; boosterId: string }
  | { t: number; type: "spin" }
  | { t: number; type: "payload_pop" }
  | { t: number; type: "stall"; stageId: string }
  | { t: number; type: "burnout" }
  | { t: number; type: "explode" }
  | { t: number; type: "impact" }
  | { t: number; type: "tip_over" }
  | { t: number; type: "wobble" }
  | { t: number; type: "arrive" };

/**
 * How animation time maps onto flight time: matching rows of a monotonic
 * table, animation seconds after liftoff against flight seconds.
 */
interface WarpClock {
  anim: Float64Array;
  flight: Float64Array;
}

/** A server flight prepared for playback under smooth time warp. */
export interface LaunchPlan extends Omit<Flight, "duration"> {
  flightDuration: number;
  duration: number;
  events: LaunchEvent[];
  clock: WarpClock;
}

/**
 * Where the vehicle is at one moment of the flight. `climb` and `ground` are
 * the rates of change of altitude and downrange in m/s of flight time, and
 * `warp` is how many flight seconds pass per animation second.
 */
export interface FlightPoint {
  altitude: number;
  downrange: number;
  speed: number;
  pitch: number;
  climb: number;
  ground: number;
  warp: number;
}

const LIFTOFF_AT = 1.2;
const TICK = 1 / 120;
const REAL_TIME_UNTIL = 6;
const FULL_WARP_AT = 30;
const COAST_WARP = 5;
const EVENT_WARP = 3;
const EVENT_BEHIND = 2;
const EVENT_LOOKAHEAD = 1.5;
const WARP_RESPONSE = 2.5;
const EVENT_TYPES = new Set([
  "booster_sep",
  "stage_sep",
  "fairing_sep",
  "engine_out",
  "booster_fail",
  "spin",
  "payload_pop",
  "stall",
  "explode",
  "impact",
]);

/** Animation seconds a flight of this length should take to watch. */
function watchSeconds(flightSeconds: number): number {
  return Math.min(48, 14 + 1.6 * Math.sqrt(flightSeconds));
}

/** Smoothly steps from 0 to 1 as x goes from a to b. */
function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** The sample index at or after a flight time, by binary search. */
function sampleAt(samples: FlightSample[], t: number): number {
  let lo = 0;
  let hi = samples.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The log time warp the playback wants at a flight time: real time at
 * liftoff, ramping up to `logPeak` through the climb, faster still while
 * coasting out of the air, and down to a crawl when staging or a failure is
 * within EVENT_LOOKAHEAD seconds of the viewer's time.
 */
function wantedWarp(
  flight: Flight,
  events: number[],
  t: number,
  logPeak: number,
  warp: number,
): number {
  const samples = flight.trajectory;
  const s = samples[Math.min(samples.length - 1, sampleAt(samples, t))];
  const coasting = s !== undefined && s.throttle === 0 && s.q < 100;
  let wanted =
    smoothstep(REAL_TIME_UNTIL, FULL_WARP_AT, t) *
    (logPeak + (coasting ? Math.log(COAST_WARP) : 0));
  const reach = warp * EVENT_LOOKAHEAD;
  if (events.some((e) => e > t - EVENT_BEHIND && e < t + reach))
    wanted = Math.min(wanted, Math.log(EVENT_WARP));
  return Math.max(0, wanted);
}

/**
 * Builds the warp table for a peak warp. The log warp follows what the
 * playback wants through a critically damped spring in the viewer's time,
 * so the picture speeds up and slows down smoothly, never in a jump.
 */
function buildClock(flight: Flight, events: number[], logPeak: number) {
  const anim = [0];
  const times = [0];
  let t = 0;
  let clock = 0;
  let logWarp = 0;
  let rate = 0;
  while (t < flight.duration) {
    const wanted = wantedWarp(flight, events, t, logPeak, Math.exp(logWarp));
    const accel =
      WARP_RESPONSE * WARP_RESPONSE * (wanted - logWarp) -
      2 * WARP_RESPONSE * rate;
    rate += accel * TICK;
    logWarp = Math.max(0, logWarp + rate * TICK);
    t += Math.exp(logWarp) * TICK;
    clock += TICK;
    anim.push(clock);
    times.push(t);
  }
  return { anim: Float64Array.from(anim), flight: Float64Array.from(times) };
}

/** Chooses the time warp that plays the flight in a watchable length. */
function warpClock(flight: Flight): WarpClock {
  const events = (flight.milestones ?? [])
    .filter((e) => EVENT_TYPES.has(e.type))
    .map((e) => e.t);
  const target = watchSeconds(flight.duration);
  const length = (c: WarpClock) => c.anim[c.anim.length - 1];
  let clock = buildClock(flight, events, 0);
  if (length(clock) <= target) return clock;
  let lo = 0;
  let hi = Math.log(400);
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    clock = buildClock(flight, events, mid);
    if (length(clock) > target) lo = mid;
    else hi = mid;
  }
  return buildClock(flight, events, hi);
}

/** Reads one column of the warp table at a value of the other, extrapolating at the ends. */
function lookup(from: Float64Array, to: Float64Array, value: number): number {
  const last = from.length - 1;
  if (value <= 0) return 0;
  if (value >= from[last]) {
    const slope =
      (to[last] - to[last - 1]) / Math.max(1e-9, from[last] - from[last - 1]);
    return to[last] + (value - from[last]) * slope;
  }
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (from[mid] <= value) lo = mid;
    else hi = mid;
  }
  const f = (value - from[lo]) / Math.max(1e-9, from[hi] - from[lo]);
  return to[lo] + (to[hi] - to[lo]) * f;
}

/** Converts flight seconds to animation seconds after ignition. */
function animationTime(plan: Pick<LaunchPlan, "clock">, flightSeconds: number) {
  return LIFTOFF_AT + lookup(plan.clock.flight, plan.clock.anim, flightSeconds);
}

/** Converts animation seconds after ignition to flight seconds. */
export function flightTime(plan: LaunchPlan, animationSeconds: number): number {
  return lookup(
    plan.clock.anim,
    plan.clock.flight,
    animationSeconds - LIFTOFF_AT,
  );
}

/** Flight seconds per animation second at a moment of the animation. */
function warpAt(plan: LaunchPlan, animationSeconds: number): number {
  const a = Math.max(TICK, animationSeconds - LIFTOFF_AT);
  const before = lookup(plan.clock.anim, plan.clock.flight, a - TICK);
  const after = lookup(plan.clock.anim, plan.clock.flight, a + TICK);
  return Math.max(1, (after - before) / (2 * TICK));
}

/** Whether a launch counts as a failure on the report card. */
function failed(flight: Flight): boolean {
  return flight.report.grade === "failure";
}

/** The pad sequence for a rocket that cannot lift itself. */
function padEvents(seed: number): LaunchEvent[] {
  const events: LaunchEvent[] = [
    { t: 1.5, type: "wobble" },
    { t: 4.2, type: "tip_over" },
  ];
  if (seed % 2 === 0) events.push({ t: 6.2, type: "explode" });
  return events;
}

/** Maps flight events onto the animation clock, in step with the trajectory. */
function animateEvents(
  flight: Flight,
  plan: Pick<LaunchPlan, "clock">,
): LaunchEvent[] {
  const events: LaunchEvent[] = [];
  for (const e of flight.milestones ?? []) {
    const id = e.id ?? "";
    const t = animationTime(plan, e.t);
    switch (e.type) {
      case "liftoff":
        events.push({ t: LIFTOFF_AT, type: "liftoff" });
        break;
      case "stage_sep":
      case "stall":
        events.push({ t, type: e.type, stageId: id });
        break;
      case "engine_out":
        events.push({ t, type: "engine_out", groupId: id });
        break;
      case "booster_fail":
        events.push({ t, type: "booster_fail", boosterId: id });
        break;
      case "orbit":
        break;
      default:
        events.push({ t, type: e.type });
    }
  }
  const ended = events.some((e) => e.type === "explode" || e.type === "impact");
  if (!ended && !failed(flight))
    events.push({
      t: animationTime(plan, flight.duration) + 0.6,
      type: "arrive",
    });
  return events.sort((a, b) => a.t - b.t);
}

/** Prepares a server flight for playback. */
export function toLaunchPlan(flight: Flight): LaunchPlan {
  const clock = warpClock(flight);
  const events =
    flight.outcome === "fizzle"
      ? padEvents(flight.seed)
      : animateEvents(flight, { clock });
  const last = Math.max(0, ...events.map((e) => e.t));
  const fiery = events.some((e) => e.type === "explode" || e.type === "impact");
  return {
    ...flight,
    flightDuration: flight.duration,
    duration: last + (fiery ? 3.5 : 2.5),
    events,
    clock,
  };
}

/** Unwraps a pitch difference into [-180, 180) degrees. */
function pitchDelta(a: number, b: number): number {
  return ((((b - a + 180) % 360) + 360) % 360) - 180;
}

/**
 * Interpolates between two samples with cubic Hermite curves on altitude and
 * downrange, using the recorded rates as tangents, so the path and its
 * velocity are continuous across samples.
 */
function between(a: FlightSample, b: FlightSample, t: number): FlightPoint {
  const h = Math.max(1e-3, b.t - a.t);
  const s = Math.min(1, Math.max(0, (t - a.t) / h));
  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;
  const d00 = (6 * s2 - 6 * s) / h;
  const d10 = 3 * s2 - 4 * s + 1;
  const d01 = (-6 * s2 + 6 * s) / h;
  const d11 = 3 * s2 - 2 * s;
  const curve = (p0: number, m0: number, p1: number, m1: number) =>
    h00 * p0 + h10 * h * m0 + h01 * p1 + h11 * h * m1;
  const slope = (p0: number, m0: number, p1: number, m1: number) =>
    d00 * p0 + d10 * m0 + d01 * p1 + d11 * m1;
  return {
    altitude: Math.max(0, curve(a.altitude, a.climb, b.altitude, b.climb)),
    downrange: curve(a.downrange, a.ground, b.downrange, b.ground),
    speed: a.speed + (b.speed - a.speed) * s,
    pitch: a.pitch + pitchDelta(a.pitch, b.pitch) * s,
    climb: slope(a.altitude, a.climb, b.altitude, b.climb),
    ground: slope(a.downrange, a.ground, b.downrange, b.ground),
    warp: 1,
  };
}

/** The pad state before liftoff. */
function onPad(samples: FlightSample[]): FlightPoint {
  return {
    altitude: 0,
    downrange: 0,
    speed: 0,
    pitch: samples[0]?.pitch ?? 0,
    climb: 0,
    ground: 0,
    warp: 1,
  };
}

/**
 * The vehicle's state at an animation time: altitude and downrange in metres,
 * speed in m/s, pitch in degrees from vertical. Past the last sample a
 * surviving vehicle keeps moving at its final rates, so it never freezes in
 * the sky; a lost one holds its final reading.
 */
export function telemetryAt(
  plan: LaunchPlan,
  animationSeconds: number,
): FlightPoint {
  const samples = plan.trajectory;
  if (!samples.length || animationSeconds <= LIFTOFF_AT) return onPad(samples);
  const t = flightTime(plan, animationSeconds);
  const warp = warpAt(plan, animationSeconds);
  const i = sampleAt(samples, t);
  if (i === 0) {
    const pad = { ...samples[0], ...onPad(samples), t: 0 };
    return { ...between(pad, samples[0], t), warp };
  }
  if (i >= samples.length) {
    const last = samples[samples.length - 1];
    if (plan.report.grade === "failure")
      return { ...between(last, last, last.t), climb: 0, ground: 0, warp };
    const dt = t - last.t;
    return {
      altitude: Math.max(0, last.altitude + last.climb * dt),
      downrange: last.downrange + last.ground * dt,
      speed: last.speed,
      pitch: last.pitch,
      climb: last.climb,
      ground: last.ground,
      warp,
    };
  }
  return { ...between(samples[i - 1], samples[i], t), warp };
}
