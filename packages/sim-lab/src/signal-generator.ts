/**
 * Deterministic I/O signal generator. Every waveform is a pure function of the
 * logical simulation time (ms), so a scenario replays identically every run.
 */

import type { SimSignalBehavior } from "./types";

/** Deterministic pseudo-noise in [-1, 1] from a seed and a time bucket. */
function noiseAt(seed: number, timeMs: number): number {
  const bucket = Math.floor(timeMs / 50);
  const x = Math.sin(seed * 374761393.1 + bucket * 668265263.7) * 43758.5453123;
  return (x - Math.floor(x)) * 2 - 1;
}

/**
 * Evaluate a time-based signal behavior at `timeMs`. The `follow-command`
 * behavior is driven by the engine (it needs tag reads + ramping), so it is not
 * handled here; callers must branch on it before calling this function.
 */
export function evalSignal(behavior: SimSignalBehavior, timeMs: number): number {
  switch (behavior.kind) {
    case "constant":
      return behavior.value;
    case "ramp": {
      const phase = behavior.periodMs > 0 ? (timeMs % behavior.periodMs) / behavior.periodMs : 0;
      return behavior.from + (behavior.to - behavior.from) * phase;
    }
    case "sine": {
      const omega = behavior.periodMs > 0 ? (2 * Math.PI * timeMs) / behavior.periodMs : 0;
      return behavior.mean + behavior.amplitude * Math.sin(omega);
    }
    case "square": {
      const half = behavior.periodMs / 2;
      const inHigh = half > 0 ? timeMs % behavior.periodMs < half : false;
      return inHigh ? behavior.high : behavior.low;
    }
    case "triangle": {
      if (behavior.periodMs <= 0) return behavior.low;
      const phase = (timeMs % behavior.periodMs) / behavior.periodMs;
      const tri = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
      return behavior.low + (behavior.high - behavior.low) * tri;
    }
    case "step":
      return timeMs >= behavior.atMs ? behavior.after : behavior.before;
    case "noise":
      return behavior.mean + behavior.amplitude * noiseAt(behavior.seed, timeMs);
    case "follow-command":
      // Engine-driven; return the idle value as a safe fallback.
      return behavior.low;
  }
}

/** Move `current` toward `target` by at most `ratePerSec * deltaMs/1000`. */
export function rampToward(current: number, target: number, ratePerSec: number, deltaMs: number): number {
  const maxStep = (ratePerSec * deltaMs) / 1000;
  const diff = target - current;
  if (Math.abs(diff) <= maxStep) return target;
  return current + Math.sign(diff) * maxStep;
}
