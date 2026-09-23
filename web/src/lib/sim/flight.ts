import {
  allGroups,
  allOwners,
  atmosphere,
  attachedMass,
  buildVehicle,
  centerOfMass,
  centerOfPressure,
  dragArea,
  EARTH_MU,
  EARTH_RADIUS,
  EXCESS_SPEED_NEEDED,
  FAIRING_OWNER,
  type FailureRisk,
  failureRisks,
  fullTanks,
  G0,
  KARMAN_LINE,
  LUNAR_DISTANCE,
  machDragFactor,
  massFlow,
  type PropulsionGroup,
  SEA_LEVEL_DENSITY,
  SURFACE_SPEED,
  thrustAt,
} from "../rocket/physics";
import { type Rng, randRange } from "../rocket/random";
import type { RocketConfig } from "../rocket/types";

/** Something that happened during the flight, in real seconds after ignition. */
export type FlightEventType =
  | "liftoff"
  | "maxq"
  | "booster_sep"
  | "stage_sep"
  | "fairing_sep"
  | "engine_out"
  | "booster_fail"
  | "stall"
  | "spin"
  | "payload_pop"
  | "explode"
  | "burnout"
  | "impact"
  | "orbit"
  | "wobble";

/** A timed flight event. `id` names the stage or booster involved. */
export interface FlightEvent {
  t: number;
  type: FlightEventType;
  id?: string;
}

/** One point of the recorded trajectory. */
export interface FlightSample {
  t: number;
  altitude: number;
  downrange: number;
  speed: number;
  pitch: number;
  q: number;
}

/** How the flight ended. */
export type FlightEnd =
  | "pad"
  | "goal"
  | "orbit"
  | "escape"
  | "suborbital"
  | "crash"
  | "explode"
  | "spin"
  | "breakup"
  | "payload"
  | "stall";

/** What a stage or booster did during the flight. */
export interface GroupUsage {
  key: string;
  label: string;
  ignited: boolean;
  burned: number;
  failed: boolean;
}

/** Complete result of integrating one flight. */
export interface FlightResult {
  end: FlightEnd;
  events: FlightEvent[];
  samples: FlightSample[];
  duration: number;
  maxAltitude: number;
  maxSpeed: number;
  maxQ: number;
  maxG: number;
  apogee: number | null;
  perigee: number | null;
  excessSpeed: number;
  deltaVUsed: number;
  usage: GroupUsage[];
  firstStageLanded: boolean;
  engineOuts: number;
}

type Mode =
  | "ascent"
  | "coast"
  | "circularize"
  | "depart"
  | "passive"
  | "tumble";

interface Vec {
  x: number;
  y: number;
}

interface ScheduledFailure {
  t: number;
  key: string;
  kind: "explode" | "engine_out" | "stall" | "booster_fail" | "payload_pop";
}

const TARGET_APOGEE = 200_000;
const TARGET_PERIGEE = 150_000;
const MAX_TIME = 4000;
const SAMPLE_EVERY = 2;
const GIMBAL_RANGE = (6 * Math.PI) / 180;
const EARTH_SPIN = SURFACE_SPEED / EARTH_RADIUS;

/** Orbital elements of the current state: apogee and perigee altitudes, or excess speed when escaping. */
function orbitOf(
  pos: Vec,
  vel: Vec,
): { apogee: number; perigee: number; excess: number; apogeeRadius: number } {
  const r = Math.hypot(pos.x, pos.y);
  const v2 = vel.x * vel.x + vel.y * vel.y;
  const energy = v2 / 2 - EARTH_MU / r;
  const h = Math.abs(pos.x * vel.y - pos.y * vel.x);
  const e = Math.sqrt(Math.max(0, 1 + (2 * energy * h * h) / EARTH_MU ** 2));
  if (energy >= 0)
    return {
      apogee: Infinity,
      perigee: (h * h) / EARTH_MU / (1 + e) - EARTH_RADIUS,
      excess: Math.sqrt(2 * energy),
      apogeeRadius: Infinity,
    };
  const a = -EARTH_MU / (2 * energy);
  return {
    apogee: a * (1 + e) - EARTH_RADIUS,
    perigee: a * (1 - e) - EARTH_RADIUS,
    excess: 0,
    apogeeRadius: a * (1 + e),
  };
}

/** Converts degrees to radians. */
function rad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Converts radians to degrees. */
function deg(radians: number): number {
  return (radians * 180) / Math.PI;
}

/** Clamps a number into a range. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Returns the usable propellant floor of a group: landing reserve stays in the tank. */
function floorOf(group: PropulsionGroup): number {
  return group.reserve;
}

/** Rolls when and how one group's engines fail, if they do. */
function rollEngineFailure(
  group: PropulsionGroup,
  risk: FailureRisk | undefined,
  ignition: number,
  rng: Rng,
): ScheduledFailure | null {
  if (!risk || rng() >= risk.p) return null;
  const burnTime =
    (group.propellantMass - group.reserve) /
    Math.max(1, massFlow(group.perf) * group.engines);
  const t = ignition + randRange(rng, 0.05, 0.95) * burnTime;
  const roll = rng();
  if (group.kind === "booster")
    return {
      t,
      key: group.key,
      kind: roll < 0.5 ? "explode" : "booster_fail",
    };
  if (group.engines >= 2)
    return { t, key: group.key, kind: roll < 0.3 ? "explode" : "engine_out" };
  return { t, key: group.key, kind: roll < 0.5 ? "explode" : "stall" };
}

/**
 * Integrates a 2D flight around a round, rotating Earth: thrust with altitude-dependent
 * Isp, drag with transonic rise, gravity, staging, guidance, aerodynamic control and
 * seeded hardware failures. Deterministic for a given rocket and rng.
 */
export function flyRocket(
  config: RocketConfig,
  rng: Rng,
  chaos: number,
): FlightResult {
  const vehicle = buildVehicle(config);
  const risks = failureRisks(config, vehicle);
  const riskOf = (key: string, kind: FailureRisk["kind"]) =>
    risks.find((r) => r.key === key && r.kind === kind);
  const groups = allGroups(vehicle);
  const attached = allOwners(vehicle);
  const propellant = fullTanks(vehicle);
  const alive = new Map(groups.map((g) => [g.key, g.engines]));
  const ignited = new Set<string>();
  const failedGroups = new Set<string>();
  const events: FlightEvent[] = [];
  const samples: FlightSample[] = [];
  const failures: ScheduledFailure[] = [];
  const destination = config.destination;
  const anyGimbal = groups.some((g) => g.gimbal);
  const turnRate = anyGimbal ? 3 : 0.5;
  const gLimit = vehicle.crew > 0 ? 4 : 6;
  const qLimit = 65_000 * clamp(22 / vehicle.slenderness, 0.35, 1);
  const disturbance = rad(4 + chaos * 0.04);

  const pos: Vec = { x: 0, y: EARTH_RADIUS };
  const vel: Vec = { x: SURFACE_SPEED, y: 0 };
  let t = 0;
  let stageIndex = 0;
  let mode: Mode = "ascent";
  let enginesOn = true;
  let pauseUntil = 0;
  let lifted = false;
  let end: FlightEnd | null = null;
  let maxAltitude = 0;
  let maxSpeed = 0;
  let maxQ = 0;
  let maxQTime = 0;
  let maxQAnnounced = false;
  let maxG = 0;
  let deltaVUsed = 0;
  let lastSample = -Infinity;
  let firstStageLanded = false;
  let engineOuts = 0;
  let attitude = 90 - config.tilt;
  let reachedOrbit = false;
  let stalled = false;

  const emit = (type: FlightEventType, id?: string, at = t) =>
    events.push({ t: at, type, id });
  const ignite = (group: PropulsionGroup) => {
    ignited.add(group.key);
    const failure = rollEngineFailure(
      group,
      riskOf(group.key, "engine"),
      t,
      rng,
    );
    if (failure) failures.push(failure);
  };

  ignite(vehicle.stages[0]);
  vehicle.boosters.forEach(ignite);
  const payloadRisk = riskOf("upper", "payload");
  if (payloadRisk && rng() < payloadRisk.p)
    failures.push({
      t: randRange(rng, 30, 260),
      key: "upper",
      kind: "payload_pop",
    });
  const structureRisk = riskOf("decor", "structure");
  if (structureRisk && rng() < structureRisk.p)
    failures.push({ t: randRange(rng, 8, 120), key: "decor", kind: "explode" });
  if (chaos > 45 && rng() < chaos / 150)
    emit("wobble", undefined, randRange(rng, 4, 30));

  const currentStage = () => vehicle.stages[stageIndex];
  const hasPropellant = (g: PropulsionGroup) =>
    (propellant.get(g.key) ?? 0) > floorOf(g) + 1e-3;
  const burningGroups = (): PropulsionGroup[] => {
    if (mode === "tumble" || t < pauseUntil) return [];
    return groups.filter((g) => {
      if (!attached.has(g.key) || !ignited.has(g.key)) return false;
      if ((alive.get(g.key) ?? 0) <= 0 || !hasPropellant(g)) return false;
      if (g.kind === "stage" && g !== currentStage()) return false;
      return g.throttleable ? enginesOn && mode !== "passive" : true;
    });
  };
  const detach = (key: string) => attached.delete(key);

  while (end === null && t < MAX_TIME) {
    const r = Math.hypot(pos.x, pos.y);
    const altitude = r - EARTH_RADIUS;
    const up: Vec = { x: pos.x / r, y: pos.y / r };
    const east: Vec = { x: up.y, y: -up.x };
    const air: Vec = { x: EARTH_SPIN * pos.y, y: -EARTH_SPIN * pos.x };
    const rel: Vec = { x: vel.x - air.x, y: vel.y - air.y };
    const relSpeed = Math.hypot(rel.x, rel.y);
    const { density, pressure } = atmosphere(altitude);
    const q = 0.5 * density * relSpeed * relSpeed;
    const vr = vel.x * up.x + vel.y * up.y;
    const vh = vel.x * east.x + vel.y * east.y;
    const speed = Math.hypot(vel.x, vel.y);
    const gNet = EARTH_MU / (r * r) - (vh * vh) / r;
    const orbit = orbitOf(pos, vel);
    const mass = attachedMass(vehicle, attached, propellant);

    const burning = burningGroups();
    const dt =
      burning.length || altitude < 120_000 ? 0.2 : altitude < 400_000 ? 1 : 2;
    const fullThrust = (g: PropulsionGroup) =>
      thrustAt(g.perf, pressure) * (alive.get(g.key) ?? 0);
    const fixed = burning
      .filter((g) => !g.throttleable)
      .reduce((sum, g) => sum + fullThrust(g), 0);
    const variable = burning
      .filter((g) => g.throttleable)
      .reduce((sum, g) => sum + fullThrust(g), 0);
    let throttle = 1;
    if (variable > 0) {
      if (q > 20_000) throttle = Math.min(throttle, 1 - (q - 20_000) / 10_000);
      throttle = Math.min(
        throttle,
        (gLimit * G0 * mass - fixed) / Math.max(1, variable),
      );
      throttle = clamp(throttle, 0.25, 1);
    }
    const thrust = fixed + variable * throttle;
    const accel = thrust / mass;

    const gammaRel = deg(
      Math.asin(
        clamp((rel.x * up.x + rel.y * up.y) / Math.max(1, relSpeed), -1, 1),
      ),
    );
    const gammaIn = deg(Math.asin(clamp(vr / Math.max(1, speed), -1, 1)));
    let elevation = 90;
    if (destination === "nowhere") elevation = 90;
    else if (mode === "ascent") {
      if (relSpeed < 60 || altitude < 200) elevation = 90;
      else if (altitude < 35_000) {
        const program = 90 - 55 * (altitude / 35_000) ** 0.55;
        elevation =
          gammaRel < program - 10
            ? Math.min(90, program + 10)
            : clamp(program, gammaRel - 5, gammaRel + 5);
      } else {
        const neededVr = Math.sqrt(2 * 9.5 * Math.max(0, 120_000 - altitude));
        const hold = deg(
          Math.asin(
            clamp((gNet + (neededVr - vr) / 20) / Math.max(0.1, accel), -1, 1),
          ),
        );
        elevation = Math.max(gammaIn, hold);
      }
      if (orbit.apogee >= TARGET_APOGEE && altitude > 35_000) {
        if (burning.some((g) => !g.throttleable)) elevation = 0;
        else {
          enginesOn = false;
          mode = "coast";
        }
      }
    } else if (mode === "circularize") {
      elevation = deg(
        Math.asin(clamp((gNet - vr / 25) / Math.max(0.1, accel), -0.5, 0.8)),
      );
    } else if (mode === "depart") {
      elevation = gammaIn;
    }
    if (lifted && mode !== "tumble")
      attitude += clamp(elevation - attitude, -turnRate * dt, turnRate * dt);
    const aim = rad(attitude);
    const dir: Vec = {
      x: Math.cos(aim) * east.x + Math.sin(aim) * up.x,
      y: Math.cos(aim) * east.y + Math.sin(aim) * up.y,
    };

    if (!lifted) {
      const lift =
        thrust * (dir.x * up.x + dir.y * up.y) - (mass * EARTH_MU) / (r * r);
      if (lift > 0) {
        lifted = true;
        emit("liftoff");
      } else if (t > 8 || !burning.length) {
        end = "pad";
        break;
      }
    }

    if (lifted) {
      const dragMag =
        0.5 *
        density *
        relSpeed *
        dragArea(vehicle, attached) *
        machDragFactor(relSpeed / 320);
      const propeller = vehicle.propellerThrust * (density / SEA_LEVEL_DENSITY);
      const gravity = EARTH_MU / (r * r * r);
      const push = mode === "tumble" ? 0 : thrust + propeller;
      const ax = (push * dir.x - dragMag * rel.x) / mass - gravity * pos.x;
      const ay = (push * dir.y - dragMag * rel.y) / mass - gravity * pos.y;
      vel.x += ax * dt;
      vel.y += ay * dt;
      pos.x += vel.x * dt;
      pos.y += vel.y * dt;
      deltaVUsed += (push / mass) * dt;
      maxG = Math.max(
        maxG,
        Math.hypot(ax + gravity * pos.x, ay + gravity * pos.y) / G0,
      );
    }

    for (const g of burning) {
      const flow =
        massFlow(g.perf) *
        (alive.get(g.key) ?? 0) *
        (g.throttleable ? throttle : 1);
      propellant.set(
        g.key,
        Math.max(floorOf(g), (propellant.get(g.key) ?? 0) - flow * dt),
      );
    }

    t += dt;
    maxAltitude = Math.max(maxAltitude, altitude);
    maxSpeed = Math.max(maxSpeed, relSpeed);
    if (q > maxQ) {
      maxQ = q;
      maxQTime = t;
    } else if (!maxQAnnounced && maxQ > 5_000 && q < maxQ * 0.9) {
      maxQAnnounced = true;
      emit("maxq", undefined, maxQTime);
    }
    if (t - lastSample >= SAMPLE_EVERY) {
      lastSample = t;
      samples.push({
        t,
        altitude,
        downrange: Math.atan2(pos.x, pos.y) * EARTH_RADIUS,
        speed: relSpeed,
        pitch: 90 - attitude,
        q,
      });
    }

    if (lifted && altitude < 0 && vr < 0) {
      emit("impact");
      end = mode === "tumble" ? "spin" : stalled ? "stall" : "crash";
      break;
    }

    for (const failure of failures.filter((f) => f.t <= t)) {
      failures.splice(failures.indexOf(failure), 1);
      const group = groups.find((g) => g.key === failure.key);
      if (group && (!attached.has(group.key) || !hasPropellant(group)))
        continue;
      if (failure.kind === "payload_pop") {
        emit("payload_pop");
        end = "payload";
      } else if (failure.kind === "explode") {
        emit("explode", group?.id);
        end = "explode";
      } else if (failure.kind === "engine_out" && group) {
        alive.set(group.key, (alive.get(group.key) ?? 1) - 1);
        engineOuts++;
        emit("engine_out", group.id);
      } else if (failure.kind === "booster_fail" && group) {
        failedGroups.add(group.key);
        detach(group.key);
        emit("booster_fail", group.id);
      } else if (failure.kind === "stall" && group) {
        alive.set(group.key, 0);
        failedGroups.add(group.key);
        emit("stall", group.id);
        stalled = true;
        mode = "passive";
      }
    }
    if (end) break;

    if (lifted && q > 4_000 && burning.length && mode !== "tumble") {
      const cm = centerOfMass(vehicle, attached, propellant);
      const cp = centerOfPressure(vehicle, attached);
      const arm = cp.y - cm;
      if (arm > 0) {
        const upset = q * vehicle.referenceArea * cp.cna * disturbance * arm;
        const authority = burning
          .filter((g) => g.gimbal)
          .reduce(
            (sum, g) =>
              sum +
              fullThrust(g) *
                Math.sin(GIMBAL_RANGE) *
                Math.max(0, cm - g.engineY),
            0,
          );
        if (upset > authority) {
          emit("spin");
          if (q > 15_000) {
            emit("explode", undefined, t + 1.2);
            end = "spin";
            break;
          }
          mode = "tumble";
        }
      }
    }
    if (lifted && q > qLimit) {
      emit("explode");
      end = mode === "tumble" ? "spin" : "breakup";
      break;
    }

    if (
      vehicle.hasFairing &&
      attached.has(FAIRING_OWNER) &&
      altitude > 110_000
    ) {
      detach(FAIRING_OWNER);
      emit("fairing_sep");
    }

    const boosters = vehicle.boosters.filter((b) => attached.has(b.key));
    if (boosters.length && boosters.every((b) => !hasPropellant(b))) {
      boosters.forEach((b) => detach(b.key));
      emit("booster_sep");
    }

    const stage = currentStage();
    const boostersLeft = vehicle.boosters.some((b) => attached.has(b.key));
    if (
      lifted &&
      stage &&
      attached.has(stage.key) &&
      !hasPropellant(stage) &&
      !boostersLeft &&
      mode !== "tumble" &&
      !failedGroups.has(stage.key)
    ) {
      const next = vehicle.stages[stageIndex + 1];
      if (!next) {
        if (mode !== "passive") emit("burnout");
        mode = "passive";
      } else {
        detach(stage.key);
        emit("stage_sep", stage.id);
        if (stageIndex === 0 && config.legs) firstStageLanded = rng() < 0.9;
        stageIndex++;
        pauseUntil = t + 1.5;
        const separation = riskOf(next.key, "separation");
        if (separation && rng() < separation.p) {
          failedGroups.add(next.key);
          alive.set(next.key, 0);
          emit("stall", next.id, t + 1.5);
          stalled = true;
          mode = "passive";
        } else {
          ignite(next);
        }
      }
    }

    if (mode === "coast") {
      const next = currentStage();
      const available =
        next && attached.has(next.key) && hasPropellant(next)
          ? thrustAt(next.perf, 0) * (alive.get(next.key) ?? 0)
          : 0;
      if (!available) mode = "passive";
      else {
        const apogeeRadius = orbit.apogeeRadius;
        const h = Math.abs(pos.x * vel.y - pos.y * vel.x);
        const circularDv =
          Math.sqrt(EARTH_MU / apogeeRadius) - h / apogeeRadius;
        const burnTime = circularDv / (available / mass);
        const toApogee = vr / Math.max(0.5, gNet);
        if (vr <= 0 || toApogee <= burnTime / 2 + 5) {
          mode = "circularize";
          enginesOn = true;
        } else if (
          orbit.apogee < TARGET_APOGEE * 0.9 &&
          altitude < KARMAN_LINE
        ) {
          mode = "ascent";
          enginesOn = true;
        }
      }
    }

    if (!reachedOrbit && orbit.perigee >= TARGET_PERIGEE && orbit.apogee > 0) {
      reachedOrbit = true;
      emit("orbit");
      if (destination === "orbit") {
        end = "goal";
        break;
      }
      mode = "depart";
      enginesOn = true;
    }
    if (reachedOrbit || mode === "depart" || mode === "passive") {
      if (destination === "moon" && orbit.apogeeRadius >= LUNAR_DISTANCE) {
        end = "goal";
        break;
      }
      const excessNeeded = EXCESS_SPEED_NEEDED[destination];
      if (excessNeeded !== undefined && orbit.excess >= excessNeeded) {
        end = "goal";
        break;
      }
    }
    if (destination === "nowhere" && maxAltitude >= KARMAN_LINE && vr < 0) {
      end = "goal";
      break;
    }

    if (mode === "passive" && burningGroups().length === 0) {
      if (orbit.excess > 0) end = "escape";
      else if (orbit.perigee >= 120_000) end = "orbit";
      else if (maxAltitude >= KARMAN_LINE && vr < 0) end = "suborbital";
      if (end) break;
    }
  }

  if (end === null) end = maxAltitude >= KARMAN_LINE ? "suborbital" : "crash";
  const finalOrbit = orbitOf(pos, vel);
  return {
    end,
    events: events.sort((a, b) => a.t - b.t),
    samples,
    duration: t,
    maxAltitude,
    maxSpeed,
    maxQ,
    maxG,
    apogee: Number.isFinite(finalOrbit.apogee) ? finalOrbit.apogee : null,
    perigee: finalOrbit.excess > 0 ? null : finalOrbit.perigee,
    excessSpeed: finalOrbit.excess,
    deltaVUsed,
    usage: groups.map((g) => ({
      key: g.key,
      label: g.label,
      ignited: ignited.has(g.key),
      burned:
        1 -
        ((propellant.get(g.key) ?? 0) - g.reserve) /
          Math.max(1, g.propellantMass - g.reserve),
      failed: failedGroups.has(g.key),
    })),
    firstStageLanded,
    engineOuts,
  };
}
