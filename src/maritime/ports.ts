import type { DataProvenance } from "../sim/types";

// GR-1: the port hubs the global and regional maps render. Static reference
// data — never in SimState, never cloned per tick.
//
// WHICH ports exist comes from the nine service rotations in src/sim/roster.ts.
// WHERE they are comes from published harbour positions (see data/SOURCES.md);
// no coordinate here is inferred from a port name or a rotation string.
//
// PORT-PTP and PORT-KLANG reuse the ids of the existing AlternatePort entries in
// worldGen.ts, so a divert target and a map hub are the same entity.

export type PortRegion =
  | "southeast_asia"
  | "south_asia"
  | "east_asia"
  | "middle_east"
  | "europe"
  | "north_america";

export type PortHub = {
  id: string;
  name: string;
  countryCode: string;
  latitude: number;
  longitude: number;
  region: PortRegion;
  riskLevel: "low" | "medium" | "high";
  // Typical berth-queue wait used as a routing cost input for ports other than
  // Tuas (Tuas' own wait is calculated from live simulation state instead).
  estimatedWaitHours: number;
  source: DataProvenance;
};

const hub = (
  id: string,
  name: string,
  countryCode: string,
  latitude: number,
  longitude: number,
  region: PortRegion,
  riskLevel: PortHub["riskLevel"],
  estimatedWaitHours: number,
): PortHub => ({
  id,
  name,
  countryCode,
  latitude,
  longitude,
  region,
  riskLevel,
  estimatedWaitHours,
  source: "static_reference",
});

export const PORT_HUBS: readonly PortHub[] = [
  // Home port. Position is the Tuas terminal itself, matching WEATHER_POINTS.tuas.
  hub("PORT-TUAS", "Tuas Port, Singapore", "SG", 1.24, 103.62, "southeast_asia", "medium", 6),

  // Southeast Asia — the regional scope.
  hub("PORT-PTP", "Tanjung Pelepas", "MY", 1.36, 103.55, "southeast_asia", "low", 4),
  hub("PORT-KLANG", "Port Klang", "MY", 3.0, 101.39, "southeast_asia", "low", 5),
  hub("PORT-PENANG", "Penang", "MY", 5.41, 100.36, "southeast_asia", "low", 4),
  // GR-9: Batam and Bintan sit at their seaward harbour approaches (north-coast
  // roads / Selat Riau) rather than the island interior, so the Riau-connector
  // legs between them run through water when drawn over real coastline imagery.
  hub("PORT-BATAM", "Batam", "ID", 1.205, 104.02, "southeast_asia", "low", 3),
  hub("PORT-BINTAN", "Bintan", "ID", 1.15, 104.3, "southeast_asia", "low", 3),
  hub("PORT-JAKARTA", "Tanjung Priok, Jakarta", "ID", -6.1, 106.88, "southeast_asia", "medium", 8),
  hub("PORT-SURABAYA", "Tanjung Perak, Surabaya", "ID", -7.2, 112.73, "southeast_asia", "low", 6),
  hub("PORT-HCMC", "Ho Chi Minh City", "VN", 10.76, 106.73, "southeast_asia", "medium", 7),
  hub("PORT-BANGKOK", "Laem Chabang, Bangkok", "TH", 13.08, 100.89, "southeast_asia", "low", 6),

  // South Asia.
  hub("PORT-CHENNAI", "Chennai", "IN", 13.1, 80.29, "south_asia", "medium", 10),
  hub("PORT-COLOMBO", "Colombo", "LK", 6.95, 79.84, "south_asia", "medium", 7),

  // East Asia.
  hub("PORT-HONGKONG", "Hong Kong", "HK", 22.32, 114.13, "east_asia", "low", 5),
  hub("PORT-KAOHSIUNG", "Kaohsiung", "TW", 22.61, 120.28, "east_asia", "low", 5),

  // Middle East.
  hub("PORT-JEBELALI", "Jebel Ali", "AE", 25.01, 55.06, "middle_east", "medium", 8),

  // Europe.
  hub("PORT-ROTTERDAM", "Rotterdam", "NL", 51.95, 4.14, "europe", "low", 6),
  hub("PORT-HAMBURG", "Hamburg", "DE", 53.54, 9.93, "europe", "low", 7),

  // North America.
  hub("PORT-LA", "Los Angeles", "US", 33.73, -118.26, "north_america", "high", 18),
  hub("PORT-LONGBEACH", "Long Beach", "US", 33.75, -118.21, "north_america", "high", 20),
] as const;

export const TUAS_PORT_ID = "PORT-TUAS";

const BY_ID = new Map(PORT_HUBS.map((p) => [p.id, p]));

export function portHubById(id: string): PortHub | undefined {
  return BY_ID.get(id);
}

// GR-5A: visual hierarchy. Tiers drive marker size and when a label earns screen
// space, so a global view is not a wall of overlapping text. This is presentation
// only — routing treats every hub identically.
export type PortTier = "primary" | "regional" | "supporting";

// The network's anchor ports: the demo's destination plus the largest hubs each
// corridor family terminates at.
const PRIMARY_PORTS = new Set([
  "PORT-TUAS",
  "PORT-ROTTERDAM",
  "PORT-HONGKONG",
  "PORT-JEBELALI",
  "PORT-LA",
]);

// Secondary hubs that carry their own services and deserve labels once the map
// leaves the widest zoom.
const REGIONAL_PORTS = new Set([
  "PORT-PTP",
  "PORT-KLANG",
  "PORT-COLOMBO",
  "PORT-HAMBURG",
  "PORT-KAOHSIUNG",
  "PORT-JAKARTA",
  "PORT-HCMC",
  "PORT-CHENNAI",
  "PORT-BANGKOK",
]);

export function portTier(hub: PortHub): PortTier {
  if (PRIMARY_PORTS.has(hub.id)) return "primary";
  if (REGIONAL_PORTS.has(hub.id)) return "regional";
  return "supporting";
}
