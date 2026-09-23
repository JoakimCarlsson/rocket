"use client";

import { Canvas } from "@react-three/fiber";
import { Suspense, useMemo } from "react";
import { layoutRocket } from "@/lib/rocket/layout";
import type { RocketConfig } from "@/lib/rocket/types";
import { Bay, BayCamera } from "./Bay";

/** A self-contained bay view for share pages and share cards. */
export function ShowcaseViewport({ rocket, capture = false, className = "" }: { rocket: RocketConfig; capture?: boolean; className?: string }) {
  const layout = useMemo(() => layoutRocket(rocket), [rocket]);
  return (
    <Canvas
      className={className}
      dpr={capture ? 2 : [1, 2]}
      gl={{ antialias: true, preserveDrawingBuffer: capture }}
      camera={{ fov: 35, near: 0.5, far: 6000, position: [70, 40, 110] }}
    >
      <Suspense fallback={null}>
        <Bay rocket={rocket} layout={layout} labels={false} quality="high" />
        <BayCamera layout={layout} autoRotate={!capture} />
      </Suspense>
    </Canvas>
  );
}
