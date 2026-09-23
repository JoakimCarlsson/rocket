import {
  decorAnchor,
  finGeometry,
  payloadHeight,
  payloadTopRadius,
  stackSections,
  stageIndexAt,
  topHeight,
  totalHeight,
  upperRadius,
} from "./geometry";
import type {
  DecorAttach,
  DecorKind,
  Destination,
  EngineSpec,
  FinShape,
  NozzleStyle,
  PayloadKind,
  Propellant,
  RocketConfig,
  TopKind,
} from "./types";

/** Standard gravity, used for specific impulse and g-loads. */
export const G0 = 9.80665;
/** Mean Earth radius in metres. */
export const EARTH_RADIUS = 6_371_000;
/** Earth's gravitational parameter in m³/s². */
export const EARTH_MU = 3.986004418e14;
/** Eastward surface speed at the launch site, which the vehicle starts with. */
export const SURFACE_SPEED = 408;
/** Exponential atmosphere scale height in metres. */
export const SCALE_HEIGHT = 8500;
/** Air density at sea level in kg/m³. */
export const SEA_LEVEL_DENSITY = 1.225;
/** Altitude where space begins, for scoring. */
export const KARMAN_LINE = 100_000;
/** Segment key for the payload, nose and anything attached to them. */
export const UPPER_OWNER = "upper";
/** Segment key for a jettisonable payload fairing. */
export const FAIRING_OWNER = "fairing";

/** Physical behaviour of a propellant combination. */
export interface PropellantSpec {
  label: string;
  density: number;
  ispSea: number;
  ispVac: number;
  tankDensity: number;
  thrustFactor: number;
  engineTwr: number;
  throttleable: boolean;
  risk: number;
}

/** Every propellant the game knows. Numbers are rounded real-world figures. */
export const PROPELLANTS: Record<Propellant, PropellantSpec> = {
  solid: {
    label: "SOLID",
    density: 1750,
    ispSea: 242,
    ispVac: 268,
    tankDensity: 190,
    thrustFactor: 1.7,
    engineTwr: 400,
    throttleable: false,
    risk: 0.6,
  },
  kerolox: {
    label: "KEROLOX",
    density: 1030,
    ispSea: 282,
    ispVac: 311,
    tankDensity: 34,
    thrustFactor: 1,
    engineTwr: 105,
    throttleable: true,
    risk: 0.9,
  },
  methalox: {
    label: "METHALOX",
    density: 830,
    ispSea: 305,
    ispVac: 345,
    tankDensity: 32,
    thrustFactor: 1,
    engineTwr: 100,
    throttleable: true,
    risk: 1,
  },
  hydrolox: {
    label: "HYDROLOX",
    density: 360,
    ispSea: 366,
    ispVac: 450,
    tankDensity: 30,
    thrustFactor: 0.75,
    engineTwr: 75,
    throttleable: true,
    risk: 1.2,
  },
};

/** How a nozzle shape trades sea-level against vacuum performance. */
export const NOZZLES: Record<
  NozzleStyle,
  { sea: number; vac: number; thrust: number; risk: number }
> = {
  bell: { sea: 1, vac: 1, thrust: 1, risk: 1 },
  aerospike: { sea: 1.07, vac: 0.97, thrust: 0.95, risk: 1.25 },
  flared: { sea: 0.78, vac: 1.08, thrust: 1, risk: 1 },
  trumpet: { sea: 0.96, vac: 0.95, thrust: 1.12, risk: 1.4 },
};

/** Velocity change a destination needs from the pad, losses included, in m/s. */
export const DELTA_V_NEEDED: Record<Destination, number> = {
  nowhere: 1800,
  orbit: 9300,
  moon: 12400,
  mars: 13200,
  sun: 31000,
};

/** Hyperbolic excess speed that counts as reaching a destination, in m/s. */
export const EXCESS_SPEED_NEEDED: Partial<Record<Destination, number>> = {
  mars: 2940,
  sun: 26900,
};

/** Apogee radius that counts as reaching the Moon, in metres from Earth's centre. */
export const LUNAR_DISTANCE = 384_400_000;

const DRAG_COEFFICIENT: Record<TopKind, number> = {
  needle: 0.22,
  ogive: 0.27,
  cone: 0.32,
  spike: 0.3,
  dome: 0.45,
  blunt: 0.5,
  none: 0.85,
};

const NOSE_CENTER_OF_PRESSURE: Record<TopKind, number> = {
  needle: 0.47,
  ogive: 0.47,
  cone: 0.67,
  spike: 0.6,
  dome: 0.4,
  blunt: 0.4,
  none: 0,
};

const PAYLOAD_DENSITY: Record<PayloadKind, number> = {
  capsule: 260,
  fairing: 110,
  satellite: 160,
  cargo: 320,
  habitat: 130,
  none: 0,
};

const FIN_TIP_RATIO: Record<FinShape, number> = {
  delta: 0,
  swept: 0.35,
  grid: 1,
  tiny: 0.5,
  shark: 0.25,
};

const DECOR_MASS: Record<DecorKind, number> = {
  antenna: 30,
  ring: 400,
  solarPanels: 250,
  spikes: 150,
  lights: 20,
  wings: 1500,
  flag: 10,
  googlyEyes: 5,
  duck: 2,
  windows: 60,
  tank: 900,
  propeller: 300,
};

const DECOR_DRAG: Record<DecorKind, number> = {
  antenna: 0.05,
  ring: 0.3,
  solarPanels: 2,
  spikes: 1.2,
  lights: 0.05,
  wings: 1.5,
  flag: 0.3,
  googlyEyes: 0.4,
  duck: 0.3,
  windows: 0,
  tank: 0.4,
  propeller: 1.5,
};

/** Performance of one engine burning a given propellant. */
export interface EnginePerformance {
  thrustVac: number;
  ispSea: number;
  ispVac: number;
  mass: number;
}

/** A stage or booster: a tank with engines under it. */
export interface PropulsionGroup {
  key: string;
  id: string;
  kind: "stage" | "booster";
  index: number;
  label: string;
  propellant: Propellant;
  propellantMass: number;
  reserve: number;
  engines: number;
  perf: EnginePerformance;
  gimbal: boolean;
  throttleable: boolean;
  y: number;
  engineY: number;
  power: number;
  style: NozzleStyle;
}

/** A fixed mass owned by a segment of the vehicle. */
export interface MassItem {
  owner: string;
  mass: number;
  y: number;
}

/** A normal-force contribution for centre-of-pressure maths (Barrowman-style). */
export interface LiftItem {
  owner: string;
  cna: number;
  y: number;
}

/** A drag area contribution in m². */
export interface DragItem {
  owner: string;
  cda: number;
}

/** Everything the flight model needs to know about a vehicle. */
export interface VehicleModel {
  stages: PropulsionGroup[];
  boosters: PropulsionGroup[];
  items: MassItem[];
  lift: LiftItem[];
  drag: DragItem[];
  referenceDiameter: number;
  referenceArea: number;
  height: number;
  slenderness: number;
  payloadMass: number;
  crew: number;
  hasFairing: boolean;
  propellerThrust: number;
}

/** One burn of the analytic staging breakdown. */
export interface BurnPhase {
  label: string;
  deltaV: number;
  twr: number;
  burnTime: number;
  propellant: string;
}

/** A way the hardware can let the mission down, with its per-flight probability. */
export interface FailureRisk {
  key: string;
  kind: "engine" | "separation" | "payload" | "structure";
  p: number;
  lossShare: number;
}

/** Returns the performance of one engine of a cluster. */
export function enginePerformance(
  engine: EngineSpec,
  propellant: Propellant,
): EnginePerformance {
  const p = PROPELLANTS[propellant];
  const n = NOZZLES[engine.style];
  const pressure = 1 + (engine.power - 5) * 0.006;
  const thrustVac =
    2.6e6 * engine.size ** 2 * (engine.power / 5) * p.thrustFactor * n.thrust;
  return {
    thrustVac,
    ispSea: p.ispSea * n.sea * pressure,
    ispVac: p.ispVac * n.vac * pressure,
    mass: (thrustVac / (G0 * p.engineTwr)) * (engine.gimbal ? 1.04 : 1),
  };
}

/** Returns specific impulse at an ambient pressure ratio (1 = sea level, 0 = vacuum). */
export function ispAt(perf: EnginePerformance, pressure: number): number {
  return perf.ispVac - (perf.ispVac - perf.ispSea) * pressure;
}

/** Returns one engine's thrust at an ambient pressure ratio. Mass flow is fixed, so thrust follows Isp. */
export function thrustAt(perf: EnginePerformance, pressure: number): number {
  return (perf.thrustVac * ispAt(perf, pressure)) / perf.ispVac;
}

/** Returns one engine's propellant mass flow in kg/s at full throttle. */
export function massFlow(perf: EnginePerformance): number {
  return perf.thrustVac / (perf.ispVac * G0);
}

/** Volume of a truncated cone. */
function frustumVolume(h: number, r1: number, r2: number): number {
  return (Math.PI * h * (r1 * r1 + r1 * r2 + r2 * r2)) / 3;
}

/** Slanted side area of a truncated cone. */
function frustumArea(h: number, r1: number, r2: number): number {
  return Math.PI * (r1 + r2) * Math.hypot(h, r1 - r2);
}

/** Barrowman normal-force slope of a set of fins, relative to the reference diameter. */
function finLift(
  count: number,
  span: number,
  rootChord: number,
  tipChord: number,
  bodyRadius: number,
  referenceDiameter: number,
): number {
  if (span <= 0 || rootChord <= 0) return 0;
  const effective = count <= 4 ? count : 4 + (count - 4) * 0.6;
  const midChord = Math.hypot(span, (rootChord - tipChord) / 2);
  const interference = 1 + bodyRadius / (span + bodyRadius);
  return (
    (interference * 4 * effective * (span / referenceDiameter) ** 2) /
    (1 + Math.sqrt(1 + ((2 * midChord) / (rootChord + tipChord)) ** 2))
  );
}

/** Returns which segment a decoration rides on. */
function decorOwner(config: RocketConfig, attach: DecorAttach): string {
  if (attach === "top" || attach === "payload") return UPPER_OWNER;
  const index = stageIndexAt(config, decorAnchor(config, attach));
  return index === null ? UPPER_OWNER : `stage:${config.stages[index].id}`;
}

/** Builds the physical model of a rocket: masses, tanks, engines, lift and drag. */
export function buildVehicle(config: RocketConfig): VehicleModel {
  const sections = stackSections(config);
  const items: MassItem[] = [];
  const lift: LiftItem[] = [];
  const drag: DragItem[] = [];
  const referenceDiameter =
    2 * Math.max(1, ...config.stages.map((s) => s.radius));
  const referenceArea = Math.PI * (referenceDiameter / 2) ** 2;
  const transition = (owner: string, fore: number, aft: number, y: number) => {
    const cna =
      2 * ((2 * aft) / referenceDiameter) ** 2 -
      2 * ((2 * fore) / referenceDiameter) ** 2;
    if (Math.abs(cna) > 1e-4) lift.push({ owner, cna, y });
  };

  const stages: PropulsionGroup[] = sections.map((section) => {
    const { stage, index } = section;
    const key = `stage:${stage.id}`;
    const spec = PROPELLANTS[stage.propellant];
    const volume = frustumVolume(stage.height, section.rBottom, section.rTop);
    const perf = enginePerformance(stage.engine, stage.propellant);
    items.push({
      owner: key,
      mass: volume * spec.tankDensity + perf.mass * stage.engine.count,
      y: section.base + stage.height * 0.4,
    });
    transition(
      key,
      section.rTop,
      section.rBottom,
      section.base + stage.height / 2,
    );
    const next = sections[index + 1];
    if (next) {
      const h = next.base - section.top;
      items.push({
        owner: key,
        mass: frustumArea(h, section.rTop, next.rBottom) * 45,
        y: section.top + h / 2,
      });
      transition(key, next.rBottom, section.rTop, section.top + h / 2);
    }
    return {
      key,
      id: stage.id,
      kind: "stage",
      index,
      label: `S${index + 1}`,
      propellant: stage.propellant,
      propellantMass: volume * 0.9 * spec.density,
      reserve: 0,
      engines: stage.engine.count,
      perf,
      gimbal: stage.engine.gimbal,
      throttleable: spec.throttleable,
      y: section.base + stage.height / 2,
      engineY: section.base - stage.engine.size * 1.7,
      power: stage.engine.power,
      style: stage.engine.style,
    };
  });

  const boosters: PropulsionGroup[] = config.boosters.map((booster, index) => {
    const key = `booster:${booster.id}`;
    const spec = PROPELLANTS[booster.propellant];
    const volume = Math.PI * booster.radius ** 2 * booster.height;
    const perf = enginePerformance(booster.engine, booster.propellant);
    const noseLength = booster.radius * (booster.top === "blunt" ? 1 : 2.6);
    items.push({
      owner: key,
      mass: volume * spec.tankDensity + perf.mass * booster.engine.count + 350,
      y: booster.height * 0.45,
    });
    lift.push({
      owner: key,
      cna: 2 * ((2 * booster.radius) / referenceDiameter) ** 2,
      y: booster.height + noseLength * 0.5,
    });
    drag.push({
      owner: key,
      cda:
        { cone: 0.35, ogive: 0.3, blunt: 0.6 }[booster.top] *
        Math.PI *
        booster.radius ** 2,
    });
    return {
      key,
      id: booster.id,
      kind: "booster",
      index,
      label: `B${index + 1}`,
      propellant: booster.propellant,
      propellantMass: volume * 0.9 * spec.density,
      reserve: 0,
      engines: booster.engine.count,
      perf,
      gimbal: booster.engine.gimbal,
      throttleable: spec.throttleable,
      y: booster.height / 2,
      engineY: -booster.engine.size * 1.7,
      power: booster.engine.power,
      style: booster.engine.style,
    };
  });

  const { payload } = config;
  const top = sections[sections.length - 1];
  const baseY = top?.top ?? 0;
  const pHeight = payloadHeight(config);
  const rBase = upperRadius(config);
  const rTop = payloadTopRadius(config);
  const hasFairing = payload.kind === "fairing";
  const shellOwner = hasFairing ? FAIRING_OWNER : UPPER_OWNER;
  const payloadMass =
    frustumVolume(pHeight, rBase, rTop) * PAYLOAD_DENSITY[payload.kind] +
    payload.crew * 150;
  items.push({ owner: UPPER_OWNER, mass: payloadMass, y: baseY + pHeight / 2 });
  if (hasFairing)
    items.push({
      owner: FAIRING_OWNER,
      mass: frustumArea(pHeight, rBase, rTop) * 12,
      y: baseY + pHeight / 2,
    });
  if (payload.heatShield)
    items.push({ owner: UPPER_OWNER, mass: payloadMass * 0.1, y: baseY });
  if (payload.parachutes)
    items.push({
      owner: UPPER_OWNER,
      mass: payloadMass * 0.04,
      y: baseY + pHeight,
    });
  transition(shellOwner, rTop, rBase, baseY + pHeight / 2);

  const noseLength = topHeight(payload.top, rBase);
  const noseBase = baseY + pHeight;
  if (payload.top !== "none") {
    items.push({
      owner: shellOwner,
      mass:
        frustumArea(noseLength, rTop, 0) *
        (payload.top === "dome" ? 54 : hasFairing ? 12 : 18),
      y: noseBase + noseLength / 3,
    });
  }
  lift.push({
    owner: shellOwner,
    cna: 2 * ((2 * rTop) / referenceDiameter) ** 2,
    y: noseBase + noseLength * (1 - NOSE_CENTER_OF_PRESSURE[payload.top]),
  });
  drag.push({
    owner: UPPER_OWNER,
    cda:
      (DRAG_COEFFICIENT[payload.top] +
        (payload.kind === "capsule" ? 0.04 : 0)) *
      referenceArea,
  });

  if (config.fins && sections[0]) {
    const fins = config.fins;
    const { span, rootChord } = finGeometry(config);
    const tipChord = rootChord * FIN_TIP_RATIO[fins.shape];
    const key = stages[0].key;
    lift.push({
      owner: key,
      cna:
        finLift(
          fins.count,
          span,
          rootChord,
          tipChord,
          sections[0].rBottom,
          referenceDiameter,
        ) * (fins.shape === "grid" ? 1.2 : fins.shape === "tiny" ? 0.5 : 1),
      y: rootChord * 0.5,
    });
    items.push({
      owner: key,
      mass:
        fins.count *
        span *
        ((rootChord + tipChord) / 2) *
        (fins.shape === "grid" ? 70 : 35),
      y: rootChord * 0.5,
    });
    drag.push({
      owner: key,
      cda: fins.count * span * (fins.shape === "grid" ? 0.2 : 0.05),
    });
  }

  if (config.legs && stages[0]) {
    const legs = config.legs;
    items.push({
      owner: stages[0].key,
      mass: legs.count * 600 * legs.size ** 2,
      y: 1,
    });
    drag.push({ owner: stages[0].key, cda: legs.count * 0.3 * legs.size });
    stages[0].reserve = stages[0].propellantMass * 0.08;
  }

  let propellerThrust = 0;
  config.decorativeParts.forEach((decor) => {
    const owner = decorOwner(config, decor.attach);
    const y = decorAnchor(config, decor.attach);
    const scale = decor.size ** 3 * decor.count;
    items.push({ owner, mass: DECOR_MASS[decor.kind] * scale, y });
    drag.push({
      owner,
      cda: DECOR_DRAG[decor.kind] * decor.size ** 2 * decor.count,
    });
    if (decor.kind === "tank") {
      const group =
        stages.find((s) => s.key === owner) ?? stages[stages.length - 1];
      const volume = Math.PI * (0.7 * decor.size) ** 2 * 6 * decor.size;
      group.propellantMass +=
        volume * decor.count * 0.9 * PROPELLANTS[group.propellant].density;
    }
    if (decor.kind === "wings") {
      const bodyRadius = Math.max(1, sections[0]?.rBottom ?? 1);
      lift.push({
        owner,
        cna: finLift(
          2,
          6 * decor.size,
          7 * decor.size,
          2 * decor.size,
          bodyRadius,
          referenceDiameter,
        ),
        y: y + 0.5 * decor.size,
      });
    }
    if (decor.kind === "propeller") propellerThrust += 4000 * scale;
  });

  const height = totalHeight(config);
  return {
    stages,
    boosters,
    items,
    lift,
    drag,
    referenceDiameter,
    referenceArea,
    height,
    slenderness: height / referenceDiameter,
    payloadMass,
    crew: payload.crew,
    hasFairing,
    propellerThrust,
  };
}

/** Every propulsion group of a vehicle, stages first. */
export function allGroups(vehicle: VehicleModel): PropulsionGroup[] {
  return [...vehicle.stages, ...vehicle.boosters];
}

/** Returns the segment keys of a whole, unstaged vehicle. */
export function allOwners(vehicle: VehicleModel): Set<string> {
  return new Set([
    ...vehicle.items.map((i) => i.owner),
    ...allGroups(vehicle).map((g) => g.key),
  ]);
}

/** Sums the mass still attached, given the propellant left in each group. */
export function attachedMass(
  vehicle: VehicleModel,
  attached: Set<string>,
  propellant: Map<string, number>,
): number {
  let mass = 0;
  for (const item of vehicle.items)
    if (attached.has(item.owner)) mass += item.mass;
  for (const group of allGroups(vehicle))
    if (attached.has(group.key)) mass += propellant.get(group.key) ?? 0;
  return mass;
}

/** Returns the height of the centre of mass. */
export function centerOfMass(
  vehicle: VehicleModel,
  attached: Set<string>,
  propellant: Map<string, number>,
): number {
  let mass = 0;
  let moment = 0;
  for (const item of vehicle.items) {
    if (!attached.has(item.owner)) continue;
    mass += item.mass;
    moment += item.mass * item.y;
  }
  for (const group of allGroups(vehicle)) {
    if (!attached.has(group.key)) continue;
    const m = propellant.get(group.key) ?? 0;
    mass += m;
    moment += m * group.y;
  }
  return moment / Math.max(1, mass);
}

/** Returns the total normal-force slope and the height of the centre of pressure. */
export function centerOfPressure(
  vehicle: VehicleModel,
  attached: Set<string>,
): { cna: number; y: number } {
  let cna = 0;
  let moment = 0;
  for (const item of vehicle.lift) {
    if (!attached.has(item.owner)) continue;
    cna += item.cna;
    moment += item.cna * item.y;
  }
  return { cna: Math.max(0.1, cna), y: cna > 0.1 ? moment / cna : 0 };
}

/** Sums the drag area still attached. */
export function dragArea(vehicle: VehicleModel, attached: Set<string>): number {
  return vehicle.drag
    .filter((d) => attached.has(d.owner))
    .reduce((sum, d) => sum + d.cda, 0);
}

/** Full-tank propellant for every group. */
export function fullTanks(vehicle: VehicleModel): Map<string, number> {
  return new Map(allGroups(vehicle).map((g) => [g.key, g.propellantMass]));
}

/** Static margin in calibers: positive when the centre of pressure sits below the centre of mass. */
export function staticMargin(
  vehicle: VehicleModel,
  attached: Set<string>,
  propellant: Map<string, number>,
): number {
  const cm = centerOfMass(vehicle, attached, propellant);
  const cp = centerOfPressure(vehicle, attached);
  return (cm - cp.y) / vehicle.referenceDiameter;
}

/** Transonic drag rise: drag peaks just above Mach 1. */
export function machDragFactor(mach: number): number {
  return 1 + 0.9 * Math.exp(-(((mach - 1.2) / 0.45) ** 2));
}

/** Air density and pressure ratio at an altitude. */
export function atmosphere(altitude: number): {
  density: number;
  pressure: number;
} {
  const pressure = Math.exp(-Math.max(0, altitude) / SCALE_HEIGHT);
  return { density: SEA_LEVEL_DENSITY * pressure, pressure };
}

/**
 * Analytic staging breakdown with the rocket equation. First-stage burns use a
 * blended Isp to stand in for the climb out of the atmosphere.
 */
export function burnPhases(vehicle: VehicleModel): BurnPhase[] {
  const phases: BurnPhase[] = [];
  const attached = allOwners(vehicle);
  const propellant = fullTanks(vehicle);
  vehicle.stages.forEach((s) =>
    propellant.set(s.key, s.propellantMass - s.reserve),
  );
  for (let i = 0; i < vehicle.stages.length; i++) {
    const stage = vehicle.stages[i];
    let first = true;
    while (true) {
      const burning = [stage, ...vehicle.boosters].filter(
        (g) => attached.has(g.key) && (propellant.get(g.key) ?? 0) > 0,
      );
      if (!burning.length) break;
      const pressure = i === 0 ? 0.35 : 0;
      const thrust = burning.reduce(
        (sum, g) => sum + thrustAt(g.perf, pressure) * g.engines,
        0,
      );
      const flow = burning.reduce(
        (sum, g) => sum + massFlow(g.perf) * g.engines,
        0,
      );
      const burnTime = Math.min(
        ...burning.map(
          (g) => (propellant.get(g.key) ?? 0) / (massFlow(g.perf) * g.engines),
        ),
      );
      const m0 = attachedMass(vehicle, attached, propellant);
      const m1 = m0 - flow * burnTime;
      const ignitionThrust = burning.reduce(
        (sum, g) =>
          sum + thrustAt(g.perf, i === 0 && first ? 1 : 0) * g.engines,
        0,
      );
      const boosted = burning.some((g) => g.kind === "booster");
      phases.push({
        label: boosted ? `${stage.label} + BOOSTERS` : stage.label,
        deltaV: (thrust / flow) * Math.log(m0 / Math.max(1, m1)),
        twr: ignitionThrust / (m0 * G0),
        burnTime,
        propellant: [
          ...new Set(burning.map((g) => PROPELLANTS[g.propellant].label)),
        ].join("+"),
      });
      first = false;
      burning.forEach((g) => {
        const left =
          (propellant.get(g.key) ?? 0) -
          massFlow(g.perf) * g.engines * burnTime;
        propellant.set(g.key, left < 1e-3 ? 0 : left);
      });
      if (vehicle.boosters.every((b) => (propellant.get(b.key) ?? 0) === 0))
        vehicle.boosters.forEach((b) => attached.delete(b.key));
    }
    vehicle.boosters.forEach((b) => attached.delete(b.key));
    attached.delete(stage.key);
  }
  return phases;
}

/** Hardware risks for one flight. `lossShare` is how often the failure ends the mission. */
export function failureRisks(
  config: RocketConfig,
  vehicle: VehicleModel,
): FailureRisk[] {
  const risks: FailureRisk[] = [];
  for (const group of allGroups(vehicle)) {
    const stress = 1 + Math.max(0, group.power - 6) ** 2 * 0.35;
    const perEngine =
      0.002 *
      stress *
      NOZZLES[group.style].risk *
      PROPELLANTS[group.propellant].risk;
    risks.push({
      key: group.key,
      kind: "engine",
      p: 1 - (1 - perEngine) ** group.engines,
      lossShare: group.kind === "booster" ? 0.5 : group.engines >= 2 ? 0.3 : 1,
    });
  }
  vehicle.stages.slice(1).forEach((stage) =>
    risks.push({
      key: stage.key,
      kind: "separation",
      p: 0.004,
      lossShare: 1,
    }),
  );
  const silly = config.decorativeParts.filter((d) =>
    ["googlyEyes", "duck", "propeller", "spikes"].includes(d.kind),
  ).length;
  risks.push({
    key: UPPER_OWNER,
    kind: "payload",
    p: 0.003 + silly * 0.008 + (config.payload.top === "none" ? 0.01 : 0),
    lossShare: 1,
  });
  const decor = config.decorativeParts.reduce((sum, d) => sum + d.count, 0);
  if (decor)
    risks.push({
      key: "decor",
      kind: "structure",
      p: decor * 0.0015,
      lossShare: 1,
    });
  return risks;
}

/** Probability, in percent, that no hardware failure ends the mission. */
export function hardwareReliability(risks: FailureRisk[]): number {
  return (
    100 * risks.reduce((product, r) => product * (1 - r.p * r.lossShare), 1)
  );
}
