import {
  AdditiveBlending,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Points,
  PointsMaterial,
  Vector3,
} from "three";

interface VaporEntry {
  readonly points: Points<BufferGeometry, PointsMaterial>;
  readonly velocities: Float32Array;
  elapsedMs: number;
  durationMs: number;
}

const PARTICLES = 20;

export class VaporPool extends Group {
  private readonly entries: readonly VaporEntry[];
  private nextIndex = 0;

  constructor(size = 18) {
    super();
    this.name = "vapor-pool";
    this.renderOrder = 25;
    this.entries = Array.from({ length: size }, (_, index) => this.createEntry(index));
  }

  burst(origin: Vector3, color: number): void {
    const entry = this.entries[this.nextIndex];
    if (!entry) return;
    this.nextIndex = (this.nextIndex + 1) % this.entries.length;
    const position = entry.points.geometry.getAttribute("position") as Float32BufferAttribute;
    for (let particle = 0; particle < PARTICLES; particle += 1) {
      position.setXYZ(particle, 0, 0, 0);
    }
    position.needsUpdate = true;
    entry.points.position.copy(origin);
    entry.points.visible = true;
    entry.points.material.color.setHex(color);
    entry.points.material.opacity = 0.92;
    entry.points.scale.setScalar(1);
    entry.elapsedMs = 0;
    entry.durationMs = 720;
  }

  update(deltaMs: number): void {
    const seconds = deltaMs / 1_000;
    for (const entry of this.entries) {
      if (!entry.points.visible) continue;
      entry.elapsedMs += deltaMs;
      const life = Math.max(0, 1 - entry.elapsedMs / entry.durationMs);
      const position = entry.points.geometry.getAttribute("position") as Float32BufferAttribute;
      for (let particle = 0; particle < PARTICLES; particle += 1) {
        const offset = particle * 3;
        const vx = entry.velocities[offset] ?? 0;
        const vy = entry.velocities[offset + 1] ?? 0;
        const vz = entry.velocities[offset + 2] ?? 0;
        position.setXYZ(
          particle,
          position.getX(particle) + vx * seconds,
          position.getY(particle) + vy * seconds - 0.45 * seconds * seconds,
          position.getZ(particle) + vz * seconds,
        );
      }
      position.needsUpdate = true;
      entry.points.material.opacity = life * life * 0.92;
      if (life <= 0) entry.points.visible = false;
    }
  }

  dispose(): void {
    for (const entry of this.entries) {
      entry.points.geometry.dispose();
      entry.points.material.dispose();
    }
    this.clear();
  }

  private createEntry(seed: number): VaporEntry {
    const positions = new Float32Array(PARTICLES * 3);
    const velocities = new Float32Array(PARTICLES * 3);
    for (let particle = 0; particle < PARTICLES; particle += 1) {
      const angle = particle / PARTICLES * Math.PI * 2 + seed * 0.37;
      const lift = 0.45 + ((particle * 17 + seed * 11) % 13) / 13 * 1.7;
      const speed = 0.7 + ((particle * 7 + seed * 3) % 9) / 9 * 1.5;
      velocities[particle * 3] = Math.cos(angle) * speed;
      velocities[particle * 3 + 1] = lift;
      velocities[particle * 3 + 2] = Math.sin(angle) * speed;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    const material = new PointsMaterial({
      color: 0xffffff,
      size: 0.19,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
      blending: AdditiveBlending,
    });
    const points = new Points(geometry, material);
    points.visible = false;
    points.frustumCulled = false;
    this.add(points);
    return { points, velocities, elapsedMs: 0, durationMs: 1 };
  }
}
