"use client";

import { useFrame } from "@react-three/fiber";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { PlacedPart, RocketLayout } from "@/lib/rocket/layout";
import type { Finish } from "@/lib/rocket/types";
import { PartMesh } from "./PartMesh";

/** Spring stiffness and damping for part motion; slightly underdamped for a satisfying snap. */
const STIFFNESS = 110;
const DAMPING = 14;
const EXIT_MS = 650;

interface AnimatedPartProps {
  part: PlacedPart;
  finish: Finish;
  delay: number;
  exiting: boolean;
  onLanded?: (part: PlacedPart) => void;
  instant: boolean;
}

/** Direction a part flies in from: outward from the axis and a little upward. */
function flyOffset(part: PlacedPart): THREE.Vector3 {
  const [x, y, z] = part.position;
  const radial = new THREE.Vector3(x, 0, z);
  if (radial.lengthSq() < 0.01) radial.set(Math.sin(y) || 0.3, 0, Math.cos(y) || 1);
  radial.normalize();
  const distance = part.kind === "booster" ? 22 : part.kind === "body" ? 0 : 12;
  return radial.multiplyScalar(distance).add(new THREE.Vector3(0, part.kind === "body" ? -6 : 8, 0));
}

/** One part that springs into place, resizes smoothly and flies away when removed. */
const AnimatedPart = memo(function AnimatedPart({ part, finish, delay, exiting, onLanded, instant }: AnimatedPartProps) {
  const group = useRef<THREE.Group>(null);
  const state = useRef({
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    scale: new THREE.Vector3(1, 1, 1),
    scaleVel: new THREE.Vector3(),
    started: 0,
    initialised: false,
    landed: instant,
    dims: part.dims,
  });
  const target = useMemo(() => new THREE.Vector3(...part.position), [part.position]);

  useEffect(() => {
    const s = state.current;
    const prev = s.dims;
    if (s.initialised && (prev.h !== part.dims.h || prev.r !== part.dims.r)) {
      const sy = prev.h > 0 && part.dims.h > 0 ? prev.h / part.dims.h : 1;
      const sr = prev.r > 0 && part.dims.r > 0 ? prev.r / part.dims.r : 1;
      s.scale.set(sr, sy, sr);
    }
    s.dims = part.dims;
  }, [part.dims]);

  useFrame(({ clock }, rawDelta) => {
    const g = group.current;
    if (!g) return;
    const s = state.current;
    const now = clock.elapsedTime * 1000;
    if (!s.initialised) {
      s.initialised = true;
      s.started = now + delay;
      if (instant) {
        s.pos.copy(target);
        s.scale.set(1, 1, 1);
      } else {
        s.pos.copy(target).add(flyOffset(part));
        s.scale.setScalar(0.001);
      }
    }
    const dt = Math.min(rawDelta, 1 / 30);
    if (now < s.started) {
      g.visible = false;
      return;
    }
    g.visible = true;
    const goal = exiting ? target.clone().add(flyOffset(part).multiplyScalar(1.4)) : target;
    const scaleGoal = exiting ? 0.001 : 1;
    s.vel.addScaledVector(goal.clone().sub(s.pos), STIFFNESS * dt).multiplyScalar(Math.max(0, 1 - DAMPING * dt));
    s.pos.addScaledVector(s.vel, dt);
    s.scaleVel
      .addScaledVector(new THREE.Vector3(scaleGoal, scaleGoal, scaleGoal).sub(s.scale), STIFFNESS * dt)
      .multiplyScalar(Math.max(0, 1 - DAMPING * dt));
    s.scale.addScaledVector(s.scaleVel, dt);
    g.position.copy(s.pos);
    g.scale.set(Math.max(0.001, s.scale.x), Math.max(0.001, s.scale.y), Math.max(0.001, s.scale.z));
    if (!s.landed && !exiting && s.pos.distanceToSquared(target) < 0.04) {
      s.landed = true;
      onLanded?.(part);
    }
  });

  return (
    <group ref={group} rotation={part.rotation} visible={false}>
      <PartMesh part={part} finish={finish} />
    </group>
  );
});

/** Props for the animated construction-bay rocket. */
export interface RocketModelProps {
  layout: RocketLayout;
  finish: Finish;
  tilt: number;
  onLanded?: (part: PlacedPart) => void;
}

interface Displayed {
  part: PlacedPart;
  delay: number;
  exiting: boolean;
  instant: boolean;
}

/**
 * The construction-bay rocket. Tracks parts by key so additions fly in, removals fly out,
 * and existing parts spring to their new positions.
 */
export function RocketModel({ layout, finish, tilt, onLanded }: RocketModelProps) {
  const [displayed, setDisplayed] = useState<Map<string, Displayed>>(() => {
    const map = new Map<string, Displayed>();
    layout.parts.forEach((part, i) => map.set(part.key, { part, delay: Math.min(1400, i * 12), exiting: false, instant: false }));
    return map;
  });
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const current = new Set(layout.parts.map((p) => p.key));
    setDisplayed((previous) => {
      const next = new Map<string, Displayed>();
      let added = 0;
      layout.parts.forEach((part) => {
        const existing = previous.get(part.key);
        if (existing && !existing.exiting) next.set(part.key, { ...existing, part });
        else next.set(part.key, { part, delay: Math.min(1600, added++ * 45), exiting: false, instant: false });
      });
      previous.forEach((entry, key) => {
        if (!current.has(key)) next.set(key, { ...entry, exiting: true });
      });
      return next;
    });
    const timer = setTimeout(() => {
      setDisplayed((previous) => {
        const next = new Map(previous);
        next.forEach((entry, key) => {
          if (entry.exiting) next.delete(key);
        });
        return next;
      });
    }, EXIT_MS);
    return () => clearTimeout(timer);
  }, [layout]);

  const tiltGroup = useRef<THREE.Group>(null);
  const tiltTarget = THREE.MathUtils.degToRad(tilt);
  const center = (layout.height + layout.minY) / 2;
  const halfLength = (layout.height - layout.minY) / 2;
  useFrame((_, delta) => {
    const g = tiltGroup.current;
    if (!g) return;
    g.rotation.z = THREE.MathUtils.damp(g.rotation.z, -tiltTarget, 3, delta);
    const angle = g.rotation.z;
    const pivot = halfLength * Math.abs(Math.cos(angle)) + (layout.width / 2) * Math.abs(Math.sin(angle));
    g.position.y = pivot;
  });

  return (
    <group ref={tiltGroup} position={[0, halfLength, 0]}>
      <group position={[0, -center, 0]}>
        {[...displayed.values()].map((entry) => (
          <AnimatedPart
            key={entry.part.key}
            part={entry.part}
            finish={finish}
            delay={entry.delay}
            exiting={entry.exiting}
            instant={entry.instant}
            onLanded={onLanded}
          />
        ))}
      </group>
    </group>
  );
}

/** A non-animated rocket, used for thumbnails and share cards. */
export function StaticRocket({ layout, finish, tilt = 0 }: { layout: RocketLayout; finish: Finish; tilt?: number }) {
  const angle = -THREE.MathUtils.degToRad(tilt);
  const center = (layout.height + layout.minY) / 2;
  const halfLength = (layout.height - layout.minY) / 2;
  const pivot = halfLength * Math.abs(Math.cos(angle)) + (layout.width / 2) * Math.abs(Math.sin(angle));
  return (
    <group position={[0, pivot, 0]} rotation={[0, 0, angle]}>
      <group position={[0, -center, 0]}>
        {layout.parts.map((part) => (
          <group key={part.key} position={part.position} rotation={part.rotation}>
            <PartMesh part={part} finish={finish} />
          </group>
        ))}
      </group>
    </group>
  );
}
