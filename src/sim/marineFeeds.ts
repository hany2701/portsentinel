import { DOCTRINE, hazeVisibilityKm, lightningRiskAt } from "./doctrine";
import { stepTide } from "./tide";
import type { SimState } from "./types";

// REAL-5 (D-83): resolve lightning + haze into their per-tick state, mirroring
// weather.ts's live/stale/simulated priority chain. Lightning falls back to
// the existing precipitation proxy (D-78) when the NEA feed is unreachable;
// haze falls back to a calm-air baseline (no random walk needed — haze has no
// storm-overlay analogue to preserve, unlike weather).

function resolveLightning(state: SimState): void {
  const feed = state.lightningFeed;
  if (feed.reading) {
    state.lightning = {
      active: feed.reading.active,
      asOfMs: feed.reading.asOfMs,
      freshness: feed.freshness,
      provenance: "live_external",
      source: "nea",
    };
  } else {
    state.lightning = {
      active: lightningRiskAt(state.weather.precipMm),
      freshness: "simulated",
      provenance: "simulated",
      source: "precip_proxy",
    };
  }
}

function resolveHaze(state: SimState): void {
  const feed = state.hazeFeed;
  if (feed.reading) {
    state.haze = {
      psi: feed.reading.psi,
      visibilityKm: hazeVisibilityKm(feed.reading.psi),
      asOfMs: feed.reading.asOfMs,
      freshness: feed.freshness,
      provenance: "live_external",
    };
  } else {
    state.haze = {
      psi: DOCTRINE.haze.baselinePsi,
      visibilityKm: hazeVisibilityKm(DOCTRINE.haze.baselinePsi),
      freshness: "simulated",
      provenance: "simulated",
    };
  }
}

// Resolves the tide curve + the two injected feeds (lightning, haze) into
// their per-tick state. Runs right after stepWeather (lightning's proxy
// fallback needs the tick's resolved precipMm) and before stepWxOps (which
// gates on lightning + haze) and moveVessels (which gates on tide). Also
// called directly by the store's poll handlers to refresh out-of-tick, the
// same way refreshWeather does for the weather feed.
export function stepMarineEnvironment(state: SimState): void {
  resolveLightning(state);
  resolveHaze(state);
  stepTide(state);
}
