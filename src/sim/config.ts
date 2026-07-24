export const TICK_SIM_MINUTES = 5;
export const TICK_REAL_MS = 2000;
export const SPEEDS = [0.5, 1, 2, 4, 8] as const;
export const KPI_HISTORY_LENGTH = 288; // 24 sim-hours (D-77 shift memory; was 120)

export const DAY_START_MINUTES = 8 * 60;

export const VESSEL_COUNT = 22;
export const RULE_COOLDOWN_TICKS = 12;

// REAL-2 (D-80): transshipment connection tuning. Tuas is ~85-90% transshipment
// — most discharged boxes wait in the yard for an onward service rather than
// leaving by truck. The window is a compressed SLA to catch the onward call
// (~2x the service cadence); at-risk fires as the deadline nears un-connected.
// A single manifest item becomes one yard lot on discharge, so it must fit a
// yard block. Capping item size keeps discharge from stalling on an item larger
// than any block's free space (D-80). Big vessels split into several lots.
export const MAX_ITEM_TEU = 1200;
// Liveness (D-80): a berth is a scarce resource. If a vessel has finished loading
// but its discharge is wedged by a full yard while cranes are working, it cuts
// the call short after this many stalled ticks and sails with the undischarged
// remainder — realistic congestion behaviour that prevents a berth deadlock.
export const CARGO_STALL_LIMIT = 10;
// REAL-3 (D-81): terminal-KPI rolling windows. Berth-on-arrival % and turnaround
// average over the last N completed calls; gross crane rate and rehandle ratio
// average over the last N ticks of move activity.
export const TERMINAL_COMPLETIONS_WINDOW = 40;
export const TERMINAL_MOVE_WINDOW_TICKS = 72; // 6 sim-hours
export const TRANSSHIP_SHARE = 0.85;
export const CONNECTION_WINDOW_TICKS = 160;
export const CONNECTION_AT_RISK_LEAD_TICKS = 40;
// Crane productivity (shared by the cargo tick stage and the D-55 wait projection).
export const MOVES_PER_CRANE_PER_TICK = 90;

// Weather feed (wall-clock, outside the engine — D-31).
export const WEATHER_POLL_MS = 10 * 60 * 1000; // poll Open-Meteo every 10 min
export const WEATHER_STALE_MS = 30 * 60 * 1000; // stale after 30 min without success
export const WEATHER_MAX_FAILURES = 3; // ...or 3 consecutive failed polls
export const WEATHER_POINTS = {
  tuas: { latitude: 1.29, longitude: 103.63, label: "Tuas" },
  strait: { latitude: 1.6, longitude: 102.9, label: "Malacca Strait" },
} as const;

// Operations planning/forecast horizons (UI selection, not doctrine policy).
export const FORECAST_HORIZON_OPTIONS = [72, 144, 288] as const; // 6 / 12 / 24 sim-hours

export function formatSimTime(simMinutes: number): string {
  const total = DAY_START_MINUTES + simMinutes;
  const day = Math.floor(total / (24 * 60)) + 1;
  const minutesOfDay = total % (24 * 60);
  const hh = String(Math.floor(minutesOfDay / 60)).padStart(2, "0");
  const mm = String(minutesOfDay % 60).padStart(2, "0");
  return `Day ${day} ${hh}:${mm}`;
}

export function ticksToHours(ticks: number): number {
  return (ticks * TICK_SIM_MINUTES) / 60;
}
