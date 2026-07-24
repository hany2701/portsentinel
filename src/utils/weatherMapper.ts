import type { OpenMeteoRaw } from "../services/weatherClient";
import type { WeatherReading } from "../sim/types";

// Pure transform: Open-Meteo raw payloads → a fused WeatherReading + hourly gust forecast.
// The two points are averaged for scalar conditions; wind direction takes the primary
// (Tuas) point to avoid degree-wraparound error. Units: forecast API already returns
// knots (wind_speed_unit=kn); visibility is metres → km; times are unix seconds → ms.

export type WeatherForecastPoint = { timeMs: number; gustKts: number };
export type MappedWeather = { reading: WeatherReading; forecast: WeatherForecastPoint[] };

// D-75: the earliest forecast point at/above a crane gust limit — the Monitor's
// lead-time warning and the agent's proactive-advice line share this one
// derivation. Limits are parameters so the function stays pure and testable.
export type GustBreach = { scope: "STS" | "ALL"; limitKts: number; gustKts: number; inHours: number };

export function firstGustBreach(
  forecast: WeatherForecastPoint[],
  nowMs: number,
  limits: { stsKts: number; rtgKts: number },
): GustBreach | null {
  for (const p of forecast) {
    if (p.timeMs < nowMs) continue;
    if (p.gustKts >= limits.stsKts) {
      const all = p.gustKts >= limits.rtgKts;
      return {
        scope: all ? "ALL" : "STS",
        limitKts: all ? limits.rtgKts : limits.stsKts,
        gustKts: p.gustKts,
        inHours: Math.max(0, Math.round(((p.timeMs - nowMs) / 3_600_000) * 10) / 10),
      };
    }
  }
  return null;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export function mapWeather(raw: OpenMeteoRaw): MappedWeather {
  const fc = raw.forecast.map((f) => f.current);
  const marine = raw.marine.map((m) => m.current);
  const tuas = raw.forecast[0].current;

  const reading: WeatherReading = {
    asOfMs: Math.max(...fc.map((c) => c.time)) * 1000,
    windKts: round1(mean(fc.map((c) => c.wind_speed_10m))),
    gustKts: round1(mean(fc.map((c) => c.wind_gusts_10m))),
    windDirDeg: Math.round(tuas.wind_direction_10m),
    waveHeightM: round2(mean(marine.map((c) => c.wave_height))),
    visibilityKm: round1(mean(fc.map((c) => c.visibility)) / 1000),
    precipMm: round1(mean(fc.map((c) => c.precipitation))),
  };

  const h = raw.forecast[0].hourly;
  const nowMs = reading.asOfMs;
  const forecast: WeatherForecastPoint[] = h.time
    .map((t, i) => ({ timeMs: t * 1000, gustKts: round1(h.wind_gusts_10m[i]) }))
    .filter((p) => p.timeMs >= nowMs)
    .slice(0, 24);

  return { reading, forecast };
}

const round1 = (n: number) => Number(n.toFixed(1));
const round2 = (n: number) => Number(n.toFixed(2));
