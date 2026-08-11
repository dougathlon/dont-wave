import {
  CylinderGeometry,
  Group,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  SphereGeometry,
  Vector3,
} from "three";
import { CROSSING_RED_MS, DEATH_MS, DESCENT_MS } from "../simulation/DontWaveSession";
import type { DontWaveState } from "../simulation/types";
import {
  CROSSING_CAMERA_START,
  CROSSING_LOOK_TARGET,
  CROSSING_TRAVEL,
  WATCH_CAMERA_POSITION,
  WATCH_CAMERA_TARGET,
  clamp01,
} from "./constants";

export interface CameraSnapshot {
  readonly position: readonly [number, number, number];
  readonly quaternion: readonly [number, number, number, number];
  readonly screenUp: readonly [number, number, number];
  readonly fov: number;
  readonly handVisible: boolean;
}

export class CameraDirector {
  readonly camera = new PerspectiveCamera(49, 16 / 9, 0.1, 120);
  private readonly hand = new Group();
  private readonly ownedGeometries = [
    new CylinderGeometry(0.11, 0.16, 1.25, 7),
    new SphereGeometry(0.2, 8, 6),
  ] as const;
  private readonly handMaterial = new MeshStandardMaterial({ color: 0xb7795d, roughness: 0.78 });
  private readonly target = new Vector3();
  private readonly screenUp = new Vector3();

  constructor() {
    const forearm = new Mesh(this.ownedGeometries[0], this.handMaterial);
    forearm.position.y = -0.56;
    const palm = new Mesh(this.ownedGeometries[1], this.handMaterial);
    palm.position.y = 0.11;
    palm.scale.set(0.82, 1.18, 0.52);
    this.hand.add(forearm, palm);
    this.hand.position.set(0.58, -1.12, -1.28);
    this.hand.visible = false;
    this.camera.add(this.hand);
    this.setWatchPose();
  }

  setAspect(aspect: number): void {
    this.camera.aspect = Math.max(0.35, aspect);
    this.camera.updateProjectionMatrix();
  }

  update(state: DontWaveState, elapsedMs: number, reducedMotion: boolean): void {
    if (isWatchPhase(state.phase)) {
      this.setWatchPose();
      this.hand.visible = false;
      return;
    }
    if (state.phase === "descent") {
      const t = smooth(clamp01(state.phaseElapsedMs / DESCENT_MS));
      const stairArc = Math.sin(Math.PI * t);
      this.camera.position.lerpVectors(WATCH_CAMERA_POSITION, CROSSING_CAMERA_START, t);
      this.camera.position.x += stairArc * 2.4;
      this.target.lerpVectors(WATCH_CAMERA_TARGET, CROSSING_LOOK_TARGET, t);
      this.target.x -= stairArc * 0.8;
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(this.target);
      this.hand.visible = false;
      return;
    }

    const z = CROSSING_CAMERA_START.z + state.playerProgress * CROSSING_TRAVEL;
    const bob = state.phase === "crossing-green" && state.playerMoving && !reducedMotion
      ? Math.sin(elapsedMs * 0.014) * 0.035
      : 0;
    this.camera.position.set(CROSSING_CAMERA_START.x, CROSSING_CAMERA_START.y + bob, z);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(CROSSING_LOOK_TARGET.x, CROSSING_LOOK_TARGET.y, CROSSING_LOOK_TARGET.z);

    if (state.phase === "crossing-red") {
      const t = smooth(clamp01(state.phaseElapsedMs / Math.min(720, CROSSING_RED_MS)));
      this.hand.visible = true;
      this.hand.position.set(0.58, MathUtils.lerp(-1.12, -0.18, t), -1.28);
      const wave = reducedMotion ? 0 : Math.sin(state.phaseElapsedMs * 0.024) * 0.22;
      this.hand.rotation.set(0.1, 0, -0.2 + wave);
      return;
    }
    if (state.phase === "death" || state.phase === "complete") {
      const t = state.phase === "complete" ? 1 : smooth(clamp01(state.phaseElapsedMs / DEATH_MS));
      this.hand.visible = state.phaseElapsedMs < DEATH_MS * 0.58 && state.phase !== "complete";
      this.hand.position.set(0.58, -0.18, -1.28);
      this.hand.rotation.set(0.1, 0, -0.2);
      this.camera.position.y = MathUtils.lerp(CROSSING_CAMERA_START.y, reducedMotion ? 1.18 : 0.42, t);
      this.camera.lookAt(CROSSING_LOOK_TARGET.x, CROSSING_LOOK_TARGET.y, CROSSING_LOOK_TARGET.z);
      if (!reducedMotion) {
        this.camera.rotateZ(-1.12 * t);
        this.camera.rotateX(0.16 * t);
      }
      return;
    }
    this.hand.visible = false;
  }

  snapshot(): CameraSnapshot {
    this.screenUp.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
    return {
      position: [this.camera.position.x, this.camera.position.y, this.camera.position.z],
      quaternion: [this.camera.quaternion.x, this.camera.quaternion.y, this.camera.quaternion.z, this.camera.quaternion.w],
      screenUp: [this.screenUp.x, this.screenUp.y, this.screenUp.z],
      fov: this.camera.fov,
      handVisible: this.hand.visible,
    };
  }

  dispose(): void {
    for (const geometry of this.ownedGeometries) geometry.dispose();
    this.handMaterial.dispose();
    this.camera.remove(this.hand);
    this.hand.clear();
  }

  private setWatchPose(): void {
    this.camera.position.copy(WATCH_CAMERA_POSITION);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(WATCH_CAMERA_TARGET);
    this.camera.rotation.z = 0;
  }
}

function isWatchPhase(phase: DontWaveState["phase"]): boolean {
  return phase === "briefing"
    || phase === "ready"
    || phase === "green"
    || phase === "reveal"
    || phase === "hunt"
    || phase === "rivals"
    || phase === "interturn"
    || phase === "round-break"
    || phase === "final-standings";
}

function smooth(value: number): number {
  return value * value * (3 - 2 * value);
}
