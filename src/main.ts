import "./styles.css";
import { AudioDirector } from "./audio/AudioDirector";
import {
  DontWaveWorld,
  RENDER_STATUS_EVENT,
  RETICLE_EVENT,
  type RenderStatusDetail,
  type ReticleDetail,
} from "./game/DontWaveWorld";
import { InputController } from "./input/InputController";
import { DontWaveSession } from "./simulation/DontWaveSession";
import type { DontWaveState, ZapCreatureResult } from "./simulation/types";
import { DontWaveUI } from "./ui";

interface DontWaveRuntime {
  state(): DontWaveState;
  start(): DontWaveState;
  startGreen(): DontWaveState;
  triggerRed(): DontWaveState;
  advance(milliseconds: number): DontWaveState;
  zapCreature(creatureId: string): ZapCreatureResult;
  registerMiss(): DontWaveState;
  continueFromReport(): DontWaveState;
  beginCrossing(): DontWaveState;
  setPlayerMoving(moving: boolean): DontWaveState;
  togglePause(): DontWaveState;
  restart(seed?: number): DontWaveState;
  fireAtReticle(): boolean;
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
const world = new DontWaveWorld(gameRoot, session);
const audio = new AudioDirector();
const ui = new DontWaveUI(uiRoot, {
  start: () => { audio.unlock(); session.start(); },
  startGreen: () => { session.startGreen(); },
  triggerRed: () => { session.triggerRed(); },
  continueFromReport: () => { session.continueFromReport(); },
  beginCrossing: () => { session.beginCrossing(); },
  setPlayerMoving: (moving) => { session.setPlayerMoving(moving); },
  togglePause: () => { session.togglePause(); },
  restart: () => { session.restart(); },
});
const input = new InputController(session, () => world.fireAtReticle());
let previousState = session.getState();
const unsubscribeUI = session.subscribe((state) => {
  ui.render(state);
  if (state.playerHits > previousState.playerHits) ui.flashShot(true);
  else if (state.playerMisses > previousState.playerMisses) ui.flashShot(false);
  audio.sync(previousState, state);
  previousState = state;
});

const onReticle = (event: Event): void => {
  const detail = (event as CustomEvent<ReticleDetail>).detail;
  ui.setReticle({
    x: (detail.normalizedX + 1) / 2,
    y: (1 - detail.normalizedY) / 2,
    visible: detail.visible,
    canZap: detail.canZap,
  });
};

const onRenderStatus = (event: Event): void => {
  const detail = (event as CustomEvent<RenderStatusDetail>).detail;
  if (detail.status === "lost") {
    session.pause();
    ui.setSystemNotice(detail.message);
  } else {
    ui.setSystemNotice("");
  }
};

window.addEventListener(RETICLE_EVENT, onReticle);
window.addEventListener(RENDER_STATUS_EVENT, onRenderStatus);

window.__DONT_WAVE__ = {
  state: runtimeStateSnapshot,
  start: () => mutateAndSnapshot(() => { session.start(); }),
  startGreen: () => mutateAndSnapshot(() => { session.startGreen(); }),
  triggerRed: () => mutateAndSnapshot(() => { session.triggerRed(); }),
  advance: (milliseconds) => {
    advanceSession(milliseconds);
    return runtimeStateSnapshot();
  },
  zapCreature: (creatureId) => session.zapCreature(creatureId),
  registerMiss: () => mutateAndSnapshot(() => { session.registerMiss(); }),
  continueFromReport: () => mutateAndSnapshot(() => { session.continueFromReport(); }),
  beginCrossing: () => mutateAndSnapshot(() => { session.beginCrossing(); }),
  setPlayerMoving: (moving) => mutateAndSnapshot(() => { session.setPlayerMoving(moving); }),
  togglePause: () => mutateAndSnapshot(() => { session.togglePause(); }),
  restart: (seed) => mutateAndSnapshot(() => { session.restart(seed); }),
  fireAtReticle: () => world.fireAtReticle(),
};

window.addEventListener("beforeunload", () => {
  window.removeEventListener(RETICLE_EVENT, onReticle);
  window.removeEventListener(RENDER_STATUS_EVENT, onRenderStatus);
  unsubscribeUI();
  input.destroy();
  ui.destroy();
  audio.destroy();
  world.destroy();
}, { once: true });

function readSeed(): number {
  const value = new URLSearchParams(window.location.search).get("seed");
  if (value === null) return 7_071;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 7_071;
}

function advanceSession(milliseconds: number): void {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return;
  let remaining = Math.min(milliseconds, 120_000);
  while (remaining > 0) {
    const step = Math.min(50, remaining);
    session.tick(step);
    remaining -= step;
  }
}

function mutateAndSnapshot(mutation: () => void): DontWaveState {
  mutation();
  return runtimeStateSnapshot();
}

function runtimeStateSnapshot(): DontWaveState {
  return structuredClone(session.getState());
}
