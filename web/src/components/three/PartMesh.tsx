"use client";

import { useFrame } from "@react-three/fiber";
import { createContext, useContext, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { PlacedPart, ShapeInfo } from "@/lib/rocket/layout";
import type { Finish, Pattern, ShapeMaterial } from "@/lib/rocket/types";
import {
  columnGeometry,
  finGeometry,
  noseGeometry,
  nozzleGeometry,
  shapeGeometry,
} from "./geometry";
import { bodyTexture, FINISH_PROPS } from "./materials";

/** Mutable render flags shared by every part, written by scenes each frame. */
export interface RenderFlags {
  engineGlow: number;
  time: number;
}

const RenderFlagsContext = createContext<{ current: RenderFlags }>({
  current: { engineGlow: 0, time: 0 },
});

/** Provides render flags to parts below. */
export const RenderFlagsProvider = RenderFlagsContext.Provider;

/** Creates a physical material for the given finish and disposes it when replaced. */
function useSurface(
  color: string,
  finish: Finish,
  map?: THREE.Texture | null,
): THREE.MeshPhysicalMaterial {
  const material = useMemo(() => {
    const f = FINISH_PROPS[finish];
    return new THREE.MeshPhysicalMaterial({
      metalness: f.metalness,
      roughness: f.roughness,
      clearcoat: f.clearcoat,
      clearcoatRoughness: 0.2,
      envMapIntensity: 1.1,
    });
  }, [finish]);
  useEffect(() => {
    material.color.set(map ? "#ffffff" : color);
    material.map = map ?? null;
    material.needsUpdate = true;
  }, [material, color, map]);
  useEffect(() => () => material.dispose(), [material]);
  return material;
}

/** Creates a simple standard material. */
function useBasicSurface(
  color: string,
  params: THREE.MeshStandardMaterialParameters = {},
): THREE.MeshStandardMaterial {
  const key = JSON.stringify(params);
  const material = useMemo(
    () => new THREE.MeshStandardMaterial(JSON.parse(key)),
    [key],
  );
  useEffect(() => {
    material.color.set(color);
  }, [material, color]);
  useEffect(() => () => material.dispose(), [material]);
  return material;
}

/** Memoises a geometry and disposes it when inputs change. */
function useGeometry(
  factory: () => THREE.BufferGeometry,
  deps: unknown[],
): THREE.BufferGeometry {
  const geometry = useMemo(factory, deps);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return geometry;
}

/** Props for a single rocket primitive. */
export interface PartMeshProps {
  part: PlacedPart;
  finish: Finish;
}

/** Renders one placed part at its local origin. Position and rotation are applied by the parent. */
export function PartMesh({ part, finish }: PartMeshProps) {
  switch (part.kind) {
    case "body":
    case "booster":
      return <Body part={part} finish={finish} />;
    case "interstage":
      return <Interstage part={part} finish={finish} />;
    case "trim":
      return <Trim part={part} />;
    case "engine":
      return <Engine part={part} />;
    case "boosterTop":
    case "top":
      return part.variant === "dome" ? (
        <Dome part={part} />
      ) : (
        <Nose part={part} finish={finish} />
      );
    case "strut":
      return <Strut part={part} />;
    case "payload":
      return <PayloadSection part={part} finish={finish} />;
    case "fin":
      return <Fin part={part} finish={finish} />;
    case "wing":
      return <Fin part={{ ...part, variant: "wing" }} finish={finish} />;
    case "leg":
      return <Leg part={part} />;
    case "antenna":
      return <Antenna part={part} />;
    case "ring":
      return <Ring part={part} finish={finish} />;
    case "solarPanel":
      return <SolarPanel part={part} />;
    case "spike":
      return <Spike part={part} />;
    case "light":
      return <Light part={part} />;
    case "flag":
      return <Flag part={part} />;
    case "googlyEye":
      return <GooglyEye part={part} />;
    case "duck":
      return <Duck part={part} />;
    case "window":
      return <Porthole part={part} />;
    case "tank":
      return <Tank part={part} finish={finish} />;
    case "propeller":
      return <Propeller part={part} />;
    case "shape":
      return <Sculpted part={part} finish={finish} />;
  }
}

/** Core stage or booster body with its paint pattern. */
function Body({ part, finish }: PartMeshProps) {
  const { h, r, r2 } = part.dims;
  const isBooster = part.kind === "booster";
  const top = r;
  const bottom = isBooster ? r : r2;
  const pattern = (isBooster ? "bands" : part.variant) as Pattern;
  const geometry = useGeometry(
    () => columnGeometry(top, bottom, h),
    [top, bottom, h],
  );
  const map = useMemo(
    () =>
      bodyTexture(pattern, part.color, part.color2, h, Math.max(top, bottom)),
    [pattern, part.color, part.color2, h, top, bottom],
  );
  useEffect(() => () => map.dispose(), [map]);
  const material = useSurface(part.color, finish, map);
  return (
    <mesh geometry={geometry} material={material} castShadow receiveShadow />
  );
}

/** Adapter section between stages. */
function Interstage({ part, finish }: PartMeshProps) {
  const { h, r, r2 } = part.dims;
  const geometry = useGeometry(() => columnGeometry(r, r2, h, 24), [r, r2, h]);
  const material = useSurface(
    part.color,
    finish === "chrome" ? "chrome" : "metallic",
  );
  const ring = useGeometry(
    () => columnGeometry(r2 * 1.02, r2 * 1.02, 0.25),
    [r2],
  );
  const accent = useBasicSurface(part.color2, {
    metalness: 0.3,
    roughness: 0.4,
  });
  return (
    <group>
      <mesh geometry={geometry} material={material} castShadow />
      <mesh geometry={ring} material={accent} />
    </group>
  );
}

/** Thin accent ring at the top of a stage. */
function Trim({ part }: { part: PlacedPart }) {
  const geometry = useGeometry(
    () => columnGeometry(part.dims.r, part.dims.r2, part.dims.h),
    [part.dims.r, part.dims.r2, part.dims.h],
  );
  const material = useBasicSurface(part.color, {
    metalness: 0.4,
    roughness: 0.35,
  });
  return <mesh geometry={geometry} material={material} />;
}

/** Engine nozzle with a throat glow that brightens during launch. */
function Engine({ part }: { part: PlacedPart }) {
  const flags = useContext(RenderFlagsContext);
  const { h, r, r2, s: power } = part.dims;
  const bell = useGeometry(
    () => nozzleGeometry(part.variant, h, r, r2),
    [part.variant, h, r, r2],
  );
  const head = useGeometry(
    () => columnGeometry(r2 * 1.5, r2 * 1.8, h * 0.28, 16),
    [r2, h],
  );
  const metal = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        metalness: 0.9,
        roughness: 0.32,
        side: THREE.DoubleSide,
      }),
    [],
  );
  const glowMat = useMemo(
    () => new THREE.MeshBasicMaterial({ toneMapped: false }),
    [],
  );
  useEffect(() => {
    metal.color.set(part.color);
    glowMat.color.set(part.color2);
  }, [metal, glowMat, part.color, part.color2]);
  useEffect(
    () => () => {
      metal.dispose();
      glowMat.dispose();
    },
    [metal, glowMat],
  );
  const glowRef = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const glow = flags.current.engineGlow;
    if (glowRef.current) {
      glowRef.current.visible = glow > 0.01;
      glowRef.current.scale.setScalar(0.6 + glow * 0.4);
    }
    metal.emissive.set(part.color2);
    metal.emissiveIntensity = glow * 0.25 * (power / 10);
  });
  return (
    <group>
      <mesh geometry={bell} material={metal} castShadow />
      <mesh geometry={head} material={metal} position={[0, h * 0.95, 0]} />
      <mesh
        ref={glowRef}
        material={glowMat}
        position={[0, h * 0.35, 0]}
        rotation={[Math.PI / 2, 0, 0]}
      >
        <circleGeometry args={[r * 0.8, 20]} />
      </mesh>
    </group>
  );
}

/** Solid nose cone of any style. */
function Nose({ part, finish }: PartMeshProps) {
  const { h, r } = part.dims;
  const geometry = useGeometry(
    () => noseGeometry(part.variant, h, r),
    [part.variant, h, r],
  );
  const material = useSurface(part.color, finish);
  return <mesh geometry={geometry} material={material} castShadow />;
}

/** Glass observation dome with a tiny pilot inside. */
function Dome({ part }: { part: PlacedPart }) {
  const { r } = part.dims;
  const glass = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: part.color,
        metalness: 0,
        roughness: 0.04,
        transmission: 0.92,
        thickness: 0.4,
        ior: 1.3,
        transparent: true,
        opacity: 0.55,
        clearcoat: 1,
        envMapIntensity: 1.6,
      }),
    [part.color],
  );
  useEffect(() => () => glass.dispose(), [glass]);
  const scale = Math.max(0.35, r / 2.2);
  return (
    <group>
      <mesh material={glass}>
        <sphereGeometry
          args={[r * 0.99, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2]}
        />
      </mesh>
      <mesh position={[0, 0.05, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[r, 0.12 * scale, 10, 48]} />
        <meshStandardMaterial
          color={part.color2}
          metalness={0.6}
          roughness={0.3}
        />
      </mesh>
      <group scale={scale}>
        <mesh position={[0, 0.5, 0]}>
          <cylinderGeometry args={[0.55, 0.65, 1, 16]} />
          <meshStandardMaterial color="#26282e" roughness={0.6} />
        </mesh>
        <mesh position={[0, 1.35, 0.1]}>
          <capsuleGeometry args={[0.32, 0.5, 6, 12]} />
          <meshStandardMaterial color="#ff7a1a" roughness={0.5} />
        </mesh>
        <mesh position={[0, 1.95, 0.1]}>
          <sphereGeometry args={[0.3, 16, 12]} />
          <meshStandardMaterial
            color="#f4f4f4"
            roughness={0.2}
            metalness={0.2}
          />
        </mesh>
        <mesh position={[0, 1.95, 0.35]}>
          <sphereGeometry args={[0.18, 12, 8]} />
          <meshStandardMaterial color="#111" roughness={0.05} metalness={0.8} />
        </mesh>
        <mesh position={[0, 0.85, 0.75]} rotation={[-0.6, 0, 0]}>
          <boxGeometry args={[1, 0.35, 0.08]} />
          <meshBasicMaterial color="#6ee7ff" toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}

/** Connecting strut between a booster and the core; extends inward along local -X. */
function Strut({ part }: { part: PlacedPart }) {
  const material = useBasicSurface(part.color, {
    metalness: 0.7,
    roughness: 0.4,
  });
  return (
    <mesh position={[-part.dims.h / 2, 0, 0]} material={material}>
      <boxGeometry args={[part.dims.h, part.dims.r * 2, part.dims.r * 2]} />
    </mesh>
  );
}

/** Payload section in one of several silhouettes. */
function PayloadSection({ part, finish }: PartMeshProps) {
  const { h, r, r2 } = part.dims;
  const variant = part.variant;
  const geometry = useGeometry(() => {
    if (variant === "fairing") {
      const profile: THREE.Vector2[] = [];
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        const rr =
          t < 0.2 ? r2 + (r - r2) * Math.sin((t / 0.2) * (Math.PI / 2)) : r;
        profile.push(new THREE.Vector2(rr, t * h));
      }
      return new THREE.LatheGeometry(profile, 40);
    }
    if (variant === "cargo") return columnGeometry(r, r2, h, 8);
    if (variant === "satellite") return columnGeometry(r, r, h, 6);
    return columnGeometry(r, r2, h, 40);
  }, [variant, h, r, r2]);
  const color = variant === "satellite" ? "#d4a93a" : part.color;
  const material = useSurface(
    color,
    variant === "satellite" ? "metallic" : finish,
  );
  const dark = useBasicSurface(part.color2, { metalness: 0.4, roughness: 0.5 });
  const panel = useBasicSurface("#1a2c55", {
    metalness: 0.6,
    roughness: 0.25,
    emissive: new THREE.Color("#0a1a44"),
  });
  return (
    <group>
      <mesh geometry={geometry} material={material} castShadow />
      {variant === "habitat" && (
        <mesh
          position={[0, h * 0.5, 0]}
          rotation={[Math.PI / 2, 0, 0]}
          material={dark}
        >
          <torusGeometry args={[r * 1.35, Math.max(0.25, r * 0.14), 12, 48]} />
        </mesh>
      )}
      {variant === "cargo" &&
        [0.25, 0.5, 0.75].map((t) => (
          <mesh key={t} position={[0, h * t, 0]} material={dark}>
            <cylinderGeometry args={[r * 1.03, r * 1.03, 0.25, 8]} />
          </mesh>
        ))}
      {variant === "satellite" &&
        [-1, 1].map((side) => (
          <group key={side} position={[side * (r + 3.2), h * 0.5, 0]}>
            <mesh material={panel}>
              <boxGeometry args={[6, 0.08, Math.max(1.4, h * 0.6)]} />
            </mesh>
            <mesh position={[-side * 3.1, 0, 0]} material={dark}>
              <boxGeometry args={[0.6, 0.15, 0.15]} />
            </mesh>
          </group>
        ))}
    </group>
  );
}

/** Fin or wing extruded from a silhouette; spans outward along local +X. */
function Fin({ part, finish }: PartMeshProps) {
  const { h, r, s } = part.dims;
  const thickness = Math.max(0.12, 0.14 * s);
  const geometry = useGeometry(
    () => finGeometry(part.variant, h, r, thickness),
    [part.variant, h, r, thickness],
  );
  const material = useSurface(part.color, finish);
  return <mesh geometry={geometry} material={material} castShadow />;
}

/** Landing leg angling down and outward from its mount, with a foot pad. */
function Leg({ part }: { part: PlacedPart }) {
  const { h, r, s } = part.dims;
  const length = Math.hypot(h, r);
  const angle = Math.atan2(r, h);
  const material = useBasicSurface(part.color, {
    metalness: 0.7,
    roughness: 0.35,
  });
  const accent = useBasicSurface(part.color2, {
    metalness: 0.3,
    roughness: 0.4,
  });
  return (
    <group>
      <group rotation={[0, 0, angle]}>
        <mesh position={[0, -length / 2, 0]} material={material}>
          <boxGeometry args={[0.35 * s, length, 0.35 * s]} />
        </mesh>
      </group>
      <mesh position={[r, -h + 0.1, 0]} material={accent}>
        <cylinderGeometry args={[0.7 * s, 0.9 * s, 0.25, 16]} />
      </mesh>
      <mesh
        position={[r * 0.45, -h * 0.55, 0]}
        rotation={[0, 0, Math.PI / 2 - angle * 0.4]}
        material={material}
      >
        <boxGeometry args={[0.18 * s, r * 0.9, 0.18 * s]} />
      </mesh>
    </group>
  );
}

/** Thin antenna mast with a ball tip. */
function Antenna({ part }: { part: PlacedPart }) {
  const { h, r } = part.dims;
  const material = useBasicSurface("#d9dde2", {
    metalness: 0.9,
    roughness: 0.2,
  });
  const tip = useBasicSurface(part.color, {
    emissive: new THREE.Color(part.color),
    emissiveIntensity: 0.8,
  });
  return (
    <group>
      <mesh position={[0, h / 2, 0]} material={material}>
        <cylinderGeometry args={[r, r * 1.6, h, 8]} />
      </mesh>
      <mesh position={[0, h, 0]} material={tip}>
        <sphereGeometry args={[r * 3.5, 12, 8]} />
      </mesh>
    </group>
  );
}

/** Decorative ring encircling the body. */
function Ring({ part, finish }: PartMeshProps) {
  const material = useSurface(
    part.color,
    finish === "matte" ? "metallic" : finish,
  );
  return (
    <mesh rotation={[Math.PI / 2, 0, 0]} material={material}>
      <torusGeometry args={[part.dims.r, part.dims.h, 12, 64]} />
    </mesh>
  );
}

/** Solar panel wing projecting outward along local +X. */
function SolarPanel({ part }: { part: PlacedPart }) {
  const { h, r } = part.dims;
  const panel = useBasicSurface(part.color, {
    metalness: 0.6,
    roughness: 0.2,
    emissive: new THREE.Color("#0b1d4d"),
    emissiveIntensity: 0.6,
  });
  const frame = useBasicSurface(part.color2, {
    metalness: 0.6,
    roughness: 0.3,
  });
  return (
    <group>
      <mesh position={[0.6, 0, 0]} material={frame}>
        <boxGeometry args={[1.2, 0.2, 0.2]} />
      </mesh>
      <mesh position={[1.2 + r / 2, 0, 0]} material={panel}>
        <boxGeometry args={[r, h, 0.08]} />
      </mesh>
    </group>
  );
}

/** Menacing spike pointing outward (the parent rotation turns +Y outward). */
function Spike({ part }: { part: PlacedPart }) {
  const geometry = useGeometry(() => {
    const g = new THREE.ConeGeometry(part.dims.r, part.dims.h, 12);
    g.translate(0, part.dims.h / 2, 0);
    return g;
  }, [part.dims.r, part.dims.h]);
  const material = useBasicSurface(part.color, {
    metalness: 0.85,
    roughness: 0.2,
  });
  return <mesh geometry={geometry} material={material} castShadow />;
}

/** Blinking indicator light. */
function Light({ part }: { part: PlacedPart }) {
  const ref = useRef<THREE.MeshBasicMaterial>(null);
  const phase = part.dims.s;
  const base = useMemo(() => new THREE.Color(part.color), [part.color]);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const on =
      0.35 + 0.65 * Math.max(0, Math.sin(clock.elapsedTime * 3 + phase * 0.9));
    ref.current.color.copy(base).multiplyScalar(0.4 + on * 1.8);
  });
  return (
    <mesh>
      <sphereGeometry args={[part.dims.r, 10, 8]} />
      <meshBasicMaterial ref={ref} color={part.color} toneMapped={false} />
    </mesh>
  );
}

/** Flag on a short pole, gently waving. */
function Flag({ part }: { part: PlacedPart }) {
  const { h, r } = part.dims;
  const cloth = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (cloth.current)
      cloth.current.rotation.y = Math.sin(clock.elapsedTime * 2.2) * 0.25;
  });
  return (
    <group>
      <mesh position={[0, h / 2, 0]}>
        <cylinderGeometry args={[0.06, 0.06, h, 8]} />
        <meshStandardMaterial color="#d8dadd" metalness={0.8} roughness={0.2} />
      </mesh>
      <group position={[0, h - r * 0.32, 0]} ref={cloth}>
        <mesh position={[r / 2, 0, 0]}>
          <planeGeometry args={[r, r * 0.62]} />
          <meshStandardMaterial color={part.color} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[r / 2, 0, 0.01]}>
          <planeGeometry args={[r, r * 0.12]} />
          <meshStandardMaterial color="#ffffff" side={THREE.DoubleSide} />
        </mesh>
      </group>
    </group>
  );
}

/** A googly eye whose pupil jiggles around. */
function GooglyEye({ part }: { part: PlacedPart }) {
  const pupil = useRef<THREE.Mesh>(null);
  const { r, s } = part.dims;
  useFrame(({ clock }) => {
    if (!pupil.current) return;
    const t = clock.elapsedTime * 2.2 + s * 1.7;
    pupil.current.position.x = Math.sin(t * 1.3) * r * 0.35;
    pupil.current.position.y = -Math.abs(Math.cos(t)) * r * 0.35;
  });
  return (
    <group>
      <mesh scale={[1, 1, 0.35]}>
        <sphereGeometry args={[r, 24, 16]} />
        <meshPhysicalMaterial
          color={part.color}
          roughness={0.15}
          clearcoat={1}
        />
      </mesh>
      <mesh ref={pupil} position={[0, 0, r * 0.3]} scale={[1, 1, 0.35]}>
        <sphereGeometry args={[r * 0.48, 16, 12]} />
        <meshStandardMaterial color={part.color2} roughness={0.3} />
      </mesh>
    </group>
  );
}

/** Rubber duck, for morale. */
function Duck({ part }: { part: PlacedPart }) {
  const s = part.dims.r;
  return (
    <group scale={s}>
      <mesh position={[0, 0.7, 0]} scale={[1.1, 0.8, 1.35]}>
        <sphereGeometry args={[0.9, 20, 16]} />
        <meshPhysicalMaterial
          color={part.color}
          roughness={0.25}
          clearcoat={0.8}
        />
      </mesh>
      <mesh position={[0, 1.6, 0.55]}>
        <sphereGeometry args={[0.55, 20, 16]} />
        <meshPhysicalMaterial
          color={part.color}
          roughness={0.25}
          clearcoat={0.8}
        />
      </mesh>
      <mesh
        position={[0, 1.5, 1.1]}
        rotation={[Math.PI / 2, 0, 0]}
        scale={[1, 1, 0.5]}
      >
        <coneGeometry args={[0.25, 0.5, 12]} />
        <meshStandardMaterial color={part.color2} roughness={0.4} />
      </mesh>
      {[-0.22, 0.22].map((x) => (
        <mesh key={x} position={[x, 1.75, 0.98]}>
          <sphereGeometry args={[0.08, 8, 6]} />
          <meshBasicMaterial color="#111" />
        </mesh>
      ))}
    </group>
  );
}

/** Round porthole window facing outward along local +Z. */
function Porthole({ part }: { part: PlacedPart }) {
  const r = part.dims.r;
  return (
    <group>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[r, r, 0.12, 20]} />
        <meshPhysicalMaterial
          color={part.color}
          roughness={0.05}
          metalness={0.2}
          clearcoat={1}
          emissive={part.color2}
          emissiveIntensity={0.25}
        />
      </mesh>
      <mesh position={[0, 0, 0.04]}>
        <torusGeometry args={[r, r * 0.16, 8, 24]} />
        <meshStandardMaterial
          color="#9aa0a8"
          metalness={0.9}
          roughness={0.25}
        />
      </mesh>
    </group>
  );
}

/** Strap-on external tank with rounded ends. */
function Tank({ part, finish }: PartMeshProps) {
  const { h, r } = part.dims;
  const material = useSurface(part.color, finish);
  return (
    <group>
      <mesh position={[0, h / 2, 0]} material={material} castShadow>
        <capsuleGeometry args={[r, h - r * 2, 6, 20]} />
      </mesh>
    </group>
  );
}

/** Propeller hat. It will not help. */
function Propeller({ part }: { part: PlacedPart }) {
  const rotor = useRef<THREE.Group>(null);
  const r = part.dims.r;
  useFrame((_, delta) => {
    if (rotor.current) rotor.current.rotation.y += delta * 9;
  });
  return (
    <group>
      <mesh position={[0, r * 0.25, 0]}>
        <cylinderGeometry args={[0.08 * r, 0.08 * r, r * 0.5, 8]} />
        <meshStandardMaterial color="#cfd3d8" metalness={0.8} roughness={0.2} />
      </mesh>
      <group ref={rotor} position={[0, r * 0.5, 0]}>
        {[0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].map((a, i) => (
          <mesh
            key={a}
            rotation={[0.25, a, 0]}
            position={[Math.cos(a) * r * 0.5, 0, -Math.sin(a) * r * 0.5]}
          >
            <boxGeometry args={[r, 0.06 * r, 0.22 * r]} />
            <meshStandardMaterial
              color={i % 2 ? part.color : "#ff3b30"}
              roughness={0.4}
            />
          </mesh>
        ))}
        <mesh>
          <sphereGeometry args={[0.14 * r, 12, 8]} />
          <meshStandardMaterial color={part.color} />
        </mesh>
      </group>
    </group>
  );
}

/** Picks the material for a sculpted shape's surface. */
function useShapeMaterial(
  color: string,
  material: ShapeMaterial,
  finish: Finish,
): THREE.Material {
  const paint = useSurface(color, finish);
  const special = useMemo(() => {
    switch (material) {
      case "chrome":
        return new THREE.MeshPhysicalMaterial({
          metalness: 1,
          roughness: 0.08,
          clearcoat: 1,
          envMapIntensity: 1.6,
        });
      case "glass":
        return new THREE.MeshPhysicalMaterial({
          metalness: 0,
          roughness: 0.04,
          transmission: 0.9,
          thickness: 0.6,
          ior: 1.35,
          transparent: true,
          opacity: 0.6,
          clearcoat: 1,
          envMapIntensity: 1.6,
        });
      case "glow":
        return new THREE.MeshBasicMaterial({ toneMapped: false });
      default:
        return null;
    }
  }, [material]);
  useEffect(() => {
    if (!special) return;
    const tint = new THREE.Color(color);
    (special as THREE.MeshBasicMaterial).color.copy(
      material === "glow" ? tint.multiplyScalar(2.2) : tint,
    );
  }, [special, color, material]);
  useEffect(() => () => special?.dispose(), [special]);
  return special ?? paint;
}

/** A freeform sculpted primitive, turned by its own rotation inside the part's placement. */
function Sculpted({ part, finish }: PartMeshProps) {
  const info = part.shape as ShapeInfo;
  const [w, h, d] = info.size;
  const realSize = info.kind === "capsule";
  const geometry = useGeometry(
    () => shapeGeometry(info.kind, w, h, d),
    [info.kind, realSize ? w : 0, realSize ? h : 0, realSize ? d : 0],
  );
  const material = useShapeMaterial(part.color, info.material, finish);
  const radius = Math.min(w, d, h) / 2;
  const scale: [number, number, number] = realSize
    ? [w / (2 * radius), 1, d / (2 * radius)]
    : [w, h, d];
  if (info.mirrored) scale[0] = -scale[0];
  return (
    <group rotation={info.euler}>
      <mesh
        geometry={geometry}
        material={material}
        scale={scale}
        castShadow
        receiveShadow
      />
    </group>
  );
}
