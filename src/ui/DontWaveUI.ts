import type { DontWavePhase, DontWaveState, ShotEvent } from "../simulation/types";

export interface DontWaveUIActions {
  readonly start: () => void;
  readonly startGreen: () => void;
  readonly triggerRed: () => void;
  readonly continueRound: () => void;
  readonly leaveTower: () => void;
  readonly beginCrossing: () => void;
  readonly setPlayerMoving: (moving: boolean) => void;
  readonly restart: () => void;
}

export interface ReticlePosition {
  readonly x: number;
  readonly y: number;
  readonly visible: boolean;
}

const FOCUSABLE = "button:not(:disabled), [href], input:not(:disabled), [tabindex]:not([tabindex='-1'])";

export class DontWaveUI {
  private readonly shell: HTMLElement;
  private readonly hud: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly controls: HTMLElement;
  private readonly greenButton: HTMLButtonElement;
  private readonly redButton: HTMLButtonElement;
  private readonly moveButton: HTMLButtonElement;
  private readonly reticle: HTMLElement;
  private readonly feedback: HTMLElement;
  private readonly chargePips: readonly HTMLElement[];
  private state: DontWaveState | null = null;
  private overlayKey = "";
  private lastPlayerEventId = 0;
  private feedbackTimer = 0;
  private movingPointerId: number | null = null;
  private systemNotice = "";
  private reticleVisible = false;

  constructor(private readonly root: HTMLElement, private readonly actions: DontWaveUIActions) {
    root.innerHTML = shellMarkup();
    this.shell = required(root, ".dw-shell");
    this.hud = required(root, "[data-ui='hud']");
    this.overlay = required(root, "[data-ui='overlay']");
    this.controls = required(root, "[data-ui='controls']");
    this.greenButton = required(root, "[data-action='green']");
    this.redButton = required(root, "[data-action='red']");
    this.moveButton = required(root, "[data-action='move']");
    this.reticle = required(root, "[data-ui='reticle']");
    this.feedback = required(root, "[data-ui='feedback']");
    this.chargePips = [...root.querySelectorAll<HTMLElement>("[data-ui='charge-pip']")];
    root.addEventListener("click", this.onClick);
    root.addEventListener("pointerdown", this.onPointerDown);
    root.addEventListener("pointerup", this.onPointerRelease);
    root.addEventListener("pointercancel", this.onPointerRelease);
    root.addEventListener("lostpointercapture", this.onPointerRelease);
    root.addEventListener("keydown", this.onModalKeyDown);
  }

  render(state: DontWaveState): void {
    this.state = state;
    this.shell.dataset.phase = state.phase;
    this.hud.hidden = hasOverlay(state.phase);
    this.controls.hidden = hasOverlay(state.phase);
    this.text("round", `${state.round} / ${state.totalRounds}`);
    this.text("turn", `${state.turn} / ${state.turnsPerRound}`);
    this.text("player-score", score(state.playerScore));
    this.text("left-score", score(state.leftScore));
    this.text("right-score", score(state.rightScore));
    this.text("phase", phaseLabel(state.phase));
    this.text("announcement", announcement(state));
    this.text("timer", timerText(state));
    this.text("ammo", `${state.ammo} / ${state.maxAmmo}`);
    this.text("status", this.systemNotice || statusText(state));
    this.updateCharge(state);
    this.updateControls(state);
    this.updateFeedback(state);
    this.renderOverlay(state);
    this.reticle.hidden = !(this.reticleVisible && state.phase === "hunt");
  }

  setReticle(position: ReticlePosition): void {
    this.reticleVisible = position.visible;
    this.shell.style.setProperty("--reticle-x", `${clamp(position.x) * 100}%`);
    this.shell.style.setProperty("--reticle-y", `${clamp(position.y) * 100}%`);
    this.reticle.hidden = !(this.reticleVisible && this.state?.phase === "hunt");
  }

  flashDryFire(): void {
    this.showFeedback("NO CHARGE", "dry");
  }

  setSystemNotice(message: string): void {
    this.systemNotice = message;
    if (this.state) this.text("status", message || statusText(this.state));
  }

  destroy(): void {
    window.clearTimeout(this.feedbackTimer);
    this.actions.setPlayerMoving(false);
    this.root.removeEventListener("click", this.onClick);
    this.root.removeEventListener("pointerdown", this.onPointerDown);
    this.root.removeEventListener("pointerup", this.onPointerRelease);
    this.root.removeEventListener("pointercancel", this.onPointerRelease);
    this.root.removeEventListener("lostpointercapture", this.onPointerRelease);
    this.root.removeEventListener("keydown", this.onModalKeyDown);
    this.root.replaceChildren();
  }

  private updateCharge(state: DontWaveState): void {
    this.chargePips.forEach((pip, index) => {
      pip.classList.toggle("is-filled", index < state.ammo);
      pip.classList.toggle("is-spent", state.phase === "hunt" && index >= state.ammo && index < state.ammoAtRed);
    });
  }

  private updateControls(state: DontWaveState): void {
    this.greenButton.hidden = state.phase !== "ready";
    this.redButton.hidden = state.phase !== "green";
    this.redButton.disabled = !state.canCallRed;
    this.redButton.querySelector("small")!.textContent = state.canCallRed
      ? "R · STOP THE FIELD"
      : "CHARGING";
    this.moveButton.hidden = state.phase !== "crossing-green";
    this.moveButton.classList.toggle("is-held", state.playerMoving);
    this.moveButton.setAttribute("aria-pressed", String(state.playerMoving));
  }

  private updateFeedback(state: DontWaveState): void {
    const event = [...state.events].reverse().find((candidate) => candidate.operator === "player");
    if (!event || event.id <= this.lastPlayerEventId) return;
    this.lastPlayerEventId = event.id;
    this.presentShot(event);
  }

  private presentShot(event: ShotEvent): void {
    if (event.outcome === "correct") this.showFeedback("+100", "correct");
    else if (event.outcome === "wrong") this.showFeedback("−100", "wrong");
    else this.showFeedback("EMPTY", "empty");
  }

  private showFeedback(message: string, kind: string): void {
    window.clearTimeout(this.feedbackTimer);
    this.feedback.textContent = message;
    this.feedback.dataset.kind = kind;
    this.feedback.hidden = false;
    this.feedbackTimer = window.setTimeout(() => {
      this.feedback.hidden = true;
      this.feedback.textContent = "";
      delete this.feedback.dataset.kind;
    }, 420);
  }

  private renderOverlay(state: DontWaveState): void {
    const overlayPhase = hasOverlay(state.phase) ? state.phase : "";
    const key = `${overlayPhase}:${state.round}:${state.crowdRevision}:${state.playerScore}:${state.leftScore}:${state.rightScore}`;
    if (!overlayPhase) {
      if (!this.overlay.hidden) this.closeOverlay();
      this.overlayKey = key;
      return;
    }
    if (key === this.overlayKey) return;
    this.overlayKey = key;
    this.hud.inert = true;
    this.controls.inert = true;
    this.overlay.hidden = false;
    this.overlay.innerHTML = overlayMarkup(state);
    const heading = required<HTMLElement>(this.overlay, ".dw-modal-focus");
    heading.id = "dw-overlay-title";
    this.overlay.setAttribute("role", "dialog");
    this.overlay.setAttribute("aria-modal", "true");
    this.overlay.setAttribute("aria-labelledby", heading.id);
    window.requestAnimationFrame(() => heading.focus({ preventScroll: true }));
  }

  private closeOverlay(): void {
    this.hud.inert = false;
    this.controls.inert = false;
    this.overlay.hidden = true;
    this.overlay.replaceChildren();
    this.overlay.removeAttribute("role");
    this.overlay.removeAttribute("aria-modal");
    this.overlay.removeAttribute("aria-labelledby");
    window.requestAnimationFrame(() => this.shell.focus({ preventScroll: true }));
  }

  private text(key: string, value: string): void {
    const element = required(this.root, `[data-ui='${key}']`);
    if (element.textContent !== value) element.textContent = value;
  }

  private readonly onClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("button") : null;
    if (!target || target.disabled || !this.root.contains(target)) return;
    switch (target.dataset.action) {
      case "start": this.actions.start(); break;
      case "green": this.actions.startGreen(); break;
      case "red": this.actions.triggerRed(); break;
      case "continue-round": this.actions.continueRound(); break;
      case "leave-tower": this.actions.leaveTower(); break;
      case "begin-crossing": this.actions.beginCrossing(); break;
      case "restart": this.lastPlayerEventId = 0; this.actions.restart(); break;
      case "move":
        if (event.detail === 0) this.actions.setPlayerMoving(!(this.state?.playerMoving ?? false));
        break;
    }
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    const button = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>("[data-action='move']")
      : null;
    if (!button || button.disabled || !this.root.contains(button)) return;
    event.preventDefault();
    this.movingPointerId = event.pointerId;
    button.setPointerCapture(event.pointerId);
    this.actions.setPlayerMoving(true);
  };

  private readonly onPointerRelease = (event: PointerEvent): void => {
    if (this.movingPointerId !== event.pointerId) return;
    this.movingPointerId = null;
    this.actions.setPlayerMoving(false);
  };

  private readonly onModalKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Tab" || this.overlay.hidden) return;
    const focusable = [...this.overlay.querySelectorAll<HTMLElement>(FOCUSABLE)]
      .filter((element) => element.getClientRects().length > 0);
    if (focusable.length === 0) {
      event.preventDefault();
      this.overlay.querySelector<HTMLElement>(".dw-modal-focus")?.focus();
      return;
    }
    const index = focusable.indexOf(document.activeElement as HTMLElement);
    if ((!event.shiftKey && index === focusable.length - 1) || (event.shiftKey && index <= 0)) {
      event.preventDefault();
      (event.shiftKey ? focusable.at(-1) : focusable[0])?.focus();
    }
  };
}

function shellMarkup(): string {
  return `
    <div class="dw-shell" data-phase="briefing" tabindex="-1">
      <header class="dw-hud" data-ui="hud" hidden>
        <div class="dw-run"><span>ROUND <b data-ui="round">1 / 2</b></span><span>TURN <b data-ui="turn">1 / 4</b></span></div>
        <div class="dw-phase"><i></i><b data-ui="phase">READY</b></div>
        <div class="dw-scores" aria-label="Scores">
          <span class="dw-score dw-score--you"><small>YOU</small><b data-ui="player-score">0</b></span>
          <span class="dw-score dw-score--left"><small>LEFT</small><b data-ui="left-score">0</b></span>
          <span class="dw-score dw-score--right"><small>RIGHT</small><b data-ui="right-score">0</b></span>
        </div>
      </header>

      <strong class="dw-announcement" data-ui="announcement" aria-live="assertive"></strong>
      <span class="dw-timer" data-ui="timer"></span>
      <div class="dw-reticle" data-ui="reticle" aria-hidden="true" hidden></div>
      <strong class="dw-feedback" data-ui="feedback" aria-live="assertive" hidden></strong>

      <div class="dw-charge" aria-label="Gun charge">
        <span class="dw-charge__label">CHARGE <b data-ui="ammo">0 / 6</b></span>
        <span class="dw-charge__pips">
          ${Array.from({ length: 6 }, () => '<i data-ui="charge-pip"></i>').join("")}
        </span>
      </div>
      <p class="dw-status" data-ui="status" aria-live="polite"></p>

      <div class="dw-controls" data-ui="controls">
        <button class="dw-action dw-action--green" type="button" data-action="green" data-testid="green" hidden>
          GREEN LIGHT<small>G · START THE CROSSING</small>
        </button>
        <button class="dw-action dw-action--red" type="button" data-action="red" data-testid="red" hidden disabled>
          RED LIGHT<small>CHARGING</small>
        </button>
        <button class="dw-action dw-action--move" type="button" data-action="move" data-testid="move" aria-pressed="false" hidden>
          HOLD TO WALK<small>W / SPACE</small>
        </button>
      </div>

      <p class="dw-orientation">LANDSCAPE RECOMMENDED</p>
      <div class="dw-death-wash" aria-hidden="true"></div>
      <section class="dw-overlay" data-ui="overlay" hidden></section>
    </div>`;
}

function overlayMarkup(state: DontWaveState): string {
  if (state.phase === "briefing") {
    return `
      <div class="dw-panel" data-testid="briefing">
        <p class="dw-kicker">WATCHTOWER SHIFT 01</p>
        <h1 class="dw-modal-focus" tabindex="-1">DON'T<br><em>WAVE</em></h1>
        <p class="dw-deck">Call <b>GREEN LIGHT</b>. Let the gun charge. Call <b>RED LIGHT</b>. Zap the wavers before the two towers do.</p>
        <button class="dw-primary" type="button" data-action="start" data-testid="start">TAKE THE TOWER</button>
      </div>`;
  }
  if (state.phase === "round-break") {
    return `
      <div class="dw-panel dw-panel--compact" data-testid="round-break">
        <p class="dw-kicker">ROUND ONE COMPLETE</p>
        <h2 class="dw-modal-focus" tabindex="-1">NEW CROWD</h2>
        ${standings(state)}
        <button class="dw-primary" type="button" data-action="continue-round" data-testid="continue-round">OPEN ROUND TWO</button>
      </div>`;
  }
  if (state.phase === "final-standings") {
    return `
      <div class="dw-panel dw-panel--compact" data-testid="final-standings">
        <p class="dw-kicker">FINAL STANDINGS</p>
        <h2 class="dw-modal-focus" tabindex="-1">${leader(state)}</h2>
        ${standings(state)}
        <button class="dw-primary" type="button" data-action="leave-tower" data-testid="leave-tower">LEAVE THE TOWER</button>
      </div>`;
  }
  if (state.phase === "crossing-ready") {
    return `
      <div class="dw-panel dw-panel--compact" data-testid="crossing-ready">
        <p class="dw-kicker">FIELD LEVEL</p>
        <h2 class="dw-modal-focus" tabindex="-1">WALK FORWARD</h2>
        <p class="dw-deck">Hold forward when the light turns green.</p>
        <button class="dw-primary" type="button" data-action="begin-crossing" data-testid="begin-crossing">ENTER THE FIELD</button>
      </div>`;
  }
  return `
    <div class="dw-panel dw-panel--compact" data-testid="complete">
      <p class="dw-kicker">SHIFT CLOSED</p>
      <h2 class="dw-modal-focus" tabindex="-1">DON'T WAVE</h2>
      ${standings(state)}
      <button class="dw-primary" type="button" data-action="restart" data-testid="restart">PLAY AGAIN</button>
    </div>`;
}

function standings(state: DontWaveState): string {
  return `
    <div class="dw-standings">
      <span class="dw-score--you"><small>YOU</small><b>${score(state.playerScore)}</b></span>
      <span class="dw-score--left"><small>LEFT</small><b>${score(state.leftScore)}</b></span>
      <span class="dw-score--right"><small>RIGHT</small><b>${score(state.rightScore)}</b></span>
    </div>`;
}

function leader(state: DontWaveState): string {
  const maximum = Math.max(state.playerScore, state.leftScore, state.rightScore);
  const leaders = [state.playerScore, state.leftScore, state.rightScore]
    .map((value, index) => ({ value, index }))
    .filter(({ value }) => value === maximum);
  if (leaders.length > 1) {
    return leaders.some(({ index }) => index === 0) ? "TIED FOR FIRST" : "TOWERS TIED";
  }
  if (state.playerScore === maximum) return "YOU LEAD";
  return state.leftScore > state.rightScore ? "LEFT TOWER LEADS" : "RIGHT TOWER LEADS";
}

function hasOverlay(phase: DontWavePhase): boolean {
  return phase === "briefing"
    || phase === "round-break"
    || phase === "final-standings"
    || phase === "crossing-ready"
    || phase === "complete";
}

function phaseLabel(phase: DontWavePhase): string {
  if (phase === "green" || phase === "crossing-green") return "GREEN";
  if (phase === "reveal" || phase === "hunt" || phase === "rivals" || phase === "crossing-red") return "RED";
  if (phase === "death") return "HIT";
  if (phase === "descent") return "DESCENT";
  return "READY";
}

function announcement(state: DontWaveState): string {
  if (state.phase === "green" || state.phase === "crossing-green") return "GREEN LIGHT";
  if (state.phase === "reveal" || state.phase === "crossing-red") return "RED LIGHT";
  if (state.phase === "hunt") return "FIRE";
  if (state.phase === "rivals") return "TOWERS";
  return "";
}

function timerText(state: DontWaveState): string {
  if (state.phase === "hunt") return `${(state.huntRemainingMs / 1_000).toFixed(1)}s`;
  if (state.phase === "green") return state.canCallRed ? "RED READY" : "CHARGING";
  return "";
}

function statusText(state: DontWaveState): string {
  if (state.phase === "ready") return "CALL GREEN LIGHT";
  if (state.phase === "green") return state.ammo === state.maxAmmo ? "FULL CHARGE" : "WAIT FOR CHARGE — OR CALL RED";
  if (state.phase === "reveal") return "WATCH THE ARMS";
  if (state.phase === "hunt") return "CLICK THE WAVERS";
  if (state.phase === "rivals") return "RIVAL VOLLEY";
  if (state.phase === "crossing-green") return "HOLD FORWARD";
  return state.statusMessage;
}

function score(value: number): string {
  return value.toLocaleString("en-GB");
}

function required<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Don't Wave UI is missing ${selector}.`);
  return element;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
