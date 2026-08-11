import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  Vector3,
} from "three";
import type { ContestantState } from "../../simulation/types";
import { PALETTE } from "../constants";

interface ContestantView {
  readonly id: string;
  readonly root: Group;
  readonly torso: Mesh;
  readonly head: Mesh;
  readonly leftArm: Group;
  readonly rightArm: Group;
  readonly leftLeg: Group;
  readonly rightLeg: Group;
  readonly pick: Mesh<BoxGeometry, MeshBasicMaterial>;
  removedAt: number | null;
  lastStatus: ContestantState["status"];
}

const EVAPORATE_MS = 480;

/** Presentation-only grotesque humanoids with equal invisible pick envelopes. */
export class CreatureField extends Group {
  readonly pickTargets: readonly Mesh<BoxGeometry, MeshBasicMaterial>[];
  private readonly views = new Map<string, ContestantView>();
  private readonly geometries = new Set<BoxGeometry | CylinderGeometry | SphereGeometry>();
  private readonly materials = new Set<MeshBasicMaterial | MeshStandardMaterial>();
  constructor(contestants: readonly ContestantState[]) {
    super();
    this.name = "contestant-field";
    this.pickTargets = contestants.map((contestant) => {
      const view = this.createView(contestant);
      this.views.set(contestant.id, view);
      this.add(view.root);
      return view.pick;
    });
  }

  sync(contestants: readonly ContestantState[], elapsedMs: number, reducedMotion: boolean): void {
    for (const contestant of contestants) {
      const view = this.views.get(contestant.id);
      if (!view) continue;
      this.updateView(view, contestant, elapsedMs, reducedMotion);
    }
  }

  pickableTargets(): readonly Mesh<BoxGeometry, MeshBasicMaterial>[] {
    return this.pickTargets.filter((target) => target.visible);
  }

  centerFor(id: string, target = new Vector3()): Vector3 | null {
    const view = this.views.get(id);
    if (!view) return null;
    return target.set(view.root.position.x, view.root.position.y + 1.45 * view.root.scale.y, view.root.position.z);
  }

  contestantIdForObject(object: Object3D | null): string | null {
    let current: Object3D | null = object;
    while (current) {
      const value = current.userData.contestantId;
      if (typeof value === "string") return value;
      current = current.parent;
    }
    return null;
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.views.clear();
    this.clear();
  }

  private createView(contestant: ContestantState): ContestantView {
    const root = new Group();
    root.name = contestant.id;
    root.userData.contestantId = contestant.id;
    root.position.set(contestant.x, 0, contestant.z);

    const skin = this.standard(contestant.visual.skinColor, 0.82);
    const suit = this.standard(contestant.visual.suitColor, 0.86);
    const accent = this.standard(contestant.visual.accentColor, 0.78);
    const white = this.standard(PALETTE.bone.getHex(), 0.72);
    const pupil = this.standard(PALETTE.ink.getHex(), 0.74);

    const torso = new Mesh(this.geometry(new SphereGeometry(0.78, 10, 8)), suit);
    torso.position.y = 1.42;
    torso.scale.set(contestant.visual.torsoWidth, contestant.visual.torsoHeight, 0.72);
    root.add(torso);

    const belly = new Mesh(this.geometry(new SphereGeometry(0.5, 8, 6)), accent);
    belly.position.set(0.11, 1.28, 0.58);
    belly.scale.set(0.72, 0.82, 0.18);
    root.add(belly);

    const head = new Mesh(this.geometry(new SphereGeometry(0.58, 10, 8)), skin);
    head.position.set(-0.08, 2.58, 0.02);
    head.scale.set(contestant.visual.headScale, 1.02, 0.9);
    root.add(head);

    for (let eye = 0; eye < contestant.visual.eyeCount; eye += 1) {
      const offset = contestant.visual.eyeCount === 1
        ? 0
        : contestant.visual.eyeCount === 2
          ? (eye - 0.5) * 0.34
          : (eye - 1) * 0.29;
      const eyeball = new Mesh(this.geometry(new SphereGeometry(0.105, 7, 5)), white);
      eyeball.position.set(-0.08 + offset, 2.66 + (eye % 2) * 0.035, 0.52);
      const iris = new Mesh(this.geometry(new SphereGeometry(0.045, 6, 4)), pupil);
      iris.position.set(-0.08 + offset, 2.66 + (eye % 2) * 0.035, 0.615);
      root.add(eyeball, iris);
    }

    const mouth = new Mesh(this.geometry(new BoxGeometry(0.28, 0.055, 0.055)), pupil);
    mouth.position.set(-0.04, 2.35, 0.53);
    mouth.rotation.z = ((contestant.slot % 5) - 2) * 0.08;
    root.add(mouth);

    const leftArm = this.createLimb(skin, contestant.visual.armLength, true);
    const rightArm = this.createLimb(skin, contestant.visual.armLength, true);
    leftArm.position.set(-0.62 * contestant.visual.torsoWidth, 1.95, 0);
    rightArm.position.set(0.62 * contestant.visual.torsoWidth, 1.95, 0);
    root.add(leftArm, rightArm);

    const leftLeg = this.createLimb(suit, 0.9, false);
    const rightLeg = this.createLimb(suit, 0.9, false);
    leftLeg.position.set(-0.28, 0.82, 0);
    rightLeg.position.set(0.28, 0.82, 0);
    root.add(leftLeg, rightLeg);

    const pickMaterial = this.basic(0xffffff, 0);
    pickMaterial.colorWrite = false;
    pickMaterial.depthWrite = false;
    const pick = new Mesh(this.geometry(new BoxGeometry(1.72, 3.35, 1.42)), pickMaterial);
    pick.position.set(0, 1.55, 0.05);
    pick.userData.contestantId = contestant.id;
    root.add(pick);

    return {
      id: contestant.id,
      root,
      torso,
      head,
      leftArm,
      rightArm,
      leftLeg,
      rightLeg,
      pick,
      removedAt: null,
      lastStatus: contestant.status,
    };
  }

  private createLimb(material: MeshStandardMaterial, lengthScale: number, hand: boolean): Group {
    const pivot = new Group();
    const segment = new Mesh(this.geometry(new CylinderGeometry(0.11, 0.15, 1.05, 7)), material);
    segment.position.y = -0.5;
    segment.scale.y = lengthScale;
    pivot.add(segment);
    if (hand) {
      const palm = new Mesh(this.geometry(new SphereGeometry(0.16, 7, 5)), material);
      palm.position.y = -1.02 * lengthScale;
      palm.scale.set(0.9, 1.18, 0.72);
      pivot.add(palm);
    } else {
      const foot = new Mesh(this.geometry(new BoxGeometry(0.3, 0.18, 0.52)), material);
      foot.position.set(0, -1.02 * lengthScale, 0.16);
      pivot.add(foot);
    }
    return pivot;
  }

  private updateView(view: ContestantView, contestant: ContestantState, elapsedMs: number, reducedMotion: boolean): void {
    view.root.position.x = contestant.x;
    view.root.position.z = contestant.z;
    if (contestant.status === "crossed") {
      view.root.visible = false;
      view.pick.visible = false;
      view.lastStatus = contestant.status;
      return;
    }
    if (contestant.status === "evaporated") {
      if (view.lastStatus !== "evaporated") view.removedAt = elapsedMs;
      const age = Math.max(0, elapsedMs - (view.removedAt ?? elapsedMs));
      const remaining = Math.max(0, 1 - age / EVAPORATE_MS);
      view.root.visible = remaining > 0;
      view.pick.visible = false;
      view.root.scale.setScalar(Math.max(0.001, remaining * remaining));
      view.root.position.y = (1 - remaining) * 0.65;
      view.root.rotation.y = (1 - remaining) * 0.9;
      view.lastStatus = contestant.status;
      return;
    }

    view.root.visible = true;
    view.pick.visible = true;
    view.root.scale.setScalar(1);
    view.root.position.y = 0;
    view.root.rotation.set(0, 0, 0);
    const phase = contestant.visual.gaitPhase;
    const moving = contestant.pose === "walking";
    const waving = contestant.pose === "waving";
    const gait = moving && !reducedMotion ? Math.sin(elapsedMs * 0.011 + phase) : 0;
    const bob = moving && !reducedMotion ? Math.abs(Math.sin(elapsedMs * 0.011 + phase)) * 0.055 : 0;
    view.root.position.y = bob;
    // Positive X rotation leans the face and torso toward positive Z: the tower.
    view.torso.rotation.x = moving ? 0.09 : 0;
    view.head.rotation.x = moving ? 0.05 : 0;
    view.leftLeg.rotation.x = moving ? gait * 0.42 : 0;
    view.rightLeg.rotation.x = moving ? -gait * 0.42 : 0;
    view.leftArm.rotation.set(moving ? -gait * 0.26 : 0, 0, 0);
    view.rightArm.rotation.set(moving ? gait * 0.26 : 0, 0, 0);

    if (waving) {
      const wave = reducedMotion ? Math.sin(elapsedMs * 0.01 + phase) * 0.12 : Math.sin(elapsedMs * 0.022 + phase) * 0.34;
      const raised = contestant.visual.waveHand === "left" ? view.leftArm : view.rightArm;
      raised.rotation.set(0, 0, Math.PI + wave);
    }
    view.lastStatus = contestant.status;
  }

  private standard(color: number, roughness: number): MeshStandardMaterial {
    const material = new MeshStandardMaterial({ color, roughness, metalness: 0.02 });
    this.materials.add(material);
    return material;
  }

  private basic(color: number, opacity: number): MeshBasicMaterial {
    const material = new MeshBasicMaterial({ color, transparent: true, opacity, toneMapped: false });
    this.materials.add(material);
    return material;
  }

  private geometry<T extends BoxGeometry | CylinderGeometry | SphereGeometry>(geometry: T): T {
    this.geometries.add(geometry);
    return geometry;
  }
}
