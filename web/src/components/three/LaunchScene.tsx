"use client";

import { Environment } from "@react-three/drei";
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
import { fbm, ridged } from "./noise";
import { PartMesh, type RenderFlags, RenderFlagsProvider } from "./PartMesh";
import { billboardGeometry, ParticleField } from "./particles";
import {
  flameMaterial,
  glowMaterial,
  SUN_DIRECTION,
  smokeMaterial,
} from "./vfx";

/** Seconds of countdown before ignition. */
export const COUNTDOWN_SECONDS = 3.6;
const PAD_TOP = 3;
const GRAVITY = 9.81;
const PLANET_RADIUS = 600_000;
const PLANET_CENTER = new THREE.Vector3(0, -PLANET_RADIUS, 0);
const NORTH = new THREE.Vector3(0, 0, 1);
const DOWN = new THREE.Vector3(0, -1, 0);
const LOCAL_GROUND_CEILING = 8_000;
const SMOKE_CEILING = 30_000;
const AIR_SCALE_HEIGHT = 5_600;
const ATMOSPHERE_HEIGHT = 70_000;
const CAMERA_CLEARANCE = 2;
const PITCH_LIMIT = 1.4;
const ORBIT_PITCH = 0.5;
const DEPARTURE_PITCH = 1.25;
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

const SUN_COLOR = new THREE.Color("#ffc896");
const WHITE = new THREE.Color("#ffffff");

/** Lets every lit, opaque mesh under an object cast and receive shadows. */
function castShadows(root: THREE.Object3D) {
  root.traverse((object) => {
    if (
      object instanceof THREE.Mesh &&
      !(object instanceof THREE.InstancedMesh) &&
      object.material instanceof THREE.MeshStandardMaterial &&
      !object.material.transparent
    ) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
}

/** Surface colours for the body shown on arrival. */
const CELESTIAL = {
  moon: { color: "#d9d6cf", emissive: "#3a3833" },
  mars: { color: "#c4552b", emissive: "#3a1206" },
  sun: { color: "#ffd27a", emissive: "#ff9a2a" },
} as const;

/**
 * Moves a camera-centred backdrop (sky, stars) onto the camera just before it
 * draws, after every frame update has moved the camera, so it never lags a
 * fast-moving camera by a frame.
 */
function centerOnCamera(
  this: THREE.Object3D,
  _renderer: THREE.WebGLRenderer,
  _scene: THREE.Scene,
  camera: THREE.Camera,
) {
  this.position.copy(camera.position);
  this.updateMatrixWorld();
}

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
  const sun = useRef<THREE.DirectionalLight>(null);
  const sky = useRef<THREE.ShaderMaterial>(null);
  const stars = useRef<THREE.PointsMaterial>(null);
  const celestial = useRef<THREE.Group>(null);
  const localGround = useRef<THREE.Group>(null);
  const atmosphere = useRef<THREE.ShaderMaterial>(null);
  const low = quality === "low";

  const fields = useMemo(() => {
    const fire = new ParticleField(low ? 600 : 1400, glowMaterial(1.2));
    const smoke = new ParticleField(
      low ? 900 : 2400,
      smokeMaterial({ opacity: 0.8 }),
    );
    const exhaust = new ParticleField(low ? 500 : 1200, glowMaterial(0.9));
    return { fire, smoke, exhaust };
  }, [low]);
  const smokeUniforms = (fields.smoke.mesh.material as THREE.ShaderMaterial)
    .uniforms;
  useEffect(
    () => () => {
      fields.fire.dispose();
      fields.smoke.dispose();
      fields.exhaust.dispose();
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
    air: 1,
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
    touched: false,
    startPitch: -0.15,
    lastX: 0,
    lastY: 0,
  });

  useEffect(() => {
    const v = view.current;
    const distance = Math.max(70, layout.height * 1.6) * 1.16;
    const focusHeight = PAD_TOP + layout.height * 0.45;
    v.distance = v.target = distance;
    v.pitch = v.startPitch = Math.asin(
      THREE.MathUtils.clamp((8 - focusHeight) / distance, -0.9, 0.9),
    );
    const cam = camera as THREE.PerspectiveCamera;
    cam.far = 4_000_000;
    cam.updateProjectionMatrix();
    const fog = new THREE.Fog(HAZE, 500, 7000);
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
      v.touched = true;
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

  /** The vehicle's velocity in flight metres per second, without the time warp. */
  const flightVelocity = () => {
    const s = sim.current;
    return s.vel.clone().divideScalar(Math.max(1, s.warp));
  };

  /** Detaches a segment from the vehicle and turns it into free-falling debris, moving at `velocity` in flight metres per second. */
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
    if (firing.current.has(key)) fields.exhaust.clear();
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
      const velocity = flightVelocity()
        .multiplyScalar(0.9)
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
              flightVelocity().add(out),
              new THREE.Vector3(out.z * 0.05, 0, -out.x * 0.08),
            );
          });
        break;
      case "stage_sep":
        detach(
          `stage:${event.stageId}`,
          flightVelocity().sub(dir.clone().multiplyScalar(6)),
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
          flightVelocity()
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
          flightVelocity()
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
          flightVelocity().add(new THREE.Vector3(9, 3, 4)),
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
   * Spawns flame and smoke particles from burning nozzles. Flame lives in the
   * vehicle's own frame, so it stays on the nozzles however fast the vehicle
   * moves or the time warp changes; smoke is left behind in the air as a
   * trail, spread over the distance the vehicle covered this frame so fast
   * flight leaves no gaps.
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
    const fireFrom = new THREE.Color().copy(glow).multiplyScalar(1.5);
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
    const local = new THREE.Vector3();
    for (let i = 0; i < fireBudget; i++) {
      const n = nozzles[Math.floor(Math.random() * nozzles.length)];
      jitter.randomDirection().multiplyScalar(n.radius * 0.6);
      local.set(...n.position).add(jitter);
      fields.exhaust.spawn({
        position: local,
        velocity: DOWN.clone()
          .multiplyScalar((24 + Math.random() * 20) * (0.6 + n.power / 10))
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
    if (altitude < 120) billowFromTrench(dt, altitude, smokeFrom, smokeTo);
  };

  /**
   * Pushes the ground cloud out of both ends of the flame trench while the
   * plume still hits the pad, thinning out as the vehicle climbs away.
   */
  const billowFromTrench = (
    dt: number,
    altitude: number,
    from: THREE.Color,
    to: THREE.Color,
  ) => {
    const s = sim.current;
    const strength = s.throttle * (1 - altitude / 120);
    if (Math.random() > strength) return;
    const count = Math.ceil((low ? 1 : 2) * Math.min(2, dt * 60));
    const origin = new THREE.Vector3();
    const velocity = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const side = Math.random() < 0.5 ? -1 : 1;
      origin.set((Math.random() - 0.5) * 10, PAD_TOP, side * 34);
      velocity.set(
        (Math.random() - 0.5) * 14,
        2 + Math.random() * 6,
        side * (18 + Math.random() * 24),
      );
      fields.smoke.spawn({
        position: origin,
        velocity,
        life: 6 + Math.random() * 5,
        size: 4 * scale,
        growth: (14 + Math.random() * 12) * scale,
        from,
        to,
      });
    }
  };

  /**
   * Keeps the sun's shadow camera centred on the vehicle, sized to cover it
   * and its long dusk shadow across the pad. Sunlight whitens above the air.
   */
  const followWithSun = (space: number) => {
    const light = sun.current;
    if (!light) return;
    const reach = Math.max(70, layout.height * 1.8);
    const focus = sim.current.lookAt;
    light.target.position.copy(focus);
    light.position.copy(focus).addScaledVector(SUN_DIRECTION, reach * 3);
    light.target.updateMatrixWorld();
    const shadow = light.shadow.camera;
    if (shadow.right !== reach) {
      shadow.left = shadow.bottom = -reach;
      shadow.right = shadow.top = reach;
      shadow.far = reach * 6;
      shadow.updateProjectionMatrix();
    }
    light.color.set(SUN_COLOR).lerp(WHITE, space);
    light.intensity = THREE.MathUtils.lerp(3.2, 4.5, space);
  };

  /**
   * Lights the smoke with the burning engines and fades its sky and ground
   * bounce light away as the vehicle leaves the atmosphere.
   */
  const shadeSmoke = (space: number) => {
    const s = sim.current;
    const u = smokeUniforms;
    if (engineLight.current)
      u.uGlowPosition.value.copy(engineLight.current.position);
    u.uGlowColor.value.copy(glow).multiplyScalar(s.throttle * 2.4);
    u.uGlowRange.value = 50 * scale;
    localUp(s.lookAt, u.uUp.value);
    u.uSkyColor.value.setRGB(0.36, 0.42, 0.56).multiplyScalar(1 - space * 0.85);
    u.uGroundColor.value
      .setRGB(0.22, 0.17, 0.13)
      .multiplyScalar(1 - space * 0.9);
  };

  /**
   * A Kerbal Space Program camera: locked onto the vehicle with no lag, at a
   * yaw, pitch and distance the player can drag and scroll, measured in the
   * vehicle's local frame so the horizon stays level as it arcs over the
   * planet. Until the player drags it, it rises from the low pad view to look
   * down past the vehicle at the planet as the climb goes on, and on a
   * departure looks almost straight down so the shrinking planet stays in view.
   */
  const moveCamera = (cam: THREE.PerspectiveCamera, dt: number) => {
    const s = sim.current;
    const v = view.current;
    v.distance = THREE.MathUtils.damp(v.distance, v.target, 5, dt);
    if (!v.touched) {
      const altitude = altitudeOf(s.lookAt);
      const climb = THREE.MathUtils.smoothstep(altitude, 1_500, 40_000);
      const leave = THREE.MathUtils.smoothstep(altitude, 150_000, 1_500_000);
      const wanted = THREE.MathUtils.lerp(
        THREE.MathUtils.lerp(v.startPitch, ORBIT_PITCH, climb),
        DEPARTURE_PITCH,
        leave,
      );
      v.pitch = THREE.MathUtils.damp(v.pitch, wanted, 1.5, dt);
    }
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
    cam.far = Math.max(
      4_000_000,
      3 * altitudeOf(cam.position) + 2 * PLANET_RADIUS,
    );
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
      castShadows(v);
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

    const point = telemetryAt(plan, t);
    const wanted = s.lifted ? point.throttle : 1;
    const burning =
      s.alive && s.thrusting && s.clock >= s.pauseUntil && wanted > 0.01;
    s.throttle = THREE.MathUtils.damp(
      s.throttle,
      burning ? wanted : 0,
      burning ? 4 : 10,
      dt,
    );
    flags.current.engineGlow = s.throttle;

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
    s.air = air;
    emitExhaust(dt, dir, altitude);
    fields.fire.update(dt, 1.6, 2, 0.5);
    fields.exhaust.update(dt, 0, 0, Number.NEGATIVE_INFINITY);
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
    const space = THREE.MathUtils.smoothstep(altitude, 8_000, 60_000);
    followWithSun(space);
    shadeSmoke(space);
    scene.environmentIntensity = THREE.MathUtils.lerp(1, 0.25, space);

    telemetry.current = { altitude, speed: point.speed, t };
    const cam = state.camera as THREE.PerspectiveCamera;
    const cameraAltitude = altitudeOf(cam.position);
    if (sky.current) {
      sky.current.uniforms.uSpace.value = space;
      localUp(cam.position, sky.current.uniforms.uUp.value);
    }
    if (stars.current) stars.current.opacity = space;
    if (atmosphere.current)
      atmosphere.current.uniforms.uSpace.value = THREE.MathUtils.smoothstep(
        cameraAltitude,
        ATMOSPHERE_HEIGHT * 0.3,
        ATMOSPHERE_HEIGHT,
      );
    if (scene.fog instanceof THREE.Fog) {
      const haze = 1 - THREE.MathUtils.smoothstep(altitude, 20_000, 70_000);
      scene.fog.near = 500 + altitude * 1.5;
      scene.fog.far = (7000 + altitude * 6) / Math.max(1e-3, haze);
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
      <LaunchEnvironment />
      <hemisphereLight args={["#ffd7b5", "#2a2320", 0.35]} />
      <directionalLight
        ref={sun}
        intensity={3.2}
        color={SUN_COLOR}
        castShadow
        shadow-mapSize={low ? [1024, 1024] : [2048, 2048]}
        shadow-bias={-0.0006}
        shadow-normalBias={0.12}
      />
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
      <Atmosphere material={atmosphere} />
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
              air={() => sim.current.air}
            />
          </group>
        ))}
        <primitive object={fields.exhaust.mesh} />
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

/**
 * Flame plumes hanging under nozzles; `active` returns a 0..1 throttle each
 * frame and `air` the share of sea-level air, which keeps the plume tight
 * with shock diamonds low down and lets it bloom wide in vacuum.
 */
function Flames({
  nozzles,
  glow,
  active,
  air = () => 1,
}: {
  nozzles: Nozzle[];
  glow: THREE.Color;
  active: () => number;
  air?: () => number;
}) {
  const group = useRef<THREE.Group>(null);
  const outer = useMemo(
    () =>
      flameMaterial(
        glow.clone().multiplyScalar(1.3),
        new THREE.Color(2.6, 2.2, 1.9),
        0.9,
      ),
    [glow],
  );
  const inner = useMemo(
    () =>
      flameMaterial(
        new THREE.Color(3.2, 2.6, 2),
        new THREE.Color(6, 5.4, 4.8),
        1,
      ),
    [],
  );
  const cone = useMemo(() => {
    const g = new THREE.ConeGeometry(1, 1, 32, 12, true);
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
    const thin = air();
    g.visible = throttle > 0.02;
    outer.uniforms.uTime.value = inner.uniforms.uTime.value = clock.elapsedTime;
    outer.uniforms.uAir.value = inner.uniforms.uAir.value = Math.sqrt(thin);
    const widen = 1 + (1 - thin) * 2.2;
    g.children.forEach((child, i) => {
      const n = nozzles[Math.floor(i / 2)];
      const isInner = i % 2 === 1;
      const flicker = 1 + wiggle(clock.elapsedTime * 1.3, i) * 0.12;
      const length =
        n.radius *
        (5 + n.power * 0.9) *
        throttle *
        flicker *
        (isInner ? 0.45 : 1) *
        (1 + (1 - thin) * 0.6);
      const width = n.radius * (isInner ? 0.55 : 0.95 * widen);
      child.scale.set(width, Math.max(0.001, length), width);
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
 * physics on the true-scale planet. Its velocity is in flight metres per
 * second; `warp` is the playback's current time warp, so it keeps pace with
 * the vehicle however the warp changes.
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
    if (burning) s.vel.addScaledVector(nose, 30 * w * dt);
    s.vel.addScaledVector(down, GRAVITY * w * dt);
    s.vel.multiplyScalar(1 - Math.min(0.5, 0.3 * airAt(altitude) * w * dt));
    s.pos.addScaledVector(s.vel, w * dt);
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

const HAZE = "#d9a58c";

const SKY_VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAGMENT = /* glsl */ `
  uniform float uSpace;
  uniform vec3 uUp;
  uniform vec3 uSun;
  uniform vec3 uHaze;
  uniform vec3 uBelow;
  varying vec3 vDir;
  void main() {
    vec3 dir = normalize(vDir);
    float h = dot(dir, uUp);
    float mu = dot(dir, uSun);
    float above = max(h, 0.0);
    float toward = pow(clamp(mu * 0.5 + 0.5, 0.0, 1.0), 4.0);
    vec3 zenith = mix(vec3(0.05, 0.1, 0.28), vec3(0.09, 0.14, 0.32), toward);
    vec3 horizon = mix(uHaze, vec3(1.5, 0.72, 0.32), toward);
    vec3 sky = mix(horizon, zenith, pow(above, 0.45));
    float forward = max(mu, 0.0);
    sky += vec3(1.0, 0.62, 0.34) * (pow(forward, 10.0) * 0.55 + pow(forward, 300.0) * 3.5);
    sky += vec3(60.0, 46.0, 34.0) * smoothstep(0.99955, 0.99978, mu);
    sky = mix(sky, uBelow, smoothstep(0.0, -0.06, h));
    float limb = pow(max(0.0, 1.0 - abs(h + 0.08) * 7.0), 5.0);
    vec3 space = vec3(0.002, 0.003, 0.007) + vec3(0.2, 0.45, 1.0) * limb * 0.35;
    space += vec3(80.0, 76.0, 70.0) * smoothstep(0.99988, 0.99994, mu);
    space += vec3(1.0, 0.92, 0.8) * pow(forward, 800.0) * 2.0;
    gl_FragColor = vec4(mix(sky, space, uSpace), 1.0);
  }
`;

/**
 * A dusk sky with a low sun: blue overhead, a warm glow and sun disc toward
 * the sun, dusty haze away from it, fading to black with a thin blue limb
 * as `uSpace` rises. `below` is what lies under the horizon.
 */
function skyMaterial(below: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uSpace: { value: 0 },
      uUp: { value: new THREE.Vector3(0, 1, 0) },
      uSun: { value: SUN_DIRECTION.clone() },
      uHaze: { value: new THREE.Color(HAZE) },
      uBelow: { value: new THREE.Color(below) },
    },
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
}

/** The sky, level with the local horizon, that fades to black as the rocket climbs. */
function Sky({
  material,
}: {
  material: React.RefObject<THREE.ShaderMaterial | null>;
}) {
  const sky = useMemo(() => skyMaterial(HAZE), []);
  useEffect(() => () => sky.dispose(), [sky]);
  return (
    <mesh
      renderOrder={-1}
      frustumCulled={false}
      onBeforeRender={centerOnCamera}
      material={sky}
      ref={(mesh) => {
        material.current = mesh ? sky : null;
      }}
    >
      <sphereGeometry args={[9000, 64, 32]} />
    </mesh>
  );
}

/**
 * Image-based lighting for the launch: the same dusk sky over dark ground,
 * rendered once into a cube map so metal and paint reflect the real sky.
 */
function LaunchEnvironment() {
  const sky = useMemo(() => skyMaterial("#1c1712"), []);
  useEffect(() => () => sky.dispose(), [sky]);
  return (
    <Environment resolution={256} frames={1}>
      <mesh material={sky}>
        <sphereGeometry args={[400, 64, 32]} />
      </mesh>
    </Environment>
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
  return (
    <points
      geometry={geometry}
      frustumCulled={false}
      onBeforeRender={centerOnCamera}
    >
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
    const land = new THREE.Color("#4f6b38");
    const dry = new THREE.Color("#7a7a4a");
    const desert = new THREE.Color("#3a3a2f");
    const sea = new THREE.Color("#2a5f8f");
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
      else
        c.copy(land)
          .lerp(dry, 0.5 + 0.5 * Math.sin(x * 41 + z * 37))
          .lerp(desert, THREE.MathUtils.smoothstep(y, 0.998, 0.99995));
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
 * The thin blue glow of the atmosphere along the planet's horizon: each
 * pixel glows by how closely its view ray grazes the surface. `uSpace`
 * fades it in as the camera leaves the air.
 */
function Atmosphere({
  material,
}: {
  material: React.RefObject<THREE.ShaderMaterial | null>;
}) {
  const uniforms = useMemo(
    () => ({
      uSpace: { value: 0 },
      uColor: { value: new THREE.Color("#5fa8ff") },
      uCenter: { value: PLANET_CENTER.clone() },
      uRadius: { value: PLANET_RADIUS },
    }),
    [],
  );
  return (
    <mesh position={PLANET_CENTER} renderOrder={1}>
      <sphereGeometry args={[PLANET_RADIUS + ATMOSPHERE_HEIGHT, 192, 96]} />
      <shaderMaterial
        ref={material}
        side={THREE.BackSide}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        fog={false}
        uniforms={uniforms}
        vertexShader={`varying vec3 vWorld;
          void main(){ vec4 world = modelMatrix * vec4(position,1.0); vWorld = world.xyz;
            gl_Position = projectionMatrix * viewMatrix * world; }`}
        fragmentShader={`uniform float uSpace; uniform vec3 uColor; uniform vec3 uCenter; uniform float uRadius; varying vec3 vWorld;
          void main(){ vec3 ray = normalize(vWorld - cameraPosition); vec3 toCenter = uCenter - cameraPosition;
            float miss = length(toCenter - ray * dot(toCenter, ray)) - uRadius;
            float glow = exp(-max(0.0, miss) / 9000.0);
            gl_FragColor = vec4(uColor * glow * uSpace, 1.0); }`}
      />
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

/** Small deterministic random generator for baked textures and scenery. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
}

/** Wraps a painted canvas as a tiling, mipmapped colour texture. */
function canvasTexture(
  canvas: HTMLCanvasElement,
  repeat: number,
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.anisotropy = 8;
  return texture;
}

/** Scrubland seen from above, tiled `repeat` times: patches of dry grass, dirt and rock with fine speckle. */
function groundTexture(repeat: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const g = get2DContext(canvas);
  const random = seededRandom(11);
  g.fillStyle = "#4a4634";
  g.fillRect(0, 0, 512, 512);
  const patches = ["#5a5638", "#3d3b2b", "#62583f", "#44482f", "#2f2d24"];
  for (let i = 0; i < 260; i++) {
    const x = random() * 512;
    const y = random() * 512;
    const r = 8 + random() * 60;
    g.globalAlpha = 0.16 + random() * 0.2;
    g.fillStyle = patches[i % patches.length];
    for (const [dx, dy] of [
      [0, 0],
      [-512, 0],
      [512, 0],
      [0, -512],
      [0, 512],
    ]) {
      g.beginPath();
      g.ellipse(
        x + dx,
        y + dy,
        r,
        r * (0.5 + random() * 0.5),
        random() * 3,
        0,
        Math.PI * 2,
      );
      g.fill();
    }
  }
  for (let i = 0; i < 9000; i++) {
    g.globalAlpha = 0.1 + random() * 0.25;
    g.fillStyle = random() < 0.5 ? "#23211a" : "#77705a";
    g.fillRect(
      random() * 512,
      random() * 512,
      1 + random() * 2,
      1 + random() * 2,
    );
  }
  g.globalAlpha = 1;
  return canvasTexture(canvas, repeat);
}

/** Poured-concrete pad seen from above: slabs, stains and a burn scar around the flame trench. */
function padTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1024;
  const g = get2DContext(canvas);
  const random = seededRandom(5);
  g.fillStyle = "#8a857d";
  g.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 14000; i++) {
    g.globalAlpha = 0.05 + random() * 0.12;
    g.fillStyle = random() < 0.5 ? "#5e5a54" : "#a8a39a";
    g.fillRect(
      random() * 1024,
      random() * 1024,
      2 + random() * 4,
      2 + random() * 4,
    );
  }
  g.globalAlpha = 0.5;
  g.strokeStyle = "#4b4843";
  g.lineWidth = 2;
  for (let x = 0; x <= 1024; x += 64) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 1024);
    g.moveTo(0, x);
    g.lineTo(1024, x);
    g.stroke();
  }
  for (let i = 0; i < 40; i++) {
    const x = random() * 1024;
    const y = random() * 1024;
    const r = 20 + random() * 80;
    const stain = g.createRadialGradient(x, y, 0, x, y, r);
    stain.addColorStop(0, "rgba(40,36,32,0.35)");
    stain.addColorStop(1, "rgba(40,36,32,0)");
    g.globalAlpha = 1;
    g.fillStyle = stain;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const scorch = g.createRadialGradient(512, 512, 40, 512, 512, 470);
  scorch.addColorStop(0, "rgba(10,9,8,0.95)");
  scorch.addColorStop(0.35, "rgba(22,20,18,0.7)");
  scorch.addColorStop(1, "rgba(22,20,18,0)");
  g.fillStyle = scorch;
  g.fillRect(0, 0, 1024, 1024);
  return canvasTexture(canvas, 1);
}

const FLAT_RADIUS = 900;
const TERRAIN_RADIUS = 9000;
const SEA_CENTER = new THREE.Vector2(2400, 0);
const SEA_RADIUS = 1800;

/**
 * Height of the land around the pad: flat near the pad, rolling foothills,
 * then ridged mountains further out, sinking under the sea to the east.
 */
function terrainHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const rise = THREE.MathUtils.smoothstep(r, FLAT_RADIUS, 2600);
  const hills = fbm(x / 900, z / 900, 5, 21) * 140;
  const range = THREE.MathUtils.smoothstep(r, 2200, 5000);
  const peaks = ridged(x / 2600, z / 2600, 6, 9) ** 1.6 * 1100;
  const shore = THREE.MathUtils.smoothstep(
    Math.hypot(x - SEA_CENTER.x, z - SEA_CENTER.y),
    SEA_RADIUS - 300,
    SEA_RADIUS + 500,
  );
  return rise * (hills + peaks * range) * shore - (1 - shore) * 25;
}

/**
 * A ring of land from the pad's flat apron out to the horizon, displaced by
 * noise and coloured by height and slope (scrub, dirt, rock, pale crests),
 * bent to follow the planet's curvature.
 */
function terrainGeometry(): THREE.BufferGeometry {
  const g = new THREE.RingGeometry(FLAT_RADIUS, TERRAIN_RADIUS, 360, 140);
  const position = g.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const r = Math.hypot(x, y);
    const t = Math.max(0, (r - FLAT_RADIUS) / (TERRAIN_RADIUS - FLAT_RADIUS));
    const eased = FLAT_RADIUS + (TERRAIN_RADIUS - FLAT_RADIUS) * t ** 1.6;
    const scale = r > 0 ? eased / r : 1;
    const wx = x * scale;
    const wy = y * scale;
    position.setXYZ(
      i,
      wx,
      wy,
      terrainHeight(wx, -wy) - (wx * wx + wy * wy) / (2 * PLANET_RADIUS),
    );
  }
  g.computeVertexNormals();
  const normals = g.attributes.normal;
  const colors = new Float32Array(position.count * 3);
  const scrub = new THREE.Color("#5b5a3a");
  const dirt = new THREE.Color("#6e5a40");
  const rock = new THREE.Color("#5a4f45");
  const crest = new THREE.Color("#b3a58f");
  const c = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const h = position.getZ(i) + (x * x + y * y) / (2 * PLANET_RADIUS);
    const steep = 1 - normals.getZ(i);
    const patch = fbm(x / 300, y / 300, 3, 5);
    c.copy(scrub)
      .lerp(dirt, patch)
      .lerp(rock, THREE.MathUtils.smoothstep(steep, 0.08, 0.3))
      .lerp(crest, THREE.MathUtils.smoothstep(h, 600, 1000) * 0.8);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++)
    uv.setXY(i, position.getX(i) / 100, position.getY(i) / 100);
  return g;
}

/** Ground around the pad with mountains and a sea, following the planet's curve. */
function Ground() {
  const land = useMemo(() => curvedDisc(FLAT_RADIUS, 0), []);
  const terrain = useMemo(() => terrainGeometry(), []);
  const sea = useMemo(() => curvedDisc(SEA_RADIUS + 100, SEA_CENTER.x), []);
  const dirt = useMemo(() => groundTexture(FLAT_RADIUS / 50), []);
  const detail = useMemo(() => groundTexture(1), []);
  useEffect(
    () => () => {
      land.dispose();
      terrain.dispose();
      sea.dispose();
      dirt.dispose();
      detail.dispose();
    },
    [land, terrain, sea, dirt, detail],
  );
  return (
    <group>
      <mesh geometry={land} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <meshStandardMaterial map={dirt} roughness={1} />
      </mesh>
      <mesh geometry={terrain} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <meshStandardMaterial
          vertexColors
          map={detail}
          color="#c8c0b0"
          roughness={1}
        />
      </mesh>
      <mesh
        geometry={sea}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[SEA_CENTER.x, 0.3, SEA_CENTER.y]}
      >
        <meshPhysicalMaterial
          color="#0d2a3d"
          roughness={0.12}
          metalness={0}
          clearcoat={1}
          clearcoatRoughness={0.05}
        />
      </mesh>
    </group>
  );
}

/** Concrete pad, flame trench and a service tower. */
function Pad({ height }: { height: number }) {
  const towerHeight = Math.max(40, height * 0.95);
  const light = useRef<THREE.MeshBasicMaterial>(null);
  const concrete = useMemo(() => padTexture(), []);
  useEffect(() => () => concrete.dispose(), [concrete]);
  useFrame(({ clock }) => {
    if (light.current)
      light.current.color.setRGB(
        Math.sin(clock.elapsedTime * 3) > 0 ? 8 : 0.4,
        0.15,
        0.05,
      );
  });
  return (
    <group>
      <mesh position={[0, PAD_TOP / 2, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[34, 40, PAD_TOP, 64]} />
        <meshStandardMaterial map={concrete} roughness={0.92} />
      </mesh>
      <mesh
        position={[0, PAD_TOP + 0.02, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      >
        <ringGeometry args={[18, 18.6, 64]} />
        <meshStandardMaterial color="#e0a100" roughness={0.7} />
      </mesh>
      <mesh position={[0, PAD_TOP - 0.4, 0]} receiveShadow>
        <boxGeometry args={[12, 1, 70]} />
        <meshStandardMaterial color="#141312" roughness={1} />
      </mesh>
      <group position={[-26, 0, -6]}>
        {[-2.5, 2.5].flatMap((dx) =>
          [-2.5, 2.5].map((dz) => (
            <mesh
              key={`${dx}${dz}`}
              position={[dx, towerHeight / 2 + PAD_TOP, dz]}
              castShadow
              receiveShadow
            >
              <boxGeometry args={[0.5, towerHeight, 0.5]} />
              <meshStandardMaterial
                color="#8a2a1a"
                metalness={0.6}
                roughness={0.45}
              />
            </mesh>
          )),
        )}
        {Array.from({ length: Math.floor(towerHeight / 7) }, (_, i) => (
          <mesh
            key={i}
            position={[0, PAD_TOP + i * 7 + 3.5, 0]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[5.5, 0.3, 5.5]} />
            <meshStandardMaterial
              color="#6b2014"
              metalness={0.6}
              roughness={0.45}
            />
          </mesh>
        ))}
        {Array.from({ length: Math.floor(towerHeight / 7) - 1 }, (_, i) => (
          <mesh
            key={`x${i}`}
            position={[2.5, PAD_TOP + i * 7 + 7, 0]}
            rotation={[i % 2 ? Math.atan2(5, 7) : -Math.atan2(5, 7), 0, 0]}
            castShadow
          >
            <boxGeometry args={[0.18, 8.6, 0.18]} />
            <meshStandardMaterial
              color="#6b2014"
              metalness={0.6}
              roughness={0.45}
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
        <mesh key={i} position={[x, 6, z]} castShadow receiveShadow>
          <cylinderGeometry args={[4, 4, 12, 32]} />
          <meshPhysicalMaterial
            color="#e4e0d8"
            roughness={0.35}
            metalness={0.6}
            clearcoat={0.4}
          />
        </mesh>
      ))}
    </group>
  );
}

const CLOUD_BANKS = 36;
const PUFFS_PER_CLOUD = 16;

/**
 * Lit cumulus a couple of kilometres up that the rocket climbs through, each
 * a cluster of puffs shaded by the low sun, so they glow warm on the sunward
 * side and go grey and flat underneath.
 */
function Clouds() {
  const mesh = useMemo(() => {
    const count = CLOUD_BANKS * PUFFS_PER_CLOUD;
    const geometry = billboardGeometry(count);
    (
      geometry.getAttribute("aFade") as THREE.InstancedBufferAttribute
    ).array.fill(0.3);
    const material = smokeMaterial({ opacity: 0.95, spread: 1.9, erode: 0 });
    material.fog = false;
    material.uniforms.uHaze.value.set(HAZE);
    material.uniforms.uHazeRange.value = 26000;
    material.uniforms.uSkyColor.value.setRGB(0.5, 0.58, 0.75);
    material.uniforms.uGroundColor.value.setRGB(0.32, 0.26, 0.24);
    material.uniforms.uSunColor.value.setRGB(1.3, 0.92, 0.66);
    const clouds = new THREE.InstancedMesh(geometry, material, count);
    clouds.frustumCulled = false;
    const random = seededRandom(3);
    const matrix = new THREE.Matrix4();
    const at = new THREE.Vector3();
    const size = new THREE.Vector3();
    const none = new THREE.Quaternion();
    const shade = new THREE.Color();
    for (let c = 0; c < CLOUD_BANKS; c++) {
      const angle = random() * Math.PI * 2;
      const reach = 5000 + random() * 22000;
      const cx = Math.cos(angle) * reach;
      const cy = 1800 + random() * 1400;
      const cz = Math.sin(angle) * reach;
      const r = 300 + random() * 350;
      for (let p = 0; p < PUFFS_PER_CLOUD; p++) {
        const lift = random();
        at.set(
          cx + (random() - 0.5) * r * 3.2,
          cy + lift * r * 0.9,
          cz + (random() - 0.5) * r * 1.8,
        );
        size.setScalar(r * (0.28 + random() * 0.22) * (1 - lift * 0.4));
        matrix.compose(at, none, size);
        clouds.setMatrixAt(c * PUFFS_PER_CLOUD + p, matrix);
        shade.setScalar(0.78 + lift * 0.22);
        clouds.setColorAt(c * PUFFS_PER_CLOUD + p, shade);
      }
    }
    return clouds;
  }, []);
  useEffect(
    () => () => {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    },
    [mesh],
  );
  return <primitive object={mesh} />;
}
