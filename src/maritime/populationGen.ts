import { geoInterpolate } from "d3-geo";
import { makeRng, pick, randInt, randRange } from "../sim/rng";
import { CLASS_SPEC, generateManifest } from "../sim/voyage";
import { serviceById } from "../sim/roster";
import { SHIPPING_CORRIDORS, routeNodeById, type ShippingCorridor } from "./network";
import { edgeBetween, sequenceDistanceNm } from "./graph";
import {
  CLASS_SPEED_KNOTS,
  DEEPSEA_VESSEL_COUNT,
  MIN_VESSELS_PER_CORRIDOR,
  REGIONAL_VESSEL_COUNT,
  TUAS_BOUND_TRACKED_MAX,
  nmPerTick,
} from "./config";
import type { SimState, Vessel, VesselRoutePlan, VesselScope } from "../sim/types";

// GR-2: seed the tracked vessel population — 78 deep-sea + 30 regional, on top
// of the 22 frozen Tuas baseline vessels, for ONE authoritative population of
// 130 unique entities. The global, regional and Tuas views render different
// scopes and detail levels of these same entities; nothing is duplicated per
// view.
//
// DETERMINISM CONTRACT: this runs on a rng DERIVED from the world seed, never
// state.rng. Genesis draws its 22 vessels first and its stream must come out
// byte-identical (src/sim/worldGenFreeze.test.ts), so nothing here may touch it.
const POPULATION_SALT = 0x5f356495;

// `scope` classifies a vessel's TRADE, not its instantaneous position: a
// regional vessel runs an intra-Asia loop, a deep-sea vessel runs a long-haul
// corridor. Which vessels the regional map draws individually is a separate,
// position-based question (see selectors.regionalVessels).
const REGIONAL_SERVICE_IDS = ["SVC-STX", "SVC-RIAU", "SVC-MEK", "SVC-JAVA", "SVC-SGN"];

const corridorsFor = (scope: VesselScope): ShippingCorridor[] =>
  SHIPPING_CORRIDORS.filter((c) =>
    scope === "regional"
      ? REGIONAL_SERVICE_IDS.includes(c.serviceId)
      : !REGIONAL_SERVICE_IDS.includes(c.serviceId),
  );

// Corridors run outward from Tuas. A vessel that is NOT bound for Tuas sails the
// leg beyond the approach chain, so it can never enter the Singapore approach
// fence and trigger a handover it was not meant to make.
const OUTBOUND_START_INDEX = 4;

const TRACKED_NAMES = [
  "Ocean Ranger", "Cape Horn", "Andaman Star", "Formosa Wind", "Java Sunrise",
  "Bengal Trader", "Arafura", "Celebes Dawn", "Sumatra Belle", "Timor Sea",
  "Coral Highway", "Pacific Herald", "Atlantic Reach", "Indus Voyager", "Gulf Sentinel",
  "Sunda Pioneer", "Nicobar", "Malacca Maiden", "Riau Star", "Borneo Light",
  "Mindoro", "Luzon Breeze", "Hokkaido", "Kanto Express", "Yellow Sea",
  "Bosphorus", "Levant Trader", "Iberian Wave", "Biscay Dawn", "North Cape",
];

function positionAlongRoute(
  nodeIds: readonly string[],
  distanceFromStartNm: number,
): { edgeIndex: number; progressNm: number; latitude: number; longitude: number; courseDeg: number } {
  let remaining = distanceFromStartNm;
  for (let i = 0; i < nodeIds.length - 1; i++) {
    const edge = edgeBetween(nodeIds[i], nodeIds[i + 1])!;
    if (remaining <= edge.distanceNm || i === nodeIds.length - 2) {
      const from = routeNodeById(nodeIds[i])!;
      const to = routeNodeById(nodeIds[i + 1])!;
      const t = edge.distanceNm === 0 ? 0 : Math.min(1, remaining / edge.distanceNm);
      const [longitude, latitude] = geoInterpolate(
        [from.longitude, from.latitude],
        [to.longitude, to.latitude],
      )(t);
      return {
        edgeIndex: i,
        progressNm: Math.min(remaining, edge.distanceNm),
        latitude,
        longitude,
        courseDeg: bearingDeg(from, to),
      };
    }
    remaining -= edge.distanceNm;
  }
  const only = routeNodeById(nodeIds[0])!;
  return { edgeIndex: 0, progressNm: 0, latitude: only.latitude, longitude: only.longitude, courseDeg: 0 };
}

/** Initial great-circle bearing from one node to another, in degrees clockwise from north. */
export function bearingDeg(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
): number {
  const toRad = Math.PI / 180;
  const phi1 = from.latitude * toRad;
  const phi2 = to.latitude * toRad;
  const dLambda = (to.longitude - from.longitude) * toRad;
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return (Math.atan2(y, x) / toRad + 360) % 360;
}

// GR-5A: minimum spacing between two vessels on the same edge. Congestion near
// approaches is realistic and wanted; two hulls at the same coordinate is not.
const MIN_SEPARATION_NM = 45;

/**
 * Corridor assignment: traffic is spread across corridors in proportion to their
 * LENGTH — an 8,000 nm route plausibly carries more ships at any instant than a
 * 900 nm one — subject to a minimum of MIN_VESSELS_PER_CORRIDOR so that a short
 * loop still reads as a working service rather than a dead line.
 *
 * The floor is what stops proportional allocation from emptying the shortest
 * regional loops (Riau is 62 nm against Mekong's 1,291; pure proportion gives it
 * one vessel). It binds ONLY there: every deep-sea corridor's proportional share
 * already clears it, so their allocation is unchanged by its presence.
 *
 * No RNG — the distribution itself is the intent, and jitter comes later from
 * the stratum.
 */
function allocateCorridors(corridors: ShippingCorridor[], count: number): ShippingCorridor[] {
  if (corridors.length === 0) return [];
  // Degenerate case: too few vessels to give every corridor its floor. Round-robin
  // is the fairest thing left, and keeps every corridor populated.
  if (corridors.length * MIN_VESSELS_PER_CORRIDOR > count) {
    return Array.from({ length: count }, (_, i) => corridors[i % corridors.length]);
  }

  const lengths = corridors.map((c) => Math.max(1, sequenceDistanceNm(c.nodeIds)));
  const total = lengths.reduce((s, n) => s + n, 0);

  // Largest-remainder apportionment: whole shares first, then the leftover seats
  // to the biggest fractional parts. Ties break on corridor order, so the result
  // is a pure function of the corridor list.
  const exact = lengths.map((len) => (count * len) / total);
  const counts = exact.map(Math.floor);
  const seats = count - counts.reduce((s, n) => s + n, 0);
  [...counts.keys()]
    .sort((a, b) => exact[b] - counts[b] - (exact[a] - counts[a]) || a - b)
    .slice(0, seats)
    .forEach((i) => counts[i]++);

  // Raise anything under the floor, taking each vessel from the corridor that can
  // best spare one (the largest; ties to the longer corridor, then to order).
  for (let i = 0; i < counts.length; i++) {
    while (counts[i] < MIN_VESSELS_PER_CORRIDOR) {
      const donor = [...counts.keys()]
        .filter((j) => counts[j] > MIN_VESSELS_PER_CORRIDOR)
        .sort((a, b) => counts[b] - counts[a] || lengths[b] - lengths[a] || a - b)[0];
      if (donor === undefined) break;
      counts[donor]--;
      counts[i]++;
    }
  }

  return counts.flatMap((n, i) => Array.from({ length: n }, () => corridors[i]));
}

/**
 * Position within the route, stratified so vessels sharing a corridor spread
 * along its whole length instead of bunching in one stretch.
 *
 * The stratum comes from the vessel's ordinal WITHIN ITS OWN CORRIDOR (not its
 * global index): corridor assignment is proportional, so consecutive global
 * indices often land on the same corridor and a global-index stratum would put
 * them all in the same band — which is exactly the clumping this prevents.
 */
function stratifiedFraction(
  ordinalInCorridor: number,
  countInCorridor: number,
  rng: Parameters<typeof randRange>[0],
): number {
  const strata = Math.max(1, countInCorridor);
  const usable = 0.88;
  const width = usable / strata;
  const start = 0.05 + (ordinalInCorridor % strata) * width;
  // Jitter inside the stratum, inset slightly so neighbouring bands cannot
  // produce two vessels touching at a boundary.
  return randRange(rng, start + width * 0.15, start + width * 0.85);
}

/**
 * The three Tuas-bound vessels start at deliberately different journey stages
 * (GR-5A §4) so the demo can show an approach, a mid-route leg and an upstream
 * departure — not three ships stacked outside Singapore.
 */
function tuasBoundFraction(ordinal: number, rng: Parameters<typeof randRange>[0]): number {
  switch (ordinal) {
    case 0:
      return randRange(rng, 0.86, 0.93); // in the wider Singapore approach
    case 1:
      return randRange(rng, 0.55, 0.68); // a medium-distance regional segment
    default:
      return randRange(rng, 0.22, 0.35); // farther upstream
  }
}

/**
 * Seeds the tracked population into an already-generated world. Called last in
 * generateWorld so every genesis draw has already happened.
 */
export function seedMaritimePopulation(state: SimState): void {
  const rng = makeRng(state.clock.seed ^ POPULATION_SALT);
  const nextId = (prefix: string) => `${prefix}-${state.seq++}`;

  const plan = (
    vesselId: string,
    nodeIds: string[],
    speedKnots: number,
    remainingNm: number,
  ): VesselRoutePlan => ({
    id: nextId("RP"),
    vesselId,
    routeVersion: 1,
    status: "active",
    nodeIds,
    originNodeId: nodeIds[0],
    destinationNodeId: nodeIds[nodeIds.length - 1],
    totalDistanceNm: sequenceDistanceNm(nodeIds),
    etaTick: state.clock.tick + Math.round(remainingNm / nmPerTick(speedKnots)),
    expectedWaitMinutes: 0,
    weatherRisk: 0,
    congestionRisk: 0,
    totalCost: 0,
    createdTick: state.clock.tick,
  });

  let tuasBound = 0;
  // Canonical positions already placed, so a new vessel can be nudged off an
  // exact duplicate or an implausibly tight pair on the same edge.
  const placed: Array<{ nodeKey: string; edgeIndex: number; travelledNm: number }> = [];

  const seedOne = (
    scope: VesselScope,
    corridor: ShippingCorridor,
    ordinalInCorridor: number,
    countInCorridor: number,
  ): void => {
    // REAL-1 (D-79): a vessel's class matches its service's class — a weekly
    // loop is run by one size of ship. Deriving it (rather than drawing a class
    // independently) keeps that invariant true across all 130 vessels.
    const vclass = serviceById(corridor.serviceId)!.class;
    const speedKnots = CLASS_SPEED_KNOTS[vclass];

    // An inter-port lane is sailed END TO END, and alternate vessels sail it in
    // opposite directions — so a Hong Kong–Los Angeles lane carries ships going
    // each way rather than a single outbound stream. Both endpoints are real
    // ports, so these vessels are the ones that carry a genuine origin port.
    //
    // A Tuas rotation keeps its existing treatment: the first few regional
    // vessels are inbound (sailing the rotation in reverse, handing over to the
    // Tuas FSM at the approach fence), and the rest sail the outbound leg only,
    // which never enters the fence.
    const interPort = !corridor.tuasRotation;
    const inboundToTuas =
      corridor.tuasRotation && scope === "regional" && tuasBound < TUAS_BOUND_TRACKED_MAX;
    const nodeIds = interPort
      ? ordinalInCorridor % 2 === 1
        ? [...corridor.nodeIds].reverse()
        : [...corridor.nodeIds]
      : inboundToTuas
        ? [...corridor.nodeIds].reverse()
        : corridor.nodeIds.slice(OUTBOUND_START_INDEX);
    if (inboundToTuas) tuasBound++;

    const totalNm = sequenceDistanceNm(nodeIds);
    // GR-5A: stratified placement. A single uniform draw clumps vessels and
    // leaves visible gaps; dividing the route into strata and jittering WITHIN a
    // stratum spreads traffic along the whole corridor while still looking
    // random rather than evenly spaced.
    const fraction = inboundToTuas
      ? tuasBoundFraction(tuasBound - 1, rng) // each of the three at a different stage
      : stratifiedFraction(ordinalInCorridor, countInCorridor, rng);
    let travelled = totalNm * fraction;
    // Separation is mostly structural: stratum bands are disjoint, so two
    // vessels on one corridor cannot share a position by construction. This
    // guard only covers the remaining case — two routes that overlap on the
    // same node sequence — and nudges WITHIN the vessel's own band so it can
    // never be pushed onto another vessel's stretch or clamped to a shared cap.
    //
    // The spacing scales with the route: on a 120 nm regional hop, demanding
    // 45 nm between hulls is not "minimum separation where feasible", it is
    // impossible, and forcing it is what stacked vessels on one coordinate.
    const bandNm = (totalNm * 0.88) / Math.max(1, countInCorridor);
    const separationNm = Math.min(MIN_SEPARATION_NM, bandNm * 0.5);
    const nodeKey = nodeIds.join(">");
    const tooCloseAt = (d: number) =>
      placed.some((p) => p.nodeKey === nodeKey && Math.abs(p.travelledNm - d) < separationNm);
    for (let attempt = 0; attempt < 4 && tooCloseAt(travelled); attempt++) {
      const nudged = travelled + separationNm * 0.45;
      travelled = nudged > totalNm * 0.95 ? travelled - separationNm * 0.45 : nudged;
    }
    const at = positionAlongRoute(nodeIds, travelled);
    placed.push({ nodeKey, edgeIndex: at.edgeIndex, travelledNm: travelled });

    const id = nextId("V");
    const destinationNodeId = nodeIds[nodeIds.length - 1];
    const routePlan = plan(id, nodeIds, speedKnots, Math.max(0, totalNm - travelled));

    const vessel: Vessel = {
      id,
      name: `${pick(rng, TRACKED_NAMES)} ${randInt(rng, 2, 9)}`,
      class: vclass,
      serviceId: corridor.serviceId,
      lengthM: CLASS_SPEC[vclass].lengthM,
      status: "enroute",
      etaTick: routePlan.etaTick,
      // Only Tuas-bound vessels carry a manifest: cargo state exists to be
      // worked at Tuas, and 105 unused manifests would bloat every tick's clone.
      manifest: inboundToTuas
        ? generateManifest(rng, () => nextId("MF"), state.customers, vclass, corridor.serviceId)
        : [],
      dischargedTEU: 0,
      loadTEU: 0,
      workProgress: 0,
      scope,
      homePortId: nodeIds[0].startsWith("PORT-") ? nodeIds[0] : undefined,
      destinationPortId: destinationNodeId.startsWith("PORT-") ? destinationNodeId : undefined,
      track: {
        routePlanId: routePlan.id,
        edgeIndex: at.edgeIndex,
        progressNm: at.progressNm,
        latitude: at.latitude,
        longitude: at.longitude,
        speedKnots,
        courseDeg: at.courseDeg,
        lastUpdatedTick: state.clock.tick,
      },
    };
    if (inboundToTuas) {
      vessel.loadTEU = Math.round(vessel.manifest.reduce((s, m) => s + m.quantityTEU, 0) * 1.1);
    }

    state.vessels.push(vessel);
    state.maritime.routePlans.push(routePlan);
  };

  // Two phases: assign every vessel a corridor first, then place each corridor's
  // members across its full length. Stratification needs to know how many
  // vessels share a corridor, which the assignment pass establishes.
  const assign = (scope: VesselScope, count: number): Array<{ corridor: ShippingCorridor; ordinal: number; total: number }> => {
    const corridors = corridorsFor(scope);
    const chosen = allocateCorridors(corridors, count);
    const totals = new Map<string, number>();
    for (const c of chosen) totals.set(c.id, (totals.get(c.id) ?? 0) + 1);
    const seen = new Map<string, number>();
    return chosen.map((corridor) => {
      const ordinal = seen.get(corridor.id) ?? 0;
      seen.set(corridor.id, ordinal + 1);
      return { corridor, ordinal, total: totals.get(corridor.id)! };
    });
  };

  for (const a of assign("regional", REGIONAL_VESSEL_COUNT)) {
    seedOne("regional", a.corridor, a.ordinal, a.total);
  }
  for (const a of assign("deepSea", DEEPSEA_VESSEL_COUNT)) {
    seedOne("deepSea", a.corridor, a.ordinal, a.total);
  }
}
