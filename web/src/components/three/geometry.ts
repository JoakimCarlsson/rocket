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
      case "round":
        return radius * Math.sqrt(Math.max(0, 1 - t * t));
      case "bulb":
        return t < 0.15
          ? radius * (0.92 + 0.38 * Math.sin((t / 0.15) * (Math.PI / 2)))
          : radius * 1.3 * Math.sqrt(Math.max(0, 1 - ((t - 0.15) / 0.85) ** 2));
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

/** Scales and centres a geometry so its bounding box is exactly the unit cube around the origin. */
function fitUnitCube(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox as THREE.Box3;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  geometry.translate(-center.x, -center.y, -center.z);
  geometry.scale(
    1 / Math.max(size.x, 1e-4),
    1 / Math.max(size.y, 1e-4),
    1 / Math.max(size.z, 1e-4),
  );
  geometry.computeVertexNormals();
  return geometry;
}

/** Extrudes a flat outline in the XY plane along Z with soft bevelled edges. */
function extrudeOutline(outline: THREE.Shape): THREE.BufferGeometry {
  return new THREE.ExtrudeGeometry(outline, {
    depth: 0.4,
    bevelEnabled: true,
    bevelThickness: 0.08,
    bevelSize: 0.06,
    bevelSegments: 3,
    curveSegments: 24,
  });
}

/** Five-pointed star outline. */
function starOutline(): THREE.Shape {
  const outline = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? 0.2 : 0.5;
    const [x, y] = [Math.cos(a) * r, Math.sin(a) * r];
    if (i === 0) outline.moveTo(x, y);
    else outline.lineTo(x, y);
  }
  outline.closePath();
  return outline;
}

/** Heart outline with the point at the bottom. */
function heartOutline(): THREE.Shape {
  const outline = new THREE.Shape();
  outline.moveTo(0, -0.5);
  outline.bezierCurveTo(-0.15, -0.3, -0.5, -0.1, -0.5, 0.15);
  outline.bezierCurveTo(-0.5, 0.45, -0.1, 0.55, 0, 0.3);
  outline.bezierCurveTo(0.1, 0.55, 0.5, 0.45, 0.5, 0.15);
  outline.bezierCurveTo(0.5, -0.1, 0.15, -0.3, 0, -0.5);
  return outline;
}

/** Triangular prism pointing along +Z, like a beak or a doorstop. */
function wedgeGeometry(): THREE.BufferGeometry {
  const outline = new THREE.Shape();
  outline.moveTo(-0.5, -0.5);
  outline.lineTo(0.5, 0);
  outline.lineTo(-0.5, 0.5);
  outline.closePath();
  const geometry = new THREE.ExtrudeGeometry(outline, {
    depth: 1,
    bevelEnabled: false,
  });
  geometry.translate(0, 0, -0.5);
  geometry.rotateY(-Math.PI / 2);
  return geometry;
}

/** Capsule whose rounded ends stay round however tall it is, sized in metres. */
function capsuleGeometry(
  width: number,
  height: number,
  depth: number,
): THREE.BufferGeometry {
  const radius = Math.min(width, depth, height) / 2;
  const geometry = new THREE.CapsuleGeometry(
    radius,
    Math.max(0, height - radius * 2),
    10,
    28,
  );
  return geometry;
}

/**
 * Builds a sculpted shape filling the unit cube around the origin, facing +Z, so the
 * caller scales it to width, height and depth. Capsules are the exception and come out
 * at real size, because stretching would squash their rounded ends.
 */
export function shapeGeometry(
  kind: string,
  width: number,
  height: number,
  depth: number,
): THREE.BufferGeometry {
  switch (kind) {
    case "sphere":
      return new THREE.SphereGeometry(0.5, 36, 24);
    case "hemisphere": {
      const profile = [new THREE.Vector2(0.0001, -0.5)];
      for (let i = 0; i <= 16; i++) {
        const a = (i / 16) * (Math.PI / 2);
        profile.push(
          new THREE.Vector2(
            Math.max(0.0001, Math.cos(a) * 0.5),
            Math.sin(a) - 0.5,
          ),
        );
      }
      return new THREE.LatheGeometry(profile, 36);
    }
    case "capsule":
      return capsuleGeometry(width, height, depth);
    case "cylinder":
      return new THREE.CylinderGeometry(0.5, 0.5, 1, 36);
    case "cone":
      return new THREE.ConeGeometry(0.5, 1, 36);
    case "box":
      return new THREE.BoxGeometry(1, 1, 1);
    case "torus":
      return fitUnitCube(
        new THREE.TorusGeometry(0.375, 0.125, 18, 56).rotateX(Math.PI / 2),
      );
    case "wedge":
      return wedgeGeometry();
    case "star":
      return fitUnitCube(extrudeOutline(starOutline()));
    case "heart":
      return fitUnitCube(extrudeOutline(heartOutline()));
    default:
      return fitUnitCube(
        new THREE.TorusGeometry(0.4, 0.09, 12, 32, Math.PI).rotateZ(Math.PI),
      );
  }
}
