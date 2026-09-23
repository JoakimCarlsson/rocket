"use client";

import { Environment, Lightformer } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import { layoutRocket } from "@/lib/rocket/layout";
import type { RocketConfig } from "@/lib/rocket/types";
import { StaticRocket } from "./RocketModel";
import {
  thumbnailCache as cache,
  type ThumbnailRequest as Request,
  ThumbnailContext,
} from "./thumbnail-context";

interface Job {
  key: string;
  rocket: RocketConfig;
}

const WIDTH = 360;
const HEIGHT = 480;

/**
 * Renders rocket thumbnails one at a time in a single hidden canvas, so a long feed
 * never needs more than one WebGL context.
 */
export function ThumbnailProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Job[]>([]);
  const waiters = useRef(new Map<string, ((url: string) => void)[]>());

  const request = useCallback<Request>((key, rocket) => {
    const hit = cache.get(key);
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve) => {
      const list = waiters.current.get(key);
      if (list) {
        list.push(resolve);
        return;
      }
      waiters.current.set(key, [resolve]);
      setQueue((q) => [...q, { key, rocket }]);
    });
  }, []);

  const finish = useCallback((key: string, url: string) => {
    cache.set(key, url);
    waiters.current.get(key)?.forEach((resolve) => resolve(url));
    waiters.current.delete(key);
    setQueue((q) => q.filter((job) => job.key !== key));
  }, []);

  const job = queue[0];
  return (
    <ThumbnailContext.Provider value={request}>
      {children}
      <div
        aria-hidden
        className="pointer-events-none fixed top-0 -left-[9999px]"
        style={{ width: WIDTH, height: HEIGHT }}
      >
        <Canvas
          dpr={1}
          gl={{ preserveDrawingBuffer: true, antialias: true }}
          camera={{ fov: 30, near: 0.5, far: 3000 }}
          frameloop="always"
        >
          <color attach="background" args={["#0b0c10"]} />
          <ambientLight intensity={0.35} />
          <directionalLight
            position={[40, 90, 60]}
            intensity={1.8}
            color="#fff1e0"
          />
          <directionalLight
            position={[-60, 30, -30]}
            intensity={1.1}
            color="#7aa7ff"
          />
          <hemisphereLight args={["#9fb4d8", "#1a1410", 0.6]} />
          <Environment resolution={128} frames={1}>
            <Lightformer
              form="rect"
              intensity={3}
              position={[0, 10, -6]}
              scale={[16, 3, 1]}
            />
            <Lightformer
              form="rect"
              intensity={1.5}
              color="#ffd2a8"
              position={[-8, 3, 0]}
              rotation={[0, Math.PI / 2, 0]}
              scale={[10, 5, 1]}
            />
          </Environment>
          {job && <Capture key={job.key} job={job} onDone={finish} />}
        </Canvas>
      </div>
    </ThumbnailContext.Provider>
  );
}

/** Frames one rocket, waits a few frames for materials to settle, then grabs the pixels. */
function Capture({
  job,
  onDone,
}: {
  job: Job;
  onDone: (key: string, url: string) => void;
}) {
  const layout = useMemo(() => layoutRocket(job.rocket), [job.rocket]);
  const { camera, gl } = useThree();
  const frames = useRef(0);
  const done = useRef(false);
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const tilt = THREE.MathUtils.degToRad(job.rocket.tilt);
    const length = layout.height - layout.minY;
    const extentY =
      Math.abs(Math.cos(tilt)) * length +
      Math.abs(Math.sin(tilt)) * layout.width;
    const extentX =
      Math.abs(Math.sin(tilt)) * length +
      Math.abs(Math.cos(tilt)) * layout.width;
    const fov = THREE.MathUtils.degToRad(cam.fov);
    const distance =
      Math.max(
        extentY / 2 / Math.tan(fov / 2),
        extentX / 2 / Math.tan(fov / 2) / (WIDTH / HEIGHT),
      ) *
        1.35 +
      layout.width;
    cam.position.set(
      distance * 0.55,
      extentY * 0.5 + distance * 0.12,
      distance * 0.83,
    );
    cam.lookAt(0, extentY * 0.5, 0);
    cam.updateProjectionMatrix();
  }, [camera, layout, job.rocket.tilt]);
  useFrame(() => {
    frames.current++;
    if (frames.current === 4 && !done.current) {
      done.current = true;
      onDone(job.key, gl.domElement.toDataURL("image/webp", 0.85));
    }
  });
  return (
    <StaticRocket
      layout={layout}
      finish={job.rocket.appearance.finish}
      tilt={job.rocket.tilt}
    />
  );
}
