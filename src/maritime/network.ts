import { geoDistance } from "d3-geo";
import { EARTH_RADIUS_NM } from "./config";
import { PORT_HUBS } from "./ports";
import type { RouteNodeKind } from "../sim/types";

// GR-1: the static shipping network — nodes, edges and named corridors. Static
// reference data: it is never stored in SimState and never cloned per tick.
// A vessel's route plan holds only node IDs; polylines are derived for render.
//
// These are CONCEPTUAL routing waypoints for decision support, not navigational
// waypoints. Distances are great-circle and ignore traffic separation schemes,
// depth and weather routing. See data/SOURCES.md.

export type RouteNode = {
  id: string;
  name: string;
  kind: RouteNodeKind;
  latitude: number;
  longitude: number;
  portId?: string; // set on port nodes
};

export type RouteEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  distanceNm: number;
  restrictions?: readonly string[];
};

const wpt = (
  id: string,
  name: string,
  kind: RouteNodeKind,
  latitude: number,
  longitude: number,
): RouteNode => ({ id, name, kind, latitude, longitude });

// Port nodes are generated from the hub table so a port's position exists once.
const PORT_NODES: RouteNode[] = PORT_HUBS.map((p) => ({
  id: p.id,
  name: p.name,
  kind: "port" as const,
  latitude: p.latitude,
  longitude: p.longitude,
  portId: p.id,
}));

const WAYPOINTS: readonly RouteNode[] = [
  // --- Tuas approach chain. The geofence handover to the D-62 twin happens on
  // this chain; NODE-TUAS-ANCHORAGE is the single geographic stand-in for the
  // whole offshore anchorage (the twin places individual vessels in slots).
  wpt("NODE-TUAS-ANCHORAGE", "Tuas offshore anchorage", "anchorage", 1.18, 103.6),
  wpt("WPT-TUAS-HOLDING", "Tuas approach holding", "holding_area", 1.15, 103.66),
  wpt("WPT-SG-APPROACH", "Singapore eastern approach", "approach", 1.16, 103.75),
  // Westbound traffic leaves Tuas to the WEST. Without this node the Malacca
  // legs ran east to WPT-SG-APPROACH and then doubled back northwest, crossing
  // the Tuas-anchorage leg ~1 nm off the terminal — one flaw drawn nine times
  // over, since every corridor shared the exit chain. Measured clear of land.
  wpt("WPT-SG-WEST", "Singapore western approach", "approach", 1.2, 103.44),
  wpt("WPT-SG-STRAIT-E", "Singapore Strait east", "strait", 1.23, 104.1),
  // GR-9: eastern exit of the Singapore Strait and the Riau-island channels, so
  // the eastbound and Riau-connector legs stay in the shipping lanes rather than
  // cutting across Batam, Bintan and the Riau archipelago (verified vs NE 10m).
  wpt("WPT-SG-STRAIT-OUT", "Singapore Strait eastern exit", "strait", 1.28, 104.55),
  wpt("WPT-RIAU", "Riau Strait", "strait", 1.2, 104.33),
  wpt("WPT-RIAU-E", "East of Bintan", "waypoint", 0.9, 105.1),

  // --- Malacca Strait: the main westbound artery. MALACCA-N sits mid-strait so
  // the Klang/Penang legs run down the shipping lane, not the Sumatran shore.
  wpt("WPT-MALACCA-S", "Malacca Strait south", "strait", 1.75, 102.5),
  wpt("WPT-MALACCA-N", "Malacca Strait north", "strait", 4.2, 99.6),
  wpt("WPT-MALACCA-NW", "Malacca Strait northwest exit", "strait", 6.0, 96.5),
  // Port Klang lies up the Klang river channel and Penang is an island port, so
  // each is entered from one end of its channel and left from the other. The
  // straight strait-to-port lines they replace cut 32 nm and 9 nm across the
  // Malay peninsula respectively; both approach pairs are measured clear.
  wpt("WPT-KLANG-S", "Port Klang south approach", "approach", 2.9, 101.15),
  wpt("WPT-KLANG-N", "Port Klang north approach", "approach", 3.15, 101.2),
  wpt("WPT-PENANG-S", "Penang south channel", "approach", 5.25, 100.4),
  wpt("WPT-PENANG-N", "Penang north channel", "approach", 5.55, 100.3),

  // --- Sunda route: the genuine alternative to Malacca, south around Sumatra.
  wpt("WPT-SUNDA", "Sunda Strait", "strait", -6.0, 105.8),
  // GR-5A: without this offshore leg the Sunda→Sumatra great circle cuts across
  // southern Sumatra. Ships leaving Sunda stand well out into the Indian Ocean
  // before turning northwest.
  wpt("WPT-SUNDA-SW", "Southwest of Sunda Strait", "waypoint", -7.2, 103.5),
  // Well offshore, west of the Mentawai chain, so the Sunda alternative and the
  // Nicobar legs stay in the open Indian Ocean rather than over Sumatra.
  wpt("WPT-SUMATRA-W", "West of Sumatra", "waypoint", -1.0, 95.5),

  // --- Indian Ocean.
  wpt("WPT-NICOBAR", "Great Channel, Nicobar", "strait", 6.4, 94.2),
  wpt("WPT-BENGAL", "Bay of Bengal", "waypoint", 12.0, 87.0),
  wpt("WPT-SRILANKA-S", "South of Sri Lanka", "waypoint", 5.4, 80.6),
  // GR-5A: Chennai traffic passes EAST of Sri Lanka — the direct line to the
  // southern waypoint clips the Palk Strait, which is not a through route for
  // deep-draught vessels. The southeast corner keeps the turn offshore of the
  // island's eastern bulge.
  wpt("WPT-SRILANKA-E", "East of Sri Lanka", "waypoint", 8.6, 82.6),
  wpt("WPT-SRILANKA-SE", "Southeast of Sri Lanka", "waypoint", 5.8, 82.1),
  // GR-9: southwest of Sri Lanka — the Colombo approach rounds Dondra Head in
  // open water instead of the straight line that clipped the island's south.
  wpt("WPT-SL-SW", "Southwest of Sri Lanka", "waypoint", 6.0, 79.7),
  // GR-5A: the Laccadive Sea leg keeps Colombo→Arabian Sea clear of the
  // southern Indian coast instead of cutting across Kerala.
  // Shifted southwest of its original 7.2N 74.0E: the leg on to the Arabian Sea
  // clipped a Lakshadweep islet for 0.25 nm. Too fine for the 2 nm sampling the
  // route-geometry test used, but it is still a line drawn over land.
  wpt("WPT-LACCADIVE", "Laccadive Sea", "waypoint", 7.0, 73.6),
  wpt("WPT-ARABIAN", "Arabian Sea", "waypoint", 14.0, 68.0),

  // --- Gulf.
  wpt("WPT-OMAN", "Gulf of Oman", "waypoint", 23.5, 59.5),
  wpt("WPT-HORMUZ", "Strait of Hormuz", "strait", 26.5, 56.5),

  // --- Red Sea and Suez.
  wpt("WPT-ADEN", "Gulf of Aden", "waypoint", 12.5, 47.0),
  wpt("WPT-BABELMANDEB", "Bab-el-Mandeb", "strait", 12.6, 43.4),
  wpt("WPT-REDSEA", "Red Sea", "waypoint", 20.0, 38.5),
  wpt("WPT-SUEZ", "Suez Canal", "strait", 29.9, 32.55),

  // --- Mediterranean and northwest Europe.
  wpt("WPT-MED-E", "Eastern Mediterranean", "waypoint", 33.5, 30.0),
  // GR-5A: the Sicily Channel. Without it the east–west Mediterranean leg runs
  // over Tunisia rather than between Sicily and Cap Bon.
  // GR-5A: the Mediterranean transit follows the real trunk route — south of
  // Sicily through the Sicily Channel, north around Cap Bon, west along the
  // Algerian basin, then the Alborán Sea into Gibraltar. Each of these exists
  // because the direct line between its neighbours runs over land.
  wpt("WPT-MED-C", "Sicily Channel", "strait", 36.9, 11.9),
  wpt("WPT-MED-CB", "North of Cap Bon", "waypoint", 37.9, 10.6),
  wpt("WPT-MED-W", "Western Mediterranean", "waypoint", 37.9, 2.0),
  wpt("WPT-ALBORAN", "Alborán Sea", "waypoint", 36.1, -3.0),
  wpt("WPT-GIBRALTAR", "Strait of Gibraltar", "strait", 35.95, -5.6),
  // GR-5A: Cape St Vincent. Gibraltar→Biscay direct runs overland across the
  // Iberian peninsula; real traffic rounds the southwest corner of Portugal.
  wpt("WPT-ST-VINCENT", "Off Cape St Vincent", "waypoint", 36.9, -9.4),
  // GR-9: west of Portugal, so the Iberian Atlantic leg clears Cabo da Roca.
  wpt("WPT-PORTUGAL-W", "West of Portugal", "waypoint", 39.5, -10.2),
  wpt("WPT-BISCAY", "Bay of Biscay", "waypoint", 45.0, -9.5),
  // GR-5A: Ushant, the standard Biscay→Channel turning point. The direct line
  // crosses Brittany.
  wpt("WPT-USHANT", "Off Ushant", "waypoint", 48.6, -5.8),
  // GR-9: two mid-Channel steps north of the Cotentin peninsula and the Channel
  // Islands, so the Ushant→Dover leg no longer cuts across Normandy.
  wpt("WPT-CH-W", "Western English Channel", "waypoint", 49.3, -4.5),
  wpt("WPT-CH-MID", "Mid English Channel", "waypoint", 49.95, -2.0),
  wpt("WPT-CHANNEL", "English Channel", "strait", 50.5, 1.3),
  wpt("WPT-NORTHSEA", "Southern North Sea", "waypoint", 52.9, 3.4),
  // GR-5A: the German Bight. Hamburg lies up the Elbe, so approaches run north
  // of the Frisian coast instead of straight across the Netherlands.
  wpt("WPT-GERMAN-BIGHT", "German Bight", "waypoint", 54.2, 7.6),

  // --- South China Sea and East Asia.
  wpt("WPT-SCS-S", "South China Sea south", "waypoint", 4.0, 106.0),
  wpt("WPT-SCS-N", "South China Sea north", "waypoint", 15.0, 113.0),
  // The approach comes up the East Lamma Channel and the exit leaves through Lei
  // Yue Mun to the east. The previous pair (approach at 21.8N, exit WEST of the
  // harbour at 113.9E) made the corridor double back on itself: the eastbound
  // leg crossed its own approach at 114.170E 22.024N. An east-facing exit cannot
  // re-cross an approach that lies west of it.
  wpt("WPT-HK-APPROACH", "Hong Kong approach", "approach", 22.15, 114.15),
  wpt("WPT-HK-E", "Hong Kong eastern exit", "waypoint", 22.29, 114.26),
  wpt("WPT-SCS-HK", "South China Sea off Hong Kong", "waypoint", 21.8, 116.5),
  wpt("WPT-TAIWAN-STRAIT", "Taiwan Strait", "strait", 23.5, 118.5),
  wpt("WPT-LUZON", "Luzon Strait", "strait", 20.5, 121.5),

  // --- Indochina.
  // The Vung Tau pilot station at the mouth of the Saigon river. Ho Chi Minh City
  // is ~36 nm upriver, so this is the ONLY node it connects to — the old direct
  // HCMC→Ca Mau leg ran 92 nm overland across the whole Mekong delta.
  wpt("WPT-MEKONG", "Vung Tau, Saigon river mouth", "approach", 10.32, 107.15),
  wpt("WPT-CAMAU", "Ca Mau point", "waypoint", 8.2, 104.5),
  wpt("WPT-GULF-THAILAND", "Gulf of Thailand", "waypoint", 9.0, 102.0),
  // GR-9: central upper Gulf of Thailand, keeping the Laem Chabang approach off
  // the eastern-seaboard headlands.
  wpt("WPT-GULF-C", "Central Gulf of Thailand", "waypoint", 12.5, 100.55),

  // --- Indonesian archipelago.
  wpt("WPT-KARIMATA", "Karimata Strait", "strait", -2.5, 108.5),
  // GR-9: east of Belitung, so the Sunda alternative rounds the island in water.
  wpt("WPT-BELITUNG-E", "East of Belitung", "waypoint", -4.3, 108.9),
  // GR-5A: standing offshore of Jakarta before turning east keeps the coastal
  // leg in the Java Sea rather than tracking along the shoreline.
  wpt("WPT-JAVA-NW", "North of Jakarta", "waypoint", -5.4, 107.4),
  wpt("WPT-JAVA-SEA", "Java Sea", "waypoint", -5.5, 110.5),
  // GR-9: north of Surabaya at the mouth of the Madura Strait.
  wpt("WPT-SURABAYA-N", "North of Surabaya", "waypoint", -6.45, 112.75),

  // --- Pacific crossing.
  wpt("WPT-PACIFIC-W", "Western Pacific", "waypoint", 25.0, 145.0),
  wpt("WPT-PACIFIC-MID", "Mid Pacific", "waypoint", 32.0, -170.0),
  wpt("WPT-PACIFIC-E", "Eastern Pacific", "waypoint", 33.0, -125.0),
] as const;

export const ROUTE_NODES: readonly RouteNode[] = [...PORT_NODES, ...WAYPOINTS];

const NODE_BY_ID = new Map(ROUTE_NODES.map((n) => [n.id, n]));

export function routeNodeById(id: string): RouteNode | undefined {
  return NODE_BY_ID.get(id);
}

// Great-circle distance in nautical miles between two nodes.
export function nodeDistanceNm(fromId: string, toId: string): number {
  const a = NODE_BY_ID.get(fromId);
  const b = NODE_BY_ID.get(toId);
  if (!a || !b) throw new Error(`Unknown route node: ${!a ? fromId : toId}`);
  return geoDistance([a.longitude, a.latitude], [b.longitude, b.latitude]) * EARTH_RADIUS_NM;
}

// Undirected connections. The graph builder makes each traversable both ways;
// listing them once keeps the network readable and impossible to half-connect.
const LINKS: readonly (readonly [string, string])[] = [
  // Tuas approach chain.
  ["PORT-TUAS", "NODE-TUAS-ANCHORAGE"],
  ["NODE-TUAS-ANCHORAGE", "WPT-TUAS-HOLDING"],
  ["WPT-TUAS-HOLDING", "WPT-SG-APPROACH"],
  ["WPT-SG-APPROACH", "WPT-SG-STRAIT-E"],
  // Westbound traffic turns west at the holding area. The former
  // WPT-SG-APPROACH→WPT-MALACCA-S and WPT-SG-STRAIT-E→WPT-MALACCA-S shortcuts
  // are gone: both ran back over Singapore (the second crossed 14 nm of it) and
  // together with the port legs they closed the triangles drawn off Tuas.
  ["WPT-TUAS-HOLDING", "WPT-SG-WEST"],
  ["WPT-SG-WEST", "WPT-MALACCA-S"],

  // Tanjung Pelepas sits just west of Tuas on the Malacca approach — it is the
  // nearest divert target, so it must be reachable from both approach sides.
  ["WPT-SG-APPROACH", "PORT-PTP"],
  ["PORT-PTP", "WPT-MALACCA-S"],

  // Malacca Strait. Klang and Penang are entered at one end of their channel and
  // left at the other, so a call is a pass-through rather than a line drawn
  // across the peninsula and back.
  ["WPT-MALACCA-S", "WPT-KLANG-S"],
  ["WPT-KLANG-S", "PORT-KLANG"],
  ["PORT-KLANG", "WPT-KLANG-N"],
  ["WPT-KLANG-N", "WPT-MALACCA-N"],
  ["WPT-MALACCA-S", "WPT-MALACCA-N"],
  ["WPT-MALACCA-N", "WPT-PENANG-S"],
  ["WPT-PENANG-S", "PORT-PENANG"],
  ["PORT-PENANG", "WPT-PENANG-N"],
  ["WPT-PENANG-N", "WPT-MALACCA-NW"],
  ["WPT-MALACCA-N", "WPT-MALACCA-NW"],
  ["WPT-MALACCA-NW", "WPT-NICOBAR"],

  // Singapore Strait eastern exit — the eastbound and Riau legs fan out from
  // here so they stay in the shipping lanes rather than over the Riau islands.
  ["WPT-SG-STRAIT-E", "WPT-SG-STRAIT-OUT"],
  ["WPT-SG-STRAIT-OUT", "WPT-SCS-S"],
  ["WPT-SG-STRAIT-OUT", "WPT-RIAU-E"],
  ["WPT-RIAU-E", "WPT-KARIMATA"],

  // Sunda alternative to Malacca (rounds Belitung and stands well offshore of
  // Sumatra's west coast).
  ["WPT-KARIMATA", "WPT-BELITUNG-E"],
  ["WPT-BELITUNG-E", "WPT-SUNDA"],
  ["WPT-SUNDA", "WPT-SUNDA-SW"],
  ["WPT-SUNDA-SW", "WPT-SUMATRA-W"],
  ["WPT-SUMATRA-W", "WPT-NICOBAR"],
  ["WPT-SUMATRA-W", "WPT-SRILANKA-S"],

  // Riau connector — Batam and Bintan joined through the Riau Strait, not across
  // the islands between them.
  ["WPT-SG-STRAIT-E", "PORT-BATAM"],
  ["PORT-BATAM", "WPT-RIAU"],
  ["WPT-RIAU", "PORT-BINTAN"],

  // Indian Ocean.
  ["WPT-NICOBAR", "WPT-BENGAL"],
  ["WPT-NICOBAR", "WPT-SRILANKA-S"],
  ["WPT-BENGAL", "PORT-CHENNAI"],
  // Chennai runs east of Sri Lanka; Colombo reaches the Arabian Sea via the
  // Laccadive Sea. Both avoid crossing the Indian subcontinent.
  ["PORT-CHENNAI", "WPT-SRILANKA-E"],
  ["WPT-SRILANKA-E", "WPT-SRILANKA-SE"],
  ["WPT-SRILANKA-SE", "WPT-SRILANKA-S"],
  ["WPT-SRILANKA-S", "WPT-SL-SW"],
  ["WPT-SL-SW", "PORT-COLOMBO"],
  ["PORT-COLOMBO", "WPT-LACCADIVE"],
  ["WPT-LACCADIVE", "WPT-ARABIAN"],
  ["WPT-SRILANKA-S", "WPT-ARABIAN"],

  // Gulf.
  ["WPT-ARABIAN", "WPT-OMAN"],
  ["WPT-OMAN", "WPT-HORMUZ"],
  ["WPT-HORMUZ", "PORT-JEBELALI"],

  // Red Sea / Suez / Europe.
  ["WPT-ARABIAN", "WPT-ADEN"],
  ["WPT-ADEN", "WPT-BABELMANDEB"],
  ["WPT-BABELMANDEB", "WPT-REDSEA"],
  ["WPT-REDSEA", "WPT-SUEZ"],
  ["WPT-SUEZ", "WPT-MED-E"],
  // The Mediterranean runs through the Sicily Channel, and northwest Europe via
  // Ushant and the German Bight — the direct lines cross Tunisia, Brittany and
  // the Low Countries respectively.
  ["WPT-MED-E", "WPT-MED-C"],
  ["WPT-MED-C", "WPT-MED-CB"],
  ["WPT-MED-CB", "WPT-MED-W"],
  ["WPT-MED-W", "WPT-ALBORAN"],
  ["WPT-ALBORAN", "WPT-GIBRALTAR"],
  ["WPT-GIBRALTAR", "WPT-ST-VINCENT"],
  ["WPT-ST-VINCENT", "WPT-PORTUGAL-W"],
  ["WPT-PORTUGAL-W", "WPT-BISCAY"],
  ["WPT-BISCAY", "WPT-USHANT"],
  ["WPT-USHANT", "WPT-CH-W"],
  ["WPT-CH-W", "WPT-CH-MID"],
  ["WPT-CH-MID", "WPT-CHANNEL"],
  ["WPT-CHANNEL", "WPT-NORTHSEA"],
  ["WPT-NORTHSEA", "PORT-ROTTERDAM"],
  ["WPT-NORTHSEA", "WPT-GERMAN-BIGHT"],
  ["WPT-GERMAN-BIGHT", "PORT-HAMBURG"],

  // South China Sea and East Asia. Hong Kong exits its harbour to the south and
  // runs offshore before the Taiwan Strait, clear of the Guangdong coast.
  ["WPT-SCS-S", "WPT-SCS-N"],
  ["WPT-SCS-N", "WPT-HK-APPROACH"],
  ["WPT-HK-APPROACH", "PORT-HONGKONG"],
  ["PORT-HONGKONG", "WPT-HK-E"],
  ["WPT-HK-E", "WPT-SCS-HK"],
  ["WPT-SCS-HK", "WPT-TAIWAN-STRAIT"],
  ["WPT-TAIWAN-STRAIT", "PORT-KAOHSIUNG"],
  ["WPT-SCS-N", "WPT-LUZON"],
  ["PORT-KAOHSIUNG", "WPT-LUZON"],
  // The Hong Kong end of the transpacific lane, so a HK–LA sailing reaches the
  // Luzon Strait without detouring through the Taiwan Strait.
  ["WPT-SCS-HK", "WPT-LUZON"],

  // Indochina. Ho Chi Minh City is 36 nm up the Saigon river, so WPT-MEKONG
  // (Vung Tau) is its ONLY connection — everything bound for the Gulf of
  // Thailand rounds Ca Mau from the open sea instead of crossing the delta.
  ["WPT-SCS-S", "WPT-MEKONG"],
  ["WPT-MEKONG", "PORT-HCMC"],
  ["WPT-SCS-S", "WPT-CAMAU"],
  ["WPT-CAMAU", "WPT-GULF-THAILAND"],
  ["WPT-GULF-THAILAND", "WPT-GULF-C"],
  ["WPT-GULF-C", "PORT-BANGKOK"],

  // Indonesian archipelago.
  ["WPT-KARIMATA", "PORT-JAKARTA"],
  ["PORT-JAKARTA", "WPT-JAVA-NW"],
  ["WPT-JAVA-NW", "WPT-JAVA-SEA"],
  ["WPT-JAVA-SEA", "WPT-SURABAYA-N"],
  ["WPT-SURABAYA-N", "PORT-SURABAYA"],

  // Pacific crossing.
  ["WPT-LUZON", "WPT-PACIFIC-W"],
  ["WPT-PACIFIC-W", "WPT-PACIFIC-MID"],
  ["WPT-PACIFIC-MID", "WPT-PACIFIC-E"],
  ["WPT-PACIFIC-E", "PORT-LA"],
  ["PORT-LA", "PORT-LONGBEACH"],
] as const;

export const ROUTE_EDGES: readonly RouteEdge[] = LINKS.map(([from, to]) => ({
  id: `E-${from}__${to}`,
  fromNodeId: from,
  toNodeId: to,
  distanceNm: nodeDistanceNm(from, to),
}));

// A named trade lane. Most are Tuas rotations, one per weekly service in
// src/sim/roster.ts; nodeIds runs outward from Tuas and a vessel sails it
// forward then back. The INTER-PORT lanes below do not call at Tuas at all —
// `tuasRotation` marks which is which, because only a Tuas rotation may be
// reversed into the approach fence for a handover.
export type ShippingCorridor = {
  id: string;
  name: string;
  serviceId: string;
  nodeIds: readonly string[];
  tuasRotation: boolean;
};

// Two exits, because Tuas faces west. Both are four nodes long so the outbound
// slice in populationGen keeps its meaning.
const TUAS_EXIT_EAST = ["PORT-TUAS", "NODE-TUAS-ANCHORAGE", "WPT-TUAS-HOLDING", "WPT-SG-APPROACH"] as const;
const TUAS_EXIT_WEST = ["PORT-TUAS", "NODE-TUAS-ANCHORAGE", "WPT-TUAS-HOLDING", "WPT-SG-WEST"] as const;

export const SHIPPING_CORRIDORS: readonly ShippingCorridor[] = [
  {
    id: "COR-STX",
    name: "Straits Express",
    serviceId: "SVC-STX",
    nodeIds: [
      ...TUAS_EXIT_WEST, "WPT-MALACCA-S", "WPT-KLANG-S", "PORT-KLANG", "WPT-KLANG-N",
      "WPT-MALACCA-N", "WPT-PENANG-S", "PORT-PENANG",
    ],
    tuasRotation: true,
  },
  {
    id: "COR-RIAU",
    name: "Riau Connector",
    serviceId: "SVC-RIAU",
    nodeIds: [...TUAS_EXIT_EAST, "WPT-SG-STRAIT-E", "PORT-BATAM", "WPT-RIAU", "PORT-BINTAN"],
    tuasRotation: true,
  },
  {
    id: "COR-AE7",
    name: "Asia–Europe AE7",
    serviceId: "SVC-AE7",
    nodeIds: [
      ...TUAS_EXIT_WEST, "WPT-MALACCA-S", "WPT-MALACCA-N", "WPT-MALACCA-NW", "WPT-NICOBAR",
      "WPT-SRILANKA-S", "WPT-ARABIAN", "WPT-ADEN", "WPT-BABELMANDEB", "WPT-REDSEA",
      "WPT-SUEZ", "WPT-MED-E", "WPT-MED-C", "WPT-MED-CB", "WPT-MED-W", "WPT-ALBORAN",
      "WPT-GIBRALTAR", "WPT-ST-VINCENT", "WPT-PORTUGAL-W", "WPT-BISCAY", "WPT-USHANT",
      "WPT-CH-W", "WPT-CH-MID", "WPT-CHANNEL", "WPT-NORTHSEA",
      "PORT-ROTTERDAM",
    ],
    tuasRotation: true,
  },
  {
    // Ho Chi Minh City left this rotation when the delta crossing was removed:
    // it sits 36 nm up a river with one way in, so a through-route cannot call
    // there. It now anchors the inter-port COR-SGN lane instead, and the Gulf of
    // Thailand is reached by rounding Ca Mau from the open sea.
    id: "COR-MEK",
    name: "Gulf of Thailand Link",
    serviceId: "SVC-MEK",
    nodeIds: [
      ...TUAS_EXIT_EAST, "WPT-SG-STRAIT-E", "WPT-SG-STRAIT-OUT", "WPT-SCS-S",
      "WPT-CAMAU", "WPT-GULF-THAILAND", "WPT-GULF-C", "PORT-BANGKOK",
    ],
    tuasRotation: true,
  },
  {
    id: "COR-BOB",
    name: "Bay of Bengal Service",
    serviceId: "SVC-BOB",
    nodeIds: [
      ...TUAS_EXIT_WEST, "WPT-MALACCA-S", "WPT-MALACCA-N", "WPT-MALACCA-NW", "WPT-NICOBAR",
      "WPT-BENGAL", "PORT-CHENNAI", "WPT-SRILANKA-E", "WPT-SRILANKA-SE", "WPT-SRILANKA-S",
      "WPT-SL-SW", "PORT-COLOMBO",
    ],
    tuasRotation: true,
  },
  {
    id: "COR-NAS",
    name: "North Asia Shuttle",
    serviceId: "SVC-NAS",
    nodeIds: [
      ...TUAS_EXIT_EAST, "WPT-SG-STRAIT-E", "WPT-SG-STRAIT-OUT", "WPT-SCS-S", "WPT-SCS-N", "WPT-HK-APPROACH",
      "PORT-HONGKONG", "WPT-HK-E", "WPT-SCS-HK", "WPT-TAIWAN-STRAIT", "PORT-KAOHSIUNG",
    ],
    tuasRotation: true,
  },
  {
    id: "COR-JAVA",
    name: "Java Loop",
    serviceId: "SVC-JAVA",
    nodeIds: [
      ...TUAS_EXIT_EAST, "WPT-SG-STRAIT-E", "WPT-SG-STRAIT-OUT", "WPT-RIAU-E", "WPT-KARIMATA", "PORT-JAKARTA",
      "WPT-JAVA-NW", "WPT-JAVA-SEA", "WPT-SURABAYA-N", "PORT-SURABAYA",
    ],
    tuasRotation: true,
  },
  {
    id: "COR-GULF",
    name: "Gulf Passage",
    serviceId: "SVC-GULF",
    nodeIds: [
      ...TUAS_EXIT_WEST, "WPT-MALACCA-S", "WPT-MALACCA-N", "WPT-MALACCA-NW", "WPT-NICOBAR",
      "WPT-SRILANKA-S", "WPT-ARABIAN", "WPT-OMAN", "WPT-HORMUZ", "PORT-JEBELALI",
    ],
    tuasRotation: true,
  },
  {
    id: "COR-TP3",
    name: "Transpacific TP3",
    serviceId: "SVC-TP3",
    nodeIds: [
      ...TUAS_EXIT_EAST, "WPT-SG-STRAIT-E", "WPT-SG-STRAIT-OUT", "WPT-SCS-S", "WPT-SCS-N", "WPT-LUZON",
      "WPT-PACIFIC-W", "WPT-PACIFIC-MID", "WPT-PACIFIC-E", "PORT-LA", "PORT-LONGBEACH",
    ],
    tuasRotation: true,
  },

  // --- Inter-port lanes. These never call at Tuas, so their vessels carry a
  // real origin port and are seeded sailing in BOTH directions: the network
  // stops being a star with Tuas at the centre and every ship pointing outward.
  // They are deliberately absent from SERVICE_ROSTER — that roster drives Tuas
  // berth scheduling, and a lane that never arrives must not book a berth.
  {
    id: "COR-TPX",
    name: "Transpacific TPX",
    serviceId: "SVC-TPX",
    nodeIds: [
      "PORT-HONGKONG", "WPT-HK-E", "WPT-SCS-HK", "WPT-LUZON",
      "WPT-PACIFIC-W", "WPT-PACIFIC-MID", "WPT-PACIFIC-E", "PORT-LA", "PORT-LONGBEACH",
    ],
    tuasRotation: false,
  },
  {
    id: "COR-SGN",
    name: "Saigon–Hong Kong Feeder",
    serviceId: "SVC-SGN",
    nodeIds: [
      "PORT-HCMC", "WPT-MEKONG", "WPT-SCS-S", "WPT-SCS-N", "WPT-HK-APPROACH", "PORT-HONGKONG",
    ],
    tuasRotation: false,
  },
] as const;

export function corridorForService(serviceId: string): ShippingCorridor | undefined {
  return SHIPPING_CORRIDORS.find((c) => c.serviceId === serviceId);
}

/**
 * Legs whose navigable water is narrower than the bundled coastline can
 * represent. At the checked resolution these are drawn crossing solid land, yet
 * each is a real shipping route — canals, sub-10 nm straits, river approaches,
 * island-harbour approaches and berths inside one harbour complex.
 *
 * This exists so the land-crossing check can skip them BY NAME with a recorded
 * reason, rather than lowering the standard everywhere. The check still runs on
 * every OTHER edge — now against Natural Earth 10m, the coastline the satellite
 * basemap shows (GR-9) — which is what caught the Riau (Batam/Bintan), Colombo,
 * Hong Kong→Taiwan, Channel/Normandy, Sumatra, Sunda and Java–Surabaya crossings
 * that the network now routes around in open water. Adding an entry is a
 * deliberate act requiring the same justification: a real route through water
 * too narrow to draw a vessel visibly clear of at this resolution.
 */
export const SUB_RESOLUTION_EDGES: Readonly<Record<string, string>> = {
  // Canals, rivers and sub-10 nm straits (real routes that transit land/narrows).
  "E-WPT-REDSEA__WPT-SUEZ": "Suez Canal — an artificial channel, absent from any coastline set",
  "E-WPT-SUEZ__WPT-MED-E": "Suez Canal northern approach",
  "E-WPT-ALBORAN__WPT-GIBRALTAR": "Strait of Gibraltar — 8 nm wide, below coastline resolution",
  "E-WPT-GIBRALTAR__WPT-ST-VINCENT": "Gulf of Cádiz — exits the strait along the Spanish coast",
  "E-WPT-CHANNEL__WPT-NORTHSEA": "Dover Strait — passes Cap Gris-Nez, below resolution",
  "E-WPT-HORMUZ__PORT-JEBELALI": "Strait of Hormuz and the Gulf approaches",
  "E-WPT-MEKONG__PORT-HCMC": "Saigon river approach — a river passage to the port",
  "E-WPT-GERMAN-BIGHT__PORT-HAMBURG": "Elbe approach — Hamburg lies 60 nm up a navigable river",
  "E-WPT-BABELMANDEB__WPT-REDSEA": "Bab-el-Mandeb — passes the Hanish islands, below resolution",
  // Island / delta / harbour port approaches (the port itself sits on land).
  "E-WPT-SG-APPROACH__PORT-PTP": "Johor Strait approaches — sub-resolution channel",
  "E-PORT-PTP__WPT-MALACCA-S": "Tanjung Pelepas — Johor/Karimun island approach below resolution",
  "E-WPT-BENGAL__PORT-CHENNAI": "Chennai — an artificial harbour on an open coast",
  "E-PORT-CHENNAI__WPT-SRILANKA-E": "Chennai — southern departure along the same coast",
  "E-WPT-KLANG-S__PORT-KLANG": "Klang river channel — the port lies inside the delta",
  "E-PORT-KLANG__WPT-KLANG-N": "Klang river channel — northern exit",
  "E-WPT-HK-APPROACH__PORT-HONGKONG": "Hong Kong — East Lamma Channel into Victoria Harbour",
  "E-PORT-HONGKONG__WPT-HK-E": "Hong Kong — Lei Yue Mun, the eastern harbour exit",
  "E-WPT-HK-E__WPT-SCS-HK": "Clears the Po Toi group east of Hong Kong",
  "E-PORT-KAOHSIUNG__WPT-LUZON": "Kaohsiung — Taiwan island approach",
  "E-WPT-KARIMATA__PORT-JAKARTA": "Tanjung Priok approach across the shallow Java Sea shelf",
  "E-WPT-SURABAYA-N__PORT-SURABAYA": "Surabaya — Madura Strait entrance, below resolution",
  "E-WPT-NORTHSEA__PORT-ROTTERDAM": "Rotterdam — Maasvlakte harbour approach",
  "E-PORT-LA__PORT-LONGBEACH": "adjacent berths in one harbour complex",
  "E-WPT-PACIFIC-E__PORT-LA": "Los Angeles — Channel Islands approach",
};
