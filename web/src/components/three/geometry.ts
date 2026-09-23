import * as THREE from "three";

const SEGMENTS = 40;

/** Samples a radius profile into lathe points from bottom (t=0) to top (t=1). */
function sampleProfile(
  height: number,
  steps: number,
  radiusAt: (t: number) => number,
): THREE.Vector2[] {
  const points: THREE.Vector2[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    points.push(new THREE.Vector2(Math.max(0.0001, radiusAt(t)), t * height));
  }
  return points;
}

/** Builds a nose shape of the given style sitting on y=0. */
export function noseGeometry(
  style: string,
  height: number,
  radius: number,
): THREE.BufferGeometry {
  const profile = (t: number): number => {
    switch (style) {
      case "cone":
        return radius * (1 - t);
      case "needle":
        return t < 0.72
          ? radius * (1 - t / 0.72) ** 0.75 * 0.96 + radius * 0.04 * (1 - t)
          : radius * 0.04 * (1 - t) * 3;
      case "blunt":
        return radius * Math.cos((t * Math.PI) / 2) ** 0.7;
      case "spike":
        return t < 0.5
          ? radius * (1 - t * 1.5)
          : radius * 0.25 * Math.max(0, 1 - (t - 0.5) / 0.5) * 0.4;
      default:
        return radius * (1 - t * t) ** 0.62;
    }
  };
  return new THREE.LatheGeometry(sampleProfile(height, 28, profile), SEGMENTS);
}

/** Builds an engine nozzle whose exit sits at y=0 and throat at y=height. */
export function nozzleGeometry(
  style: string,
  height: number,
  exit: number,
  throat: number,
): THREE.BufferGeometry {
  if (style === "aerospike") {
    return new THREE.LatheGeometry(
      sampleProfile(height, 16, (t) => exit * 0.9 * t + throat * 0.3),
      28,
    );
  }
  const power = style === "trumpet" ? 4.2 : style === "flared" ? 2.8 : 1.8;
  const flare = style === "trumpet" ? 1.25 : style === "flared" ? 1.12 : 1;
  return new THREE.LatheGeometry(
    sampleProfile(
      height,
      18,
      (t) => throat + (exit * flare - throat) * (1 - t) ** power,
    ),
    28,
  );
}

/** Builds a flat fin or wing shape in the XY plane, extruded along Z. */
export function finGeometry(
  shape: string,
  height: number,
  span: number,
  thickness: number,
): THREE.BufferGeometry {
  const s = new THREE.Shape();
  switch (shape) {
    case "delta":
      s.moveTo(0, 0);
      s.lineTo(span, -height * 0.05);
      s.lineTo(span * 0.2, height);
      s.lineTo(0, height);
      break;
    case "shark":
      s.moveTo(0, 0);
      s.quadraticCurveTo(span * 0.9, -height * 0.1, span * 1.1, height * 0.55);
      s.quadraticCurveTo(span * 0.4, height * 0.4, 0, height);
      break;
    case "tiny":
      s.moveTo(0, 0);
      s.lineTo(span * 0.5, 0);
      s.lineTo(0, height * 0.5);
      break;
    case "grid": {
      s.moveTo(0, height * 0.55);
      s.lineTo(span, height * 0.55);
      s.lineTo(span, height);
      s.lineTo(0, height);
      const cells = 4;
      const w = span / cells;
      const hh = (height * 0.45) / 3;
      for (let x = 0; x < cells; x++) {
        for (let y = 0; y < 3; y++) {
          const hole = new THREE.Path();
          const x0 = x * w + w * 0.14;
          const y0 = height * 0.55 + y * hh + hh * 0.14;
          hole.moveTo(x0, y0);
          hole.lineTo(x0 + w * 0.72, y0);
          hole.lineTo(x0 + w * 0.72, y0 + hh * 0.72);
          hole.lineTo(x0, y0 + hh * 0.72);
          s.holes.push(hole);
        }
      }
      break;
    }
    case "wing":
      s.moveTo(0, 0);
      s.lineTo(span, height * 0.12);
      s.lineTo(span * 1.02, height * 0.3);
      s.lineTo(span * 0.3, height * 0.8);
      s.lineTo(0, height);
      break;
    default:
      s.moveTo(0, 0);
      s.lineTo(span, -height * 0.2);
      s.lineTo(span, height * 0.22);
      s.lineTo(0, height);
  }
  s.closePath();
  const geometry = new THREE.ExtrudeGeometry(s, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: thickness * 0.35,
    bevelSize: thickness * 0.35,
    bevelSegments: 2,
  });
  geometry.translate(0, 0, -thickness / 2);
  return geometry;
}

/** Cylinder standing on y=0. */
export function columnGeometry(
  radiusTop: number,
  radiusBottom: number,
  height: number,
  segments = SEGMENTS,
): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(
    radiusTop,
    radiusBottom,
    height,
    segments,
    1,
    false,
  );
  geometry.translate(0, height / 2, 0);
  return geometry;
}
