import { rand, randRange } from "./rng";
import { inSingaporeApproach } from "../maritime/geofence";
import { routeNodeById } from "../maritime/network";
import type { Disruption, SimState, WeatherState } from "./types";

export function computeRiskIndex(w: Pick<WeatherState, "gustKts" | "waveHeightM" | "precipMm" | "visibilityKm">): number {
  const wind = w.gustKts * 1.4;
  const wave = w.waveHeightM * 22;
  const rain = w.precipMm * 2.5;
  const vis = w.visibilityKm < 5 ? (5 - w.visibilityKm) * 6 : 0;
  return Math.max(0, Math.min(100, Math.round(wind + wave + rain + vis)));
}

/**
 * Is this storm over Singapore?
 *
 * MDS-1 (D-91): `state.weather` is the SINGAPORE/Tuas weather state — it drives
 * the terminal's crane suspensions, visibility gates and risk KPI. A storm that
 * sits at Suez or Hormuz must not touch it, or the demo claims a Red Sea storm
 * stopped the cranes at Tuas.
 *
 * A storm counts as local when it names no route nodes (the historical form —
 * "a storm here", used by the demo script, the GR-10 scenario and every existing
 * storm test), or when any node it does name lies inside the Singapore approach
 * fence. Remote storms are handled entirely by the maritime edge model.
 */
function isLocalStorm(storm: Disruption): boolean {
  const nodes = storm.targetIds.flatMap((id) => {
    const node = routeNodeById(id);
    return node ? [node] : [];
  });
  return nodes.length === 0 || nodes.some(inSingaporeApproach);
}

function activeStorm(state: SimState): Disruption | undefined {
  return state.disruptions.find(
    (d) => d.type === "storm" &&
      state.clock.tick >= d.startTick &&
      state.clock.tick < d.startTick + d.durationTicks &&
      isLocalStorm(d),
  );
}

// Round the working values and recompute the risk index. asOfTick is stamped by the
// caller from the live clock.
function finalize(w: WeatherState): void {
  w.gustKts = Number(w.gustKts.toFixed(1));
  w.windKts = Number(w.windKts.toFixed(1));
  w.waveHeightM = Number(w.waveHeightM.toFixed(2));
  w.precipMm = Number(w.precipMm.toFixed(1));
  w.visibilityKm = Number(w.visibilityKm.toFixed(1));
  w.riskIndex = computeRiskIndex(w);
}

// A simulated severe-weather overlay driven by an active storm disruption. Applied
// regardless of any live feed so the demo never depends on real storms; the UI shows
// the overlay explicitly. Provenance stays `simulated` — never labeled Live.
function applyStormOverlay(w: WeatherState, storm: Disruption): void {
  const target = { gust: 20 + storm.severity * 14, wave: 1 + storm.severity * 1.1, precip: storm.severity * 6, vis: 10 - storm.severity * 2.5 };
  w.gustKts += (target.gust - w.gustKts) * 0.35;
  w.windKts = w.gustKts * 0.7;
  w.waveHeightM += (target.wave - w.waveHeightM) * 0.35;
  w.precipMm += (target.precip - w.precipMm) * 0.35;
  w.visibilityKm += (target.vis - w.visibilityKm) * 0.35;
  w.freshness = "simulated";
  w.provenance = "simulated";
  w.stormOverlay = true;
  w.asOfMs = undefined;
}

// Copy the last-good external reading straight through — live weather updates ~hourly,
// so it holds steady between polls rather than drifting. Freshness comes from the feed.
function applyLiveReading(state: SimState): void {
  const r = state.weatherFeed.reading!;
  const w = state.weather;
  w.windKts = r.windKts;
  w.gustKts = r.gustKts;
  w.windDirDeg = r.windDirDeg;
  w.waveHeightM = r.waveHeightM;
  w.visibilityKm = r.visibilityKm;
  w.precipMm = r.precipMm;
  w.asOfMs = r.asOfMs;
  w.freshness = state.weatherFeed.freshness;
  w.provenance = "live_external";
  w.stormOverlay = false;
}

/**
 * Weather tick stage. Resolves, in priority order:
 *   1. active storm  → simulated severe overlay (demo-safe, always applied)
 *   2. live reading  → last-good external values, freshness from the feed
 *   3. neither       → gentle simulated drift around a calm baseline (fallback)
 * Only branch 3 draws from the RNG, so a run with no feed stays deterministic (D-32).
 */
export function stepWeather(state: SimState): void {
  const storm = activeStorm(state);
  const w = state.weather;
  if (storm) {
    applyStormOverlay(w, storm);
  } else if (state.weatherFeed.reading) {
    applyLiveReading(state);
  } else {
    // Gentle MEAN-REVERTING drift around a calm baseline (fallback when no feed).
    // The reversion term + caps stop the random walk from wandering into a
    // permanent storm over a long run; draw count is unchanged so determinism and
    // the downstream RNG stream are preserved (D-32).
    w.windKts = Math.max(4, Math.min(26, w.windKts + randRange(state.rng, -1.5, 1.5) + (11 - w.windKts) * 0.08));
    w.gustKts = w.windKts + randRange(state.rng, 3, 8);
    w.waveHeightM = Math.max(0.3, Math.min(2.5, w.waveHeightM + randRange(state.rng, -0.2, 0.2) + (0.8 - w.waveHeightM) * 0.08));
    // REAL-5 fix: this had no reversion term, unlike wind/wave/visibility below —
    // the same gap REAL-2 already closed for those three (D-80 stability fix) —
    // so a storm's elevated precip could random-walk and stay stuck near the
    // lightning threshold indefinitely instead of settling back to calm.
    w.precipMm = Math.max(0, w.precipMm + randRange(state.rng, -1, 0.8) + (0 - w.precipMm) * 0.08);
    w.visibilityKm = Math.min(15, Math.max(4, w.visibilityKm + randRange(state.rng, -0.5, 0.6)));
    w.windDirDeg = (w.windDirDeg + Math.round(rand(state.rng) * 8 - 4) + 360) % 360;
    w.freshness = "simulated";
    w.provenance = "simulated";
    w.stormOverlay = false;
    w.asOfMs = undefined;
  }
  w.asOfTick = state.clock.tick;
  finalize(w);
}

/**
 * Re-resolve weather WITHOUT advancing the RNG — for the store to apply a fresh poll
 * (or a freshness change) between ticks so the UI updates even while paused. Never
 * touches the simulated-drift branch, so it stays deterministic and side-effect free.
 */
export function refreshWeather(state: SimState): void {
  const storm = activeStorm(state);
  if (storm) applyStormOverlay(state.weather, storm);
  else if (state.weatherFeed.reading) applyLiveReading(state);
  else return;
  state.weather.asOfTick = state.clock.tick;
  finalize(state.weather);
}
