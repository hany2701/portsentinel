import { describe, expect, it } from "vitest";
import {
  ROUTE_EDGES,
  ROUTE_NODES,
  SHIPPING_CORRIDORS,
  corridorForService,
  nodeDistanceNm,
  routeNodeById,
} from "./network";
import {
  edgeBetween,
  isConnectedSequence,
  neighboursOf,
  sequenceDistanceNm,
  validateNetwork,
} from "./graph";
import { PORT_HUBS, TUAS_PORT_ID, portHubById } from "./ports";
import {
  REGIONAL_BOUNDS,
  inRegionalScope,
  inSingaporeApproach,
  withinBounds,
} from "./geofence";
import { SERVICE_ROSTER } from "../sim/roster";

describe("static route network (GR-1)", () => {
  it("passes structural validation", () => {
    expect(() => validateNetwork()).not.toThrow();
  });

  it("gives every corridor an edge-connected node sequence", () => {
    for (const corridor of SHIPPING_CORRIDORS) {
      expect(isConnectedSequence(corridor.nodeIds), `${corridor.id} is not connected`).toBe(true);
    }
  });

  it("covers every weekly service with exactly one corridor", () => {
    for (const service of SERVICE_ROSTER) {
      expect(corridorForService(service.id), `no corridor for ${service.id}`).toBeDefined();
    }
    // One Tuas rotation per weekly service. The inter-port lanes are extra and
    // deliberately have no SERVICE_ROSTER entry, so the counts are no longer
    // equal — the invariant is that every ROSTER service is covered.
    expect(SHIPPING_CORRIDORS.filter((c) => c.tuasRotation).length).toBe(SERVICE_ROSTER.length);
  });

  it("starts every Tuas rotation at Tuas, and every inter-port lane at a port", () => {
    for (const corridor of SHIPPING_CORRIDORS) {
      if (corridor.tuasRotation) {
        expect(corridor.nodeIds[0]).toBe(TUAS_PORT_ID);
      } else {
        // An inter-port lane must run port-to-port and never touch Tuas — it is
        // the reason a vessel can carry an origin that is not Singapore.
        expect(corridor.nodeIds[0].startsWith("PORT-")).toBe(true);
        expect(corridor.nodeIds[corridor.nodeIds.length - 1].startsWith("PORT-")).toBe(true);
        expect(corridor.nodeIds).not.toContain(TUAS_PORT_ID);
      }
    }
  });

  it("computes deterministic, symmetric great-circle distances", () => {
    const a = nodeDistanceNm("PORT-TUAS", "PORT-ROTTERDAM");
    expect(a).toBe(nodeDistanceNm("PORT-ROTTERDAM", "PORT-TUAS"));
    expect(a).toBe(nodeDistanceNm("PORT-TUAS", "PORT-ROTTERDAM"));
    // Singapore→Rotterdam direct-line is ~5,300 nm; the sailed route via Suez is
    // longer, which is exactly why the graph exists.
    expect(a).toBeGreaterThan(4800);
    expect(a).toBeLessThan(5800);
    expect(sequenceDistanceNm(corridorForService("SVC-AE7")!.nodeIds)).toBeGreaterThan(a);
  });

  it("makes every edge traversable in both directions", () => {
    for (const edge of ROUTE_EDGES) {
      expect(edgeBetween(edge.fromNodeId, edge.toNodeId)).toBeDefined();
      expect(edgeBetween(edge.toNodeId, edge.fromNodeId)).toBeDefined();
    }
  });

  it("orders neighbours deterministically", () => {
    for (const node of ROUTE_NODES) {
      const ids = neighboursOf(node.id).map((n) => n.toNodeId);
      expect(ids).toEqual([...ids].sort());
    }
  });

  it("offers a genuine alternative to the Malacca Strait", () => {
    // Sunda is the real-world alternative when Malacca is closed. Without it,
    // "reroute" west of Singapore would have no candidate to choose.
    // GR-9 kept the alternative but moved its geometry into water: it now leaves
    // via the Singapore Strait eastern exit, rounds Belitung, and stands well
    // offshore of Sumatra's west coast rather than cutting across the islands.
    expect(isConnectedSequence([
      "WPT-SG-STRAIT-E", "WPT-SG-STRAIT-OUT", "WPT-RIAU-E", "WPT-KARIMATA", "WPT-BELITUNG-E",
      "WPT-SUNDA", "WPT-SUNDA-SW", "WPT-SUMATRA-W", "WPT-NICOBAR",
    ])).toBe(true);
  });
});

describe("geographic reference data (GR-1)", () => {
  it("keeps every coordinate in range", () => {
    for (const node of ROUTE_NODES) {
      expect(node.latitude).toBeGreaterThanOrEqual(-90);
      expect(node.latitude).toBeLessThanOrEqual(90);
      expect(node.longitude).toBeGreaterThanOrEqual(-180);
      expect(node.longitude).toBeLessThanOrEqual(180);
    }
  });

  it("resolves every port hub to a route node at the same position", () => {
    for (const hub of PORT_HUBS) {
      const node = routeNodeById(hub.id);
      expect(node, `no route node for ${hub.id}`).toBeDefined();
      expect(node!.latitude).toBe(hub.latitude);
      expect(node!.longitude).toBe(hub.longitude);
      expect(node!.kind).toBe("port");
    }
  });

  it("places every port hub inside its declared region", () => {
    const REGION_BOX: Record<string, { south: number; north: number; west: number; east: number }> = {
      southeast_asia: { south: -11, north: 21, west: 92, east: 141 },
      south_asia: { south: -1, north: 36, west: 60, east: 93 },
      east_asia: { south: 18, north: 46, west: 105, east: 146 },
      middle_east: { south: 12, north: 40, west: 32, east: 63 },
      europe: { south: 34, north: 71, west: -12, east: 41 },
      north_america: { south: 14, north: 72, west: -170, east: -52 },
    };
    for (const hub of PORT_HUBS) {
      const box = REGION_BOX[hub.region];
      expect(
        withinBounds(hub, box),
        `${hub.id} (${hub.latitude}, ${hub.longitude}) is outside ${hub.region}`,
      ).toBe(true);
    }
  });

  it("labels every port hub as static reference data", () => {
    for (const hub of PORT_HUBS) expect(hub.source).toBe("static_reference");
  });

  it("reuses the existing alternate-port ids so a divert target is one entity", () => {
    expect(portHubById("PORT-PTP")).toBeDefined();
    expect(portHubById("PORT-KLANG")).toBeDefined();
  });

  it("loads fully offline — no network access at import time", () => {
    // The whole layer is static imports; if anything were fetched, importing it
    // in this DOM-less environment would already have failed.
    expect(ROUTE_NODES.length).toBeGreaterThan(40);
    expect(PORT_HUBS.length).toBe(19);
  });
});

describe("geofences (GR-1)", () => {
  it("encloses the Tuas approach chain but not the wider region", () => {
    for (const id of ["WPT-SG-APPROACH", "WPT-TUAS-HOLDING", "NODE-TUAS-ANCHORAGE", "PORT-TUAS"]) {
      expect(inSingaporeApproach(routeNodeById(id)!), `${id} should be inside the fence`).toBe(true);
    }
    for (const id of ["WPT-SG-STRAIT-E", "WPT-MALACCA-S", "PORT-BATAM"]) {
      expect(inSingaporeApproach(routeNodeById(id)!), `${id} should be outside the fence`).toBe(false);
    }
  });

  it("scopes the regional view to Southeast Asia", () => {
    expect(inRegionalScope(routeNodeById("WPT-MALACCA-N")!)).toBe(true);
    expect(inRegionalScope(routeNodeById("PORT-JAKARTA")!)).toBe(true);
    expect(inRegionalScope(routeNodeById("PORT-ROTTERDAM")!)).toBe(false);
    expect(inRegionalScope(routeNodeById("PORT-LA")!)).toBe(false);
    expect(REGIONAL_BOUNDS.south).toBeLessThan(REGIONAL_BOUNDS.north);
    expect(REGIONAL_BOUNDS.west).toBeLessThan(REGIONAL_BOUNDS.east);
  });
});
