import { DOCTRINE } from "./doctrine";
import {
  averageBerthWaitHours,
  avgTurnaroundHours,
  berthOccupancyPct,
  berthOnArrivalPct,
  connectionsAtRisk,
  craneAvailabilityPct,
  craneMovesPerHour,
  rehandleRatio,
  teuAtRisk,
  vesselsWaiting,
  yardUtilisationPct,
} from "./derive";
import type { KpiSnapshot, SimState } from "./types";

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function gateStress(state: SimState): number {
  const q = state.gate.queuedTrucks;
  return clamp01(q / 80);
}

export type ScoreBreakdown = {
  queueAndWait: number;
  craneAvailability: number;
  berthOccupancy: number;
  yardUtilisation: number;
  weatherRisk: number;
  gateCongestion: number;
};

export function scoreStress(state: SimState): ScoreBreakdown {
  const waiting = vesselsWaiting(state);
  const avgWait = averageBerthWaitHours(state);
  const queueStress = clamp01(waiting / 10) * 0.5 + clamp01(avgWait / DOCTRINE.berth.targetMaxAnchorageWaitHours) * 0.5;
  const crane = 1 - craneAvailabilityPct(state) / 100;
  const berth = clamp01((berthOccupancyPct(state) / 100 - 0.7) / 0.3);
  const yard = clamp01((yardUtilisationPct(state) / 100 - 0.7) / 0.3);
  const weather = clamp01(state.weather.riskIndex / 100);
  const gate = gateStress(state);
  return {
    queueAndWait: queueStress,
    craneAvailability: crane,
    berthOccupancy: berth,
    yardUtilisation: yard,
    weatherRisk: weather,
    gateCongestion: gate,
  };
}

// D-75: the score's arithmetic as displayable rows — same stresses and weights
// the score uses, so the cockpit can show the recipe without the LLM.
export type ResilienceFactor = {
  key: keyof ScoreBreakdown;
  label: string;
  weightPct: number;
  stress: number; // 0..1
  contribution: number; // points deducted from 100
};

const FACTOR_LABELS: Record<keyof ScoreBreakdown, string> = {
  queueAndWait: "Queue & wait",
  craneAvailability: "Crane availability",
  berthOccupancy: "Berth occupancy",
  yardUtilisation: "Yard utilisation",
  weatherRisk: "Weather risk",
  gateCongestion: "Gate congestion",
};

export function resilienceBreakdown(state: SimState): ResilienceFactor[] {
  const s = scoreStress(state);
  const w = DOCTRINE.score.weights;
  return (Object.keys(FACTOR_LABELS) as (keyof ScoreBreakdown)[]).map((k) => ({
    key: k,
    label: FACTOR_LABELS[k],
    weightPct: w[k],
    stress: s[k],
    contribution: s[k] * w[k],
  }));
}

export function resilienceScore(state: SimState): number {
  const s = scoreStress(state);
  const w = DOCTRINE.score.weights;
  const penalty =
    s.queueAndWait * w.queueAndWait +
    s.craneAvailability * w.craneAvailability +
    s.berthOccupancy * w.berthOccupancy +
    s.yardUtilisation * w.yardUtilisation +
    s.weatherRisk * w.weatherRisk +
    s.gateCongestion * w.gateCongestion;
  return Math.max(0, Math.min(100, Math.round(100 - penalty)));
}

export function computeKpis(state: SimState): KpiSnapshot {
  return {
    tick: state.clock.tick,
    resilienceScore: resilienceScore(state),
    berthOccupancyPct: Math.round(berthOccupancyPct(state)),
    vesselsWaiting: vesselsWaiting(state),
    averageBerthWaitHours: Number(averageBerthWaitHours(state).toFixed(1)),
    yardUtilisationPct: Math.round(yardUtilisationPct(state)),
    craneAvailabilityPct: Math.round(craneAvailabilityPct(state)),
    weatherRiskIndex: state.weather.riskIndex,
    teuAtRisk: Math.round(teuAtRisk(state)),
    connectionsAtRisk: connectionsAtRisk(state).length,
    berthOnArrivalPct: berthOnArrivalPct(state),
    turnaroundHours: avgTurnaroundHours(state),
    craneMovesPerHour: craneMovesPerHour(state),
    rehandleRatio: rehandleRatio(state),
  };
}
