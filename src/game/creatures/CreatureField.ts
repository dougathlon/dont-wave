import {
  BoxGeometry,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
} from "three";
import type { CreatureRuntimeState } from "../../simulation/types";
import { creatureZAtProgress } from "../../content/fieldLayout";
import { clamp01, hashUnit, PALETTE, stableHash, WORLD } from "../constants";

type BodyShape = "bean" | "gourd" | "orb" | "slug";

interface RenderTraits {
  readonly bodyShape: BodyShape;
  readonly bodyColor: number;
  readonly accentColor: number;
  readonly eyeCount: 1 | 2 | 3;
  readonly eyeScale: number;
  readonly earStyle: "antennae" | "droop" | "fan" | "horns";
  readonly marking: "belly" | "freckles" | "stripe" | "patch";
  readonly widthScale: number;
  readonly heightScale: number;
  readonly lean: number;
  readonly leftHanded: boolean;
}

type RenderCreature = CreatureRuntimeState & { readonly zappedBy?: unknown };

interface CreatureSlot {
  readonly id: string;
  readonly index: number;
  readonly row: number;
  readonly column: number;
  readonly phase: number;
  readonly traits: RenderTraits;
  readonly bodyShape: BodyShape;
  readonly bodyKey: string;
  readonly bodyInstance: number;
  readonly armBase: number;
  readonly accentBase: number;
  readonly accentInstance: number;
}

export interface ZapPresentation {
  readonly creatureId: string;
  readonly zappedBy: string;
  readonly position: Vector3;
}

const UP = new Vector3(0, 1, 0);
const HIDDEN_SCALE = new Vector3(0.0001, 0.0001, 0.0001);

/**
 * Instanced visual adapter for the stable population. It reads snapshots and
 * owns no movement, target validity, score, or death decisions.
 */
export class CreatureField extends Group {
  readonly pickTargets: InstancedMesh<BoxGeometry, MeshBasicMaterial>;
  private readonly slots: readonly CreatureSlot[];
  private readonly slotById = new Map<string, CreatureSlot>();
  private readonly idByInstance: readonly string[];
  private readonly latestById = new Map<string, RenderCreature>();
  private readonly bodyMeshes = new Map<string, InstancedMesh<BufferGeometry, MeshBasicMaterial>>();
  private readonly armMeshes = new Map<number, InstancedMesh<CylinderGeometry, MeshBasicMaterial>>();
  private readonly feetMeshes = new Map<number, InstancedMesh<SphereGeometry, MeshBasicMaterial>>();
  private readonly earMeshes = new Map<number, InstancedMesh<ConeGeometry, MeshBasicMaterial>>();
  private readonly markingMeshes = new Map<number, InstancedMesh<SphereGeometry, MeshBasicMaterial>>();
  private readonly eyes: InstancedMesh<SphereGeometry, MeshBasicMaterial>;
  private readonly pupils: InstancedMesh<SphereGeometry, MeshBasicMaterial>;
  private readonly focusRing: Mesh<TorusGeometry, MeshBasicMaterial>;
  private readonly deathStartedAt = new Map<string, number>();
  private readonly previousZappedBy = new Map<string, string | null>();
  private readonly ownedGeometries = new Set<BufferGeometry>();
  private readonly ownedMaterials = new Set<Material>();
  private readonly paletteMaterials = new Map<number, MeshBasicMaterial>();
  private readonly dummy = new Object3D();
  private readonly start = new Vector3();
  private readonly end = new Vector3();
  private readonly midpoint = new Vector3();
  private readonly direction = new Vector3();
  private focusedCreatureId: string | null = null;

  constructor(creatures: readonly CreatureRuntimeState[]) {
    super();
    this.name = "creature-field";

    const shapes = creatures.map((creature) => readTraits(creature));
    const bodyCounts = new Map<string, number>();
    const bodyColorCounts = new Map<number, number>();
    const accentCounts = new Map<number, number>();
    const slots = creatures.map((creature, index): CreatureSlot => {
      const traits = shapes[index] ?? fallbackTraits(creature.id);
      const bodyKey = `${traits.bodyShape}:${traits.bodyColor.toString(16)}`;
      const bodyInstance = takeIndex(bodyCounts, bodyKey);
      const bodyColorIndex = takeIndex(bodyColorCounts, traits.bodyColor);
      const accentIndex = takeIndex(accentCounts, traits.accentColor);
      return {
        id: creature.id,
        index,
        row: Math.floor(index / WORLD.columns),
        column: index % WORLD.columns,
        phase: hashUnit(creature.id, 17) * Math.PI * 2,
        traits,
        bodyShape: traits.bodyShape,
        bodyKey,
        bodyInstance,
        armBase: bodyColorIndex * 2,
        accentBase: accentIndex * 2,
        accentInstance: accentIndex,
      };
    });
    this.slots = slots;
    this.idByInstance = slots.map((slot) => slot.id);
    for (const slot of slots) this.slotById.set(slot.id, slot);
    for (const creature of creatures) this.latestById.set(creature.id, creature as RenderCreature);

    const bodyGeometries: Record<BodyShape, BufferGeometry> = {
      bean: new CapsuleGeometry(0.47, 0.74, 3, 7),
      gourd: new SphereGeometry(0.72, 7, 5),
      orb: new SphereGeometry(0.7, 8, 6),
      slug: new CapsuleGeometry(0.44, 0.56, 2, 7),
    };
    for (const geometry of Object.values(bodyGeometries)) this.ownedGeometries.add(geometry);
    for (const [key, count] of bodyCounts) {
      const [shapePart, colorPart] = key.split(":");
      const shape = isBodyShape(shapePart) ? shapePart : "bean";
      const color = Number.parseInt(colorPart ?? "f0d49a", 16);
      const mesh = this.instanced(bodyGeometries[shape], this.paletteMaterial(color), count);
      this.bodyMeshes.set(key, mesh);
      this.add(mesh);
    }

    const armGeometry = new CylinderGeometry(0.075, 0.095, 1, 5);
    for (const [color, count] of bodyColorCounts) {
      const mesh = this.instanced(armGeometry, this.paletteMaterial(color), count * 2);
      this.armMeshes.set(color, mesh);
      this.add(mesh);
    }
    const feetGeometry = new SphereGeometry(0.22, 6, 4);
    const earGeometry = new ConeGeometry(0.18, 0.55, 5);
    const markingGeometry = new SphereGeometry(0.25, 7, 5);
    for (const [color, count] of accentCounts) {
      const material = this.paletteMaterial(color);
      const feet = this.instanced(feetGeometry, material, count * 2);
      const ears = this.instanced(earGeometry, material, count * 2);
      const markings = this.instanced(markingGeometry, material, count);
      this.feetMeshes.set(color, feet);
      this.earMeshes.set(color, ears);
      this.markingMeshes.set(color, markings);
      this.add(feet, ears, markings);
    }
    this.eyes = this.instanced(
      new SphereGeometry(0.16, 7, 5),
      this.paletteMaterial(PALETTE.cream.getHex()),
      creatures.length * 3,
    );
    this.pupils = this.instanced(
      new SphereGeometry(0.075, 6, 4),
      this.paletteMaterial(PALETTE.ink.getHex()),
      creatures.length * 3,
    );
    this.add(this.eyes, this.pupils);

    const pickMaterial = new MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      colorWrite: false,
      toneMapped: false,
    });
    this.ownedMaterials.add(pickMaterial);
    const pickGeometry = new BoxGeometry(1.45, 2.5, 1.25);
    this.ownedGeometries.add(pickGeometry);
    this.pickTargets = new InstancedMesh(pickGeometry, pickMaterial, creatures.length);
    this.pickTargets.name = "creature-pick-targets";
    this.pickTargets.frustumCulled = false;
    this.add(this.pickTargets);

    const focusMaterial = new MeshBasicMaterial({
      color: PALETTE.cream,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
      toneMapped: false,
    });
    this.ownedMaterials.add(focusMaterial);
    const focusGeometry = new TorusGeometry(0.8, 0.035, 5, 24);
    this.ownedGeometries.add(focusGeometry);
    this.focusRing = new Mesh(focusGeometry, focusMaterial);
    this.focusRing.visible = false;
    this.focusRing.rotation.x = -Math.PI / 2;
    this.focusRing.renderOrder = 15;
    this.add(this.focusRing);

    this.sync(creatures, 0, true);
  }

  sync(creatures: readonly CreatureRuntimeState[], elapsedMs: number, reducedMotion: boolean): readonly ZapPresentation[] {
    const newZaps: ZapPresentation[] = [];
    for (const creature of creatures) this.latestById.set(creature.id, creature as RenderCreature);

    for (const slot of this.slots) {
      const creature = this.latestById.get(slot.id);
      if (!creature) {
        this.hideSlot(slot);
        continue;
      }
      const zappedBy = normalizedZappedBy(creature);
      const previousZappedBy = this.previousZappedBy.get(slot.id) ?? null;
      if (zappedBy !== null && previousZappedBy === null) {
        this.deathStartedAt.set(slot.id, elapsedMs);
        newZaps.push({ creatureId: slot.id, zappedBy, position: this.positionFor(creature, slot) });
      }
      if (zappedBy === null) this.deathStartedAt.delete(slot.id);
      this.previousZappedBy.set(slot.id, zappedBy);
      this.updateSlot(slot, creature, elapsedMs, reducedMotion);
    }

    this.markMatricesDirty();
    this.syncFocusRing();
    return newZaps;
  }

  setFocused(creatureId: string | null): void {
    this.focusedCreatureId = creatureId !== null && this.slotById.has(creatureId) ? creatureId : null;
    this.syncFocusRing();
  }

  creatureIdForInstance(instanceId: number | undefined): string | null {
    if (instanceId === undefined || !Number.isInteger(instanceId)) return null;
    return this.idByInstance[instanceId] ?? null;
  }

  creatureAt(id: string): CreatureRuntimeState | null {
    return this.latestById.get(id) ?? null;
  }

  getCreatureCenter(id: string, target = new Vector3()): Vector3 | null {
    const slot = this.slotById.get(id);
    const creature = this.latestById.get(id);
    if (!slot || !creature) return null;
    target.copy(this.positionFor(creature, slot));
    target.y += 1.08;
    return target;
  }

  dispose(): void {
    for (const geometry of this.ownedGeometries) geometry.dispose();
    for (const material of this.ownedMaterials) material.dispose();
    this.ownedGeometries.clear();
    this.ownedMaterials.clear();
    this.latestById.clear();
    this.deathStartedAt.clear();
    this.previousZappedBy.clear();
    this.clear();
  }

  private updateSlot(slot: CreatureSlot, creature: RenderCreature, elapsedMs: number, reducedMotion: boolean): void {
    const base = this.positionFor(creature, slot);
    const moving = String(creature.pose) === "moving";
    const waving = String(creature.pose) === "waving";
    const zapped = normalizedZappedBy(creature) !== null || isResolvedStatus(creature.status);
    const deathStarted = this.deathStartedAt.get(slot.id);
    const deathAge = deathStarted === undefined ? 0 : Math.max(0, elapsedMs - deathStarted);
    const deathScale = zapped
      ? reducedMotion ? 0 : 1 - clamp01(deathAge / 470)
      : 1;
    const bob = moving && !reducedMotion ? Math.sin(elapsedMs * 0.008 + slot.phase) * 0.08 : 0;
    const gait = moving && !reducedMotion ? Math.sin(elapsedMs * 0.011 + slot.phase) : 0;
    const wave = waving && !reducedMotion ? Math.sin(elapsedMs * 0.022 + slot.phase) : 0;
    const width = slot.traits.widthScale;
    const height = slot.traits.heightScale;
    const lean = slot.traits.lean * Math.PI / 180;
    const bodyCenter = base.clone().add(new Vector3(0, 1.05 + bob, 0));
    const bodyScale = bodyScaleFor(slot.bodyShape, width, height).multiplyScalar(Math.max(0.0001, deathScale));
    const bodyMesh = requiredMesh(this.bodyMeshes, slot.bodyKey);
    const armMesh = requiredMesh(this.armMeshes, slot.traits.bodyColor);
    const feetMesh = requiredMesh(this.feetMeshes, slot.traits.accentColor);
    const earMesh = requiredMesh(this.earMeshes, slot.traits.accentColor);
    const markingMesh = requiredMesh(this.markingMeshes, slot.traits.accentColor);
    this.setTransform(bodyMesh, slot.bodyInstance, bodyCenter, 0, 0, lean, bodyScale);

    const shoulderY = bodyCenter.y + 0.28 * height;
    const sideX = 0.46 * width;
    const isLeftWave = waving && slot.traits.leftHanded;
    const isRightWave = waving && !slot.traits.leftHanded;
    this.placeArm(armMesh, slot.armBase, base, -sideX, shoulderY, isLeftWave, gait, wave, -1, deathScale);
    this.placeArm(armMesh, slot.armBase + 1, base, sideX, shoulderY, isRightWave, gait, wave, 1, deathScale);

    for (let foot = 0; foot < 2; foot += 1) {
      const side = foot === 0 ? -1 : 1;
      this.start.set(
        base.x + side * 0.27 * width + gait * side * 0.08,
        base.y + 0.18 + bob,
        base.z + 0.08 - gait * side * 0.09,
      );
      this.setTransform(
        feetMesh,
        slot.accentBase + foot,
        this.start,
        0,
        side * 0.16,
        0,
        new Vector3(1.15 * width, 0.7, 1.65).multiplyScalar(Math.max(0.0001, deathScale)),
      );
    }

    const eyeCount = slot.traits.eyeCount;
    for (let eye = 0; eye < 3; eye += 1) {
      const eyeIndex = slot.index * 3 + eye;
      if (eye >= eyeCount || deathScale <= 0) {
        this.hideInstance(this.eyes, eyeIndex);
        this.hideInstance(this.pupils, eyeIndex);
        continue;
      }
      const eyeOffset = eyeCount === 1 ? 0 : eyeCount === 2 ? (eye - 0.5) * 0.36 : (eye - 1) * 0.31;
      const mismatch = eye === eyeCount - 1 ? 0.82 : 1;
      const radius = slot.traits.eyeScale * mismatch;
      this.start.set(base.x + eyeOffset * width, bodyCenter.y + 0.22 * height + (eye % 2) * 0.035, base.z + 0.48);
      this.setTransform(this.eyes, eyeIndex, this.start, 0, 0, 0, new Vector3(radius, radius * 1.08, 0.76 * radius).multiplyScalar(deathScale));
      this.start.z += 0.125 * radius;
      this.start.x += slot.traits.leftHanded ? -0.025 : 0.025;
      this.setTransform(this.pupils, eyeIndex, this.start, 0, 0, 0, new Vector3(0.74, 0.78, 0.55).multiplyScalar(deathScale));
    }

    this.placeEars(earMesh, slot, base, bodyCenter, deathScale);
    this.start.set(base.x + markingOffset(slot.traits.marking), bodyCenter.y - 0.16, base.z + 0.5);
    this.setTransform(
      markingMesh,
      slot.accentInstance,
      this.start,
      0,
      0,
      slot.traits.marking === "stripe" ? 0.18 : -0.2,
      markingScale(slot.traits.marking, width, height).multiplyScalar(Math.max(0.0001, deathScale)),
    );
    // Pick proxies never inherit visual size; every creature is equally targetable.
    this.setTransform(
      this.pickTargets,
      slot.index,
      new Vector3(base.x, base.y + 1.15, base.z),
      0,
      0,
      0,
      deathScale <= 0 ? HIDDEN_SCALE : new Vector3(1, 1, 1),
    );
  }

  private placeArm(
    mesh: InstancedMesh,
    instance: number,
    base: Vector3,
    shoulderX: number,
    shoulderY: number,
    raised: boolean,
    gait: number,
    wave: number,
    side: -1 | 1,
    deathScale: number,
  ): void {
    this.start.set(base.x + shoulderX, shoulderY, base.z);
    if (raised) {
      this.end.set(base.x + shoulderX + side * (0.23 + wave * 0.16), shoulderY + 1.14, base.z + 0.02);
    } else {
      this.end.set(base.x + shoulderX + side * (0.22 + gait * 0.06), shoulderY - 0.75, base.z + gait * side * 0.12);
    }
    this.placeSegment(mesh, instance, this.start, this.end, Math.max(0.0001, deathScale));
  }

  private placeEars(
    mesh: InstancedMesh,
    slot: CreatureSlot,
    base: Vector3,
    bodyCenter: Vector3,
    deathScale: number,
  ): void {
    const style = slot.traits.earStyle;
    for (let ear = 0; ear < 2; ear += 1) {
      const side = ear === 0 ? -1 : 1;
      const index = slot.accentBase + ear;
      const scale = earScale(style).multiplyScalar(Math.max(0.0001, deathScale));
      this.start.set(
        base.x + side * 0.38 * slot.traits.widthScale,
        bodyCenter.y + 0.73 * slot.traits.heightScale,
        base.z + 0.02,
      );
      this.setTransform(mesh, index, this.start, 0.06 * side, 0, earRotation(style, side), scale);
    }
  }

  private positionFor(creature: RenderCreature, slot: CreatureSlot): Vector3 {
    const xStep = 2.18;
    const x = (slot.column - (WORLD.columns - 1) / 2) * xStep + (hashUnit(slot.id, 31) - 0.5) * 0.34;
    return new Vector3(x, 0, creatureZAtProgress(Number(creature.progress)));
  }

  private hideSlot(slot: CreatureSlot): void {
    const bodyMesh = requiredMesh(this.bodyMeshes, slot.bodyKey);
    const armMesh = requiredMesh(this.armMeshes, slot.traits.bodyColor);
    const feetMesh = requiredMesh(this.feetMeshes, slot.traits.accentColor);
    const earMesh = requiredMesh(this.earMeshes, slot.traits.accentColor);
    const markingMesh = requiredMesh(this.markingMeshes, slot.traits.accentColor);
    this.hideInstance(bodyMesh, slot.bodyInstance);
    for (let offset = 0; offset < 2; offset += 1) {
      this.hideInstance(armMesh, slot.armBase + offset);
      this.hideInstance(feetMesh, slot.accentBase + offset);
      this.hideInstance(earMesh, slot.accentBase + offset);
    }
    for (let offset = 0; offset < 3; offset += 1) {
      this.hideInstance(this.eyes, slot.index * 3 + offset);
      this.hideInstance(this.pupils, slot.index * 3 + offset);
    }
    this.hideInstance(markingMesh, slot.accentInstance);
    this.hideInstance(this.pickTargets, slot.index);
  }

  private hideInstance(mesh: InstancedMesh, index: number): void {
    this.setTransform(mesh, index, this.start.set(0, -200, 0), 0, 0, 0, HIDDEN_SCALE);
  }

  private placeSegment(
    mesh: InstancedMesh,
    index: number,
    start: Vector3,
    end: Vector3,
    scale: number,
  ): void {
    this.direction.copy(end).sub(start);
    const length = this.direction.length();
    this.midpoint.copy(start).add(end).multiplyScalar(0.5);
    this.dummy.position.copy(this.midpoint);
    this.dummy.quaternion.copy(new Quaternion().setFromUnitVectors(UP, this.direction.normalize()));
    this.dummy.scale.set(scale, length * scale, scale);
    this.dummy.updateMatrix();
    mesh.setMatrixAt(index, this.dummy.matrix);
  }

  private setTransform(
    mesh: InstancedMesh,
    index: number,
    position: Vector3,
    rotationX: number,
    rotationY: number,
    rotationZ: number,
    scale: Vector3,
  ): void {
    this.dummy.position.copy(position);
    this.dummy.rotation.set(rotationX, rotationY, rotationZ);
    this.dummy.quaternion.setFromEuler(this.dummy.rotation);
    this.dummy.scale.copy(scale);
    this.dummy.updateMatrix();
    mesh.setMatrixAt(index, this.dummy.matrix);
  }

  private syncFocusRing(): void {
    if (!this.focusedCreatureId) {
      this.focusRing.visible = false;
      return;
    }
    const center = this.getCreatureCenter(this.focusedCreatureId, this.start);
    if (!center) {
      this.focusRing.visible = false;
      return;
    }
    this.focusRing.visible = true;
    this.focusRing.position.set(center.x, 0.035, center.z);
  }

  private markMatricesDirty(): void {
    for (const mesh of [
      ...this.bodyMeshes.values(),
      ...this.armMeshes.values(),
      ...this.feetMeshes.values(),
      this.eyes,
      this.pupils,
      ...this.earMeshes.values(),
      ...this.markingMeshes.values(),
      this.pickTargets,
    ]) mesh.instanceMatrix.needsUpdate = true;
  }

  private instanced<G extends BufferGeometry, M extends Material>(geometry: G, material: M, count: number): InstancedMesh<G, M> {
    this.ownedGeometries.add(geometry);
    this.ownedMaterials.add(material);
    const mesh = new InstancedMesh(geometry, material, count);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    return mesh;
  }

  private paletteMaterial(color: number): MeshBasicMaterial {
    const existing = this.paletteMaterials.get(color);
    if (existing) return existing;
    const material = new MeshBasicMaterial({
      color,
      toneMapped: false,
      fog: false,
    });
    this.paletteMaterials.set(color, material);
    this.ownedMaterials.add(material);
    return material;
  }

}

function takeIndex<K>(counts: Map<K, number>, key: K): number {
  const index = counts.get(key) ?? 0;
  counts.set(key, index + 1);
  return index;
}

function requiredMesh<K, T extends InstancedMesh>(meshes: ReadonlyMap<K, T>, key: K): T {
  const mesh = meshes.get(key);
  if (!mesh) throw new Error(`Missing creature render batch for ${String(key)}.`);
  return mesh;
}

function readTraits(creature: CreatureRuntimeState): RenderTraits {
  const source = creature.visual as unknown as Record<string, unknown>;
  const fallback = fallbackTraits(creature.id);
  return {
    bodyShape: isBodyShape(source.bodyShape) ? source.bodyShape : fallback.bodyShape,
    bodyColor: finiteNumber(source.bodyColor, fallback.bodyColor),
    accentColor: finiteNumber(source.accentColor, fallback.accentColor),
    eyeCount: isEyeCount(source.eyeCount) ? source.eyeCount : fallback.eyeCount,
    eyeScale: finiteNumber(source.eyeScale, fallback.eyeScale),
    earStyle: isEarStyle(source.earStyle) ? source.earStyle : fallback.earStyle,
    marking: isMarking(source.marking) ? source.marking : fallback.marking,
    widthScale: finiteNumber(source.widthScale, fallback.widthScale),
    heightScale: finiteNumber(source.heightScale, fallback.heightScale),
    lean: finiteNumber(source.lean, fallback.lean),
    leftHanded: typeof source.leftHanded === "boolean" ? source.leftHanded : fallback.leftHanded,
  };
}

function fallbackTraits(id: string): RenderTraits {
  const bodyShapes = ["bean", "gourd", "orb", "slug"] as const;
  const ears = ["antennae", "droop", "fan", "horns"] as const;
  const markings = ["belly", "freckles", "stripe", "patch"] as const;
  const bodyColors = [0xf0d49a, 0xdb8e83, 0x8cc8bd, 0xa9bd68, 0x9f7ca7, 0xd1a76d, 0xc987b0, 0x91a4c4] as const;
  const accentColors = [0xff786f, 0x65ded1, 0xb6cf5b, 0xe4b4d0, 0xf0cc68, 0x7d6d9e] as const;
  const hash = stableHash(id);
  return {
    bodyShape: bodyShapes[hash % bodyShapes.length] ?? "bean",
    bodyColor: bodyColors[(hash >>> 3) % bodyColors.length] ?? 0xf0d49a,
    accentColor: accentColors[(hash >>> 7) % accentColors.length] ?? 0xff786f,
    eyeCount: (((hash >>> 11) % 3) + 1) as 1 | 2 | 3,
    eyeScale: 0.78 + hashUnit(id, 3) * 0.38,
    earStyle: ears[(hash >>> 13) % ears.length] ?? "antennae",
    marking: markings[(hash >>> 17) % markings.length] ?? "belly",
    widthScale: 0.78 + hashUnit(id, 5) * 0.38,
    heightScale: 0.78 + hashUnit(id, 7) * 0.4,
    lean: Math.round(hashUnit(id, 11) * 10 - 5),
    leftHanded: (hash & 1) === 0,
  };
}

function normalizedZappedBy(creature: RenderCreature): string | null {
  const value = creature.zappedBy;
  return value === null || value === undefined ? null : String(value);
}

function isResolvedStatus(status: CreatureRuntimeState["status"]): boolean {
  const value = String(status);
  return value === "zapped" || value === "removed" || value === "dead";
}

function bodyScaleFor(shape: BodyShape, width: number, height: number): Vector3 {
  if (shape === "gourd") return new Vector3(width * 0.78, height * 1.16, width * 0.72);
  if (shape === "orb") return new Vector3(width * 0.84, height * 0.96, width * 0.78);
  if (shape === "slug") return new Vector3(width * 0.9, height * 0.94, width * 0.72);
  return new Vector3(width, height, width * 0.78);
}

function markingScale(marking: RenderTraits["marking"], width: number, height: number): Vector3 {
  if (marking === "stripe") return new Vector3(width * 1.7, height * 0.34, 0.3);
  if (marking === "patch") return new Vector3(width * 0.72, height * 0.85, 0.32);
  if (marking === "freckles") return new Vector3(width * 0.42, height * 0.48, 0.25);
  return new Vector3(width, height * 1.12, 0.36);
}

function markingOffset(marking: RenderTraits["marking"]): number {
  if (marking === "patch") return -0.18;
  if (marking === "freckles") return 0.16;
  return 0;
}

function earScale(style: RenderTraits["earStyle"]): Vector3 {
  if (style === "droop") return new Vector3(1.15, 1.4, 0.72);
  if (style === "fan") return new Vector3(1.55, 0.9, 0.75);
  if (style === "horns") return new Vector3(0.82, 1.5, 0.82);
  return new Vector3(0.62, 1.72, 0.62);
}

function earRotation(style: RenderTraits["earStyle"], side: -1 | 1): number {
  if (style === "droop") return side * 1.18;
  if (style === "fan") return side * 0.95;
  if (style === "horns") return side * 0.45;
  return side * 0.18;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isBodyShape(value: unknown): value is BodyShape {
  return value === "bean" || value === "gourd" || value === "orb" || value === "slug";
}

function isEyeCount(value: unknown): value is 1 | 2 | 3 {
  return value === 1 || value === 2 || value === 3;
}

function isEarStyle(value: unknown): value is RenderTraits["earStyle"] {
  return value === "antennae" || value === "droop" || value === "fan" || value === "horns";
}

function isMarking(value: unknown): value is RenderTraits["marking"] {
  return value === "belly" || value === "freckles" || value === "stripe" || value === "patch";
}
