import { DOCTRINE, weatherRiskBand } from "./doctrine";
import { addAlert } from "./alerts";
import type { EntityRef, SimState } from "./types";

// Weather-effects state machine (D-54, W1–W8). Runs right after stepWeather so
// every gate reads the tick's resolved weather. Deterministic and RNG-free
// (preview-safe): suspend instantly, resume only after
// DOCTRINE.weather.recoveryClearTicks consecutive clear ticks (anti-flap).
// Storm scenarios need no special path — the overlay's values drive the same
// thresholds (W8). Wind/precip/wave gate nothing directly (W6) — they act only
// through the risk index and the explicit gust/visibility thresholds.

function firstCraneRef(state: SimState, kind: "STS" | "RTG"): EntityRef | undefined {
  const c = state.cranes.find((x) => x.kind === kind);
  return c ? { entityType: "crane", entityId: c.id } : undefined;
}

// A clickable anchor for the port-wide moves alert: the vessel most visibly
// affected (mid-manoeuvre first, else head of the anchorage).
function movesRef(state: SimState): EntityRef | undefined {
  const v =
    state.vessels.find((x) => x.status === "berthing" || x.status === "departing") ??
    state.vessels.find((x) => x.status === "anchored");
  return v ? { entityType: "vessel", entityId: v.id } : undefined;
}

export function stepWxOps(state: SimState): void {
  const wx = state.wxOps;
  const w = state.weather;
  const band = weatherRiskBand(w.riskIndex);
  const critical = band.id === "critical";
  const clearTarget = DOCTRINE.weather.recoveryClearTicks;

  // W7 — stale feed: hold every current suspension, trigger no new ones, and
  // freeze the counters until the feed recovers. Announce the hold once.
  if (w.freshness === "stale") {
    if (!wx.staleHold) {
      wx.staleHold = true;
      const held = [wx.stsSuspended && "STS", wx.rtgSuspended && "RTG", wx.movesSuspended && "vessel moves"].filter(Boolean);
      if (held.length > 0) {
        addAlert(state, "info", `Weather feed stale — holding current suspensions (${held.join(", ")}) with degraded confidence.`);
      }
    }
    freezeSuspendedTimers(state);
    return;
  }
  wx.staleHold = false;

  // D-78 — lightning suspends ALL crane work regardless of gusts or band.
  // REAL-5 (D-83): state.lightning is the NEA feed when reachable, the
  // precipitation proxy otherwise (resolved by stepMarineEnvironment).
  const lightning = state.lightning.active;
  const lightningNote =
    state.lightning.source === "nea" ? "NEA observation" : `precip ${w.precipMm} mm/h proxy`;

  // W1 + W5 + D-78 — STS: gusts at/above the limit, lightning risk, or the
  // critical band regardless of gusts.
  const stsTrigger = w.gustKts >= DOCTRINE.crane.stsSuspendGustKts || lightning || critical;
  if (stsTrigger) {
    if (!wx.stsSuspended) {
      wx.stsSuspended = true;
      addAlert(
        state,
        "warning",
        w.gustKts >= DOCTRINE.crane.stsSuspendGustKts
          ? `Gusts ${w.gustKts} kt at/above ${DOCTRINE.crane.stsSuspendGustKts} kt — STS crane operations suspended (OPS-CRANE §1).`
          : lightning
            ? `Lightning risk at the terminal (${lightningNote}) — STS crane operations suspended (OPS-CRANE §1).`
            : `Weather risk ${w.riskIndex} (critical band) — STS crane operations suspended (OPS-CRANE §1).`,
        firstCraneRef(state, "STS"),
      );
    }
    wx.stsClearTicks = 0;
  } else if (wx.stsSuspended) {
    wx.stsClearTicks += 1;
    if (wx.stsClearTicks >= clearTarget) {
      wx.stsSuspended = false;
      wx.stsClearTicks = 0;
      addAlert(state, "info", `STS crane operations resumed after ${clearTarget} consecutive clear ticks (OPS-CRANE §1).`, firstCraneRef(state, "STS"));
    }
  }

  // W2 + W5 + D-78 — RTG: higher gust limit, lightning risk, or the critical band.
  const rtgTrigger = w.gustKts >= DOCTRINE.crane.rtgSuspendGustKts || lightning || critical;
  if (rtgTrigger) {
    if (!wx.rtgSuspended) {
      wx.rtgSuspended = true;
      addAlert(
        state,
        "warning",
        w.gustKts >= DOCTRINE.crane.rtgSuspendGustKts
          ? `Gusts ${w.gustKts} kt at/above ${DOCTRINE.crane.rtgSuspendGustKts} kt — RTG operations suspended; yard-to-gate outflow stopped (OPS-CRANE §1).`
          : lightning
            ? `Lightning risk at the terminal (${lightningNote}) — RTG operations suspended; yard-to-gate outflow stopped (OPS-CRANE §1).`
            : `Weather risk ${w.riskIndex} (critical band) — RTG operations suspended; yard-to-gate outflow stopped (OPS-CRANE §1).`,
        firstCraneRef(state, "RTG"),
      );
    }
    wx.rtgClearTicks = 0;
  } else if (wx.rtgSuspended) {
    wx.rtgClearTicks += 1;
    if (wx.rtgClearTicks >= clearTarget) {
      wx.rtgSuspended = false;
      wx.rtgClearTicks = 0;
      addAlert(state, "info", `RTG operations resumed after ${clearTarget} consecutive clear ticks (OPS-CRANE §1).`, firstCraneRef(state, "RTG"));
    }
  }

  // W3 + W5 — vessel moves: low visibility, or the critical band. Arrivals are
  // additionally gated in moveVessels only on the visibility part — in the
  // critical band anchoring stays allowed (owner ruling: anchoring is the safe move).
  // REAL-5 (D-83): haze (NEA PSI) is a second, independent visibility input —
  // it can trigger the gate on a calm, rain-free day (OPS-WX §2).
  const effectiveVisKm = Math.min(w.visibilityKm, state.haze.visibilityKm);
  const hazeIsWorse = state.haze.visibilityKm < w.visibilityKm;
  const visLow = effectiveVisKm < DOCTRINE.weather.visMinKm;
  const moveTrigger = visLow || critical;
  if (moveTrigger) {
    if (!wx.movesSuspended) {
      wx.movesSuspended = true;
      addAlert(
        state,
        "critical",
        visLow
          ? `Visibility ${effectiveVisKm} km below ${DOCTRINE.weather.visMinKm} km${hazeIsWorse ? ` (haze, PSI ${state.haze.psi})` : ""} — arrivals, berthing and unberthing suspended (OPS-WX §1).`
          : `Weather risk ${w.riskIndex} — critical band: berthing and unberthing suspended; approaching vessels may still anchor (OPS-WX §1).`,
        movesRef(state),
      );
    }
    wx.moveClearTicks = 0;
  } else if (wx.movesSuspended) {
    wx.moveClearTicks += 1;
    if (wx.moveClearTicks >= clearTarget) {
      wx.movesSuspended = false;
      wx.moveClearTicks = 0;
      addAlert(state, "info", `Vessel moves resumed after ${clearTarget} consecutive clear ticks (OPS-WX §1).`, movesRef(state));
    }
  }

  // W-caution — mechanical slowdown: every 3rd consecutive caution tick, every
  // approaching vessel's ETA slips one tick. Deterministic counter, no RNG.
  if (band.id === "caution") {
    wx.cautionTicks += 1;
    if (wx.cautionTicks % 3 === 0) {
      for (const v of state.vessels) {
        if (v.status === "approaching") v.etaTick += 1;
      }
    }
  } else {
    wx.cautionTicks = 0;
  }

  freezeSuspendedTimers(state);
}

// Frozen ops must not progress invisibly (D-54): while moves are suspended,
// berthing/departing phase timers shift out one tick per suspended tick, so a
// manoeuvre resumes where it left off instead of completing during the freeze.
function freezeSuspendedTimers(state: SimState): void {
  if (!state.wxOps.movesSuspended) return;
  for (const v of state.vessels) {
    if ((v.status === "berthing" || v.status === "departing") && v.phaseEndsTick !== undefined) {
      v.phaseEndsTick += 1;
    }
  }
}
