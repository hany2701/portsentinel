import type { NeaLightningRaw, NeaPsiRaw } from "../services/marineFeeds";
import type { LightningReading, HazeReading } from "../sim/types";

// Pure transforms, no I/O — mirrors weatherMapper.ts. asOfMs is stamped by the
// caller (Date.now()) rather than parsed from the API's own timestamp field,
// since these endpoints don't return a unix-ms field to parse directly.

// "readings" is non-empty exactly when NEA is currently reporting lightning
// somewhere in Singapore — a national signal, not per-station geo-filtered
// (the response carries no per-reading coordinates to filter on).
export function mapLightning(raw: NeaLightningRaw, nowMs: number): LightningReading {
  const readings = raw.data?.records?.[0]?.item?.readings ?? [];
  return { asOfMs: nowMs, active: readings.length > 0 };
}

// PSI region nearest Tuas is "west".
export function mapHaze(raw: NeaPsiRaw, nowMs: number): HazeReading {
  const psi = raw.items?.[0]?.readings?.psi_twenty_four_hourly?.west;
  return { asOfMs: nowMs, psi: typeof psi === "number" ? psi : 45 };
}
