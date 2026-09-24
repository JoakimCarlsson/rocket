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

/** A server flight prepared for playback on a compressed clock. */
export interface LaunchPlan extends Omit<Flight, "duration"> {
  flightDuration: number;
  duration: number;
  events: LaunchEvent[];
  timeScale: number;
}

/** Where the vehicle is at one moment of the flight. `path` is the direction of motion over the ground, in degrees from vertical like `pitch`. */
export interface FlightPoint {
  altitude: number;
  downrange: number;
  speed: number;
  pitch: number;
  path: number;
}

const LIFTOFF_AT = 1.2;
const MIN_EVENT_GAP = 0.6;
const PLAYBACK_SECONDS = 22;

/** Converts flight seconds to animation seconds after ignition. */
function animationTime(flightSeconds: number, timeScale: number): number {
  return LIFTOFF_AT + timeScale * Math.sqrt(Math.max(0, flightSeconds));
}

/** Converts animation seconds after ignition to flight seconds. */
export function flightTime(plan: LaunchPlan, animationSeconds: number): number {
  const t = Math.max(0, animationSeconds - LIFTOFF_AT) / plan.timeScale;
  return t * t;
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

/** Maps flight events onto the animation clock, keeping cues readable. */
function animateEvents(flight: Flight, timeScale: number): LaunchEvent[] {
  const events: LaunchEvent[] = [];
  let previous = 0;
  const at = (t: number) => {
    const next = Math.max(
      animationTime(t, timeScale),
      previous + MIN_EVENT_GAP,
    );
    previous = next;
    return next;
  };
  for (const e of flight.milestones) {
    const id = e.id ?? "";
    switch (e.type) {
      case "liftoff":
        previous = LIFTOFF_AT;
        events.push({ t: LIFTOFF_AT, type: "liftoff" });
        break;
      case "stage_sep":
      case "stall":
        events.push({ t: at(e.t), type: e.type, stageId: id });
        break;
      case "engine_out":
        events.push({ t: at(e.t), type: "engine_out", groupId: id });
        break;
      case "booster_fail":
        events.push({ t: at(e.t), type: "booster_fail", boosterId: id });
        break;
      case "orbit":
        break;
      default:
        events.push({ t: at(e.t), type: e.type });
    }
  }
  const ended = events.some((e) => e.type === "explode" || e.type === "impact");
  if (!ended && !failed(flight))
    events.push({ t: at(flight.duration) + 0.4, type: "arrive" });
  return events.sort((a, b) => a.t - b.t);
}

/** Prepares a server flight for playback. */
export function toLaunchPlan(flight: Flight): LaunchPlan {
  const timeScale = Math.min(
    1.1,
    PLAYBACK_SECONDS / Math.sqrt(Math.max(1, flight.duration)),
  );
  const events =
    flight.outcome === "fizzle"
      ? padEvents(flight.seed)
      : animateEvents(flight, timeScale);
  const last = Math.max(0, ...events.map((e) => e.t));
  const fiery = events.some((e) => e.type === "explode" || e.type === "impact");
  return {
    ...flight,
    flightDuration: flight.duration,
    duration: last + (fiery ? 3.5 : 2.5),
    events,
    timeScale,
  };
}

/** Interpolates between two samples, or from the pad to the first one. */
function between(a: FlightSample, b: FlightSample, t: number): FlightPoint {
  const f = (t - a.t) / Math.max(0.001, b.t - a.t);
  const pitch = a.pitch + (b.pitch - a.pitch) * f;
  const rise = b.altitude - a.altitude;
  const run = b.downrange - a.downrange;
  return {
    altitude: Math.max(0, a.altitude + rise * f),
    downrange: a.downrange + run * f,
    speed: a.speed + (b.speed - a.speed) * f,
    pitch,
    path:
      Math.hypot(rise, run) > 1
        ? (Math.atan2(run, rise) * 180) / Math.PI
        : pitch,
  };
}

/**
 * The vehicle's state at an animation time: altitude and downrange in metres,
 * speed in m/s, pitch in degrees from vertical. Past the last sample a
 * surviving vehicle keeps moving at its final rate, so it never freezes in
 * the sky; a lost one holds its final reading.
 */
export function telemetryAt(
  plan: LaunchPlan,
  animationSeconds: number,
): FlightPoint {
  const samples = plan.trajectory;
  if (!samples.length || animationSeconds <= LIFTOFF_AT)
    return {
      altitude: 0,
      downrange: 0,
      speed: 0,
      pitch: samples[0]?.pitch ?? 0,
      path: samples[0]?.pitch ?? 0,
    };
  const t = flightTime(plan, animationSeconds);
  const i = samples.findIndex((s) => s.t >= t);
  if (i === 0) {
    const pad = { ...samples[0], t: 0, altitude: 0, downrange: 0, speed: 0 };
    return between(pad, samples[0], t);
  }
  if (i < 0) {
    const last = samples[samples.length - 1];
    if (plan.report.grade === "failure") return between(last, last, last.t);
    const coasting = between(samples[samples.length - 2] ?? last, last, t);
    return { ...coasting, speed: last.speed, pitch: last.pitch };
  }
  return between(samples[i - 1], samples[i], t);
}
