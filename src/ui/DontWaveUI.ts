import type { DontWavePhase, DontWaveState } from "../simulation/types";

const HUNT_DURATION_MS = 4_500;
const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export interface DontWaveUIActions {
  start(): void;
  startGreen(): void;
  triggerRed(): void;
  continueRound(): void;
  beginCrossing(): void;
  setPlayerMoving(moving: boolean): void;
  togglePause(): void;
  restart(): void;
}

export interface ReticlePosition {
  readonly x: number;
  readonly y: number;
  readonly visible: boolean;
  readonly canZap: boolean;
}

export class DontWaveUI {
  private readonly shell: HTMLElement;
  private readonly hud: HTMLElement;
  private readonly controls: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly huntMeter: HTMLElement;
  private readonly reticle: HTMLElement;
  private readonly status: HTMLElement;
  private readonly greenButton: HTMLButtonElement;
  private readonly redButton: HTMLButtonElement;
  private readonly moveButton: HTMLButtonElement;
  private readonly pauseButton: HTMLButtonElement;
  private state: DontWaveState | null = null;
  private overlayKey = "";
  private shotClassTimer = 0;
  private systemNotice = "";

  constructor(private readonly root: HTMLElement, private readonly actions: DontWaveUIActions) {
    root.innerHTML = shellMarkup();
    this.shell = requiredElement(root, ".dw-shell");
    this.hud = requiredElement(root, "[data-testid='hud']");
    this.controls = requiredElement(root, ".dw-controls");
    this.overlay = requiredElement(root, "[data-ui='overlay']");
    this.huntMeter = requiredElement(root, "[data-ui='hunt-meter']");
    this.reticle = requiredElement(root, "[data-ui='reticle']");
    this.status = requiredElement(root, "[data-ui='status']");
    this.greenButton = requiredElement(root, "[data-action='green']");
    this.redButton = requiredElement(root, "[data-action='red']");
    this.moveButton = requiredElement(root, "[data-action='move']");
    this.pauseButton = requiredElement(root, "[data-action='pause']");

    root.addEventListener("click", this.handleClick);
    root.addEventListener("pointerdown", this.handlePointerDown);
    root.addEventListener("pointerup", this.releaseMove);
    root.addEventListener("pointercancel", this.releaseMove);
    root.addEventListener("lostpointercapture", this.releaseMove);
    root.addEventListener("keydown", this.handleModalKeyDown);
  }

  render(state: DontWaveState): void {
    this.state = state;
    this.shell.dataset.phase = state.phase;
    this.shell.classList.toggle("is-paused", state.paused);
    this.hud.hidden = state.phase === "briefing";

    this.updateText("round", `${state.round} / ${state.totalRounds}`);
    this.updateText("turn", `${state.turn} / ${state.turnsPerRound}`);
    this.updateText("player-score", state.playerScore.toLocaleString("en-GB"));
    this.updateText("operator-score", (state.operatorHits * 100).toLocaleString("en-GB"));
    this.updateText("phase", phaseLabel(state.phase, state.paused));

    const inResolution = state.phase === "reveal" || state.phase === "hunt";
    this.huntMeter.hidden = !inResolution;
    if (inResolution) {
      const progress = state.phase === "reveal"
        ? 100
        : clamp((state.huntRemainingMs / HUNT_DURATION_MS) * 100, 0, 100);
      this.huntMeter.style.setProperty("--hunt-progress", `${progress}%`);
      this.updateText("targets", String(state.wavingRemaining));
      this.updateText(
        "hunt-owner",
        state.phase === "reveal"
          ? "READ THE FIELD"
          : state.phaseElapsedMs >= 1_100
            ? "SIDE TOWERS ACTIVE"
            : "YOUR WINDOW",
      );
    }

    this.reticle.hidden = state.phase !== "hunt";
    this.updateControls(state);
    this.updateStatus(state);
    this.renderOverlay(state);
  }

  setReticle(position: ReticlePosition): void {
    this.shell.style.setProperty("--reticle-x", `${clamp(position.x, 0, 1) * 100}%`);
    this.shell.style.setProperty("--reticle-y", `${clamp(position.y, 0, 1) * 100}%`);
    this.reticle.dataset.canZap = String(position.canZap);
    this.reticle.classList.toggle("is-target", position.canZap);
    if (this.state?.phase === "hunt") this.reticle.hidden = !position.visible;
  }

  flashShot(accepted: boolean): void {
    window.clearTimeout(this.shotClassTimer);
    this.shell.classList.remove("is-hit", "is-miss");
    this.shell.classList.add(accepted ? "is-hit" : "is-miss");
    this.shotClassTimer = window.setTimeout(() => {
      this.shell.classList.remove("is-hit", "is-miss");
    }, 180);
  }

  setSystemNotice(message: string): void {
    this.systemNotice = message;
    if (this.state) this.updateStatus(this.state);
  }

  destroy(): void {
    window.clearTimeout(this.shotClassTimer);
    this.actions.setPlayerMoving(false);
    this.root.removeEventListener("click", this.handleClick);
    this.root.removeEventListener("pointerdown", this.handlePointerDown);
    this.root.removeEventListener("pointerup", this.releaseMove);
    this.root.removeEventListener("pointercancel", this.releaseMove);
    this.root.removeEventListener("lostpointercapture", this.releaseMove);
    this.root.removeEventListener("keydown", this.handleModalKeyDown);
    this.setBackgroundInert(false);
    this.root.replaceChildren();
  }

  private updateControls(state: DontWaveState): void {
    this.greenButton.hidden = state.phase !== "ready";
    this.greenButton.disabled = state.paused;
    this.redButton.hidden = state.phase !== "green";
    this.redButton.disabled = state.paused || !state.canTriggerRed;
    this.redButton.querySelector("small")!.textContent = state.canTriggerRed
      ? "R · CHOOSE THE MOMENT"
      : "R · WAIT FOR ARMING";
    this.moveButton.hidden = state.phase !== "crossing-green";
    this.moveButton.disabled = state.paused;
    this.moveButton.classList.toggle("is-held", state.playerMoving);
    this.moveButton.setAttribute("aria-pressed", String(state.playerMoving));
    this.moveButton.setAttribute("aria-label", state.playerMoving ? "Stop crossing" : "Start crossing");
    this.pauseButton.disabled = !isPausable(state.phase);
    this.pauseButton.textContent = state.paused ? "▶" : "Ⅱ";
    this.pauseButton.setAttribute("aria-label", state.paused ? "Resume game" : "Pause game");
  }

  private updateStatus(state: DontWaveState): void {
    const message = this.systemNotice || state.statusMessage;
    if (this.status.textContent !== message) this.status.textContent = message;
  }

  private renderOverlay(state: DontWaveState): void {
    const overlayState = state.paused ? "paused" : overlayPhase(state.phase);
    const key = `${overlayState}:${state.round}:${state.turn}:${state.playerScore}:${state.operatorHits}:${state.counts.survivors}`;
    if (!overlayState) {
      if (!this.overlay.hidden) this.closeOverlay();
      this.overlayKey = key;
      return;
    }
    if (this.overlayKey === key) return;
    this.overlayKey = key;
    this.setBackgroundInert(true);
    this.overlay.hidden = false;
    this.overlay.innerHTML = overlayMarkup(overlayState, state);
    const title = requiredElement<HTMLElement>(this.overlay, ".dw-modal-focus");
    title.id = "dw-overlay-title";
    this.overlay.setAttribute("role", "dialog");
    this.overlay.setAttribute("aria-modal", "true");
    this.overlay.setAttribute("aria-labelledby", title.id);
    window.requestAnimationFrame(() => {
      title.focus({ preventScroll: true });
    });
  }

  private closeOverlay(): void {
    this.setBackgroundInert(false);
    this.overlay.hidden = true;
    this.overlay.removeAttribute("role");
    this.overlay.removeAttribute("aria-modal");
    this.overlay.removeAttribute("aria-labelledby");
    this.overlay.replaceChildren();
    window.requestAnimationFrame(() => {
      // Give global game verbs Space again after a modal closes. Restoring the
      // pause trigger would make Space reopen that modal instead of firing.
      this.shell.focus({ preventScroll: true });
    });
  }

  private setBackgroundInert(inert: boolean): void {
    this.hud.inert = inert;
    this.controls.inert = inert;
  }

  private updateText(key: string, value: string): void {
    const element = requiredElement(this.root, `[data-ui='${key}']`);
    if (element.textContent !== value) element.textContent = value;
  }

  private handleClick = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>("button");
    if (!button || button.disabled || !this.root.contains(button)) return;
    switch (button.dataset.action) {
      case "start":
        this.actions.start();
        break;
      case "green":
        this.actions.startGreen();
        break;
      case "red":
        this.actions.triggerRed();
        break;
      case "continue-round":
        this.actions.continueRound();
        break;
      case "begin-crossing":
        this.actions.beginCrossing();
        break;
      case "move":
        // Pointer users get momentary hold semantics from pointerdown/up. A
        // zero-detail click is keyboard or assistive activation and toggles.
        if (event.detail === 0) this.actions.setPlayerMoving(!(this.state?.playerMoving ?? false));
        break;
      case "pause":
      case "resume":
        this.actions.togglePause();
        break;
      case "restart":
        this.actions.restart();
        break;
    }
  };

  private handlePointerDown = (event: PointerEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>("[data-action='move']");
    if (!button || button.disabled || !this.root.contains(button)) return;
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    this.actions.setPlayerMoving(true);
  };

  private releaseMove = (event: PointerEvent): void => {
    if (!this.state?.playerMoving) return;
    const target = event.target;
    if (target instanceof Element && target.closest("[data-action='move']")) {
      this.actions.setPlayerMoving(false);
    }
  };

  private handleModalKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Tab" || this.overlay.hidden) return;
    const focusable = [...this.overlay.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
      .filter((element) => isRestorableFocusTarget(element));
    if (focusable.length === 0) {
      event.preventDefault();
      this.overlay.querySelector<HTMLElement>(".dw-modal-focus")?.focus({ preventScroll: true });
      return;
    }

    const active = document.activeElement;
    const activeIndex = active instanceof HTMLElement ? focusable.indexOf(active) : -1;
    if (activeIndex === -1 || (!event.shiftKey && activeIndex === focusable.length - 1) || (event.shiftKey && activeIndex === 0)) {
      event.preventDefault();
      const target = event.shiftKey ? focusable[focusable.length - 1] : focusable[0];
      target?.focus({ preventScroll: true });
    }
  };
}

function shellMarkup(): string {
  return `
    <div class="dw-shell" tabindex="-1" data-phase="briefing">
      <header class="dw-hud" data-testid="hud" hidden>
        <div class="dw-hud__run">
          <span><small>Round</small><strong data-ui="round">1 / 2</strong></span>
          <span><small>Turn</small><strong data-ui="turn">1 / 4</strong></span>
        </div>
        <div class="dw-phase-chip" data-ui="phase-chip"><i aria-hidden="true"></i><span data-ui="phase">Ready</span></div>
        <div class="dw-hud__right">
          <div class="dw-hud__scores" aria-label="Score">
            <span class="dw-score dw-score--player"><small>You</small><strong data-ui="player-score">0</strong></span>
            <span class="dw-score dw-score--operators"><small>Side score</small><strong data-ui="operator-score">0</strong></span>
          </div>
          <button class="dw-pause-button" type="button" data-action="pause" aria-label="Pause game">Ⅱ</button>
        </div>
      </header>

      <div class="dw-hunt-meter" data-ui="hunt-meter" hidden>
        <div class="dw-hunt-meter__label"><span data-ui="hunt-owner">YOUR WINDOW</span><span><b data-ui="targets">0</b> REMAIN</span></div>
        <span class="dw-hunt-meter__rail"><i></i></span>
      </div>

      <div class="dw-reticle" data-ui="reticle" aria-hidden="true" hidden></div>
      <p class="dw-status" data-ui="status" aria-live="polite"></p>

      <div class="dw-controls">
        <button class="dw-action dw-action--green" type="button" data-action="green" data-testid="green" hidden>GREEN<small>G · RELEASE THE FIELD</small></button>
        <button class="dw-action dw-action--red" type="button" data-action="red" data-testid="red" hidden>RED<small>R · CHOOSE THE MOMENT</small></button>
        <button class="dw-action dw-action--move" type="button" data-action="move" data-testid="move" aria-pressed="false" aria-label="Start crossing" hidden>HOLD TO CROSS<small>W / SPACE · RELEASE TO STOP</small></button>
      </div>

      <p class="dw-orientation-note">Landscape gives the clearest view of both side towers.</p>
      <div class="dw-death-wash" aria-hidden="true"></div>
      <section class="dw-overlay" data-ui="overlay" aria-live="polite" hidden></section>
    </div>`;
}

function overlayMarkup(kind: string, state: DontWaveState): string {
  if (kind === "briefing") {
    return `
      <div class="dw-panel" data-testid="briefing">
        <p class="dw-kicker">CIVIC PLAYGROUND 07 / TOWER CONTROL</p>
        <h1 class="dw-modal-focus" tabindex="-1"><span>DON'T</span><br>WAVE</h1>
        <p class="dw-deck">You decide when the crowd stops. Anyone still is spared for now. Anyone waving is yours—until the side towers get there first.</p>
        <div class="dw-loop" aria-label="Game loop">
          <span><b>01</b><strong>GREEN</strong><small>Release the crowd and let them cross.</small></span>
          <span><b>02</b><strong>RED</strong><small>Choose the moment everyone must stop.</small></span>
          <span><b>03</b><strong>ZAP</strong><small>Hit the ones visibly waving.</small></span>
          <span><b>04</b><strong>DESCEND</strong><small>Leave the tower after round two.</small></span>
        </div>
        <div class="dw-panel__actions">
          <button class="dw-primary" type="button" data-action="start" data-testid="start">TAKE THE TOWER →</button>
        </div>
        <p class="dw-local-note">Concept prototype · public playtest · no live connection</p>
      </div>`;
  }
  if (kind === "paused") {
    return `
      <div class="dw-panel dw-panel--compact">
        <p class="dw-kicker">CONTROL INTERRUPT</p>
        <h2 class="dw-modal-focus" tabindex="-1">TOWER HELD</h2>
        <p class="dw-deck">The field and side operators are paused. Held movement has been cleared.</p>
        ${summaryMarkup(state)}
        <div class="dw-panel__actions">
          <button class="dw-primary" type="button" data-action="resume" data-testid="resume">RESUME →</button>
          <button class="dw-secondary" type="button" data-action="restart">RESTART RUN</button>
        </div>
      </div>`;
  }
  if (kind === "intermission") {
    return `
      <div class="dw-panel dw-panel--compact" data-testid="intermission">
        <p class="dw-kicker">ROUND 01 / FIELD HELD</p>
        <h2 class="dw-modal-focus" tabindex="-1">ONE ROUND REMAINS</h2>
        <p class="dw-deck">The survivors keep their positions. The side towers keep their score.</p>
        ${summaryMarkup(state)}
        <div class="dw-panel__actions"><button class="dw-primary" type="button" data-action="continue-round" data-testid="continue-round">OPEN ROUND TWO →</button></div>
      </div>`;
  }
  if (kind === "crossing-ready") {
    return `
      <div class="dw-panel dw-panel--compact" data-testid="crossing-ready">
        <p class="dw-kicker">TOWER EXIT / FIELD LEVEL</p>
        <h2 class="dw-modal-focus" tabindex="-1">YOUR TURN</h2>
        <p class="dw-deck">The lift opens onto the same concrete. Hold to cross when the field turns green. Release when it stops.</p>
        <div class="dw-panel__actions"><button class="dw-primary" type="button" data-action="begin-crossing" data-testid="begin-crossing">ENTER THE FIELD →</button></div>
      </div>`;
  }
  return `
    <div class="dw-panel dw-panel--compact" data-testid="complete">
      <p class="dw-kicker">PERSONNEL RECOVERED / RUN CLOSED</p>
      <h2 class="dw-modal-focus" tabindex="-1">THE TOWER CONTINUES.</h2>
      ${summaryMarkup(state)}
      <div class="dw-panel__actions"><button class="dw-primary" type="button" data-action="restart" data-testid="restart">RUN AGAIN →</button></div>
    </div>`;
}

function summaryMarkup(state: DontWaveState): string {
  return `
    <div class="dw-summary-grid">
      <span class="dw-stat"><small>Your score</small><strong>${state.playerScore.toLocaleString("en-GB")}</strong></span>
      <span class="dw-stat"><small>Your hits</small><strong>${state.playerHits}</strong></span>
      <span class="dw-stat"><small>Side score</small><strong>${(state.operatorHits * 100).toLocaleString("en-GB")}</strong></span>
      <span class="dw-stat"><small>Survivors</small><strong>${state.counts.survivors}</strong></span>
    </div>`;
}

function overlayPhase(phase: DontWavePhase): string {
  if (phase === "briefing" || phase === "intermission" || phase === "crossing-ready" || phase === "complete") return phase;
  return "";
}

function phaseLabel(phase: DontWavePhase, paused: boolean): string {
  if (paused) return "HELD";
  switch (phase) {
    case "briefing": return "OFF DUTY";
    case "ready": return "READY";
    case "green": return "GREEN";
    case "reveal":
    case "crossing-red": return "RED";
    case "hunt": return "CLEAR";
    case "intermission": return "ROUND HELD";
    case "descent": return "DESCENDING";
    case "crossing-ready": return "FIELD ENTRY";
    case "crossing-green": return "GREEN";
    case "death": return "HIT";
    case "complete": return "CLOSED";
  }
}

function isPausable(phase: DontWavePhase): boolean {
  return phase !== "briefing" && phase !== "complete" && phase !== "death";
}

function requiredElement<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Don't Wave UI is missing ${selector}.`);
  return element;
}

function isRestorableFocusTarget(element: HTMLElement | null): element is HTMLElement {
  if (!element?.isConnected || element.closest("[inert]")) return false;
  if (element.matches(":disabled, [hidden], [aria-hidden='true']")) return false;
  if (element !== document.body && element.getClientRects().length === 0) return false;
  return element.matches(FOCUSABLE_SELECTOR);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
