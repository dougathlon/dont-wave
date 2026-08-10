import {
  ACESFilmicToneMapping,
  AmbientLight,
  DirectionalLight,
  Fog,
  HemisphereLight,
  MathUtils,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import type { DontWaveSession } from "../simulation/DontWaveSession";
import type { CreatureRuntimeState, DontWaveState, ZapCreatureResult } from "../simulation/types";
import { CameraDirector } from "./CameraDirector";
import {
  MAX_FRAME_DELTA_MS,
  MAX_PIXEL_RATIO,
  OPERATOR_COLORS,
  PALETTE,
  stableHash,
} from "./constants";
import { CreatureField, type ZapPresentation } from "./creatures/CreatureField";
import { BeamPool } from "./fx/BeamPool";
import { CivicPlayground } from "./world/CivicPlayground";
import { Watchtower } from "./world/Watchtower";

export const CREATURE_FOCUS_EVENT = "dont-wave:creature-focus";
export const RETICLE_EVENT = "dont-wave:reticle";
export const RENDER_STATUS_EVENT = "dont-wave:render-status";

export interface CreatureFocusDetail {
  readonly creatureId: string | null;
}

export interface ReticleDetail {
  readonly creatureId: string | null;
  readonly canZap: boolean;
  readonly normalizedX: number;
  readonly normalizedY: number;
  readonly visible: boolean;
}

export interface RenderStatusDetail {
  readonly status: "lost" | "restored";
  readonly message: string;
}

interface WorldSession {
  getState(): DontWaveState;
  subscribe(subscriber: (state: DontWaveState) => void): () => void;
  tick(deltaMs: number): void;
  zapCreature(creatureId: string): ZapCreatureResult;
  registerMiss(): boolean;
}

interface RayTarget {
  readonly creatureId: string | null;
  readonly point: Vector3;
}

/**
 * Disposable Three.js rendering adapter. It advances the session clock, but it
 * never computes target state, scores, wave outcomes, or phase transitions.
 */
export class DontWaveWorld {
  readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly session: WorldSession;
  private readonly cameraDirector: CameraDirector;
  private readonly playground = new CivicPlayground();
  private readonly watchtower = new Watchtower();
  private readonly beams = new BeamPool();
  private readonly raycaster = new Raycaster();
  private readonly reticleNdc = new Vector2();
  private readonly resizeObserver: ResizeObserver | null;
  private readonly mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  private creatureField: CreatureField;
  private state: DontWaveState;
  private unsubscribe: () => void;
  private animationFrame = 0;
  private lastFrameAt = 0;
  private elapsedMs = 0;
  private reducedMotion = this.mediaQuery.matches;
  private pointerActive = true;
  private pointerInside = false;
  private contextAvailable = true;
  private destroyed = false;
  private focusedCreatureId: string | null = null;
  private lastReticleKey = "";
  private lastPhase = "";
  private populationSignature: string;

  constructor(private readonly parent: HTMLElement, session: DontWaveSession) {
    if (!(parent instanceof HTMLElement)) throw new Error("Don't Wave requires a valid canvas parent.");
    this.session = session as unknown as WorldSession;
    this.state = this.session.getState();
    this.populationSignature = populationSignature(this.state.creatures);
    this.creatureField = new CreatureField(this.state.creatures);
    this.cameraDirector = new CameraDirector(this.reducedMotion);

    this.scene.name = "dont-wave-world";
    this.scene.background = PALETTE.abyss;
    this.scene.fog = new Fog(PALETTE.abyss, 28, 78);
    this.scene.add(this.cameraDirector.camera, this.playground, this.watchtower, this.creatureField, this.beams);
    this.addLights();

    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.setClearColor(PALETTE.abyss, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    this.renderer.domElement.className = "dont-wave-canvas";
    this.renderer.domElement.setAttribute("aria-label", "Don't Wave watchtower view over the civic playground");
    this.renderer.domElement.setAttribute("role", "img");
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.touchAction = "none";
    this.parent.append(this.renderer.domElement);

    this.unsubscribe = this.session.subscribe((state) => {
      this.state = state;
      this.ensurePopulation(state.creatures);
    });
    this.resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => this.resize());
    this.resizeObserver?.observe(this.parent);
    this.bindEvents();
    this.resize();
    this.animationFrame = requestAnimationFrame(this.frame);
  }

  /** Fires once through the same current camera/reticle ray shown to the player. */
  fireAtReticle(): boolean {
    if (!this.pointerActive || this.destroyed || !this.contextAvailable) return false;
    return this.fireAt(this.reticleNdc);
  }

  setPointerActive(active: boolean): void {
    this.pointerActive = active;
    this.cameraDirector.setPointerActive(active);
    if (!active) {
      this.pointerInside = false;
      this.publishReticle(null, false, false);
    }
  }

  focusCreature(creatureId: string | null): void {
    const normalized = creatureId !== null && this.creatureField.creatureAt(creatureId) ? creatureId : null;
    if (normalized === this.focusedCreatureId) return;
    this.focusedCreatureId = normalized;
    this.creatureField.setFocused(normalized);
    window.dispatchEvent(new CustomEvent<CreatureFocusDetail>(CREATURE_FOCUS_EVENT, {
      detail: { creatureId: normalized },
    }));
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.animationFrame);
    this.unsubscribe();
    this.resizeObserver?.disconnect();
    this.unbindEvents();
    this.cameraDirector.dispose();
    this.creatureField.dispose();
    this.playground.dispose();
    this.watchtower.dispose();
    this.beams.dispose();
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }

  private readonly frame = (now: number): void => {
    if (this.destroyed) return;
    this.animationFrame = requestAnimationFrame(this.frame);
    if (document.hidden || !this.contextAvailable) {
      this.lastFrameAt = 0;
      return;
    }

    const deltaMs = this.lastFrameAt === 0
      ? 0
      : Math.min(MAX_FRAME_DELTA_MS, Math.max(0, now - this.lastFrameAt));
    this.lastFrameAt = now;
    if (deltaMs > 0) this.session.tick(deltaMs);
    const presentationDeltaMs = this.state.paused ? 0 : deltaMs;
    this.elapsedMs += presentationDeltaMs;

    this.cameraDirector.update(this.state, presentationDeltaMs);
    const zaps = this.creatureField.sync(this.state.creatures, this.elapsedMs, this.reducedMotion);
    this.presentZaps(zaps);
    this.presentPhaseTransition();
    this.beams.update(presentationDeltaMs);
    if (this.pointerInside && this.pointerActive) this.updateReticle();
    this.renderer.render(this.scene, this.cameraDirector.camera);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.pointerActive) return;
    this.pointerInside = true;
    this.readPointer(event, this.reticleNdc);
    this.cameraDirector.setPointer(this.reticleNdc.x, this.reticleNdc.y);
    this.cameraDirector.setPointerActive(true);
    this.updateReticle();
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.pointerActive || !event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    this.pointerInside = true;
    this.readPointer(event, this.reticleNdc);
    this.cameraDirector.setPointer(this.reticleNdc.x, this.reticleNdc.y);
    if (this.state.phase !== "hunt" || this.state.paused || !this.contextAvailable) return;
    this.fireAt(this.reticleNdc);
  };

  private readonly onPointerEnter = (): void => {
    if (!this.pointerActive) return;
    this.pointerInside = true;
    this.cameraDirector.setPointerActive(true);
  };

  private readonly onPointerLeave = (): void => {
    this.pointerInside = false;
    this.cameraDirector.setPointerActive(false);
    this.publishReticle(null, false, false);
  };

  private readonly onContextLost = (event: Event): void => {
    event.preventDefault();
    this.contextAvailable = false;
    this.lastFrameAt = 0;
    this.publishRenderStatus("lost", "WebGL context lost. The shift is held until rendering returns.");
  };

  private readonly onContextRestored = (): void => {
    this.contextAvailable = true;
    this.lastFrameAt = 0;
    this.renderer.resetState();
    this.resize();
    this.publishRenderStatus("restored", "WebGL context restored. The shift may continue.");
  };

  private readonly onVisibilityChange = (): void => {
    this.lastFrameAt = 0;
  };

  private readonly onReducedMotionChange = (event: MediaQueryListEvent): void => {
    this.reducedMotion = event.matches;
    this.cameraDirector.setReducedMotion(event.matches);
  };

  private readonly onWindowResize = (): void => this.resize();

  private fireAt(ndc: Vector2): boolean {
    if (this.state.phase !== "hunt" || this.state.paused) return false;
    const target = this.resolveRayTarget(ndc);
    const creature = creatureFromState(this.state, target.creatureId);
    const valid = creature !== null && isLiveWavingTarget(creature, this.state);
    if (valid && target.creatureId !== null) {
      const accepted = this.session.zapCreature(target.creatureId);
      this.focusCreature(target.creatureId);
      return accepted.accepted;
    }

    this.session.registerMiss();
    this.beams.fire(this.playerBeamOrigin(), target.point, OPERATOR_COLORS.miss, 0.055, 260);
    this.focusCreature(target.creatureId);
    return false;
  }

  private resolveRayTarget(ndc: Vector2): RayTarget {
    this.raycaster.setFromCamera(ndc, this.cameraDirector.camera);
    const creatureHit = this.raycaster.intersectObject(this.creatureField.pickTargets, false)[0];
    if (creatureHit) {
      return {
        creatureId: this.creatureField.creatureIdForInstance(creatureHit.instanceId),
        point: creatureHit.point.clone(),
      };
    }
    const groundHit = this.raycaster.intersectObject(this.playground.pickSurface, false)[0];
    if (groundHit) return { creatureId: null, point: groundHit.point.clone() };
    return {
      creatureId: null,
      point: this.raycaster.ray.origin.clone().addScaledVector(this.raycaster.ray.direction, 38),
    };
  }

  private updateReticle(): void {
    const target = this.resolveRayTarget(this.reticleNdc);
    const creature = creatureFromState(this.state, target.creatureId);
    const canZap = creature !== null && isLiveWavingTarget(creature, this.state);
    this.publishReticle(target.creatureId, canZap, true);
    if (target.creatureId !== this.focusedCreatureId) this.focusCreature(target.creatureId);
  }

  private publishReticle(creatureId: string | null, canZap: boolean, visible: boolean): void {
    const detail: ReticleDetail = {
      creatureId,
      canZap,
      normalizedX: this.reticleNdc.x,
      normalizedY: this.reticleNdc.y,
      visible,
    };
    const key = `${creatureId ?? ""}:${canZap ? 1 : 0}:${visible ? 1 : 0}:${detail.normalizedX.toFixed(3)}:${detail.normalizedY.toFixed(3)}`;
    if (key === this.lastReticleKey) return;
    this.lastReticleKey = key;
    window.dispatchEvent(new CustomEvent<ReticleDetail>(RETICLE_EVENT, { detail }));
  }

  private presentZaps(zaps: readonly ZapPresentation[]): void {
    for (const zap of zaps) {
      const operator = operatorFor(zap.zappedBy, zap.creatureId);
      const origin = operator === "player"
        ? this.playerBeamOrigin()
        : operator === "left"
          ? this.watchtower.leftBeamOrigin
          : this.watchtower.rightBeamOrigin;
      const color = operator === "player"
        ? OPERATOR_COLORS.player
        : operator === "left"
          ? OPERATOR_COLORS.left
          : OPERATOR_COLORS.right;
      this.beams.fire(origin, zap.position.clone().add(new Vector3(0, 1.05, 0)), color, 0.085, 450);
    }
  }

  private presentPhaseTransition(): void {
    const phase = String(this.state.phase);
    if (phase === this.lastPhase) return;
    if (phase === "death") {
      const target = this.cameraDirector.camera.position.clone().add(new Vector3(0, -0.25, -0.7));
      const useLeft = (stableHash(String(this.state.seed)) & 1) === 0;
      this.beams.fire(
        useLeft ? this.watchtower.leftBeamOrigin : this.watchtower.rightBeamOrigin,
        target,
        useLeft ? OPERATOR_COLORS.left : OPERATOR_COLORS.right,
        0.085,
        450,
      );
    }
    this.lastPhase = phase;
  }

  private playerBeamOrigin(): Vector3 {
    return this.cameraDirector.camera.localToWorld(new Vector3(0.46, -0.44, -0.72));
  }

  private readPointer(event: PointerEvent, target: Vector2): void {
    const bounds = this.renderer.domElement.getBoundingClientRect();
    const width = Math.max(1, bounds.width);
    const height = Math.max(1, bounds.height);
    target.set(
      MathUtils.clamp((event.clientX - bounds.left) / width * 2 - 1, -1, 1),
      MathUtils.clamp(-((event.clientY - bounds.top) / height) * 2 + 1, -1, 1),
    );
  }

  private resize(): void {
    if (this.destroyed) return;
    const bounds = this.parent.getBoundingClientRect();
    const width = Math.max(1, Math.round(bounds.width || this.parent.clientWidth || window.innerWidth));
    const height = Math.max(1, Math.round(bounds.height || this.parent.clientHeight || window.innerHeight));
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    this.renderer.setSize(width, height, false);
    this.cameraDirector.setAspect(width / height);
  }

  private ensurePopulation(creatures: readonly CreatureRuntimeState[]): void {
    const signature = populationSignature(creatures);
    if (signature === this.populationSignature) return;
    this.scene.remove(this.creatureField);
    this.creatureField.dispose();
    this.creatureField = new CreatureField(creatures);
    this.scene.add(this.creatureField);
    this.populationSignature = signature;
    this.focusedCreatureId = null;
  }

  private addLights(): void {
    const hemisphere = new HemisphereLight(PALETTE.cream, PALETTE.abyss, 2.25);
    hemisphere.position.set(0, 18, 2);
    const key = new DirectionalLight(PALETTE.cream, 3.3);
    key.position.set(-8, 18, 13);
    const fill = new DirectionalLight(PALETTE.cyan, 1.15);
    fill.position.set(14, 9, -9);
    const ambient = new AmbientLight(PALETTE.cream, 1.8);
    this.scene.add(hemisphere, key, fill, ambient);
  }

  private bindEvents(): void {
    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointerenter", this.onPointerEnter);
    canvas.addEventListener("pointerleave", this.onPointerLeave);
    canvas.addEventListener("webglcontextlost", this.onContextLost);
    canvas.addEventListener("webglcontextrestored", this.onContextRestored);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    window.addEventListener("resize", this.onWindowResize);
    this.mediaQuery.addEventListener("change", this.onReducedMotionChange);
  }

  private unbindEvents(): void {
    const canvas = this.renderer.domElement;
    canvas.removeEventListener("pointermove", this.onPointerMove);
    canvas.removeEventListener("pointerdown", this.onPointerDown);
    canvas.removeEventListener("pointerenter", this.onPointerEnter);
    canvas.removeEventListener("pointerleave", this.onPointerLeave);
    canvas.removeEventListener("webglcontextlost", this.onContextLost);
    canvas.removeEventListener("webglcontextrestored", this.onContextRestored);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    window.removeEventListener("resize", this.onWindowResize);
    this.mediaQuery.removeEventListener("change", this.onReducedMotionChange);
  }

  private publishRenderStatus(status: RenderStatusDetail["status"], message: string): void {
    window.dispatchEvent(new CustomEvent<RenderStatusDetail>(RENDER_STATUS_EVENT, {
      detail: { status, message },
    }));
  }
}

function isLiveWavingTarget(creature: CreatureRuntimeState, state: DontWaveState): boolean {
  const renderCreature = creature as CreatureRuntimeState & { readonly zappedBy?: unknown };
  return state.phase === "hunt"
    && !state.paused
    && String(creature.pose) === "waving"
    && (renderCreature.zappedBy === null || renderCreature.zappedBy === undefined)
    && !isResolvedStatus(creature.status);
}

function isResolvedStatus(status: CreatureRuntimeState["status"]): boolean {
  const value = String(status);
  return value === "zapped" || value === "removed" || value === "dead" || value === "crossed" || value === "sheltered";
}

function operatorFor(zappedBy: string, creatureId: string): "player" | "left" | "right" {
  const normalized = zappedBy.toLowerCase();
  if (normalized.includes("player") || normalized.includes("observer")) return "player";
  if (normalized.includes("left")) return "left";
  if (normalized.includes("right")) return "right";
  return (stableHash(`${zappedBy}:${creatureId}`) & 1) === 0 ? "left" : "right";
}

function populationSignature(creatures: readonly CreatureRuntimeState[]): string {
  return creatures.map((creature) => `${creature.id}:${JSON.stringify(creature.visual)}`).join("|");
}

function creatureFromState(state: DontWaveState, creatureId: string | null): CreatureRuntimeState | null {
  if (creatureId === null) return null;
  return state.creatures.find((creature) => creature.id === creatureId) ?? null;
}
