"use client";

import {
  Bloom,
  ChromaticAberration,
  EffectComposer,
  Noise,
  SMAA,
  ToneMapping,
  Vignette,
} from "@react-three/postprocessing";
import { BlendFunction, ToneMappingMode } from "postprocessing";
import { useMemo } from "react";
import * as THREE from "three";

/** Props for the post-processing stack. */
export interface PostEffectsProps {
  quality: "high" | "low";
}

/**
 * The cinematic image pipeline: HDR bloom on emitters brighter than white
 * (flames, the sun, lights), filmic tone mapping, a touch of lens fringing,
 * vignette and film grain.
 * Low quality keeps only bloom and tone mapping.
 */
export function PostEffects({ quality }: PostEffectsProps) {
  const fringe = useMemo(() => new THREE.Vector2(0.0006, 0.0006), []);
  if (quality === "low")
    return (
      <EffectComposer multisampling={0}>
        <Bloom
          mipmapBlur
          luminanceThreshold={1.2}
          luminanceSmoothing={0.3}
          intensity={0.8}
        />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      </EffectComposer>
    );
  return (
    <EffectComposer multisampling={0}>
      <Bloom
        mipmapBlur
        luminanceThreshold={1.2}
        luminanceSmoothing={0.2}
        intensity={1.1}
        radius={0.75}
      />
      <ChromaticAberration
        offset={fringe}
        radialModulation
        modulationOffset={0.35}
      />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <Vignette offset={0.3} darkness={0.55} />
      <Noise
        premultiply
        opacity={0.08}
        blendFunction={BlendFunction.SOFT_LIGHT}
      />
      <SMAA />
    </EffectComposer>
  );
}
