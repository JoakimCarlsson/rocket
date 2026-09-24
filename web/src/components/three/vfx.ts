import * as THREE from "three";
import { fbm } from "./noise";

/** Direction the sunlight comes from, shared by the light, the sky and every lit effect. */
export const SUN_DIRECTION = new THREE.Vector3(-300, 200, 200).normalize();

const PUFF_SIZE = 128;
let puffCache: THREE.DataTexture | null = null;

/** Small deterministic random generator so the baked puff looks the same every load. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

/**
 * Bakes a billowing cloud puff: soft metaballs roughened with fractal noise.
 * The surface normal of the resulting density field is stored in RGB and the
 * density in alpha, so flat billboards can be lit as if they were round,
 * lumpy volumes.
 */
export function puffTexture(): THREE.DataTexture {
  if (puffCache) return puffCache;
  const random = seeded(7);
  const blobs = Array.from({ length: 18 }, (_, i) => {
    const angle = random() * Math.PI * 2;
    const reach = i === 0 ? 0 : Math.sqrt(random()) * 0.3;
    return {
      x: Math.cos(angle) * reach,
      y: Math.sin(angle) * reach,
      r: i === 0 ? 0.36 : 0.12 + random() * 0.14,
    };
  });
  const density = new Float32Array(PUFF_SIZE * PUFF_SIZE);
  for (let py = 0; py < PUFF_SIZE; py++)
    for (let px = 0; px < PUFF_SIZE; px++) {
      const x = (px + 0.5) / PUFF_SIZE - 0.5;
      const y = (py + 0.5) / PUFF_SIZE - 0.5;
      let d = 0;
      for (const b of blobs) {
        const f = 1 - ((x - b.x) ** 2 + (y - b.y) ** 2) / (b.r * b.r);
        if (f > 0) d += f * f;
      }
      const grain = fbm(px / 24, py / 24, 3, 3);
      const edge = 1 - THREE.MathUtils.smoothstep(Math.hypot(x, y), 0.34, 0.5);
      density[py * PUFF_SIZE + px] = d * (0.7 + grain * 0.6) * edge;
    }
  const at = (x: number, y: number) =>
    density[
      Math.min(PUFF_SIZE - 1, Math.max(0, y)) * PUFF_SIZE +
        Math.min(PUFF_SIZE - 1, Math.max(0, x))
    ];
  const data = new Uint8Array(PUFF_SIZE * PUFF_SIZE * 4);
  const normal = new THREE.Vector3();
  for (let py = 0; py < PUFF_SIZE; py++)
    for (let px = 0; px < PUFF_SIZE; px++) {
      const dx = at(px + 3, py) - at(px - 3, py);
      const dy = at(px, py + 3) - at(px, py - 3);
      normal.set(-dx * 2.5, -dy * 2.5, 1).normalize();
      const o = (py * PUFF_SIZE + px) * 4;
      data[o] = (normal.x * 0.5 + 0.5) * 255;
      data[o + 1] = (normal.y * 0.5 + 0.5) * 255;
      data[o + 2] = (normal.z * 0.5 + 0.5) * 255;
      data[o + 3] = THREE.MathUtils.smoothstep(at(px, py), 0.05, 0.9) * 255;
    }
  const texture = new THREE.DataTexture(data, PUFF_SIZE, PUFF_SIZE);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  puffCache = texture;
  return texture;
}

const BILLBOARD_VERTEX = /* glsl */ `
  attribute float aFade;
  attribute float aSeed;
  uniform float uSpread;
  varying vec2 vUv;
  varying float vFade;
  varying float vSeed;
  varying float vAngle;
  varying vec3 vColor;
  varying vec3 vCenter;
  #include <fog_pars_vertex>
  void main() {
    vec4 center = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float size = length(instanceMatrix[0].xyz);
    float angle = aSeed * 6.2831853 + aFade * (fract(aSeed * 7.31) - 0.5) * 2.5;
    vec2 turn = vec2(cos(angle), sin(angle));
    vec2 corner = mat2(turn.x, turn.y, -turn.y, turn.x) * position.xy;
    vec4 mvPosition = center + vec4(corner * size * uSpread, 0.0, 0.0);
    vUv = uv;
    vFade = aFade;
    vSeed = aSeed;
    vAngle = angle;
    #ifdef USE_INSTANCING_COLOR
      vColor = instanceColor;
    #else
      vColor = vec3(1.0);
    #endif
    vCenter = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const SMOKE_FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uSun;
  uniform vec3 uUp;
  uniform vec3 uSunColor;
  uniform vec3 uSkyColor;
  uniform vec3 uGroundColor;
  uniform vec3 uGlowPosition;
  uniform vec3 uGlowColor;
  uniform float uGlowRange;
  uniform float uOpacity;
  uniform float uErode;
  uniform vec3 uHaze;
  uniform float uHazeRange;
  varying vec2 vUv;
  varying float vFade;
  varying float vSeed;
  varying float vAngle;
  varying vec3 vColor;
  varying vec3 vCenter;
  #include <fog_pars_fragment>
  void main() {
    vec4 puff = texture2D(uMap, vUv);
    float erosion = vFade * uErode;
    float density = smoothstep(erosion, erosion + 0.35, puff.a);
    float alpha = density * uOpacity * smoothstep(0.0, 0.06, vFade) * (1.0 - smoothstep(0.55, 1.0, vFade));
    if (alpha < 0.004) discard;
    vec3 local = puff.rgb * 2.0 - 1.0;
    float c = cos(vAngle);
    float s = sin(vAngle);
    vec3 normalView = normalize(vec3(c * local.x - s * local.y, s * local.x + c * local.y, local.z));
    vec3 sunView = normalize((viewMatrix * vec4(uSun, 0.0)).xyz);
    vec3 upView = normalize((viewMatrix * vec4(uUp, 0.0)).xyz);
    float wrap = clamp(dot(normalView, sunView) * 0.55 + 0.45, 0.0, 1.0);
    float rim = pow(1.0 - clamp(local.z, 0.0, 1.0), 3.0) * clamp(0.5 - sunView.z * 0.5, 0.0, 1.0);
    float sky = dot(normalView, upView) * 0.5 + 0.5;
    vec3 ambient = mix(uGroundColor, uSkyColor, sky);
    float glowDistance = distance(vCenter, uGlowPosition) / uGlowRange;
    vec3 glow = uGlowColor / (1.0 + glowDistance * glowDistance * 6.0);
    vec3 color = vColor * (ambient + uSunColor * (wrap * wrap + rim * 1.2) + glow);
    if (uHazeRange > 0.0)
      color = mix(color, uHaze, 1.0 - exp(-distance(vCenter, cameraPosition) / uHazeRange));
    gl_FragColor = vec4(color, alpha);
    #include <fog_fragment>
  }
`;

const GLOW_FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uIntensity;
  varying vec2 vUv;
  varying float vFade;
  varying vec3 vColor;
  void main() {
    float radial = 1.0 - smoothstep(0.0, 0.5, length(vUv - 0.5));
    float puff = texture2D(uMap, vUv).a;
    float heat = pow(radial, 1.6) * mix(1.0, puff, 0.5) * (1.0 - vFade * vFade);
    if (heat < 0.002) discard;
    gl_FragColor = vec4(vColor * heat * uIntensity, 1.0);
  }
`;

/** Options for lit smoke. */
export interface SmokeOptions {
  opacity: number;
  spread?: number;
  erode?: number;
}

/**
 * Soft, lit smoke for billboard particles: each puff is shaded by the sun
 * with wrap lighting and a back-lit rim, by sky and ground bounce, and by a
 * point glow such as the engine flame, then eroded into wisps as it ages.
 */
export function smokeMaterial({
  opacity,
  spread = 1.7,
  erode = 0.55,
}: SmokeOptions): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uSun: { value: SUN_DIRECTION.clone() },
        uUp: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(1.5, 1.05, 0.72) },
        uSkyColor: { value: new THREE.Color(0.36, 0.42, 0.56) },
        uGroundColor: { value: new THREE.Color(0.22, 0.17, 0.13) },
        uGlowPosition: { value: new THREE.Vector3() },
        uGlowColor: { value: new THREE.Color(0, 0, 0) },
        uGlowRange: { value: 60 },
        uOpacity: { value: opacity },
        uErode: { value: erode },
        uSpread: { value: spread },
        uHaze: { value: new THREE.Color(0, 0, 0) },
        uHazeRange: { value: 0 },
      },
    ]),
    vertexShader: BILLBOARD_VERTEX,
    fragmentShader: SMOKE_FRAGMENT,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  material.uniforms.uMap = { value: puffTexture() };
  return material;
}

/** Hot, additive glowing billboards for flame, sparks and fireballs, bright enough to bloom. */
export function glowMaterial(intensity = 1): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: puffTexture() },
      uIntensity: { value: intensity },
      uSpread: { value: 1.3 },
    },
    vertexShader: BILLBOARD_VERTEX,
    fragmentShader: GLOW_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

const FLAME_VERTEX = /* glsl */ `
  varying float vAlong;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vAlong = -position.y;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

const FLAME_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uCore;
  uniform float uIntensity;
  uniform float uAir;
  uniform float uTime;
  varying float vAlong;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float facing = abs(dot(normalize(vNormal), normalize(vView)));
    float body = pow(facing, 1.8);
    float tail = pow(clamp(1.0 - vAlong, 0.0, 1.0), 1.3);
    float flicker = 0.88 + 0.12 * sin(uTime * 71.0 + vAlong * 23.0) * sin(uTime * 43.0 - vAlong * 9.0);
    float diamonds = uAir * pow(0.5 + 0.5 * cos(vAlong * 6.2831853 * 3.5), 10.0) * smoothstep(0.02, 0.12, vAlong) * (1.0 - vAlong);
    vec3 color = mix(uCore, uColor, smoothstep(0.0, 0.4, vAlong)) * tail;
    color += uCore * diamonds * 1.6;
    gl_FragColor = vec4(color * body * flicker * uIntensity, 1.0);
  }
`;

/**
 * An additive rocket plume for an open cone hanging under a nozzle: white-hot
 * at the throat, fading into the engine's glow colour, with shock diamonds
 * that show while there is air to form them.
 */
export function flameMaterial(
  color: THREE.Color,
  core: THREE.Color,
  intensity: number,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: color.clone() },
      uCore: { value: core.clone() },
      uIntensity: { value: intensity },
      uAir: { value: 1 },
      uTime: { value: 0 },
    },
    vertexShader: FLAME_VERTEX,
    fragmentShader: FLAME_FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}
