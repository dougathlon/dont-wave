import {
  CapsuleGeometry,
  Group,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  SphereGeometry,
  Vector2,
  Vector3,
} from "three";
import { CROSSING_RED_MS, DEATH_MS } from "../simulation/DontWaveSession";
import type { DontWaveState } from "../simulation/types";
import {
  CROSSING_CAMERA_POSITION,
  CROSSING_CAMERA_TARGET,
  PALETTE,
  WATCH_CAMERA_POSITION,
  WATCH_CAMERA_TARGET,
  WORLD,
} from "./constants";

/** Presentation-only camera motion. Session phases remain the sole source of progression. */
export class CameraDirector {
  readonly camera = new PerspectiveCamera(46, 16 / 9, 0.08, 110);
  readonly pointerNdc = new Vector2();
  private readonly pointerTarget = new Vector2();
  private readonly lookTarget = new Vector3();
  private readonly hands: PlayerHands;
  private phase = "";
  private phaseElapsedMs = 0;
  private crossingDistance = 0;
  private pointerActive = true;
  private portraitPullback = 0;

  constructor(private reducedMotion: boolean) {
    this.camera.name = "operator-camera";
    this.camera.position.copy(WATCH_CAMERA_POSITION);
    this.camera.lookAt(WATCH_CAMERA_TARGET);
    this.hands = new PlayerHands();
    this.camera.add(this.hands.group);
  }

  setAspect(aspect: number): void {
    const safeAspect = Math.max(0.2, aspect);
    this.camera.aspect = safeAspect;
    this.portraitPullback = safeAspect < 1
      ? Math.min(24, Math.max(0, (1 / safeAspect - 1) * 18))
      : 0;
    this.camera.fov = safeAspect < 1 ? Math.min(66, 46 + (1 - safeAspect) * 31) : 46;
    this.camera.updateProjectionMatrix();
  }

  setReducedMotion(reducedMotion: boolean): void {
    this.reducedMotion = reducedMotion;
  }

  setPointer(ndcX: number, ndcY: number): void {
    this.pointerTarget.set(MathUtils.clamp(ndcX, -1, 1), MathUtils.clamp(ndcY, -1, 1));
  }

  setPointerActive(active: boolean): void {
    this.pointerActive = active;
    if (!active) this.pointerTarget.set(0, 0);
  }

  update(state: DontWaveState, deltaMs: number): void {
    const phase = String(state.phase);
    if (phase !== this.phase) {
      this.phase = phase;
      if (phase === "descent") this.crossingDistance = 0;
    }
    this.phaseElapsedMs = state.phaseElapsedMs;

    const pointerEase = 1 - Math.exp(-deltaMs / 95);
    const pointerTarget = this.pointerActive && !this.reducedMotion ? this.pointerTarget : ZERO_POINTER;
    this.pointerNdc.lerp(pointerTarget, pointerEase);

    if (phase === "descent") this.updateDescent();
    else if (phase === "crossing-green") this.updateCrossing(state);
    else if (phase === "crossing-red") this.updateCrossingRed(state);
    else if (phase === "death") this.updateDeath(state);
    else if (phase === "complete") this.updateFallen(state);
    else this.updateWatch();
  }

  dispose(): void {
    this.hands.dispose();
    this.camera.remove(this.hands.group);
  }

  private updateWatch(): void {
    const driftX = this.pointerNdc.x * 0.42;
    const driftY = this.pointerNdc.y * 0.2;
    this.camera.position.copy(this.watchPosition()).add(new Vector3(driftX, driftY, 0));
    this.lookTarget.copy(WATCH_CAMERA_TARGET).add(new Vector3(this.pointerNdc.x * 0.68, this.pointerNdc.y * 0.34, 0));
    this.camera.rotation.z = 0;
    this.camera.lookAt(this.lookTarget);
    this.hands.hide();
  }

  private updateDescent(): void {
    const duration = this.reducedMotion ? 250 : 2_300;
    const raw = MathUtils.clamp(this.phaseElapsedMs / duration, 0, 1);
    const t = raw * raw * (3 - 2 * raw);
    this.camera.position.lerpVectors(this.watchPosition(), CROSSING_CAMERA_POSITION, t);
    this.lookTarget.lerpVectors(WATCH_CAMERA_TARGET, CROSSING_CAMERA_TARGET, t);
    if (!this.reducedMotion) {
      this.camera.position.x += Math.sin(t * Math.PI * 5) * 0.16 * (1 - t);
      this.camera.position.y += Math.sin(t * Math.PI * 8) * 0.09;
    }
    this.camera.rotation.z = Math.sin(t * Math.PI * 3) * 0.025;
    this.camera.lookAt(this.lookTarget);
    this.hands.showWalking(this.phaseElapsedMs, 0.28);
  }

  private updateCrossing(state: DontWaveState): void {
    const progress = MathUtils.clamp(state.playerProgress, 0, 1);
    this.crossingDistance = progress * (WORLD.crossingStartZ - WORLD.checkpointZ);
    const playerMoving = state.playerMoving;
    const drift = this.reducedMotion ? 0 : this.pointerNdc.x * 0.08;
    const bob = playerMoving && !this.reducedMotion
      ? Math.sin(this.crossingDistance * 5.4) * 0.055
      : 0;
    this.camera.position.copy(CROSSING_CAMERA_POSITION);
    this.camera.position.x += drift;
    this.camera.position.y += bob;
    this.camera.position.z -= this.crossingDistance;
    this.lookTarget.copy(CROSSING_CAMERA_TARGET);
    this.lookTarget.z -= this.crossingDistance;
    this.lookTarget.x += drift * 1.5;
    this.camera.rotation.z = 0;
    this.camera.lookAt(this.lookTarget);
    this.hands.showWalking(this.phaseElapsedMs, playerMoving ? 1 : 0.12);
  }

  private updateCrossingRed(state: DontWaveState): void {
    this.placeCrossingCamera(state);
    const waveT = MathUtils.clamp(this.phaseElapsedMs / CROSSING_RED_MS, 0, 1);
    this.hands.showFatalWave(waveT, 0, this.phaseElapsedMs, this.reducedMotion);
  }

  private updateDeath(state: DontWaveState): void {
    this.crossingDistance = MathUtils.clamp(state.playerProgress, 0, 1)
      * (WORLD.crossingStartZ - WORLD.checkpointZ);
    const impactHoldMs = this.reducedMotion ? 0 : 100;
    const fallT = MathUtils.clamp(
      (this.phaseElapsedMs - impactHoldMs) / Math.max(1, DEATH_MS - impactHoldMs),
      0,
      1,
    );
    const easedFall = fallT * fallT * (3 - 2 * fallT);
    this.camera.position.copy(CROSSING_CAMERA_POSITION);
    this.camera.position.z -= this.crossingDistance;
    this.camera.position.y = MathUtils.lerp(CROSSING_CAMERA_POSITION.y, 0.3, easedFall);
    this.camera.position.x += easedFall * 0.68;
    this.lookTarget.copy(this.camera.position).add(new Vector3(0, MathUtils.lerp(-0.05, -0.48, easedFall), -8));
    this.camera.lookAt(this.lookTarget);
    this.camera.rotation.z = easedFall * 1.12;
    this.hands.showFatalWave(1, easedFall, this.phaseElapsedMs, this.reducedMotion);
  }

  private placeCrossingCamera(state: DontWaveState): void {
    this.crossingDistance = MathUtils.clamp(state.playerProgress, 0, 1)
      * (WORLD.crossingStartZ - WORLD.checkpointZ);
    const drift = this.reducedMotion ? 0 : this.pointerNdc.x * 0.08;
    this.camera.position.copy(CROSSING_CAMERA_POSITION);
    this.camera.position.x += drift;
    this.camera.position.z -= this.crossingDistance;
    this.lookTarget.copy(CROSSING_CAMERA_TARGET);
    this.lookTarget.z -= this.crossingDistance;
    this.lookTarget.x += drift * 1.5;
    this.camera.rotation.z = 0;
    this.camera.lookAt(this.lookTarget);
  }

  private updateFallen(state: DontWaveState): void {
    this.crossingDistance = MathUtils.clamp(state.playerProgress, 0, 1)
      * (WORLD.crossingStartZ - WORLD.checkpointZ);
    this.camera.position.set(0.68, 0.3, CROSSING_CAMERA_POSITION.z - this.crossingDistance);
    this.camera.lookAt(this.camera.position.clone().add(new Vector3(0, -0.48, -8)));
    this.camera.rotation.z = 1.12;
    this.hands.showFatalWave(1, 1, this.phaseElapsedMs, true);
  }

  private watchPosition(): Vector3 {
    return WATCH_CAMERA_POSITION.clone().add(new Vector3(0, this.portraitPullback * 0.32, this.portraitPullback));
  }
}

class PlayerHands {
  readonly group = new Group();
  private readonly skinMaterial = new MeshStandardMaterial({
    color: PALETTE.dirtyCream,
    roughness: 0.92,
    metalness: 0,
    flatShading: true,
  });
  private readonly sleeveMaterial = new MeshStandardMaterial({
    color: PALETTE.aubergine,
    roughness: 0.86,
    metalness: 0.04,
    flatShading: true,
  });
  private readonly armGeometry = new CapsuleGeometry(0.12, 0.58, 2, 6);
  private readonly handGeometry = new SphereGeometry(0.2, 7, 5);
  private readonly left = this.createHand(-1);
  private readonly right = this.createHand(1);

  constructor() {
    this.group.name = "player-hands";
    this.group.add(this.left, this.right);
    this.hide();
  }

  hide(): void {
    this.group.visible = false;
  }

  showWalking(elapsedMs: number, amount: number): void {
    this.group.visible = true;
    const swing = Math.sin(elapsedMs * 0.009) * 0.07 * amount;
    this.left.position.set(-0.58, -0.56 + Math.abs(swing) * 0.15, -1.15 + swing);
    this.right.position.set(0.58, -0.56 + Math.abs(swing) * 0.15, -1.15 - swing);
    this.left.rotation.set(-0.36 + swing, 0, -0.22);
    this.right.rotation.set(-0.36 - swing, 0, 0.22);
  }

  showFatalWave(waveT: number, fallT: number, elapsedMs: number, reducedMotion: boolean): void {
    this.group.visible = true;
    const oscillation = reducedMotion ? 0 : Math.sin(elapsedMs * 0.022) * 0.32 * (1 - fallT);
    this.left.position.set(-0.56 + fallT * 0.2, -0.48 + waveT * 0.74 - fallT * 0.72, -1.04);
    this.left.rotation.set(-1.55 + waveT * 2.12, -0.25, -0.58 + oscillation);
    this.right.position.set(0.62, -0.7, -1.08);
    this.right.rotation.set(-0.24, 0, 0.28 + fallT * 0.65);
  }

  dispose(): void {
    this.armGeometry.dispose();
    this.handGeometry.dispose();
    this.skinMaterial.dispose();
    this.sleeveMaterial.dispose();
    this.group.clear();
  }

  private createHand(side: -1 | 1): Group {
    const hand = new Group();
    const arm = new Mesh(this.armGeometry, this.sleeveMaterial);
    arm.position.y = -0.28;
    const palm = new Mesh(this.handGeometry, this.skinMaterial);
    palm.scale.set(0.8, 1.12, 0.58);
    palm.position.y = 0.22;
    const thumb = new Mesh(this.handGeometry, this.skinMaterial);
    thumb.scale.set(0.34, 0.65, 0.34);
    thumb.position.set(side * 0.18, 0.18, 0);
    hand.add(arm, palm, thumb);
    return hand;
  }
}

const ZERO_POINTER = new Vector2();
