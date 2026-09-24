"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { get2DContext } from "@/lib/canvas";
import {
  FAIRING_SEGMENT,
  type Nozzle,
  type PlacedPart,
  type RocketLayout,
  UPPER_SEGMENT,
} from "@/lib/rocket/layout";
import type { RocketConfig } from "@/lib/rocket/types";
import {
  type FlightPoint,
  type LaunchEvent,
  type LaunchPlan,
  telemetryAt,
} from "@/lib/sim/playback";
import { PartMesh, type RenderFlags, RenderFlagsProvider } from "./PartMesh";
import { ParticleField } from "./particles";

/** Seconds of countdown before ignition. */
export const COUNTDOWN_SECONDS = 3.6;
const PAD_TOP = 3;
const GRAVITY = 9.81;
const PLANET_RADIUS = 600_000;
const PLANET_CENTER = new THREE.Vector3(0, -PLANET_RADIUS, 0);
const NORTH = new THREE.Vector3(0, 0, 1);
const LOCAL_GROUND_CEILING = 8_000;
const SMOKE_CEILING = 30_000;
const AIR_SCALE_HEIGHT = 5_600;
const CAMERA_CLEARANCE = 2;
const PITCH_LIMIT = 1.4;
const MAX_CAMERA_DISTANCE = 60_000;

/** Cue names the launch scene reports to the UI. */
export type LaunchCue =
  | "count:3"
  | "count:2"
  | "count:1"
  | "ignition"
  | LaunchEvent["type"]
  | "done";

/** Live numbers the HUD reads every frame. */
export interface Telemetry {
  altitude: number;
  speed: number;
  t: number;
}

/** Props for the launch sequence. */
export interface LaunchSceneProps {
  rocket: RocketConfig;
  layout: RocketLayout;
  plan: LaunchPlan;
  quality: "high" | "low";
  telemetry: { current: Telemetry };
  onCue: (cue: LaunchCue) => void;
  onComplete: () => void;
}

interface SegmentData {
  key: string;
  parts: PlacedPart[];
  nozzles: Nozzle[];
  centroid: THREE.Vector3;
}

interface DebrisSpec {
  id: number;
  segment: SegmentData;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  burning: number;
}

/** Groups parts by the segment they separate with and finds each segment's centre. */
function buildSegments(layout: RocketLayout): SegmentData[] {
  return layout.segments.map((key) => {
    const parts = layout.parts.filter((p) => p.segment === key);
    const nozzles = layout.nozzles.filter((n) => n.segment === key);
    const centroid = new THREE.Vector3();
    parts.forEach((p) =>
      centroid.add(
        new THREE.Vector3(
          p.position[0],
          p.position[1] + p.dims.h / 2,
          p.position[2],
        ),
      ),
    );
    centroid.divideScalar(Math.max(1, parts.length));
    return { key, parts, nozzles, centroid };
  });
}

/** The unit vector pointing up from the planet's centre through a point. */
function localUp(
  point: THREE.Vector3,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  return out.copy(point).sub(PLANET_CENTER).normalize();
}

/** Height of a point above the planet's surface, in metres. */
function altitudeOf(point: THREE.Vector3): number {
  return point.distanceTo(PLANET_CENTER) - PLANET_RADIUS;
}

/** Share of sea-level air density left at an altitude. */
function airAt(altitude: number): number {
  return Math.exp(-Math.max(0, altitude) / AIR_SCALE_HEIGHT);
}

/**
 * Places the vehicle on the curved, true-scale planet: writes the position of
 * its origin and its on-screen velocity (flight velocity times the time
 * warp), and returns its world pitch angle. `base` is the height of the
 * vehicle's origin above the ground on the pad.
 */
function placeOnPlanet(
  point: FlightPoint,
  base: number,
  position: THREE.Vector3,
  velocity: THREE.Vector3,
): number {
  const theta = point.downrange / PLANET_RADIUS;
  const radius = PLANET_RADIUS + base + point.altitude;
  const up = new THREE.Vector3(Math.sin(theta), Math.cos(theta), 0);
  const east = new THREE.Vector3(Math.cos(theta), -Math.sin(theta), 0);
  position.copy(PLANET_CENTER).addScaledVector(up, radius);
  velocity
    .copy(up)
    .multiplyScalar(point.climb)
    .addScaledVector(east, (point.ground * radius) / PLANET_RADIUS)
    .multiplyScalar(point.warp);
  return THREE.MathUtils.degToRad(point.pitch) + theta;
}

/** Surface colours for the body shown on arrival. */
const CELESTIAL = {
  moon: { color: "#d9d6cf", emissive: "#3a3833" },
  mars: { color: "#c4552b", emissive: "#3a1206" },
  sun: { color: "#ffd27a", emissive: "#ff9a2a" },
} as const;

/** Deterministic noise used for flame flicker. */
function wiggle(t: number, seed: number): number {
  return (
    Math.sin(t * 37.1 + seed) * 0.5 +
    Math.sin(t * 91.7 + seed * 2.3) * 0.3 +
    Math.sin(t * 13.3 + seed * 0.7) * 0.2
  );
}

/** Low-frequency noise for camera shake, slow enough never to strobe. */
function rumble(t: number, seed: number): number {
  return Math.sin(t * 11.3 + seed) * 0.6 + Math.sin(t * 6.7 + seed * 1.9) * 0.4;
}

/** The launch pad sequence: countdown, ignition, flight, separations and whatever the dice decided. */
export function LaunchScene({
  rocket,
  layout,
  plan,
  quality,
  telemetry,
  onCue,
  onComplete,
}: LaunchSceneProps) {
  const { camera, scene, gl } = useThree();
  const segments = useMemo(() => buildSegments(layout), [layout]);
  const vehicle = useRef<THREE.Group>(null);
  const segmentRefs = useRef<Record<string, THREE.Group | null>>({});
  const flags = useRef<RenderFlags>({ engineGlow: 0, time: 0 });
  const firing = useRef<Set<string>>(new Set());
  const [debris, setDebris] = useState<DebrisSpec[]>([]);
  const flash = useRef<THREE.PointLight>(null);
  const engineLight = useRef<THREE.PointLight>(null);
  const sky = useRef<THREE.ShaderMaterial>(null);
  const stars = useRef<THREE.PointsMaterial>(null);
  const celestial = useRef<THREE.Group>(null);
  const localGround = useRef<THREE.Group>(null);
  const low = quality === "low";

  const fields = useMemo(() => {
    const fire = new ParticleField(
      low ? 600 : 1400,
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshBasicMaterial({
        color: "#ffffff",
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    const smoke = new ParticleField(
      low ? 500 : 1100,
      new THREE.IcosahedronGeometry(1, 1),
      new THREE.MeshStandardMaterial({
        color: "#ffffff",
        roughness: 1,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      }),
    );
    return { fire, smoke };
  }, [low]);
  useEffect(
    () => () => {
      fields.fire.dispose();
      fields.smoke.dispose();
    },
    [fields],
  );

  const tilt = THREE.MathUtils.degToRad(rocket.tilt);
  const glow = useMemo(
    () => new THREE.Color(rocket.appearance.glow),
    [rocket.appearance.glow],
  );
  const stageOrder = useMemo(
    () => rocket.stages.map((s) => `stage:${s.id}`),
    [rocket.stages],
  );
  const scale = Math.max(1, layout.height / 60);

  const sim = useRef({
    clock: 0,
    pos: new THREE.Vector3(0, PAD_TOP - layout.minY, 0),
    vel: new THREE.Vector3(),
    base: PAD_TOP - layout.minY,
    angle: tilt,
    angVel: 0,
    roll: 0,
    rollVel: 0,
    warp: 1,
    thrusting: false,
    throttle: 0,
    pauseUntil: 0,
    alive: true,
    lifted: false,
    tipping: false,
    shake: 0,
    eventIndex: 0,
    attached: new Set(layout.segments),
    placed: false,
    lookAt: new THREE.Vector3(0, layout.height / 2, 0),
    countdownCue: 0,
    finished: false,
    arrived: false,
    debrisId: 0,
  });

  const view = useRef({
    yaw: 0.5,
    pitch: -0.15,
    distance: 100,
    target: 100,
    fov: 38,
    dragging: false,
    lastX: 0,
    lastY: 0,
  });

  useEffect(() => {
    const v = view.current;
    const distance = Math.max(70, layout.height * 1.6) * 1.16;
    const focusHeight = PAD_TOP + layout.height * 0.45;
    v.distance = v.target = distance;
    v.pitch = Math.asin(
      THREE.MathUtils.clamp((8 - focusHeight) / distance, -0.9, 0.9),
    );
    const cam = camera as THREE.PerspectiveCamera;
    cam.far = 4_000_000;
    cam.updateProjectionMatrix();
    const fog = new THREE.Fog("#e7a57a", 300, 2400);
    scene.fog = fog;
    return () => {
      if (scene.fog === fog) scene.fog = null;
      cam.up.set(0, 1, 0);
      cam.near = 0.5;
      cam.far = 6000;
      cam.updateProjectionMatrix();
    };
  }, [camera, scene, layout.height]);

  useEffect(() => {
    const el = gl.domElement;
    const v = view.current;
    const nearest = layout.height * 0.6 + 10;
    const down = (e: PointerEvent) => {
      v.dragging = true;
      v.lastX = e.clientX;
      v.lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!v.dragging) return;
      v.yaw -= (e.clientX - v.lastX) * 0.005;
      v.pitch = THREE.MathUtils.clamp(
        v.pitch + (e.clientY - v.lastY) * 0.005,
        -PITCH_LIMIT,
        PITCH_LIMIT,
      );
      v.lastX = e.clientX;
      v.lastY = e.clientY;
    };
    const up = (e: PointerEvent) => {
      v.dragging = false;
      if (el.hasPointerCapture(e.pointerId))
        el.releasePointerCapture(e.pointerId);
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      v.target = THREE.MathUtils.clamp(
        v.target * Math.exp(e.deltaY * 0.0012),
        nearest,
        MAX_CAMERA_DISTANCE,
      );
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("wheel", wheel);
    };
  }, [gl, layout.height]);

  /** Returns the vehicle's thrust direction. */
  const direction = (angle: number) =>
    new THREE.Vector3(Math.sin(angle), Math.cos(angle), 0);

  /** Updates which segments are burning: the lowest attached stage plus attached boosters. */
  const refreshFiring = () => {
    const s = sim.current;
    const next = new Set<string>();
    if (s.alive) {
      const lowest = stageOrder.find((k) => s.attached.has(k));
      if (lowest) next.add(lowest);
      s.attached.forEach((k) => {
        if (k.startsWith("booster:")) next.add(k);
      });
    }
    firing.current = next;
  };

  /** Detaches a segment from the vehicle and turns it into free-falling debris. */
  const detach = (
    key: string,
    velocity: THREE.Vector3,
    spin: THREE.Vector3,
    burning = 0,
  ) => {
    const s = sim.current;
    const group = segmentRefs.current[key];
    const segment = segments.find((seg) => seg.key === key);
    if (!group || !segment || !s.attached.has(key) || !vehicle.current) return;
    s.attached.delete(key);
    group.visible = false;
    vehicle.current.updateMatrixWorld(true);
    const position = segment.centroid
      .clone()
      .applyMatrix4(vehicle.current.matrixWorld);
    const quaternion = vehicle.current.getWorldQuaternion(
      new THREE.Quaternion(),
    );
    const id = ++s.debrisId;
    setDebris((list) => [
      ...list,
      { id, segment, position, quaternion, velocity, spin, burning },
    ]);
    refreshFiring();
  };

  /** Blows everything up with a fireball and flying parts. */
  const explode = () => {
    const s = sim.current;
    if (!s.alive || !vehicle.current) return;
    const center = s.pos
      .clone()
      .add(direction(s.angle).multiplyScalar(layout.height * 0.4));
    burst(center, 1);
    [...s.attached].forEach((key) => {
      const seg = segments.find((x) => x.key === key);
      if (!seg) return;
      const out = seg.centroid
        .clone()
        .setY(0)
        .normalize()
        .multiplyScalar(18 + Math.random() * 24);
      const velocity = s.vel
        .clone()
        .multiplyScalar(0.4)
        .add(out)
        .add(
          new THREE.Vector3(
            (Math.random() - 0.5) * 30,
            12 + Math.random() * 25,
            (Math.random() - 0.5) * 30,
          ),
        );
      const spin = new THREE.Vector3(
        (Math.random() - 0.5) * 6,
        (Math.random() - 0.5) * 6,
        (Math.random() - 0.5) * 6,
      );
      detach(key, velocity, spin, 0);
    });
    s.alive = false;
    s.thrusting = false;
    s.shake = 5;
    view.current.target = Math.min(
      MAX_CAMERA_DISTANCE,
      view.current.target * 1.5,
    );
    firing.current = new Set();
    if (flash.current) {
      flash.current.position.copy(center);
      flash.current.intensity = 400000;
    }
  };

  /** Spawns a fireball at a point. */
  const burst = (center: THREE.Vector3, size: number) => {
    const fire = new THREE.Color().copy(glow).multiplyScalar(3);
    const hot = new THREE.Color(4, 3.2, 2.2);
    const black = new THREE.Color(0, 0, 0);
    const v = new THREE.Vector3();
    for (let i = 0; i < (low ? 120 : 260) * size; i++) {
      v.randomDirection().multiplyScalar((20 + Math.random() * 60) * scale);
      fields.fire.spawn({
        position: center,
        velocity: v.clone(),
        life: 0.6 + Math.random() * 1.2,
        size: 2 * scale,
        growth: 9 * scale * size,
        from: i % 3 ? fire : hot,
        to: black,
      });
    }
    const smokeFrom = new THREE.Color("#5b5550");
    const smokeTo = new THREE.Color("#2a2826");
    for (let i = 0; i < (low ? 50 : 110) * size; i++) {
      v.randomDirection().multiplyScalar((6 + Math.random() * 18) * scale);
      v.y = Math.abs(v.y) + 4;
      fields.smoke.spawn({
        position: center,
        velocity: v.clone(),
        life: 4 + Math.random() * 4,
        size: 3 * scale,
        growth: 16 * scale * size,
        from: smokeFrom,
        to: smokeTo,
      });
    }
  };

  /** Applies one timeline event. */
  const handleEvent = (event: LaunchEvent) => {
    const s = sim.current;
    const dir = direction(s.angle);
    onCue(event.type);
    switch (event.type) {
      case "liftoff":
        s.lifted = true;
        s.shake = 1.4;
        break;
      case "booster_sep":
        [...s.attached]
          .filter((k) => k.startsWith("booster:"))
          .forEach((key) => {
            const seg = segments.find((x) => x.key === key);
            if (!seg) return;
            const out = seg.centroid
              .clone()
              .setY(0)
              .normalize()
              .multiplyScalar(7);
            detach(
              key,
              s.vel.clone().add(out),
              new THREE.Vector3(out.z * 0.05, 0, -out.x * 0.08),
            );
          });
        break;
      case "stage_sep":
        detach(
          `stage:${event.stageId}`,
          s.vel.clone().sub(dir.clone().multiplyScalar(6)),
          new THREE.Vector3(0.2, 0, 0.35),
        );
        s.pauseUntil = s.clock + 0.7;
        s.shake = Math.max(s.shake, 0.8);
        break;
      case "booster_fail": {
        const key = `booster:${event.boosterId}`;
        const seg = segments.find((x) => x.key === key);
        if (!seg) break;
        const out = seg.centroid.clone().setY(0).normalize().multiplyScalar(22);
        detach(
          key,
          s.vel
            .clone()
            .add(out)
            .add(new THREE.Vector3(0, 6, 0)),
          new THREE.Vector3(1.2, 2.4, out.x > 0 ? -1.8 : 1.8),
          5,
        );
        s.shake = Math.max(s.shake, 1.2);
        break;
      }
      case "spin":
        s.rollVel = 7;
        break;
      case "wobble":
        s.shake = Math.max(s.shake, 0.8);
        break;
      case "payload_pop":
        detach(
          UPPER_SEGMENT,
          s.vel
            .clone()
            .add(dir.clone().multiplyScalar(30))
            .add(new THREE.Vector3(8, 0, 4)),
          new THREE.Vector3(2.5, 1, 3.2),
        );
        break;
      case "stall":
        s.thrusting = false;
        s.alive = true;
        firing.current = new Set();
        break;
      case "burnout":
        s.thrusting = false;
        firing.current = new Set();
        break;
      case "engine_out":
        s.shake = Math.max(s.shake, 1);
        burst(s.pos.clone().addScaledVector(dir, layout.minY), 0.15);
        break;
      case "fairing_sep":
        detach(
          FAIRING_SEGMENT,
          s.vel.clone().add(new THREE.Vector3(9, 3, 4)),
          new THREE.Vector3(0.8, 0.4, 1.4),
        );
        break;
      case "impact":
        explode();
        break;
      case "maxq":
        break;
      case "explode":
        explode();
        break;
      case "tip_over":
        s.tipping = true;
        s.angVel = rocket.tilt >= 0 ? 0.25 : -0.25;
        break;
      case "arrive":
        s.arrived = true;
        break;
    }
  };

  /**
   * Spawns flame and smoke particles from burning nozzles. Flame rides along
   * with the vehicle; smoke is left behind in the air as a trail, spread over
   * the distance the vehicle covered this frame so fast flight leaves no gaps.
   */
  const emitExhaust = (dt: number, dir: THREE.Vector3, altitude: number) => {
    const s = sim.current;
    if (s.throttle < 0.05 || !vehicle.current) return;
    const nozzles = segments
      .filter((seg) => firing.current.has(seg.key))
      .flatMap((seg) => seg.nozzles);
    if (!nozzles.length) return;
    vehicle.current.updateMatrixWorld(true);
    const matrix = vehicle.current.matrixWorld;
    const back = dir.clone().negate();
    const fireFrom = new THREE.Color().copy(glow).multiplyScalar(2.2);
    const fireTo = new THREE.Color(0.25, 0.04, 0);
    const smokeFrom = new THREE.Color("#d8d2c8");
    const smokeTo = new THREE.Color("#6f6a64");
    const air = altitude < SMOKE_CEILING ? airAt(altitude) : 0;
    const fireBudget = Math.ceil(
      (low ? 14 : 34) * s.throttle * Math.min(2, dt * 60),
    );
    const smokeBudget = Math.ceil(
      (low ? 4 : 9) *
        s.throttle *
        Math.min(2, dt * 60) *
        (s.lifted ? 1 : 1.6) *
        Math.sqrt(air),
    );
    const world = new THREE.Vector3();
    const jitter = new THREE.Vector3();
    for (let i = 0; i < fireBudget; i++) {
      const n = nozzles[Math.floor(Math.random() * nozzles.length)];
      world.set(...n.position).applyMatrix4(matrix);
      jitter.randomDirection().multiplyScalar(n.radius * 0.6);
      fields.fire.spawn({
        position: world.clone().add(jitter),
        velocity: back
          .clone()
          .multiplyScalar((24 + Math.random() * 20) * (0.6 + n.power / 10))
          .add(s.vel)
          .add(jitter.multiplyScalar(6)),
        life: 0.22 + Math.random() * 0.25,
        size: n.radius * 0.9,
        growth: n.radius * 1.8,
        from: fireFrom,
        to: fireTo,
      });
    }
    for (let i = 0; i < smokeBudget; i++) {
      const n = nozzles[Math.floor(Math.random() * nozzles.length)];
      world
        .set(...n.position)
        .applyMatrix4(matrix)
        .addScaledVector(back, n.radius * 4)
        .addScaledVector(s.vel, -dt * Math.random());
      jitter.randomDirection().multiplyScalar(5);
      const nearGround = altitude < 30;
      fields.smoke.spawn({
        position: world.clone(),
        velocity: back
          .clone()
          .multiplyScalar(14 + Math.random() * 10)
          .add(jitter)
          .addScaledVector(s.vel, 0.04),
        life: nearGround ? 5 + Math.random() * 4 : 3 + Math.random() * 3,
        size: n.radius * 1.4,
        growth: n.radius * (nearGround ? 9 : 6) * scale,
        from: smokeFrom,
        to: smokeTo,
      });
    }
  };

  /**
   * A Kerbal Space Program camera: locked onto the vehicle with no lag, at a
   * yaw, pitch and distance the player can drag and scroll, measured in the
   * vehicle's local frame so the horizon stays level as it arcs over the
   * planet.
   */
  const moveCamera = (cam: THREE.PerspectiveCamera, dt: number) => {
    const s = sim.current;
    const v = view.current;
    v.distance = THREE.MathUtils.damp(v.distance, v.target, 5, dt);
    const up = localUp(s.lookAt);
    const east = new THREE.Vector3(up.y, -up.x, 0);
    const offset = east
      .clone()
      .multiplyScalar(Math.sin(v.yaw))
      .addScaledVector(NORTH, Math.cos(v.yaw))
      .multiplyScalar(Math.cos(v.pitch))
      .addScaledVector(up, Math.sin(v.pitch))
      .multiplyScalar(v.distance);
    cam.position.copy(s.lookAt).add(offset);
    const below = CAMERA_CLEARANCE - altitudeOf(cam.position);
    if (below > 0) cam.position.addScaledVector(localUp(cam.position), below);
    const amp = s.shake * 0.004 * v.distance;
    cam.position
      .addScaledVector(up, rumble(s.clock, 17) * amp)
      .addScaledVector(east, rumble(s.clock, 11) * amp);
    cam.up.copy(up);
    cam.lookAt(s.lookAt);
    cam.near = THREE.MathUtils.clamp(v.distance * 0.01, 0.3, 200);
    cam.fov = THREE.MathUtils.damp(cam.fov, v.fov, 2, dt);
    cam.updateProjectionMatrix();
  };

  useFrame((state, rawDelta) => {
    const dt = Math.min(rawDelta, 1 / 15);
    const s = sim.current;
    const v = vehicle.current;
    if (!v) return;
    s.clock += dt;
    const t = s.clock - COUNTDOWN_SECONDS;
    flags.current.time = s.clock;

    if (!s.placed) {
      v.position.copy(s.pos);
      v.rotation.set(0, 0, -s.angle, "ZYX");
      v.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(v);
      s.pos.y += PAD_TOP - box.min.y;
      s.base = s.pos.y;
      s.lookAt.set(0, s.base + layout.height * 0.45, 0);
      s.placed = true;
    }

    const counts: [number, LaunchCue][] = [
      [0.05, "count:3"],
      [1.2, "count:2"],
      [2.4, "count:1"],
      [COUNTDOWN_SECONDS, "ignition"],
    ];
    while (
      s.countdownCue < counts.length &&
      s.clock >= counts[s.countdownCue][0]
    ) {
      const cue = counts[s.countdownCue][1];
      onCue(cue);
      if (cue === "ignition") {
        s.thrusting = true;
        s.shake = 0.5;
        refreshFiring();
      }
      s.countdownCue++;
    }
    while (
      s.eventIndex < plan.events.length &&
      t >= plan.events[s.eventIndex].t
    ) {
      handleEvent(plan.events[s.eventIndex]);
      s.eventIndex++;
    }

    const burning = s.alive && s.thrusting && s.clock >= s.pauseUntil;
    s.throttle = THREE.MathUtils.damp(
      s.throttle,
      burning ? 1 : 0,
      burning ? 4 : 10,
      dt,
    );
    flags.current.engineGlow = s.throttle;

    const point = telemetryAt(plan, t);
    s.warp = point.warp;
    let dir = direction(s.angle);
    if (s.lifted && s.alive) {
      s.angle = placeOnPlanet(point, s.base, s.pos, s.vel);
      s.roll += s.rollVel * dt;
      dir = direction(s.angle);
    } else if (s.tipping && s.alive) {
      s.angVel += Math.sign(s.angVel) * 1.4 * dt;
      s.angle += s.angVel * dt;
      if (Math.abs(s.angle) > Math.PI / 2 - 0.05) {
        s.angle = Math.sign(s.angle) * (Math.PI / 2 - 0.05);
        if (s.tipping) {
          s.tipping = false;
          s.shake = 2;
          s.thrusting = false;
          burst(
            s.pos
              .clone()
              .add(
                new THREE.Vector3(
                  Math.sign(s.angle) * layout.height * 0.4,
                  0,
                  0,
                ),
              ),
            0.3,
          );
        }
      }
    } else if (!s.lifted && s.thrusting) {
      s.shake = Math.max(s.shake, 0.35);
    }

    v.position.copy(s.pos);
    if (!s.lifted && s.thrusting) v.position.x += wiggle(s.clock, 1) * 0.06;
    v.rotation.set(0, s.roll, -s.angle, "ZYX");

    const altitude = point.altitude;
    const air = airAt(altitude);
    emitExhaust(dt, dir, altitude);
    fields.fire.update(dt, 1.6 * air, 2 * air, 0.5);
    fields.smoke.update(dt, 0.45, 1.6 * air, 1.5);

    if (engineLight.current) {
      engineLight.current.position
        .copy(s.pos)
        .addScaledVector(dir, layout.minY - 4);
      engineLight.current.intensity =
        s.throttle * 60000 * scale * (0.85 + wiggle(s.clock, 3) * 0.3);
      engineLight.current.color.copy(glow);
    }
    if (flash.current) flash.current.intensity *= Math.max(0, 1 - dt * 3.5);

    telemetry.current = { altitude, speed: point.speed, t };
    const cam = state.camera as THREE.PerspectiveCamera;
    const cameraAltitude = altitudeOf(cam.position);
    const space = THREE.MathUtils.smoothstep(altitude, 8_000, 60_000);
    if (sky.current) {
      sky.current.uniforms.uSpace.value = space;
      localUp(cam.position, sky.current.uniforms.uUp.value);
    }
    if (stars.current) stars.current.opacity = space;
    if (scene.fog instanceof THREE.Fog) {
      const haze = 1 - THREE.MathUtils.smoothstep(altitude, 20_000, 70_000);
      scene.fog.near = 300 + altitude * 1.5;
      scene.fog.far = (2400 + altitude * 6) / Math.max(1e-3, haze);
    }
    if (localGround.current)
      localGround.current.visible = cameraAltitude < LOCAL_GROUND_CEILING;

    if (s.alive || s.attached.size > 0)
      s.lookAt.copy(s.pos).addScaledVector(dir, layout.height * 0.45);
    moveCamera(cam, dt);

    if (celestial.current && s.arrived) {
      const c = celestial.current;
      const up = localUp(cam.position);
      const east = new THREE.Vector3(up.y, -up.x, 0);
      c.visible = true;
      c.position
        .copy(cam.position)
        .addScaledVector(
          up
            .multiplyScalar(0.55)
            .addScaledVector(east, 0.35)
            .addScaledVector(NORTH, -0.75)
            .normalize(),
          60_000,
        );
      c.scale.setScalar(THREE.MathUtils.damp(c.scale.x, 1, 0.8, dt));
    }

    if (!s.finished && t >= plan.duration) {
      s.finished = true;
      onCue("done");
      onComplete();
    }
    s.shake = Math.max(0, s.shake - dt * (s.shake > 2 ? 1.2 : 0.6));
  });

  const celestialKind =
    plan.outcome === "lunar"
      ? "moon"
      : plan.outcome === "mars"
        ? "mars"
        : plan.outcome === "solar"
          ? "sun"
          : null;

  return (
    <RenderFlagsProvider value={flags}>
      <Sky material={sky} />
      <Starfield material={stars} />
      <hemisphereLight args={["#ffd7b5", "#2a2320", 0.9]} />
      <directionalLight
        position={[-300, 200, 200]}
        intensity={2.2}
        color="#ffc28f"
      />
      <ambientLight intensity={0.25} />
      <pointLight
        ref={engineLight}
        distance={400 * scale}
        decay={2}
        intensity={0}
      />
      <pointLight
        ref={flash}
        distance={900 * scale}
        decay={2}
        intensity={0}
        color="#ffb070"
      />

      <Planet />
      <group ref={localGround}>
        <Ground />
        <Pad height={layout.height} />
      </group>
      <Clouds />

      <group ref={vehicle}>
        {segments.map((seg) => (
          <group
            key={seg.key}
            ref={(el) => void (segmentRefs.current[seg.key] = el)}
          >
            {seg.parts.map((part) => (
              <group
                key={part.key}
                position={part.position}
                rotation={part.rotation}
              >
                <PartMesh part={part} finish={rocket.appearance.finish} />
              </group>
            ))}
            <Flames
              nozzles={seg.nozzles}
              glow={glow}
              active={() =>
                firing.current.has(seg.key) ? sim.current.throttle : 0
              }
            />
          </group>
        ))}
      </group>

      {debris.map((d) => (
        <Debris
          key={d.id}
          spec={d}
          finish={rocket.appearance.finish}
          glow={glow}
          smoke={fields.smoke}
          warp={() => sim.current.warp}
        />
      ))}

      <primitive object={fields.smoke.mesh} />
      <primitive object={fields.fire.mesh} />

      {celestialKind && (
        <group ref={celestial} visible={false} scale={0.4}>
          <mesh>
            <sphereGeometry args={[6000, 64, 32]} />
            <meshStandardMaterial
              color={CELESTIAL[celestialKind].color}
              roughness={1}
              emissive={CELESTIAL[celestialKind].emissive}
              fog={false}
            />
          </mesh>
        </group>
      )}
    </RenderFlagsProvider>
  );
}

/** Flame cones hanging under nozzles; `active` returns a 0..1 throttle each frame. */
function Flames({
  nozzles,
  glow,
  active,
}: {
  nozzles: Nozzle[];
  glow: THREE.Color;
  active: () => number;
}) {
  const group = useRef<THREE.Group>(null);
  const outer = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: glow.clone().multiplyScalar(1.6),
        transparent: true,
        opacity: 0.75,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    [glow],
  );
  const inner = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(3, 2.6, 2),
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );
  const cone = useMemo(() => {
    const g = new THREE.ConeGeometry(1, 1, 20, 1, true);
    g.rotateX(Math.PI);
    g.translate(0, -0.5, 0);
    return g;
  }, []);
  useEffect(
    () => () => {
      outer.dispose();
      inner.dispose();
      cone.dispose();
    },
    [outer, inner, cone],
  );
  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    const throttle = active();
    g.visible = throttle > 0.02;
    g.children.forEach((child, i) => {
      const n = nozzles[Math.floor(i / 2)];
      const isInner = i % 2 === 1;
      const flicker = 1 + wiggle(clock.elapsedTime * 1.3, i) * 0.18;
      const length =
        n.radius *
        (5 + n.power * 0.9) *
        throttle *
        flicker *
        (isInner ? 0.45 : 1);
      child.scale.set(
        n.radius * (isInner ? 0.55 : 0.95),
        Math.max(0.001, length),
        n.radius * (isInner ? 0.55 : 0.95),
      );
    });
  });
  return (
    <group ref={group} visible={false}>
      {nozzles.flatMap((n, i) => [
        <mesh
          key={`o${i}`}
          geometry={cone}
          material={outer}
          position={n.position}
        />,
        <mesh
          key={`i${i}`}
          geometry={cone}
          material={inner}
          position={n.position}
        />,
      ])}
    </group>
  );
}

/**
 * A separated chunk falling (or, if still burning, flying) under simple
 * physics on the true-scale planet. `warp` is the playback's current time
 * warp, which scales its gravity, drag and thrust to match what the vehicle
 * shows on screen.
 */
function Debris({
  spec,
  finish,
  glow,
  smoke,
  warp,
}: {
  spec: DebrisSpec;
  finish: RocketConfig["appearance"]["finish"];
  glow: THREE.Color;
  smoke: ParticleField;
  warp: () => number;
}) {
  const group = useRef<THREE.Group>(null);
  const state = useRef({
    pos: spec.position.clone(),
    vel: spec.velocity.clone(),
    quat: spec.quaternion.clone(),
    age: 0,
  });
  const offset = useMemo(
    () => spec.segment.centroid.clone().negate(),
    [spec.segment.centroid],
  );
  const smokeFrom = useMemo(() => new THREE.Color("#8c857c"), []);
  const smokeTo = useMemo(() => new THREE.Color("#3a3734"), []);
  useFrame((_, rawDelta) => {
    const dt = Math.min(rawDelta, 1 / 30);
    const s = state.current;
    const g = group.current;
    if (!g) return;
    s.age += dt;
    const w = warp();
    const burning = s.age < spec.burning;
    const altitude = altitudeOf(s.pos);
    const nose = new THREE.Vector3(0, 1, 0).applyQuaternion(s.quat);
    const down = localUp(s.pos).negate();
    if (burning) s.vel.addScaledVector(nose, 30 * w * w * dt);
    s.vel.addScaledVector(down, GRAVITY * w * w * dt);
    s.vel.multiplyScalar(1 - Math.min(0.5, 0.3 * airAt(altitude) * w * dt));
    s.pos.addScaledVector(s.vel, dt);
    if (altitude < 2) {
      s.pos.addScaledVector(down, altitude - 2);
      s.vel.multiplyScalar(0.25);
      spec.spin.multiplyScalar(0.6);
    }
    const spin = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(spec.spin.x * dt, spec.spin.y * dt, spec.spin.z * dt),
    );
    s.quat.multiply(spin);
    g.position.copy(s.pos);
    g.quaternion.copy(s.quat);
    if (
      (burning || s.age < 1.5) &&
      altitude < SMOKE_CEILING &&
      Math.random() < 0.5
    ) {
      smoke.spawn({
        position: s.pos.clone(),
        velocity: nose
          .clone()
          .multiplyScalar(-6)
          .add(
            new THREE.Vector3(
              (Math.random() - 0.5) * 4,
              2,
              (Math.random() - 0.5) * 4,
            ),
          ),
        life: 2 + Math.random() * 2,
        size: 1.2,
        growth: 5,
        from: smokeFrom,
        to: smokeTo,
      });
    }
  });
  return (
    <group ref={group} position={spec.position} quaternion={spec.quaternion}>
      <group position={offset}>
        {spec.segment.parts.map((part) => (
          <group
            key={part.key}
            position={part.position}
            rotation={part.rotation}
          >
            <PartMesh part={part} finish={finish} />
          </group>
        ))}
        {spec.burning > 0 && (
          <Flames
            nozzles={spec.segment.nozzles}
            glow={glow}
            active={() => (state.current.age < spec.burning ? 1 : 0)}
          />
        )}
      </group>
    </group>
  );
}

/** Dusk gradient sky, level with the local horizon, that fades to black as the rocket climbs. */
function Sky({
  material,
}: {
  material: React.RefObject<THREE.ShaderMaterial | null>;
}) {
  const uniforms = useMemo(
    () => ({
      uSpace: { value: 0 },
      uUp: { value: new THREE.Vector3(0, 1, 0) },
      uHorizon: { value: new THREE.Color("#ffb27a") },
      uZenith: { value: new THREE.Color("#1d2c5c") },
    }),
    [],
  );
  const group = useRef<THREE.Mesh>(null);
  useFrame(({ camera }) => group.current?.position.copy(camera.position));
  return (
    <mesh ref={group} renderOrder={-1}>
      <sphereGeometry args={[9000, 32, 16]} />
      <shaderMaterial
        ref={material}
        side={THREE.BackSide}
        depthWrite={false}
        fog={false}
        uniforms={uniforms}
        vertexShader={`varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`}
        fragmentShader={`uniform float uSpace; uniform vec3 uUp; uniform vec3 uHorizon; uniform vec3 uZenith; varying vec3 vDir;
          void main(){ float h = clamp(dot(normalize(vDir), uUp), -0.2, 1.0);
            vec3 sky = mix(uHorizon, uZenith, smoothstep(-0.02, 0.55, h));
            sky += vec3(1.0,0.55,0.25) * pow(max(0.0, 1.0 - abs(h) * 6.0), 3.0) * 0.4;
            vec3 space = vec3(0.01,0.012,0.03) + uHorizon * 0.05 * pow(max(0.0, 1.0 - abs(h) * 3.0), 4.0);
            gl_FragColor = vec4(mix(sky, space, uSpace), 1.0); }`}
      />
    </mesh>
  );
}

/** Stars that fade in with altitude. */
function Starfield({
  material,
}: {
  material: React.RefObject<THREE.PointsMaterial | null>;
}) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const points = new Float32Array(2400 * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < 2400; i++) {
      v.randomDirection().multiplyScalar(8000);
      points.set([v.x, Math.abs(v.y) * 0.9 + 200, v.z], i * 3);
    }
    g.setAttribute("position", new THREE.BufferAttribute(points, 3));
    return g;
  }, []);
  const group = useRef<THREE.Points>(null);
  useFrame(({ camera }) => group.current?.position.copy(camera.position));
  return (
    <points ref={group} geometry={geometry}>
      <pointsMaterial
        ref={material}
        size={1.6}
        sizeAttenuation={false}
        color="#ffffff"
        transparent
        opacity={0}
        depthWrite={false}
        fog={false}
      />
    </points>
  );
}

/**
 * The whole planet at true scale, with land and sea painted into its
 * vertices. It sits a little below the detailed pad area, which covers it
 * near the launch site.
 */
function Planet() {
  const geometry = useMemo(() => {
    const g = new THREE.SphereGeometry(PLANET_RADIUS - 1.5, 384, 192);
    const position = g.attributes.position;
    const colors = new Float32Array(position.count * 3);
    const land = new THREE.Color("#3a3a2f");
    const dry = new THREE.Color("#5b5242");
    const sea = new THREE.Color("#274a5e");
    const c = new THREE.Color();
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i) / PLANET_RADIUS;
      const y = position.getY(i) / PLANET_RADIUS;
      const z = position.getZ(i) / PLANET_RADIUS;
      const continents =
        Math.sin(x * 9.1 + z * 4.3) +
        Math.sin(y * 7.7 - x * 5.9) * 0.8 +
        Math.sin(z * 13.3 + y * 3.1) * 0.5;
      const nearPad = y > 0.9999;
      if (!nearPad && continents < -0.25) c.copy(sea);
      else c.copy(land).lerp(dry, 0.5 + 0.5 * Math.sin(x * 41 + z * 37));
      colors.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return g;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} position={PLANET_CENTER}>
      <meshStandardMaterial vertexColors roughness={0.95} />
    </mesh>
  );
}

/**
 * A flat disc bent down to follow the planet's curvature, for laying out
 * ground around the pad. `centerX` is where its centre sits east of the pad.
 */
function curvedDisc(radius: number, centerX: number): THREE.BufferGeometry {
  const g = new THREE.RingGeometry(0, radius, 96, 24);
  const position = g.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i) + centerX;
    const y = position.getY(i);
    position.setZ(i, -(x * x + y * y) / (2 * PLANET_RADIUS));
  }
  g.computeVertexNormals();
  return g;
}

/** Ground around the pad with distant hills and a sea, following the planet's curve. */
function Ground() {
  const hills = useMemo(
    () =>
      Array.from({ length: 26 }, (_, i) => {
        const a = (i / 26) * Math.PI * 2;
        const d = 1400 + (i % 5) * 260;
        return {
          x: Math.cos(a) * d,
          z: Math.sin(a) * d - 400,
          h: 120 + ((i * 53) % 7) * 45,
          r: 300 + ((i * 31) % 5) * 90,
        };
      }),
    [],
  );
  const land = useMemo(() => curvedDisc(8000, 0), []);
  const sea = useMemo(() => curvedDisc(1800, 2400), []);
  useEffect(
    () => () => {
      land.dispose();
      sea.dispose();
    },
    [land, sea],
  );
  return (
    <group>
      <mesh geometry={land} rotation={[-Math.PI / 2, 0, 0]}>
        <meshStandardMaterial color="#3a3a2f" roughness={1} />
      </mesh>
      <mesh
        geometry={sea}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[2400, 0.3, 0]}
      >
        <meshStandardMaterial color="#274a5e" roughness={0.2} metalness={0.3} />
      </mesh>
      {hills.map((h, i) => (
        <mesh key={i} position={[h.x, h.h / 2 - 5, h.z]}>
          <coneGeometry args={[h.r, h.h, 6]} />
          <meshStandardMaterial color="#2c2a26" roughness={1} flatShading />
        </mesh>
      ))}
    </group>
  );
}

/** Concrete pad, flame trench and a service tower. */
function Pad({ height }: { height: number }) {
  const towerHeight = Math.max(40, height * 0.95);
  const light = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (light.current)
      light.current.color.setRGB(
        Math.sin(clock.elapsedTime * 3) > 0 ? 4 : 0.4,
        0.1,
        0.05,
      );
  });
  return (
    <group>
      <mesh position={[0, PAD_TOP / 2, 0]}>
        <cylinderGeometry args={[34, 40, PAD_TOP, 48]} />
        <meshStandardMaterial color="#6d6862" roughness={0.95} />
      </mesh>
      <mesh position={[0, PAD_TOP + 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[18, 18.6, 64]} />
        <meshBasicMaterial color="#e0a100" />
      </mesh>
      <mesh position={[0, PAD_TOP - 0.4, 0]}>
        <boxGeometry args={[12, 1, 70]} />
        <meshStandardMaterial color="#1b1a19" roughness={1} />
      </mesh>
      <group position={[-26, 0, -6]}>
        {[-2.5, 2.5].flatMap((dx) =>
          [-2.5, 2.5].map((dz) => (
            <mesh
              key={`${dx}${dz}`}
              position={[dx, towerHeight / 2 + PAD_TOP, dz]}
            >
              <boxGeometry args={[0.5, towerHeight, 0.5]} />
              <meshStandardMaterial
                color="#8a2a1a"
                metalness={0.6}
                roughness={0.5}
              />
            </mesh>
          )),
        )}
        {Array.from({ length: Math.floor(towerHeight / 7) }, (_, i) => (
          <mesh key={i} position={[0, PAD_TOP + i * 7 + 3.5, 0]}>
            <boxGeometry args={[5.5, 0.3, 5.5]} />
            <meshStandardMaterial
              color="#6b2014"
              metalness={0.6}
              roughness={0.5}
            />
          </mesh>
        ))}
        <mesh position={[0, towerHeight + PAD_TOP + 1, 0]}>
          <sphereGeometry args={[0.6, 12, 8]} />
          <meshBasicMaterial ref={light} color="#ff2200" toneMapped={false} />
        </mesh>
      </group>
      {[
        [-70, -40],
        [80, -50],
        [-50, -90],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x, 6, z]}>
          <cylinderGeometry args={[4, 4, 12, 16]} />
          <meshStandardMaterial
            color="#d8d4cc"
            roughness={0.6}
            metalness={0.4}
          />
        </mesh>
      ))}
    </group>
  );
}

/** Soft billboard clouds a couple of kilometres up, which the rocket climbs through. */
function Clouds() {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const g = get2DContext(canvas);
    for (let i = 0; i < 7; i++) {
      const x = 30 + ((i * 37) % 68);
      const y = 52 + ((i * 23) % 26);
      const r = 26 + ((i * 13) % 18);
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, "rgba(255,255,255,0.55)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
    }
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);
  const clouds = useMemo(
    () =>
      Array.from({ length: 70 }, (_, i) => ({
        x: ((i * 1733) % 22000) - 6000,
        y: 1200 + ((i * 613) % 1800),
        z: ((i * 977) % 9000) - 6000,
        s: 400 + ((i * 290) % 600),
      })),
    [],
  );
  return (
    <group>
      {clouds.map((c, i) => (
        <sprite
          key={i}
          position={[c.x, c.y, c.z]}
          scale={[c.s * 1.8, c.s * 0.7, 1]}
        >
          <spriteMaterial
            map={texture}
            color="#ffe2cc"
            transparent
            opacity={0.8}
            depthWrite={false}
          />
        </sprite>
      ))}
    </group>
  );
}
