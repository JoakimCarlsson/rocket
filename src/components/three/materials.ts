import * as THREE from "three";
import type { Finish, Pattern } from "@/lib/rocket/types";

/** Metalness and roughness for each finish. */
export const FINISH_PROPS: Record<Finish, { metalness: number; roughness: number; clearcoat: number }> = {
  matte: { metalness: 0.05, roughness: 0.85, clearcoat: 0 },
  satin: { metalness: 0.25, roughness: 0.42, clearcoat: 0.3 },
  metallic: { metalness: 0.75, roughness: 0.3, clearcoat: 0.2 },
  chrome: { metalness: 1, roughness: 0.06, clearcoat: 1 },
  glossy: { metalness: 0.1, roughness: 0.14, clearcoat: 1 },
};

const patternCache = new Map<string, THREE.CanvasTexture>();

/** World-space size of one pattern tile along the body, per pattern. */
function tileHeight(pattern: Pattern, circumference: number): number {
  switch (pattern) {
    case "bands":
      return 14;
    case "checker":
      return circumference;
    case "stripes":
    case "split":
      return 1000;
    default:
      return 8;
  }
}

/** Draws a paint pattern with subtle panel lines into a canvas texture. */
function drawPattern(pattern: Pattern, primary: string, secondary: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const g = canvas.getContext("2d")!;
  g.fillStyle = primary;
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = secondary;
  switch (pattern) {
    case "bands":
      g.fillRect(0, 170, 256, 34);
      g.globalAlpha = 0.6;
      g.fillRect(0, 214, 256, 6);
      g.globalAlpha = 1;
      break;
    case "stripes":
      g.fillRect(40, 0, 20, 256);
      g.fillRect(68, 0, 8, 256);
      g.fillRect(168, 0, 20, 256);
      g.fillRect(196, 0, 8, 256);
      break;
    case "checker":
      for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) if ((x + y) % 2) g.fillRect(x * 32, y * 32, 32, 32);
      break;
    case "split":
      g.fillRect(128, 0, 128, 256);
      break;
  }
  g.globalAlpha = 0.07;
  g.fillStyle = "#000";
  for (let x = 0; x < 256; x += 32) g.fillRect(x, 0, 1, 256);
  if (pattern === "solid" || pattern === "bands") {
    g.fillRect(0, 0, 256, 2);
    g.fillRect(0, 128, 256, 1);
  }
  g.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

/** Returns a pattern texture repeated to fit a body of the given height and radius. */
export function bodyTexture(pattern: Pattern, primary: string, secondary: string, height: number, radius: number): THREE.Texture {
  const key = `${pattern}|${primary}|${secondary}`;
  let base = patternCache.get(key);
  if (!base) {
    base = drawPattern(pattern, primary, secondary);
    patternCache.set(key, base);
  }
  const texture = base.clone();
  const circumference = Math.PI * 2 * radius;
  texture.repeat.set(1, Math.max(0.001, height / tileHeight(pattern, circumference)));
  texture.needsUpdate = true;
  return texture;
}
