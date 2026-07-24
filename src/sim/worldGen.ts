import { makeRng, rand, randInt, randRange, pick } from "./rng";
import { CLASS_SPEC, containerCount, generateManifest, makeSizeMix, pickClass } from "./voyage";
import { nextServiceSlot, serviceById, servicesForClass, SERVICE_ROSTER, type Service } from "./roster";
import { TRANSSHIP_SHARE, CONNECTION_WINDOW_TICKS } from "./config";
import { DOCTRINE } from "./doctrine";
import { stepMarineEnvironment } from "./marineFeeds";
import { syncCalibrationMode } from "./calibration";
import { seedMaritimePopulation } from "../maritime/populationGen";
import type { CalibrationMode } from "./types";
import type {
  AlternatePort,
  Berth,
  CargoLot,
  CargoType,
  Crane,
  Customer,
  Finger,
  SimState,
  Vessel,
  VesselClass,
  YardBlock,
} from "./types";

const FINGERS = ["F1", "F2", "F3", "F4"];
const YARD_TARGETS: Record<string, number> = {
  "YB-A": 62, "YB-B": 70, "YB-C": 72, "YB-D": 64,
  "YB-E": 58, "YB-F": 68, "YB-G": 63, "YB-H": 66,
};

const VESSEL_NAMES = [
  "Kestrel", "Meridian", "Cascade", "Orion Star", "Blue Petrel", "Nordic Dawn",
  "Halcyon", "Sea Falcon", "Aurora Bay", "Silver Crane", "Tampines Spirit",
  "Jurong Trader", "Changi Voyager", "Pandan Express", "Selat Pearl", "Equatorial",
  "Monsoon Bell", "Coral Venture", "Straits Runner", "Emerald Wake", "Tanjong Maru",
  "Pelican", "Marlin", "Osprey", "Tradewind", "Southern Cross",
];

const CUSTOMER_SEED: Omit<Customer, "dailyConsumptionTEU" | "daysOfCoverRemaining" | "safetyStockDays">[] = [
  { id: "CUST-MED", name: "MedSupply Asia", sector: "healthcare", temperatureSensitive: true, defaultPriority: "high" },
  { id: "CUST-AGRI", name: "AgriFoods Global", sector: "food", temperatureSensitive: true, defaultPriority: "high" },
  { id: "CUST-VOLT", name: "VoltEdge Electronics", sector: "electronics", temperatureSensitive: false, defaultPriority: "high" },
  { id: "CUST-DRIVE", name: "DriveLine Motors", sector: "automotive", temperatureSensitive: false, defaultPriority: "normal" },
  { id: "CUST-FORGE", name: "Forge Industrial", sector: "industrial", temperatureSensitive: false, defaultPriority: "normal" },
  { id: "CUST-MART", name: "MartMax Retail", sector: "retail", temperatureSensitive: false, defaultPriority: "normal" },
  { id: "CUST-CHILL", name: "ChillChain Logistics", sector: "food", temperatureSensitive: true, defaultPriority: "high" },
];

const ALT_PORTS: AlternatePort[] = [
  { id: "PORT-PTP", name: "Tanjung Pelepas", extraSailingHours: 6, note: "Nearest Malaysian transshipment alternative; subject to confirmation." },
  { id: "PORT-KLANG", name: "Port Klang", extraSailingHours: 14, note: "Alternate Malacca Strait call; subject to confirmation." },
];

// REAL-6 (D-84): genesis always starts in "demo" mode unless explicitly asked
// otherwise (a reset/new session is a fresh demo start) — syncCalibrationMode
// forces the global DOCTRINE/roster regime to match BEFORE any genesis value
// (e.g. service phases) is derived from it, so a prior session's leftover
// production mode never leaks into a new world.
export function generateWorld(seed: number, mode: CalibrationMode = "demo"): SimState {
  syncCalibrationMode(mode);
  const rng = makeRng(seed);
  let seq = 1;
  const id = (prefix: string) => `${prefix}-${seq++}`;

  const fingers: Finger[] = [];
  const berths: Berth[] = [];
  const cranes: Crane[] = [];
  let berthNum = 1;
  FINGERS.forEach((fid, fi) => {
    const berthIds: string[] = [];
    for (let b = 0; b < 3; b++) {
      const bid = `B${berthNum++}`;
      berthIds.push(bid);
      const craneIds = [id("STS"), id("STS")];
      craneIds.forEach((cid) => cranes.push({ id: cid, kind: "STS", locationId: bid, status: "operational" }));
      // F4's three berths all sit on its straight west quay face (D-62); F1–F3
      // keep two west + one east.
      berths.push({ id: bid, name: bid, fingerId: fid, side: fi < 3 && b === 2 ? "east" : "west", deepWater: fi < 2, lengthM: 400, status: "available", craneIds });
    }
    fingers.push({ id: fid, name: fid, berthIds });
  });

  const yardBlocks: YardBlock[] = Object.keys(YARD_TARGETS).map((name) => {
    const reeferPowered = name === "YB-A" || name === "YB-B";
    const hazmat = name === "YB-H";
    const craneIds = [id("RTG"), id("RTG")];
    craneIds.forEach((cid) => cranes.push({ id: cid, kind: "RTG", locationId: name, status: "operational" }));
    return { id: name, name, capacityTEU: reeferPowered || hazmat ? 3000 : 4000, reeferPowered, hazmat, craneIds };
  });

  const customers: Customer[] = CUSTOMER_SEED.map((c) => ({
    ...c,
    dailyConsumptionTEU: randInt(rng, 20, 120),
    daysOfCoverRemaining: Number(randRange(rng, 1.5, 6).toFixed(1)),
    safetyStockDays: randInt(rng, 3, 7),
  }));

  const cargoLots: CargoLot[] = [];
  for (const block of yardBlocks) {
    const target = (YARD_TARGETS[block.name] / 100) * block.capacityTEU;
    const type: CargoType = block.hazmat ? "hazmat" : block.reeferPowered ? "reefer" : "standard";
    let filled = 0;
    while (filled < target - 150) {
      const teu = Math.min(randInt(rng, 180, 480), Math.round(target - filled));
      if (teu < 60) break;
      const mix = makeSizeMix(rng, teu);
      const customer = pick(rng, customers);
      // REAL-2 (D-80): ~85% of the standing yard is transshipment waiting for an
      // onward service; deadlines spread across the window so they connect over
      // the coming period (a handful may already be near their deadline).
      const isTransship = rand(rng) < TRANSSHIP_SHARE;
      cargoLots.push({
        id: id("LOT"), quantityTEU: teu, containerCount: containerCount(mix), sizeMix: mix,
        blockId: block.id, slotRegion: `${block.name}-${randInt(rng, 1, 6)}`, type, status: "yard",
        arrivalTick: -randInt(rng, 1, 400), customerId: customer.id, priority: customer.defaultPriority,
        dwellStartTick: -randInt(rng, 1, 400),
        connectingServiceId: isTransship ? pick(rng, SERVICE_ROSTER).id : undefined,
        connectDeadlineTick: isTransship ? randInt(rng, 40, CONNECTION_WINDOW_TICKS) : undefined,
        connectMissedCount: isTransship ? 0 : undefined,
      });
      filled += teu;
    }
  }

  // REAL-1 (D-79): assign each vessel to a weekly service of its own class,
  // round-robin so the pool spreads across the roster deterministically.
  const svcCursor: Record<VesselClass, number> = { feeder: 0, panamax: 0, neopanamax: 0 };
  const serviceForClass = (vclass: VesselClass): Service => {
    const services = servicesForClass(vclass);
    return services[svcCursor[vclass]++ % services.length];
  };

  const makeVessel = (svc: Service): Vessel => {
    const vclass = svc.class;
    const manifest = generateManifest(rng, () => id("MF"), customers, vclass, svc.id);
    const total = manifest.reduce((s, m) => s + m.quantityTEU, 0);
    return {
      id: id("V"), name: pick(rng, VESSEL_NAMES), class: vclass, serviceId: svc.id,
      lengthM: CLASS_SPEC[vclass].lengthM,
      status: "approaching", etaTick: 0, manifest,
      // Load capacity ≥ what it discharges, so an onward vessel can always lift at
      // least its own inbound volume — this keeps the yard's transshipment buffer
      // from growing without bound (D-80).
      dischargedTEU: 0, loadTEU: Math.round(total * randRange(rng, 1.0, 1.3)), workProgress: 0,
    };
  };

  const vessels: Vessel[] = [];
  // Genesis distribution (D-27): alongside 9, berthing 1, departing 1, anchored 6, approaching 5.
  // Berthed/departing vessels get a service of their berth-suitable class; the
  // non-berthed vessels below then cover every remaining service so no onward
  // service is ever left without a ship to lift its transshipment boxes (D-80).
  for (let i = 0; i < 10; i++) {
    const deepBerth = i < 6;
    const vclass = deepBerth ? pickClass(rng) : rand(rng) < 0.5 ? "feeder" : "panamax";
    const v = makeVessel(serviceForClass(vclass));
    const berth = berths[i];
    berth.status = "occupied";
    berth.vesselId = v.id;
    v.berthId = berth.id;
    if (i < 9) {
      v.status = "alongside";
      // dischargedTEU MUST land on a manifest item boundary, else the discharge
      // loop skips the partially-done item and the vessel never completes (D-80).
      const total = v.manifest.reduce((s, m) => s + m.quantityTEU, 0);
      const target = randRange(rng, 0.1, 0.85) * total;
      let cum = 0;
      for (const m of v.manifest) {
        if (cum + m.quantityTEU > target) break;
        cum += m.quantityTEU;
      }
      v.dischargedTEU = cum;
      v.workProgress = total === 0 ? 1 : cum / total;
      v.phaseEndsTick = randInt(rng, ...CLASS_SPEC[vclass].alongsideTicks);
    } else {
      v.status = "berthing";
      v.phaseEndsTick = randInt(rng, 1, 2);
    }
    vessels.push(v);
  }
  const dep = makeVessel(serviceForClass(rand(rng) < 0.5 ? "feeder" : "panamax"));
  dep.status = "departing";
  dep.phaseEndsTick = randInt(rng, 1, 2);
  dep.workProgress = 1;
  vessels.push(dep);

  // REAL-4 (D-82): the genesis vessel already "berthing" (i.index 9 above) and
  // the departing vessel above already hold their manoeuvre's pilot + tugs — a
  // manoeuvre that exists at t=0 didn't queue for its resources, it already has
  // them, matching how the rest of genesis skips the ramp-up.
  const genesisManoeuvring = vessels.filter((v) => v.status === "berthing" || v.status === "departing");
  const pilotage = {
    pilotsAvailable: DOCTRINE.pilotage.pilotPoolSize - genesisManoeuvring.length,
    tugsAvailable: DOCTRINE.pilotage.tugPoolSize - genesisManoeuvring.length * DOCTRINE.pilotage.tugsPerManoeuvre,
    bookings: genesisManoeuvring.map((v) => ({ vesselId: v.id })),
  };

  // Coverage (D-80): the 11 non-berthed vessels are not berth-constrained, so use
  // them to guarantee every service on the roster has at least one ship — assign
  // the still-uncovered services first, then round-robin the rest.
  const coveredIds = new Set(vessels.map((v) => v.serviceId));
  const uncovered = SERVICE_ROSTER.filter((s) => !coveredIds.has(s.id));
  let coverIdx = 0;
  const coverageService = (): Service =>
    coverIdx < uncovered.length ? uncovered[coverIdx++] : SERVICE_ROSTER[coverIdx++ % SERVICE_ROSTER.length];

  for (let i = 0; i < 6; i++) {
    const v = makeVessel(coverageService());
    v.status = "anchored";
    v.anchoredSinceTick = -randInt(rng, 1, 30);
    v.etaTick = v.anchoredSinceTick;
    vessels.push(v);
  }
  for (let i = 0; i < 5; i++) {
    const v = makeVessel(coverageService());
    v.status = "approaching";
    // REAL-1 (D-79): inbound vessels sit on their service's next scheduled slot
    // from t=0, so the weekly schedule is live from genesis.
    v.etaTick = nextServiceSlot(rng, serviceById(v.serviceId)!, 0);
    vessels.push(v);
  }

  const world: SimState = {
    clock: { tick: 0, simMinutes: 0, seed, speed: 1, running: false },
    calibrationMode: mode,
    rng, fingers, berths, yardBlocks, cranes,
    gate: { id: "GATE-1", processingCapacityPerTick: 120, queuedTrucks: randInt(rng, 5, 25), averageWaitMinutes: randInt(rng, 8, 25), status: "normal" },
    customers, alternatePorts: ALT_PORTS, vessels, cargoLots,
    weather: { asOfTick: 0, windKts: 12, gustKts: 18, windDirDeg: 225, waveHeightM: 0.8, visibilityKm: 12, precipMm: 0, freshness: "simulated", stormOverlay: false, riskIndex: 15, provenance: "simulated" },
    weatherFeed: { reading: null, freshness: "live" },
    lightningFeed: { reading: null, freshness: "live" },
    hazeFeed: { reading: null, freshness: "live" },
    wxOps: { stsSuspended: false, rtgSuspended: false, movesSuspended: false, stsClearTicks: 0, rtgClearTicks: 0, moveClearTicks: 0, cautionTicks: 0, staleHold: false },
    pilotage,
    // REAL-5 (D-83): placeholders — stepMarineEnvironment (pure, RNG-free)
    // resolves the real genesis values below before the world is returned.
    lightning: { active: false, freshness: "simulated", provenance: "simulated", source: "precip_proxy" },
    haze: { psi: 0, visibilityKm: 12, freshness: "simulated", provenance: "simulated" },
    tide: { heightM: 0, windowOpen: false },
    disruptions: [], alerts: [], recommendations: [], kpiHistory: [],
    terminal: { completions: [], moves: [] },
    // GR-1: empty until GR-2 seeds the tracked population. Seeding must use a
    // DERIVED rng, never `rng` above, or the frozen genesis stream shifts.
    maritime: { routePlans: [], rerouteDecisions: [], handovers: [] },
    seq,
  };
  stepMarineEnvironment(world);
  // GR-2: the tracked global/regional population, seeded LAST on a rng derived
  // from the seed — never `rng` above — so the 22-vessel genesis stream stays
  // byte-identical (worldGenFreeze.test.ts).
  seedMaritimePopulation(world);
  return world;
}
