import type { DontWaveState } from "../simulation/types";

type AudioContextConstructor = typeof AudioContext;

/** Small synthesized cues only; the simulation remains the source of truth. */
export class AudioDirector {
  private context: AudioContext | null = null;

  unlock(): void {
    const Constructor = (window.AudioContext
      ?? (window as typeof window & { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext);
    if (!Constructor) return;
    this.context ??= new Constructor();
    void this.context.resume();
  }

  sync(previous: DontWaveState, next: DontWaveState): void {
    if (!this.context || this.context.state !== "running") return;
    if (next.playerHits > previous.playerHits) this.tone(690, 980, 0.09, 0.06, "triangle");
    else if (next.playerMisses > previous.playerMisses) this.tone(150, 105, 0.11, 0.045, "sawtooth");
    if (next.operatorHits > previous.operatorHits) this.tone(235, 175, 0.1, 0.035, "square", 0.035);
    if (next.phase === previous.phase) return;
    switch (next.phase) {
      case "green":
      case "crossing-green":
        this.tone(260, 390, 0.16, 0.045, "sine");
        break;
      case "reveal":
      case "crossing-red":
        this.tone(125, 82, 0.28, 0.065, "square");
        break;
      case "hunt":
        this.tone(420, 520, 0.1, 0.04, "triangle");
        break;
      case "report":
        this.tone(180, 155, 0.14, 0.03, "sine");
        break;
      case "death":
        this.tone(95, 42, 0.42, 0.08, "sawtooth");
        break;
      default:
        break;
    }
  }

  destroy(): void {
    if (!this.context) return;
    void this.context.close();
    this.context = null;
  }

  private tone(
    startHz: number,
    endHz: number,
    durationSeconds: number,
    volume: number,
    type: OscillatorType,
    delaySeconds = 0,
  ): void {
    const context = this.context;
    if (!context) return;
    const startAt = context.currentTime + delaySeconds;
    const endAt = startAt + durationSeconds;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(startHz, startAt);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endHz), endAt);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(volume, startAt + Math.min(0.018, durationSeconds / 3));
    gain.gain.exponentialRampToValueAtTime(0.0001, endAt);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(startAt);
    oscillator.stop(endAt + 0.02);
  }
}
