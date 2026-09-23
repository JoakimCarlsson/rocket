import * as THREE from "three";

/** Options for one spawned particle. */
export interface SpawnOptions {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  size: number;
  growth: number;
  from: THREE.Color;
  to: THREE.Color;
}

/**
 * Fixed-capacity instanced particle pool. Particles grow, drift, fade their colour
 * toward an end colour and are recycled; no allocations happen per frame.
 */
export class ParticleField {
  readonly mesh: THREE.InstancedMesh;
  private readonly capacity: number;
  private readonly position: Float32Array;
  private readonly velocity: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly size: Float32Array;
  private readonly growth: Float32Array;
  private readonly from: Float32Array;
  private readonly to: Float32Array;
  private cursor = 0;
  private readonly matrix = new THREE.Matrix4();
  private readonly color = new THREE.Color();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly point = new THREE.Vector3();

  /** Creates a pool drawing `capacity` instances of the geometry with the material. */
  constructor(capacity: number, geometry: THREE.BufferGeometry, material: THREE.Material) {
    this.capacity = capacity;
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.position = new Float32Array(capacity * 3);
    this.velocity = new Float32Array(capacity * 3);
    this.age = new Float32Array(capacity).fill(1);
    this.life = new Float32Array(capacity).fill(1);
    this.size = new Float32Array(capacity);
    this.growth = new Float32Array(capacity);
    this.from = new Float32Array(capacity * 3);
    this.to = new Float32Array(capacity * 3);
    this.matrix.makeScale(0, 0, 0);
    for (let i = 0; i < capacity; i++) this.mesh.setMatrixAt(i, this.matrix);
  }

  /** Spawns one particle, overwriting the oldest slot when full. */
  spawn(options: SpawnOptions): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.position.set([options.position.x, options.position.y, options.position.z], i * 3);
    this.velocity.set([options.velocity.x, options.velocity.y, options.velocity.z], i * 3);
    this.from.set([options.from.r, options.from.g, options.from.b], i * 3);
    this.to.set([options.to.r, options.to.g, options.to.b], i * 3);
    this.age[i] = 0;
    this.life[i] = options.life;
    this.size[i] = options.size;
    this.growth[i] = options.growth;
  }

  /** Advances every live particle. Particles below `ground` spread out along it like billowing smoke. */
  update(dt: number, drag: number, buoyancy: number, ground: number): void {
    const damping = Math.max(0, 1 - drag * dt);
    for (let i = 0; i < this.capacity; i++) {
      if (this.age[i] >= this.life[i]) continue;
      this.age[i] += dt;
      const t = Math.min(1, this.age[i] / this.life[i]);
      const o = i * 3;
      this.velocity[o] *= damping;
      this.velocity[o + 1] = this.velocity[o + 1] * damping + buoyancy * dt;
      this.velocity[o + 2] *= damping;
      this.position[o] += this.velocity[o] * dt;
      this.position[o + 1] += this.velocity[o + 1] * dt;
      this.position[o + 2] += this.velocity[o + 2] * dt;
      if (this.position[o + 1] < ground) {
        this.position[o + 1] = ground;
        const spread = Math.abs(this.velocity[o + 1]) * 0.8;
        const len = Math.hypot(this.velocity[o], this.velocity[o + 2]) || 1;
        this.velocity[o] += (this.velocity[o] / len) * spread;
        this.velocity[o + 2] += (this.velocity[o + 2] / len) * spread;
        this.velocity[o + 1] = Math.abs(this.velocity[o + 1]) * 0.15;
      }
      const s = t >= 1 ? 0 : (this.size[i] + this.growth[i] * t) * (t > 0.8 ? (1 - t) / 0.2 : 1);
      this.point.set(this.position[o], this.position[o + 1], this.position[o + 2]);
      this.scale.setScalar(Math.max(0, s));
      this.matrix.compose(this.point, this.quaternion, this.scale);
      this.mesh.setMatrixAt(i, this.matrix);
      this.color.setRGB(
        this.from[o] + (this.to[o] - this.from[o]) * t,
        this.from[o + 1] + (this.to[o + 1] - this.from[o + 1]) * t,
        this.from[o + 2] + (this.to[o + 2] - this.from[o + 2]) * t,
      );
      this.mesh.setColorAt(i, this.color);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Releases GPU resources. */
  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}
