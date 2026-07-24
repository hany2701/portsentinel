// Shared twin palette. Hexes match the dashboard chart palette (SourceTag /
// Cockpit / Header) so the twin and the dashboard read as one system — §7:
// "All colors from the layout spec's chart hex palette so twin and dashboard agree."
import type { VesselStatus, CargoType, WeatherBandId } from "../sim";

export const C = {
  green: "#1baf7a",
  amber: "#eda100",
  red: "#d03b3b",
  blue: "#2a78d6",
  blueLight: "#3987e5",
  slate: "#64748b",
  water: "#16324f",
  deck: "#7b8494",
  quay: "#9aa3b2",
  ground: "#aab2bf",
  select: "#8b5cf6", // violet — selection highlight
} as const;

// Weather-suspended assets (D-58): a cool grey-blue distinct from degraded
// amber and down red — the asset is healthy but weather-idled.
export const SUSPENDED = "#8aa2c0";

// Yard utilization band → block tint. OPS-YARD §1: <70 normal, 70–85 elevated,
// >85 re-allocation review / critical (plan §7: "<70 green, 70–85 amber-ish, >85/92 red").
export function yardBandColor(pct: number): string {
  if (pct < 70) return C.green;
  if (pct <= 85) return C.amber;
  return C.red;
}

// Vessel hull color by status. Anchored (waiting) reads amber, alongside (working)
// green, diverted red; in-transit states stay neutral blue/slate.
const VESSEL_COLORS: Record<VesselStatus, string> = {
  // GR-1: enroute vessels are owned by the maritime engine and never render in
  // the twin; the entry keeps the map exhaustive.
  enroute: C.slate,
  approaching: C.blueLight,
  anchored: C.amber,
  berthing: C.blue,
  alongside: C.green,
  departing: C.slate,
  diverted: C.red,
};
export function vesselColor(status: VesselStatus): string {
  return VESSEL_COLORS[status];
}

// Container color by cargo type (reefer/hazmat get their doctrine-segregated hue).
export const CARGO_COLORS: Record<CargoType, string> = {
  standard: C.blueLight,
  reefer: C.green,
  hazmat: C.amber,
};

// Weather-band presentation tokens (D-52): the single place any renderer picks
// a colour for a weather-risk band. `hex` serves non-Tailwind consumers (twin);
// `bg`/`stroke`/`dot` are literal Tailwind tokens (kept whole so JIT sees them)
// for the OPS-WX band bar, the gauge arc, and the header WX dot respectively.
// The severe orange #e07b39 (formerly a one-off literal in Weather.tsx) is
// reconciled here.
export const WEATHER_BAND_COLOR: Record<
  WeatherBandId,
  { hex: string; bg: string; stroke: string; dot: string }
> = {
  normal: { hex: C.green, bg: "bg-[#1baf7a] dark:bg-[#199e70]", stroke: "stroke-[#1baf7a] dark:stroke-[#199e70]", dot: "bg-[#1baf7a] dark:bg-[#199e70]" },
  caution: { hex: C.amber, bg: "bg-[#eda100] dark:bg-[#c98500]", stroke: "stroke-[#eda100] dark:stroke-[#c98500]", dot: "bg-[#eda100] dark:bg-[#c98500]" },
  severe: { hex: "#e07b39", bg: "bg-[#e07b39]", stroke: "stroke-[#e07b39]", dot: "bg-[#e07b39]" },
  critical: { hex: C.red, bg: "bg-[#d03b3b]", stroke: "stroke-[#d03b3b]", dot: "bg-[#d03b3b]" },
};
