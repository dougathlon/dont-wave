import {
  AdditiveBlending,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from "three";

interface BeamEntry {
  readonly group: Group;
  readonly shaft: Mesh<CylinderGeometry, MeshBasicMaterial>;
  readonly impact: Mesh<SphereGeometry, MeshBasicMaterial>;
  elapsedMs: number;
  durationMs: number;
}

const UP = new Vector3(0, 1, 0);

/** Small bounded presentation pool. Beam hits never determine simulation outcomes. */
export class BeamPool extends Group {
  private readonly shaftGeometry = new CylinderGeometry(1, 1, 1, 6, 1, true);
  private readonly impactGeometry = new SphereGeometry(1, 7, 5);
  private readonly entries: readonly BeamEntry[];
  private nextIndex = 0;

  constructor(size = 18) {
    super();
    this.name = "beam-pool";
    this.renderOrder = 30;
    this.entries = Array.from({ length: size }, () => this.createEntry());
  }

  fire(origin: Vector3, target: Vector3, color: number, width = 0.055, durationMs = 260): void {
    const entry = this.entries[this.nextIndex];
    if (!entry) return;
    this.nextIndex = (this.nextIndex + 1) % this.entries.length;

    const direction = target.clone().sub(origin);
    const length = direction.length();
    if (length < 0.001) return;

    entry.elapsedMs = 0;
    entry.durationMs = Math.max(1, durationMs);
    entry.group.visible = true;
    entry.impact.visible = true;
    entry.group.position.copy(origin).addScaledVector(direction, 0.5);
    entry.group.quaternion.copy(new Quaternion().setFromUnitVectors(UP, direction.normalize()));
    entry.shaft.scale.set(width, length, width);
    entry.shaft.material.color.setHex(color);
    entry.shaft.material.opacity = 0.94;

    entry.impact.position.copy(target);
    entry.impact.scale.setScalar(width * 7.2);
    entry.impact.material.color.setHex(color);
    entry.impact.material.opacity = 0.8;
  }

  update(deltaMs: number): void {
    for (const entry of this.entries) {
      if (!entry.group.visible) continue;
      entry.elapsedMs += deltaMs;
      const remaining = Math.max(0, 1 - entry.elapsedMs / entry.durationMs);
      entry.shaft.material.opacity = remaining * 0.94;
      entry.impact.material.opacity = remaining * remaining * 0.8;
      entry.impact.scale.multiplyScalar(1 + deltaMs * 0.0025);
      if (remaining <= 0) {
        entry.group.visible = false;
        entry.impact.visible = false;
      }
    }
  }

  dispose(): void {
    this.shaftGeometry.dispose();
    this.impactGeometry.dispose();
    for (const entry of this.entries) {
      entry.shaft.material.dispose();
      entry.impact.material.dispose();
    }
    this.clear();
  }

  private createEntry(): BeamEntry {
    const shaftMaterial = new MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      blending: AdditiveBlending,
    });
    const impactMaterial = shaftMaterial.clone();
    const shaft = new Mesh(this.shaftGeometry, shaftMaterial);
    shaft.renderOrder = 30;
    const impact = new Mesh(this.impactGeometry, impactMaterial);
    impact.renderOrder = 31;
    impact.visible = false;
    const group = new Group();
    group.visible = false;
    group.add(shaft);
    // Impact stays a sibling because its position is already in world coordinates.
    this.add(group, impact);
    return { group, shaft, impact, elapsedMs: 0, durationMs: 1 };
  }
}
