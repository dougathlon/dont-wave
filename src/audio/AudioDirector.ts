import type { DontWaveState } from "../simulation/types";

type AudioContextConstructor = typeof AudioContext;

/** Gesture-unlocked cues plus the two exact spoken calls required by the game. */
export class AudioDirector {
  private context: AudioContext | null = null;
  private speechEnabled = true;

  unlock(): void {
    const Constructor = window.AudioContext
      ?? (window as typeof window & { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;
    if (Constructor) {
      this.context ??= new Constructor();
      void this.context.resume();
    }
  }

  sync(previous: DontWaveState, next: DontWaveState): void {
    if (next.ammo > previous.ammo && next.phase === "green") {
      const step = next.ammo / Math.max(1, next.maxAmmo);
      this.tone(240 + step * 260, 300 + step * 320, 0.055, 0.035, "triangle");
    }
    const previousEvent = previous.events.at(-1);
    const nextEvent = next.events.at(-1);
    if (nextEvent && nextEvent.id !== previousEvent?.id) {
      if (nextEvent.operator === "player" && nextEvent.outcome === "correct") {
        this.tone(620, 980, 0.1, 0.06, "triangle");
      } else if (nextEvent.operator === "player" && nextEvent.outcome === "wrong") {
        this.tone(165, 92, 0.14, 0.055, "sawtooth");
      } else if (nextEvent.operator === "player") {
        this.tone(190, 150, 0.07, 0.03, "square");
      } else {
        this.tone(nextEvent.operator === "left" ? 235 : 285, 145, 0.1, 0.038, "square");
      }
    }
    if (next.phase === previous.phase) return;
    if (next.phase === "green" || next.phase === "crossing-green") {
      this.announce("Green light");
      this.tone(280, 430, 0.16, 0.038, "sine");
    } else if (next.phase === "reveal" || next.phase === "crossing-red") {
      this.announce("Red light");
      this.tone(135, 78, 0.24, 0.055, "square");
    } else if (next.phase === "hunt") {
      this.tone(440, 580, 0.09, 0.04, "triangle");
    } else if (next.phase === "death") {
      this.tone(92, 38, 0.45, 0.075, "sawtooth");
    }
  }

  dryFire(): void {
    this.tone(85, 72, 0.06, 0.025, "square");
  }

  destroy(): void {
    window.speechSynthesis?.cancel();
    this.speechEnabled = false;
    if (this.context) void this.context.close();
    this.context = null;
  }

  private announce(text: "Green light" | "Red light"): void {
    if (!this.speechEnabled || !("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.78;
    utterance.pitch = 0.72;
    utterance.volume = 0.88;
    window.speechSynthesis.speak(utterance);
  }

  private tone(
    startHz: number,
    endHz: number,
    durationSeconds: number,
    volume: number,
    type: OscillatorType,
  ): void {
    const context = this.context;
    if (!context || context.state !== "running") return;
    const startAt = context.currentTime;
    const endAt = startAt + durationSeconds;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(startHz, startAt);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endHz), endAt);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(volume, startAt + Math.min(0.016, durationSeconds / 3));
    gain.gain.exponentialRampToValueAtTime(0.0001, endAt);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(startAt);
    oscillator.stop(endAt + 0.02);
  }
}
