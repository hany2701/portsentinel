import { DOCTRINE } from "./doctrine";
import { TICK_SIM_MINUTES } from "./config";
import type { SimState } from "./types";

// REAL-5 (D-83): a deterministic harmonic tide curve — pure function of sim
// time and the world's seed (a fixed per-world phase offset), no RNG draw and
// no external feed. Always "live" by construction; there is nothing to
// degrade. Semi-diurnal period approximates the Singapore Strait.

function tidePhase(seed: number): number {
  return ((seed % 1000) / 1000) * 2 * Math.PI;
}

export function tideHeightM(state: SimState): number {
  const { periodMinutes, amplitudeM, meanM } = DOCTRINE.tide;
  const angle = (2 * Math.PI * state.clock.simMinutes) / periodMinutes + tidePhase(state.clock.seed);
  return Number((meanM + amplitudeM * Math.sin(angle)).toFixed(2));
}

export function tideWindowOpen(state: SimState): boolean {
  return tideHeightM(state) >= DOCTRINE.tide.minBerthingHeightM;
}

// Ticks until the window next opens (0 if already open). A bounded search
// over one full period — cheap on the compressed clock and simpler than
// inverting the sine analytically.
export function ticksUntilTideWindow(state: SimState): number {
  if (tideWindowOpen(state)) return 0;
  const periodTicks = Math.ceil(DOCTRINE.tide.periodMinutes / TICK_SIM_MINUTES);
  for (let i = 1; i <= periodTicks; i++) {
    const probe: SimState = { ...state, clock: { ...state.clock, simMinutes: state.clock.simMinutes + i * TICK_SIM_MINUTES } };
    if (tideWindowOpen(probe)) return i;
  }
  return 0; // unreachable given the 50% duty cycle — safe fallback
}

export function stepTide(state: SimState): void {
  state.tide = { heightM: tideHeightM(state), windowOpen: tideWindowOpen(state) };
}
