"use client";

import { Canvas } from "@react-three/fiber";
import { Suspense, useCallback, useMemo, useRef } from "react";
import * as THREE from "three";
import { layoutRocket, type PlacedPart } from "@/lib/rocket/layout";
import type { RocketConfig } from "@/lib/rocket/types";
import type { LaunchPlan } from "@/lib/sim/playback";
import { sound } from "@/lib/sound";
import { Bay, BayCamera } from "./Bay";
import { type LaunchCue, LaunchScene, type Telemetry } from "./LaunchScene";
import { PostEffects } from "./PostEffects";

/** Props for the main 3D viewport. */
export interface ViewportProps {
  rocket: RocketConfig;
  scene: "bay" | "launch";
  plan: LaunchPlan | null;
  attempt: number;
  labels: boolean;
  quality: "high" | "low";
  telemetry: { current: Telemetry };
  onCue: (cue: LaunchCue) => void;
  onLaunchComplete: () => void;
}

/** The single WebGL canvas for the builder; switches between the bay and the launch pad. */
export function Viewport({
  rocket,
  scene,
  plan,
  attempt,
  labels,
  quality,
  telemetry,
  onCue,
  onLaunchComplete,
}: ViewportProps) {
  const layout = useMemo(() => layoutRocket(rocket), [rocket]);
  const lastSnap = useRef(0);
  const onPartLanded = useCallback((part: PlacedPart) => {
    const now = performance.now();
    if (part.kind === "body" || now - lastSnap.current < 70) return;
    lastSnap.current = now;
    sound.play("snap");
  }, []);

  return (
    <Canvas
      className="!fixed inset-0 touch-none"
      dpr={quality === "high" ? [1, 2] : [1, 1.25]}
      shadows={{ type: THREE.PCFShadowMap }}
      gl={{
        antialias: false,
        stencil: false,
        powerPreference: "high-performance",
      }}
      camera={{ fov: 35, near: 0.5, far: 6000, position: [70, 40, 110] }}
    >
      <Suspense fallback={null}>
        {scene === "bay" || !plan ? (
          <>
            <Bay
              rocket={rocket}
              layout={layout}
              labels={labels}
              quality={quality}
              onPartLanded={onPartLanded}
            />
            <BayCamera layout={layout} autoRotate />
          </>
        ) : (
          <LaunchScene
            key={`${attempt}`}
            rocket={rocket}
            layout={layout}
            plan={plan}
            quality={quality}
            telemetry={telemetry}
            onCue={onCue}
            onComplete={onLaunchComplete}
          />
        )}
        <PostEffects quality={quality} />
      </Suspense>
    </Canvas>
  );
}
