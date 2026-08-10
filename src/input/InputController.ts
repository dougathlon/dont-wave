import type { DontWaveSession } from "../simulation/DontWaveSession";

const EDITABLE_SELECTOR = [
  "input",
  "textarea",
  "select",
  "option",
  "[contenteditable='true']",
].join(",");

const NATIVE_ACTIVATION_SELECTOR = [
  "button",
  "summary",
  "a[href]",
  "[role='button']",
  "[role='menuitem']",
  "[role='option']",
].join(",");

type MovementCode = "Space" | "KeyW";

export class InputController {
  private destroyed = false;
  private readonly heldMovementCodes = new Set<MovementCode>();
  private readonly unsubscribeSession: () => void;

  constructor(
    private readonly session: DontWaveSession,
    private readonly fireAtReticle: () => boolean,
  ) {
    this.unsubscribeSession = session.subscribe((state) => {
      if (state.paused || state.phase !== "crossing-green") this.heldMovementCodes.clear();
    });
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("blur", this.clearHeldMovement);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unsubscribeSession();
    this.clearHeldMovement();
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("blur", this.clearHeldMovement);
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat || ownsKeyboardInput(event)) return;
    const state = this.session.getState();

    if (event.code === "Escape") {
      event.preventDefault();
      this.clearHeldMovement();
      this.session.togglePause();
      return;
    }
    if (event.code === "KeyG") {
      event.preventDefault();
      this.session.startGreen();
      return;
    }
    if (event.code === "KeyR") {
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

  private handleKeyUp = (event: KeyboardEvent): void => {
    if (!isMovementCode(event.code) || !this.heldMovementCodes.has(event.code)) return;
    event.preventDefault();
    this.heldMovementCodes.delete(event.code);
    this.session.setPlayerMoving(this.heldMovementCodes.size > 0);
  };

  private handleVisibilityChange = (): void => {
    if (!document.hidden) return;
    this.clearHeldMovement();
    this.session.pause();
  };

  private clearHeldMovement = (): void => {
    this.heldMovementCodes.clear();
    this.session.setPlayerMoving(false);
  };
}

function isMovementCode(code: string): code is MovementCode {
  return code === "Space" || code === "KeyW";
}

function ownsKeyboardInput(event: KeyboardEvent): boolean {
  const eventTarget = event.target instanceof Element ? event.target : null;
  const activeElement = document.activeElement instanceof Element ? document.activeElement : null;
  const target = eventTarget ?? activeElement;
  if (target?.closest(EDITABLE_SELECTOR)) return true;
  return (event.code === "Space" || event.code === "Enter")
    && Boolean(target?.closest(NATIVE_ACTIVATION_SELECTOR));
}
