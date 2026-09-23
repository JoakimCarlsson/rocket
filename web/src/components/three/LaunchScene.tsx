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
  type LaunchEvent,
  type LaunchPlan,
  telemetryAt,
} from "@/lib/sim/simulate";
import { PartMesh, type RenderFlags, RenderFlagsProvider } from "./PartMesh";
import { ParticleField } from "./particles";

/** Seconds of countdown before ignition. */
export const COUNTDOWN_SECONDS = 3.6;
const PAD_TOP = 3;
const GRAVITY = 14;

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

/** Surface colours for the body shown on arrival. */
const CELESTIAL = {
  moon: { color: "#d9d6cf", emissive: "#3a3833" },
  mars: { color: "#c4552b", emissive: "#3a1206" },
  sun: { color: "#ffd27a", emissive: "#ff9a2a" },
} as const;

/** Deterministic noise used for flicker and shake. */
function wiggle(t: number, seed: number): number {
  return (
    Math.sin(t * 37.1 + seed) * 0.5 +
    Math.sin(t * 91.7 + seed * 2.3) * 0.3 +
    Math.sin(t * 13.3 + seed * 0.7) * 0.2
  );
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
  const { camera, scene } = useThree();
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

  const twr = plan.stats.twr;
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
    angle: tilt,
    angVel: 0,
    roll: 0,
    rollVel: 0,
    thrusting: false,
    throttle: 0,
    pauseUntil: 0,
    alive: true,
    lifted: false,
    tipping: false,
    spinning: false,
    wobbleUntil: -1,
    shake: 0,
    eventIndex: 0,
    attached: new Set(layout.segments),
    placed: false,
    groundCamera: new THREE.Vector3(),
    lookAt: new THREE.Vector3(0, layout.height / 2, 0),
    countdownCue: 0,
    finished: false,
    arrived: false,
    debrisId: 0,
  });

  useEffect(() => {
    const distance = Math.max(70, layout.height * 1.6);
    sim.current.groundCamera.set(distance * 0.55, 6, distance);
    camera.position.copy(sim.current.groundCamera);
    camera.lookAt(0, layout.height * 0.45, 0);
    (camera as THREE.PerspectiveCamera).far = 20000;
    camera.updateProjectionMatrix();
    const fog = new THREE.Fog("#e7a57a", 300, 2400);
    scene.fog = fog;
    return () => {
      if (scene.fog === fog) scene.fog = null;
    };
  }, [camera, scene, layout.height]);

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
              s.vel.clone().multiplyScalar(0.85).add(out),
              new THREE.Vector3(out.z * 0.05, 0, -out.x * 0.08),
            );
          });
        break;
      case "stage_sep":
        detach(
          `stage:${event.stageId}`,
          s.vel.clone().multiplyScalar(0.8).sub(dir.clone().multiplyScalar(4)),
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
        s.angVel += out.x > 0 ? 0.12 : -0.12;
        s.shake = Math.max(s.shake, 1.2);
        break;
      }
      case "spin":
        s.spinning = true;
        s.rollVel = 7;
        s.angVel = (Math.random() > 0.5 ? 1 : -1) * 0.9;
        break;
      case "wobble":
        s.wobbleUntil = s.clock + 2.8;
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
        s.angVel = (Math.random() > 0.5 ? 1 : -1) * 0.5;
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

  /** Spawns flame and smoke particles from burning nozzles. */
  const emitExhaust = (dt: number, dir: THREE.Vector3) => {
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
    const fireBudget = Math.ceil(
      (low ? 14 : 34) * s.throttle * Math.min(2, dt * 60),
    );
    const smokeBudget = Math.ceil(
      (low ? 4 : 9) * s.throttle * Math.min(2, dt * 60) * (s.lifted ? 1 : 1.6),
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
          .add(s.vel.clone().multiplyScalar(0.6))
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
        .addScaledVector(back, n.radius * 4);
      jitter.randomDirection().multiplyScalar(5);
      const nearGround = world.y < PAD_TOP + 30;
      fields.smoke.spawn({
        position: world.clone(),
        velocity: back
          .clone()
          .multiplyScalar(14 + Math.random() * 10)
          .add(jitter)
          .add(s.vel.clone().multiplyScalar(0.25)),
        life: nearGround ? 5 + Math.random() * 4 : 2.5 + Math.random() * 2,
        size: n.radius * 1.4,
        growth: n.radius * (nearGround ? 9 : 5) * scale,
        from: smokeFrom,
        to: smokeTo,
      });
    }
  };

  /** Ground camera at first, then a chase camera; always shaking a bit when things are loud. */
  const moveCamera = (
    cam: THREE.PerspectiveCamera,
    dt: number,
    dir: THREE.Vector3,
    altitude: number,
  ) => {
    const s = sim.current;
    const focus =
      s.alive || s.attached.size
        ? s.pos.clone().addScaledVector(dir, layout.height * 0.45)
        : s.lookAt;
    s.lookAt.lerp(focus, Math.min(1, dt * 4));
    const chase = altitude > 45 * scale || Math.abs(s.pos.x) > 80 * scale;
    let desired: THREE.Vector3;
    if (!chase) {
      desired = s.groundCamera.clone();
    } else {
      const back = 70 * scale + Math.min(260, altitude * 0.12);
      desired = s.pos
        .clone()
        .add(new THREE.Vector3(back * 0.55, -back * 0.18, back));
    }
    cam.position.lerp(desired, Math.min(1, dt * (chase ? 1.6 : 3)));
    const amp = s.shake * 0.35 * scale;
    cam.position.x += wiggle(s.clock, 11) * amp;
    cam.position.y += wiggle(s.clock, 17) * amp;
    const look = s.lookAt.clone();
    if (s.arrived && celestial.current && plan.outcome !== "orbit")
      look.lerp(celestial.current.position, 0.25);
    cam.lookAt(look);
    const targetFov = chase ? 42 : 38;
    cam.fov = THREE.MathUtils.damp(cam.fov, targetFov, 2, dt);
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

    let dir = direction(s.angle);
    if (s.lifted && s.alive) {
      if (burning) {
        const accel =
          6 * THREE.MathUtils.clamp(twr, 0.9, 3.5) * (s.spinning ? 0.7 : 1);
        s.vel.addScaledVector(dir, accel * dt);
        s.vel.multiplyScalar(1 - 0.02 * dt);
      } else {
        s.vel.y -= GRAVITY * dt;
      }
      if (!s.spinning && burning) {
        const program = THREE.MathUtils.clamp(
          THREE.MathUtils.degToRad(telemetryAt(plan, t).pitch),
          -1,
          1,
        );
        s.angle = THREE.MathUtils.damp(s.angle, program, 0.8, dt);
      }
      if (s.spinning) s.angVel *= 1 + 0.25 * dt;
      s.angle += s.angVel * dt;
      if (!burning && !s.spinning)
        s.angVel += Math.sign(s.angVel || 1) * 0.4 * dt;
      if (s.clock < s.wobbleUntil) s.angle += Math.sin(s.clock * 11) * 0.9 * dt;
      s.roll += s.rollVel * dt;
      dir = direction(s.angle);
      s.pos.addScaledVector(s.vel, dt);
      if (burning && s.vel.lengthSq() > 1) {
        s.vel.lerp(
          dir.clone().multiplyScalar(s.vel.length()),
          Math.min(1, dt * (s.spinning ? 0.8 : 2.5)),
        );
      }
      if (s.pos.y < PAD_TOP - layout.minY - 0.5 && s.vel.y < 0) {
        s.pos.y = PAD_TOP - layout.minY - 0.5;
        if (s.vel.length() > 20) explode();
        s.vel.set(0, 0, 0);
      }
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

    emitExhaust(dt, dir);
    fields.fire.update(dt, 1.6, 2, 0.5);
    fields.smoke.update(dt, 0.45, 1.6, 1.5);

    if (engineLight.current) {
      engineLight.current.position
        .copy(s.pos)
        .addScaledVector(dir, layout.minY - 4);
      engineLight.current.intensity =
        s.throttle * 60000 * scale * (0.85 + wiggle(s.clock, 3) * 0.3);
      engineLight.current.color.copy(glow);
    }
    if (flash.current) flash.current.intensity *= Math.max(0, 1 - dt * 3.5);

    const altitude = Math.max(0, s.pos.y - PAD_TOP + layout.minY);
    const physical = telemetryAt(plan, t);
    telemetry.current = {
      altitude: physical.altitude,
      speed: physical.speed,
      t,
    };
    const space = THREE.MathUtils.smoothstep(altitude, 120, 1100);
    if (sky.current) sky.current.uniforms.uSpace.value = space;
    if (stars.current) stars.current.opacity = space;
    if (scene.fog instanceof THREE.Fog) {
      scene.fog.near = 300 + altitude * 1.5;
      scene.fog.far = 2400 + altitude * 6;
    }

    moveCamera(state.camera as THREE.PerspectiveCamera, dt, dir, altitude);

    if (celestial.current && s.arrived) {
      celestial.current.visible = true;
      const c = celestial.current;
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

      <Ground />
      <Pad height={layout.height} />
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
        />
      ))}

      <primitive object={fields.smoke.mesh} />
      <primitive object={fields.fire.mesh} />

      {celestialKind && (
        <group
          ref={celestial}
          position={[900, 3200, -2600]}
          visible={false}
          scale={0.4}
        >
          <mesh>
            <sphereGeometry args={[420, 64, 32]} />
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

/** A separated chunk falling (or, if still burning, flying) under simple fake physics. */
function Debris({
  spec,
  finish,
  glow,
  smoke,
}: {
  spec: DebrisSpec;
  finish: RocketConfig["appearance"]["finish"];
  glow: THREE.Color;
  smoke: ParticleField;
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
    const burning = s.age < spec.burning;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(s.quat);
    if (burning) s.vel.addScaledVector(up, 30 * dt);
    else s.vel.y -= GRAVITY * dt;
    s.vel.multiplyScalar(1 - 0.05 * dt);
    s.pos.addScaledVector(s.vel, dt);
    if (s.pos.y < 2) {
      s.pos.y = 2;
      s.vel.multiplyScalar(0.25);
      s.vel.y = Math.abs(s.vel.y) * 0.2;
      spec.spin.multiplyScalar(0.6);
    }
    const spin = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(spec.spin.x * dt, spec.spin.y * dt, spec.spin.z * dt),
    );
    s.quat.multiply(spin);
    g.position.copy(s.pos);
    g.quaternion.copy(s.quat);
    if ((burning || s.age < 1.5) && Math.random() < 0.5) {
      smoke.spawn({
        position: s.pos.clone(),
        velocity: up
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

/** Dusk gradient sky that fades to black as the rocket climbs. */
function Sky({
  material,
}: {
  material: React.RefObject<THREE.ShaderMaterial | null>;
}) {
  const uniforms = useMemo(
    () => ({
      uSpace: { value: 0 },
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
        fragmentShader={`uniform float uSpace; uniform vec3 uHorizon; uniform vec3 uZenith; varying vec3 vDir;
          void main(){ float h = clamp(vDir.y, -0.2, 1.0);
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

/** Flat ground with distant hills and a sea. */
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
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[6000, 64]} />
        <meshStandardMaterial color="#3a3a2f" roughness={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[2400, 0.3, 0]}>
        <circleGeometry args={[1800, 64]} />
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

/** Soft billboard clouds that make the climb readable. */
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
      Array.from({ length: 46 }, (_, i) => ({
        x: ((i * 173) % 1600) - 600,
        y: 300 + ((i * 61) % 320),
        z: ((i * 97) % 1000) - 700,
        s: 90 + ((i * 29) % 110),
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
