import { describe, expect, it } from "vitest";
import { generateWorld } from "./worldGen";

// GR-1: the Tuas baseline is frozen. The maritime workstream adds ~108 tracked
// vessels and a route graph on top of this world; none of it may perturb the
// genesis RNG stream or the D-27 vessel distribution the whole simulation is
// calibrated against. This fingerprint was recorded from the pre-GR build and
// must survive every later phase — if it fails, a maritime change drew from
// state.rng (use a derived RNG instead) or reordered genesis.

const SEED = 20260710;

// Recorded 2026-07-21, before any GR change touched worldGen.
const FROZEN_VESSELS = [
  "V-101|Tanjong Maru|feeder|SVC-STX|alongside|0|B1",
  "V-108|Orion Star|panamax|SVC-BOB|alongside|0|B2",
  "V-115|Halcyon|panamax|SVC-NAS|alongside|0|B3",
  "V-118|Nordic Dawn|feeder|SVC-RIAU|alongside|0|B4",
  "V-122|Changi Voyager|panamax|SVC-GULF|alongside|0|B5",
  "V-125|Changi Voyager|feeder|SVC-MEK|alongside|0|B6",
  "V-129|Aurora Bay|panamax|SVC-BOB|alongside|0|B7",
  "V-132|Sea Falcon|feeder|SVC-JAVA|alongside|0|B8",
  "V-135|Tampines Spirit|feeder|SVC-STX|alongside|0|B9",
  "V-139|Straits Runner|panamax|SVC-NAS|berthing|0|B10",
  "V-144|Jurong Trader|panamax|SVC-GULF|departing|0|",
  "V-156|Tradewind|neopanamax|SVC-AE7|anchored|-19|",
  "V-165|Meridian|neopanamax|SVC-TP3|anchored|-5|",
  "V-173|Emerald Wake|neopanamax|SVC-AE7|anchored|-26|",
  "V-176|Equatorial|feeder|SVC-MEK|anchored|-23|",
  "V-180|Kestrel|panamax|SVC-BOB|anchored|-13|",
  "V-186|Pelican|panamax|SVC-NAS|anchored|-12|",
  "V-189|Osprey|feeder|SVC-JAVA|approaching|27|",
  "V-196|Nordic Dawn|panamax|SVC-GULF|approaching|34|",
  "V-204|Silver Crane|neopanamax|SVC-TP3|approaching|31|",
  "V-207|Selat Pearl|feeder|SVC-STX|approaching|7|",
  "V-210|Cascade|feeder|SVC-RIAU|approaching|5|",
];

// The RNG state after genesis. Every maritime seeding step must run on a DERIVED
// rng (makeRng(seed ^ salt)), never state.rng, or this changes.
const FROZEN_RNG_STATE = 1027252556;

function baselineVessels(world: ReturnType<typeof generateWorld>) {
  // Tuas-scope vessels are the ones without a maritime `scope` — tracked
  // deep-sea/regional vessels added by GR-2 are excluded here by construction.
  return world.vessels.filter((v) => !("scope" in v) || v.scope === undefined);
}

describe("worldGen genesis freeze (GR-1)", () => {
  it("keeps the 22-vessel Tuas baseline byte-identical", () => {
    const world = generateWorld(SEED);
    const fingerprint = baselineVessels(world).map(
      (v) => `${v.id}|${v.name}|${v.class}|${v.serviceId}|${v.status}|${v.etaTick}|${v.berthId ?? ""}`,
    );
    expect(fingerprint).toEqual(FROZEN_VESSELS);
  });

  it("leaves the genesis RNG stream untouched", () => {
    expect(generateWorld(SEED).rng.state).toBe(FROZEN_RNG_STATE);
  });

  it("keeps the fixed terminal inventory", () => {
    const world = generateWorld(SEED);
    expect({
      berths: world.berths.length,
      cranes: world.cranes.length,
      yardBlocks: world.yardBlocks.length,
      cargoLots: world.cargoLots.length,
      customers: world.customers.length,
    }).toEqual({ berths: 12, cranes: 40, yardBlocks: 8, cargoLots: 58, customers: 7 });
  });
});
