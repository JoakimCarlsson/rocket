"use client";

import { ContactShadows, Environment, Grid, Html, Lightformer, OrbitControls, Sparkles } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { PlacedPart, RocketLayout } from "@/lib/rocket/layout";
import type { RocketConfig } from "@/lib/rocket/types";
import { RocketModel } from "./RocketModel";

const PLATFORM_HEIGHT = 0.8;

/** Props for the construction bay scene. */
export interface BayProps {
  rocket: RocketConfig;
  layout: RocketLayout;
  labels: boolean;
  quality: "high" | "low";
  onPartLanded?: (part: PlacedPart) => void;
}

/** The industrial construction bay: floor, gantries, lights and the rocket on its platform. */
export function Bay({ rocket, layout, labels, quality, onPartLanded }: BayProps) {
  const tower = Math.max(60, layout.height * 1.15);
  const spread = Math.max(16, layout.width * 0.8 + 10);
  return (
    <>
      <color attach="background" args={["#06070a"]} />
      <fog attach="fog" args={["#06070a", 120, 420]} />
      <ambientLight intensity={0.35} />
      <hemisphereLight args={["#9fb4d8", "#1a1410", 0.6]} />
      <directionalLight position={[40, 90, 30]} intensity={1.8} color="#fff1e0" />
      <directionalLight position={[-60, 40, -40]} intensity={1.1} color="#7aa7ff" />
      <directionalLight position={[0, 60, -120]} intensity={1.4} color="#ffb98a" />
      <pointLight position={[0, 4, 20]} intensity={600} distance={80} color="#ff7a3a" />
      <BayEnvironment />

      <Platform radius={spread} />
      <group position={[0, PLATFORM_HEIGHT, 0]}>
        <RocketModel layout={layout} finish={rocket.appearance.finish} tilt={rocket.tilt} onLanded={onPartLanded} />
        <Labels layout={layout} visible={labels && Math.abs(rocket.tilt) <= 10} />
      </group>

      <Gantry x={-spread - 8} height={tower} />
      <Gantry x={spread + 8} height={tower} mirrored />
      <CeilingStrips height={tower + 30} />

      <Grid
        position={[0, 0.01, 0]}
        args={[400, 400]}
        cellSize={2}
        cellThickness={0.6}
        cellColor="#171a20"
        sectionSize={10}
        sectionThickness={1}
        sectionColor="#262b35"
        fadeDistance={260}
        fadeStrength={1.4}
        infiniteGrid
      />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
        <planeGeometry args={[1200, 1200]} />
        <meshStandardMaterial color="#0a0b0e" roughness={quality === "high" ? 0.35 : 0.9} metalness={0.6} />
      </mesh>
      {quality === "high" && (
        <ContactShadows position={[0, PLATFORM_HEIGHT + 0.02, 0]} scale={spread * 3} blur={2.4} opacity={0.75} far={layout.height} resolution={512} frames={Infinity} />
      )}
      <Sparkles count={quality === "high" ? 120 : 40} scale={[120, Math.max(60, layout.height), 120]} position={[0, layout.height / 2, 0]} size={2} speed={0.2} opacity={0.35} color="#ffd9b0" />
    </>
  );
}

/** Offline studio lighting for reflections, built from light panels instead of an HDR download. */
function BayEnvironment() {
  return (
    <Environment resolution={256} frames={1}>
      <color attach="background" args={["#0b0c10"]} />
      <Lightformer form="rect" intensity={3} color="#ffffff" position={[0, 12, -8]} scale={[20, 3, 1]} />
      <Lightformer form="rect" intensity={1.6} color="#ffd2a8" position={[-10, 4, 0]} rotation={[0, Math.PI / 2, 0]} scale={[12, 6, 1]} />
      <Lightformer form="rect" intensity={1.4} color="#9cc0ff" position={[10, 4, 0]} rotation={[0, -Math.PI / 2, 0]} scale={[12, 6, 1]} />
      <Lightformer form="ring" intensity={2} color="#ff6a2a" position={[0, 2, 10]} scale={4} />
      <Lightformer form="rect" intensity={2.2} color="#c8d6ff" position={[0, 6, -12]} scale={[24, 10, 1]} />
    </Environment>
  );
}

/** Round assembly platform with an accent ring and hazard markings. */
function Platform({ radius }: { radius: number }) {
  const hazard = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 32;
    const g = canvas.getContext("2d")!;
    g.fillStyle = "#15161a";
    g.fillRect(0, 0, 512, 32);
    g.fillStyle = "#e0a100";
    for (let x = -32; x < 512; x += 32) {
      g.beginPath();
      g.moveTo(x, 32);
      g.lineTo(x + 16, 0);
      g.lineTo(x + 32, 0);
      g.lineTo(x + 16, 32);
      g.fill();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.repeat.set(Math.round(radius / 2), 1);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }, [radius]);
  useEffect(() => () => hazard.dispose(), [hazard]);
  return (
    <group>
      <mesh position={[0, PLATFORM_HEIGHT / 2, 0]} receiveShadow>
        <cylinderGeometry args={[radius, radius + 0.6, PLATFORM_HEIGHT, 96]} />
        <meshStandardMaterial color="#16181d" metalness={0.7} roughness={0.35} />
      </mesh>
      <mesh position={[0, PLATFORM_HEIGHT / 2, 0]}>
        <cylinderGeometry args={[radius + 0.62, radius + 0.62, PLATFORM_HEIGHT * 0.6, 96, 1, true]} />
        <meshStandardMaterial map={hazard} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, PLATFORM_HEIGHT + 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[radius - 0.8, radius - 0.6, 128]} />
        <meshBasicMaterial color="#ff5b1f" toneMapped={false} />
      </mesh>
      <mesh position={[0, PLATFORM_HEIGHT + 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[radius * 0.45, radius * 0.45 + 0.08, 128]} />
        <meshBasicMaterial color="#3a3f4a" />
      </mesh>
    </group>
  );
}

/** A lattice gantry tower with blinking warning lights. */
function Gantry({ x, height, mirrored = false }: { x: number; height: number; mirrored?: boolean }) {
  const light = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (light.current) light.current.color.setRGB(Math.sin(clock.elapsedTime * 2.5) > 0 ? 3 : 0.3, 0.1, 0.05);
  });
  const levels = Math.floor(height / 6);
  const depth = -18;
  return (
    <group position={[x, 0, depth]}>
      {[-2, 2].flatMap((dx) =>
        [-2, 2].map((dz) => (
          <mesh key={`${dx}${dz}`} position={[dx, height / 2, dz]}>
            <boxGeometry args={[0.4, height, 0.4]} />
            <meshStandardMaterial color="#1d2027" metalness={0.8} roughness={0.4} />
          </mesh>
        )),
      )}
      {Array.from({ length: levels }, (_, i) => (
        <group key={i} position={[0, i * 6 + 3, 0]}>
          <mesh rotation={[0, 0, Math.atan2(6, 4)]}>
            <boxGeometry args={[0.18, 7.2, 0.18]} />
            <meshStandardMaterial color="#22262e" metalness={0.8} roughness={0.4} />
          </mesh>
          <mesh position={[0, 3, 0]}>
            <boxGeometry args={[4.4, 0.25, 4.4]} />
            <meshStandardMaterial color="#1a1d23" metalness={0.8} roughness={0.5} />
          </mesh>
        </group>
      ))}
      <mesh position={[mirrored ? -6 : 6, height * 0.72, 0]}>
        <boxGeometry args={[12, 0.6, 0.8]} />
        <meshStandardMaterial color="#20232a" metalness={0.8} roughness={0.4} />
      </mesh>
      <mesh position={[0, height + 0.6, 0]}>
        <sphereGeometry args={[0.45, 12, 8]} />
        <meshBasicMaterial ref={light} color="#ff2200" toneMapped={false} />
      </mesh>
    </group>
  );
}

/** Long emissive strips overhead that read as industrial lighting. */
function CeilingStrips({ height }: { height: number }) {
  return (
    <group position={[0, height, -10]}>
      {[-30, -10, 10, 30].map((z) => (
        <mesh key={z} position={[0, 0, z]}>
          <boxGeometry args={[140, 0.3, 0.6]} />
          <meshBasicMaterial color="#c9d4e6" toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Small technical callouts anchored to parts of the rocket. They stay mounted and fade out
 * when hidden, because unmounting drei's Html mid-commit tears its DOM portal.
 */
function Labels({ layout, visible }: { layout: RocketLayout; visible: boolean }) {
  return (
    <>
      {layout.labels.map((label) => {
        const x = label.side === "right" ? Math.abs(label.position[0]) : -Math.abs(label.position[0]);
        return (
          <Html key={label.key} position={[x, label.position[1], 0]} zIndexRange={[10, 0]} style={{ pointerEvents: "none", opacity: visible ? 1 : 0, transition: "opacity 300ms" }}>
            <div className={`bay-label ${label.side === "left" ? "bay-label--left" : ""}`}>
              <span className="bay-label__line" />
              <span className="bay-label__title">{label.title}</span>
              <span className="bay-label__detail">{label.detail}</span>
            </div>
          </Html>
        );
      })}
    </>
  );
}

/** Orbit controls that frame the rocket, auto-rotate while idle and re-frame after changes. */
export function BayCamera({ layout, autoRotate }: { layout: RocketLayout; autoRotate: boolean }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera, size } = useThree();
  const idleSince = useRef(0);
  const interacting = useRef(false);
  const framing = useRef({ active: true, until: 0 });
  const aspect = size.width / Math.max(1, size.height);
  const fit = useMemo(() => {
    const fov = THREE.MathUtils.degToRad((camera as THREE.PerspectiveCamera).fov ?? 35);
    const verticalExtent = layout.height - layout.minY + 8;
    const horizontalExtent = layout.width + 12;
    const byHeight = verticalExtent / 2 / Math.tan(fov / 2);
    const byWidth = horizontalExtent / 2 / Math.tan(fov / 2) / Math.min(1.4, aspect);
    const center = PLATFORM_HEIGHT + (layout.height + layout.minY) / 2;
    return { distance: Math.max(30, byHeight * 1.3, byWidth), targetY: center - verticalExtent * 0.12 };
  }, [layout, camera, aspect]);

  useEffect(() => {
    framing.current = { active: true, until: performance.now() + 1600 };
  }, [fit]);

  useFrame((_, delta) => {
    const c = controls.current;
    if (!c) return;
    const now = performance.now();
    c.autoRotate = autoRotate && !interacting.current && now / 1000 - idleSince.current > 3;
    if (framing.current.active) {
      c.target.y = THREE.MathUtils.damp(c.target.y, fit.targetY, 3, delta);
      c.target.x = THREE.MathUtils.damp(c.target.x, 0, 3, delta);
      c.target.z = THREE.MathUtils.damp(c.target.z, 0, 3, delta);
      const offset = camera.position.clone().sub(c.target);
      const distance = THREE.MathUtils.damp(offset.length(), fit.distance, 2.6, delta);
      offset.setLength(distance);
      camera.position.copy(c.target).add(offset);
      if (now > framing.current.until) framing.current.active = false;
    }
    const maxPan = Math.max(10, layout.height * 0.3);
    c.target.x = THREE.MathUtils.clamp(c.target.x, -maxPan, maxPan);
    c.target.z = THREE.MathUtils.clamp(c.target.z, -maxPan, maxPan);
    c.target.y = THREE.MathUtils.clamp(c.target.y, 2, layout.height + 10);
    c.update();
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      autoRotateSpeed={0.55}
      minDistance={12}
      maxDistance={Math.max(160, fit.distance * 2.2)}
      maxPolarAngle={Math.PI * 0.53}
      minPolarAngle={Math.PI * 0.12}
      panSpeed={0.6}
      target={[0, fit.targetY, 0]}
      onStart={() => {
        interacting.current = true;
        framing.current.active = false;
      }}
      onEnd={() => {
        interacting.current = false;
        idleSince.current = performance.now() / 1000;
      }}
    />
  );
}
