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
import type { ContestantState, DontWaveState, FireResult, ShotEvent } from "../simulation/types";
import { CameraDirector, type CameraSnapshot } from "./CameraDirector";
import { MAX_FRAME_DELTA_MS, MAX_PIXEL_RATIO, OPERATOR_COLORS, PALETTE } from "./constants";
import { CreatureField } from "./creatures/CreatureField";
import { BeamPool } from "./fx/BeamPool";
import { VaporPool } from "./fx/VaporPool";
import { CivicPlayground } from "./world/CivicPlayground";
import { RivalTowers } from "./world/Watchtower";

export const RETICLE_EVENT = "dont-wave:reticle";
export const RENDER_STATUS_EVENT = "dont-wave:render-status";
export const DRY_FIRE_EVENT = "dont-wave:dry-fire";

export interface ReticleDetail {
  readonly x: number;
  readonly y: number;
  readonly visible: boolean;
}

export interface RenderStatusDetail {
  readonly status: "lost" | "restored";
  readonly message: string;
}

export interface ContestantProjection {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly visible: boolean;
  readonly pose: ContestantState["pose"];
  readonly status: ContestantState["status"];
}

interface RayTarget {
  readonly contestantId: string | null;
  readonly point: Vector3;
}

export interface DontWaveWorldOptions {
  readonly autoTick?: boolean;
}

/** Fixed-camera Three.js adapter. It never owns movement, outcomes, ammunition, or score. */
export class DontWaveWorld {
  readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly cameraDirector = new CameraDirector();
  private readonly playground = new CivicPlayground();
  private readonly towers = new RivalTowers();
  private readonly beams = new BeamPool(28);
  private readonly vapor = new VaporPool(24);
  private readonly raycaster = new Raycaster();
  private readonly reticleNdc = new Vector2();
  private readonly scratch = new Vector3();
  private readonly mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  private readonly resizeObserver: ResizeObserver | null;
  private creatureField: CreatureField;
  private state: DontWaveState;
  private readonly unsubscribe: () => void;
  private populationSignature: string;
  private animationFrame = 0;
  private lastFrameAt = 0;
  private elapsedMs = 0;
  private presentedEventId = 0;
  private lastPhase: DontWaveState["phase"] | "" = "";
  private reducedMotion = this.mediaQuery.matches;
  private pointerInside = false;
  private pointerActive = false;
  private contextAvailable = true;
  private destroyed = false;
  private readonly autoTick: boolean;

  constructor(
    private readonly parent: HTMLElement,
    private readonly session: DontWaveSession,
    options: DontWaveWorldOptions = {},
  ) {
    if (!(parent instanceof HTMLElement)) throw new Error("Don't Wave requires a valid render parent.");
    this.autoTick = options.autoTick ?? true;
    this.state = session.getState();
    this.populationSignature = signature(this.state);
    this.creatureField = new CreatureField(this.state.contestants);

    this.scene.name = "dont-wave-reset-world";
    this.scene.background = PALETTE.sky;
    this.scene.fog = new Fog(PALETTE.fog, 34, 78);
    this.scene.add(
      this.cameraDirector.camera,
      this.playground,
      this.towers,
      this.creatureField,
      this.beams,
      this.vapor,
    );
    this.addLights();

    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.03;
    this.renderer.setClearColor(PALETTE.sky, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    this.renderer.domElement.className = "dont-wave-canvas";
    this.renderer.domElement.setAttribute("aria-label", "Fixed watchtower view of grotesque humanoids crossing toward the tower");
    this.renderer.domElement.setAttribute("role", "application");
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.touchAction = "none";
    this.parent.append(this.renderer.domElement);

    this.unsubscribe = session.subscribe((state) => {
      this.state = state;
      this.ensurePopulation();
      if (state.events.length === 0) this.presentedEventId = 0;
    });
    this.resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => this.resize());
    this.resizeObserver?.observe(parent);
    this.bindEvents();
    this.resize();
    this.animationFrame = requestAnimationFrame(this.frame);
  }

  setPointerActive(active: boolean): void {
    this.pointerActive = active;
    if (!active) {
      this.pointerInside = false;
      this.publishReticle(false);
    }
  }

  fireAtReticle(): boolean {
    if (!this.pointerActive || !this.contextAvailable || this.destroyed) return false;
    return this.fireAt(this.reticleNdc);
  }

  nudgeReticle(deltaX: number, deltaY: number): void {
    if (!this.pointerActive || this.destroyed) return;
    this.pointerInside = true;
    this.reticleNdc.set(
      MathUtils.clamp(this.reticleNdc.x + deltaX, -0.96, 0.96),
      MathUtils.clamp(this.reticleNdc.y + deltaY, -0.96, 0.96),
    );
    this.publishReticle(true);
  }

  projectContestant(id: string): ContestantProjection | null {
    const contestant = this.state.contestants.find((candidate) => candidate.id === id);
    const center = this.creatureField.centerFor(id, this.scratch);
    if (!contestant || !center) return null;
    const bounds = this.renderer.domElement.getBoundingClientRect();
    const projected = center.clone().project(this.cameraDirector.camera);
    const onScreen = projected.z >= -1 && projected.z <= 1 && Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1;
    return {
      id,
      x: bounds.left + (projected.x + 1) * 0.5 * bounds.width,
      y: bounds.top + (1 - (projected.y + 1) * 0.5) * bounds.height,
      visible: contestant.status === "active" && onScreen,
      pose: contestant.pose,
      status: contestant.status,
    };
  }

  cameraSnapshot(): CameraSnapshot {
    return this.cameraDirector.snapshot();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.animationFrame);
    this.unsubscribe();
    this.resizeObserver?.disconnect();
    this.unbindEvents();
    this.creatureField.dispose();
    this.cameraDirector.dispose();
    this.playground.dispose();
    this.towers.dispose();
    this.beams.dispose();
    this.vapor.dispose();
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
    const deltaMs = this.lastFrameAt === 0 ? 0 : Math.min(MAX_FRAME_DELTA_MS, Math.max(0, now - this.lastFrameAt));
    this.lastFrameAt = now;
    if (deltaMs > 0 && this.autoTick) this.session.tick(deltaMs);
    this.elapsedMs += deltaMs;
    this.cameraDirector.update(this.state, this.elapsedMs, this.reducedMotion);
    this.creatureField.sync(this.state.contestants, this.elapsedMs, this.reducedMotion);
    this.presentEvents();
    this.presentPhaseTransition();
    this.beams.update(deltaMs);
    this.vapor.update(deltaMs);
    this.renderer.render(this.scene, this.cameraDirector.camera);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.pointerActive) return;
    this.pointerInside = true;
    this.readPointer(event, this.reticleNdc);
    this.publishReticle(true);
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.pointerActive || !event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    this.renderer.domElement.focus({ preventScroll: true });
    this.pointerInside = true;
    this.readPointer(event, this.reticleNdc);
    this.publishReticle(true);
    this.fireAt(this.reticleNdc);
  };

  private readonly onPointerEnter = (): void => {
    if (!this.pointerActive) return;
    this.pointerInside = true;
    this.publishReticle(true);
  };

  private readonly onPointerLeave = (): void => {
    this.pointerInside = false;
    this.publishReticle(false);
  };

  private readonly onContextLost = (event: Event): void => {
    event.preventDefault();
    this.contextAvailable = false;
    this.lastFrameAt = 0;
    this.publishStatus("lost", "WebGL context lost. The game clock is held.");
  };

  private readonly onContextRestored = (): void => {
    this.contextAvailable = true;
    this.lastFrameAt = 0;
    this.renderer.resetState();
    this.resize();
    this.publishStatus("restored", "WebGL context restored.");
  };

  private readonly onVisibilityChange = (): void => {
    this.lastFrameAt = 0;
  };

  private readonly onReducedMotionChange = (event: MediaQueryListEvent): void => {
    this.reducedMotion = event.matches;
  };

  private readonly onResize = (): void => this.resize();

  private fireAt(ndc: Vector2): boolean {
    if (this.state.phase !== "hunt") return false;
    const target = this.resolveRayTarget(ndc);
    const result = this.session.fire(target.contestantId);
    if (!result.fired) {
      if (result.reason === "no-ammo") window.dispatchEvent(new Event(DRY_FIRE_EVENT));
      return false;
    }
    if (result.event.outcome === "empty") {
      this.beams.fire(this.playerBeamOrigin(), target.point, OPERATOR_COLORS.empty, 0.05, 210);
    }
    return result.event.outcome === "correct";
  }

  private resolveRayTarget(ndc: Vector2): RayTarget {
    this.raycaster.setFromCamera(ndc, this.cameraDirector.camera);
    const contestantHit = this.raycaster.intersectObjects([...this.creatureField.pickableTargets()], false)[0];
    if (contestantHit) {
      return {
        contestantId: this.creatureField.contestantIdForObject(contestantHit.object),
        point: contestantHit.point.clone(),
      };
    }
    const groundHit = this.raycaster.intersectObject(this.playground.pickSurface, false)[0];
    if (groundHit) return { contestantId: null, point: groundHit.point.clone() };
    return {
      contestantId: null,
      point: this.raycaster.ray.origin.clone().addScaledVector(this.raycaster.ray.direction, 45),
    };
  }

  private presentEvents(): void {
    for (const event of this.state.events) {
      if (event.id <= this.presentedEventId) continue;
      this.presentedEventId = event.id;
      if (!event.targetId) continue;
      const target = this.creatureField.centerFor(event.targetId, this.scratch);
      if (!target) continue;
      const origin = event.operator === "player"
        ? this.playerBeamOrigin()
        : event.operator === "left"
          ? this.towers.leftBeamOrigin
          : this.towers.rightBeamOrigin;
      const color = eventColor(event);
      const rivalShot = event.operator !== "player";
      this.beams.fire(origin, target, color, rivalShot ? 0.12 : 0.08, rivalShot ? 650 : 360);
      this.vapor.burst(target, color);
    }
  }

  private presentPhaseTransition(): void {
    if (this.state.phase === this.lastPhase) return;
    if (this.state.phase === "death") {
      const origin = this.state.leftScore <= this.state.rightScore ? this.towers.leftBeamOrigin : this.towers.rightBeamOrigin;
      const color = origin === this.towers.leftBeamOrigin ? OPERATOR_COLORS.left : OPERATOR_COLORS.right;
      this.beams.fire(origin, this.cameraDirector.camera.position.clone(), color, 0.16, 800);
    }
    this.lastPhase = this.state.phase;
  }

  private playerBeamOrigin(): Vector3 {
    return this.cameraDirector.camera.localToWorld(new Vector3(0.42, -0.34, -0.68));
  }

  private publishReticle(visible: boolean): void {
    window.dispatchEvent(new CustomEvent<ReticleDetail>(RETICLE_EVENT, {
      detail: {
        x: (this.reticleNdc.x + 1) * 0.5,
        y: 1 - (this.reticleNdc.y + 1) * 0.5,
        visible: visible && this.pointerInside && this.pointerActive,
      },
    }));
  }

  private readPointer(event: PointerEvent, target: Vector2): void {
    const bounds = this.renderer.domElement.getBoundingClientRect();
    target.set(
      MathUtils.clamp((event.clientX - bounds.left) / Math.max(1, bounds.width) * 2 - 1, -1, 1),
      MathUtils.clamp(-((event.clientY - bounds.top) / Math.max(1, bounds.height) * 2 - 1), -1, 1),
    );
  }

  private resize(): void {
    if (this.destroyed) return;
    const bounds = this.parent.getBoundingClientRect();
    const width = Math.max(1, Math.round(bounds.width || window.innerWidth));
    const height = Math.max(1, Math.round(bounds.height || window.innerHeight));
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    this.renderer.setSize(width, height, false);
    this.cameraDirector.setAspect(width / height);
  }

  private ensurePopulation(): void {
    const nextSignature = signature(this.state);
    if (nextSignature === this.populationSignature) return;
    this.scene.remove(this.creatureField);
    this.creatureField.dispose();
    this.creatureField = new CreatureField(this.state.contestants);
    this.scene.add(this.creatureField);
    this.populationSignature = nextSignature;
  }

  private addLights(): void {
    const sky = new HemisphereLight(0xe3ece3, 0x574e43, 2.4);
    sky.position.set(0, 20, 0);
    const sun = new DirectionalLight(0xfff0cf, 3.1);
    sun.position.set(-11, 22, 14);
    const fill = new DirectionalLight(0x9fd5d0, 1.2);
    fill.position.set(15, 10, -18);
    const ambient = new AmbientLight(0xded1b5, 1.15);
    this.scene.add(sky, sun, fill, ambient);
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
    window.addEventListener("resize", this.onResize);
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
    window.removeEventListener("resize", this.onResize);
    this.mediaQuery.removeEventListener("change", this.onReducedMotionChange);
  }

  private publishStatus(status: RenderStatusDetail["status"], message: string): void {
    window.dispatchEvent(new CustomEvent<RenderStatusDetail>(RENDER_STATUS_EVENT, { detail: { status, message } }));
  }
}

function eventColor(event: ShotEvent): number {
  if (event.operator === "left") return OPERATOR_COLORS.left;
  if (event.operator === "right") return OPERATOR_COLORS.right;
  return event.outcome === "wrong" ? OPERATOR_COLORS.wrong : OPERATOR_COLORS.player;
}

function signature(state: DontWaveState): string {
  return `${state.seed}:${state.crowdRevision}:${state.contestants.map((contestant) => (
    `${contestant.id}:${contestant.x}:${contestant.startZ}:${JSON.stringify(contestant.visual)}`
  )).join("|")}`;
}

export function wasFired(result: FireResult): result is Extract<FireResult, { fired: true }> {
  return result.fired;
}
