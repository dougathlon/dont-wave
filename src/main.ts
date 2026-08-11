import "./styles.css";
import { AudioDirector } from "./audio/AudioDirector";
import {
  DRY_FIRE_EVENT,
  DontWaveWorld,
  RENDER_STATUS_EVENT,
  RETICLE_EVENT,
  type ContestantProjection,
  type RenderStatusDetail,
  type ReticleDetail,
} from "./game/DontWaveWorld";
import type { CameraSnapshot } from "./game/CameraDirector";
import { InputController } from "./input/InputController";
import { DontWaveSession } from "./simulation/DontWaveSession";
import type { DontWaveState, FireResult } from "./simulation/types";
import { DontWaveUI } from "./ui";

interface DontWaveRuntime {
  state(): DontWaveState;
  start(): DontWaveState;
  startGreen(): DontWaveState;
  triggerRed(): DontWaveState;
  advance(milliseconds: number): DontWaveState;
  fire(targetId: string | null): FireResult;
  continueRound(): DontWaveState;
  leaveTower(): DontWaveState;
  beginCrossing(): DontWaveState;
  setPlayerMoving(moving: boolean): DontWaveState;
  restart(seed?: number): DontWaveState;
  fireAtReticle(): boolean;
  projectContestant(id: string): ContestantProjection | null;
  cameraSnapshot(): CameraSnapshot;
}

declare global {
  interface Window {
    __DONT_WAVE__: DontWaveRuntime;
  }
}

const gameRoot = document.querySelector<HTMLElement>("#game-root");
const uiRoot = document.querySelector<HTMLElement>("#ui-root");
if (!gameRoot || !uiRoot) throw new Error("Don't Wave could not find its application roots.");

const session = new DontWaveSession(readSeed());
const world = new DontWaveWorld(gameRoot, session, { autoTick: !usesManualClock() });
const audio = new AudioDirector();
const ui = new DontWaveUI(uiRoot, {
  start: () => { audio.unlock(); session.start(); },
  startGreen: () => { audio.unlock(); session.startGreen(); },
  triggerRed: () => { audio.unlock(); session.triggerRed(); },
  continueRound: () => { session.continueRound(); },
  leaveTower: () => { session.leaveTower(); },
  beginCrossing: () => { audio.unlock(); session.beginCrossing(); },
  setPlayerMoving: (moving) => { session.setPlayerMoving(moving); },
  restart: () => { session.restart(); },
});
const input = new InputController(
  session,
  () => world.fireAtReticle(),
  (deltaX, deltaY) => world.nudgeReticle(deltaX, deltaY),
);

let previousState = session.getState();
const unsubscribe = session.subscribe((state) => {
  ui.render(state);
  audio.sync(previousState, state);
  world.setPointerActive(state.phase === "hunt");
  previousState = state;
});

const onReticle = (event: Event): void => {
  const detail = (event as CustomEvent<ReticleDetail>).detail;
  ui.setReticle({ x: detail.x, y: detail.y, visible: detail.visible });
};
const onRenderStatus = (event: Event): void => {
  const detail = (event as CustomEvent<RenderStatusDetail>).detail;
  ui.setSystemNotice(detail.status === "restored" ? "" : detail.message);
};
const onDryFire = (): void => {
  ui.flashDryFire();
  audio.dryFire();
};
window.addEventListener(RETICLE_EVENT, onReticle);
window.addEventListener(RENDER_STATUS_EVENT, onRenderStatus);
window.addEventListener(DRY_FIRE_EVENT, onDryFire);

window.__DONT_WAVE__ = {
  state: () => session.getState(),
  start: () => { audio.unlock(); session.start(); return session.getState(); },
  startGreen: () => { audio.unlock(); session.startGreen(); return session.getState(); },
  triggerRed: () => { session.triggerRed(); return session.getState(); },
  advance: (milliseconds) => advanceSession(session, milliseconds),
  fire: (targetId) => session.fire(targetId),
  continueRound: () => { session.continueRound(); return session.getState(); },
  leaveTower: () => { session.leaveTower(); return session.getState(); },
  beginCrossing: () => { session.beginCrossing(); return session.getState(); },
  setPlayerMoving: (moving) => { session.setPlayerMoving(moving); return session.getState(); },
  restart: (seed) => { session.restart(seed); return session.getState(); },
  fireAtReticle: () => world.fireAtReticle(),
  projectContestant: (id) => world.projectContestant(id),
  cameraSnapshot: () => world.cameraSnapshot(),
};

window.addEventListener("beforeunload", () => {
  unsubscribe();
  input.destroy();
  ui.destroy();
  audio.destroy();
  world.destroy();
}, { once: true });

function advanceSession(target: DontWaveSession, milliseconds: number): DontWaveState {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return target.getState();
  let remaining = Math.min(milliseconds, 60_000);
  while (remaining > 0) {
    const step = Math.min(16, remaining);
    target.tick(step);
    remaining -= step;
  }
  return target.getState();
}

function readSeed(): number {
  const raw = new URLSearchParams(window.location.search).get("seed");
  if (!raw) return 7071;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 7071;
}

function usesManualClock(): boolean {
  return new URLSearchParams(window.location.search).get("clock") === "manual";
}
