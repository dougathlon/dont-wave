import type { DontWaveSession } from "../simulation/DontWaveSession";

const EDITABLE_SELECTOR = "input, textarea, select, option, [contenteditable='true']";
const NATIVE_ACTIVATION_SELECTOR = "button, summary, a[href], [role='button'], [role='menuitem'], [role='option']";
type MovementCode = "Space" | "KeyW";

export class InputController {
  private readonly heldMovementCodes = new Set<MovementCode>();
  private readonly unsubscribe: () => void;
  private destroyed = false;

  constructor(
    private readonly session: DontWaveSession,
    private readonly fireAtReticle: () => boolean,
    private readonly nudgeReticle: (deltaX: number, deltaY: number) => void,
  ) {
    this.unsubscribe = session.subscribe((state) => {
      if (state.phase !== "crossing-green") this.clearHeldMovement();
    });
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.clearHeldMovement);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unsubscribe();
    this.clearHeldMovement();
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.clearHeldMovement);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (ownsKeyboardInput(event)) return;
    const state = this.session.getState();
    const reticleStep = reticleDirection(event.code);
    if (reticleStep && state.phase === "hunt") {
      event.preventDefault();
      this.nudgeReticle(reticleStep[0], reticleStep[1]);
      return;
    }
    if (event.repeat) return;
    if (event.code === "KeyG" && state.phase === "ready") {
      event.preventDefault();
      this.session.startGreen();
      return;
    }
    if (event.code === "KeyR" && state.phase === "green") {
      event.preventDefault();
      this.session.triggerRed();
      return;
    }
    if (event.code === "Space" && state.phase === "hunt") {
      event.preventDefault();
      this.fireAtReticle();
      return;
    }
    if (isMovementCode(event.code) && state.phase === "crossing-green") {
      event.preventDefault();
      this.heldMovementCodes.add(event.code);
      this.session.setPlayerMoving(true);
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (!isMovementCode(event.code) || !this.heldMovementCodes.has(event.code)) return;
    event.preventDefault();
    this.heldMovementCodes.delete(event.code);
    this.session.setPlayerMoving(this.heldMovementCodes.size > 0);
  };

  private readonly onVisibilityChange = (): void => {
    if (document.hidden) this.clearHeldMovement();
  };

  private readonly clearHeldMovement = (): void => {
    if (this.heldMovementCodes.size === 0) return;
    this.heldMovementCodes.clear();
    this.session.setPlayerMoving(false);
  };
}

function isMovementCode(code: string): code is MovementCode {
  return code === "Space" || code === "KeyW";
}

function reticleDirection(code: string): readonly [number, number] | null {
  if (code === "ArrowLeft") return [-0.075, 0];
  if (code === "ArrowRight") return [0.075, 0];
  if (code === "ArrowUp") return [0, 0.075];
  if (code === "ArrowDown") return [0, -0.075];
  return null;
}

function ownsKeyboardInput(event: KeyboardEvent): boolean {
  const eventTarget = event.target instanceof Element ? event.target : null;
  const activeElement = document.activeElement instanceof Element ? document.activeElement : null;
  const target = eventTarget ?? activeElement;
  if (target?.closest(EDITABLE_SELECTOR)) return true;
  return (event.code === "Space" || event.code === "Enter") && Boolean(target?.closest(NATIVE_ACTIVATION_SELECTOR));
}
