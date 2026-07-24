export type DataProvenance =
  | "simulated"
  | "calculated"
  | "live_external"
  | "static_reference"
  | "user_input"
  | "ai_generated";

export type CargoType = "standard" | "reefer" | "hazmat";
export type Priority = "normal" | "high";
export type SizeMix = { twentyFt: number; fortyFt: number };

export type Finger = { id: string; name: string; berthIds: string[] };

export type BerthStatus = "available" | "occupied" | "closed";
export type Berth = {
  id: string;
  name: string;
  fingerId: string;
  side: "east" | "west";
  deepWater: boolean;
  lengthM: number;
  status: BerthStatus;
  vesselId?: string;
  craneIds: string[];
};

export type YardBlock = {
  id: string;
  name: string;
  capacityTEU: number;
  reeferPowered: boolean;
  hazmat: boolean;
  craneIds: string[];
};

export type CraneKind = "STS" | "RTG";
export type CraneStatus = "operational" | "degraded" | "down";
export type Crane = {
  id: string;
  kind: CraneKind;
  locationId: string;
  status: CraneStatus;
  downUntilTick?: number;
};

export type GateStatus = "normal" | "busy" | "congested" | "closed";
export type GateState = {
  id: string;
  processingCapacityPerTick: number;
  queuedTrucks: number;
  averageWaitMinutes: number;
  status: GateStatus;
};

export type VesselClass = "feeder" | "panamax" | "neopanamax";
export type VesselStatus =
  | "enroute" // GR-1: on a geographic route, outside the Tuas operational FSM
  | "approaching"
  | "anchored"
  | "berthing"
  | "alongside"
  | "departing"
  | "diverted";

export type CargoManifestItem = {
  id: string;
  quantityTEU: number;
  containerCount: number;
  sizeMix: SizeMix;
  type: CargoType;
  customerId?: string;
  priority: Priority;
  // REAL-2 (D-80): if set, this box is transshipment — on discharge it waits in
  // the yard for the named onward service's next call, never the truck gate.
  // Absent = import cargo, which leaves via the gate.
  connectingServiceId?: string;
};

export type Vessel = {
  id: string;
  name: string;
  class: VesselClass;
  // REAL-1 (D-79): the weekly service loop this vessel runs. Fixed for the
  // vessel's life — the same ship returns on its service's next slot each cycle,
  // so its class stays constant across recycles.
  serviceId: string;
  lengthM: number;
  status: VesselStatus;
  etaTick: number;
  anchoredSinceTick?: number;
  phaseEndsTick?: number;
  berthId?: string;
  divertToPortId?: string;
  manifest: CargoManifestItem[];
  dischargedTEU: number;
  loadTEU: number; // load capacity for this call (max onward TEU it will lift)
  workProgress: number;
  // REAL-2 (D-80): loading phase, entered once discharge completes. loadTarget is
  // the TEU of onward boxes claimed for this call (snapshot, ≤ loadTEU); loadedTEU
  // is progress toward it. The vessel departs when discharge AND loading are done.
  loadTarget?: number;
  loadedTEU?: number;
  // REAL-2 (D-80): consecutive ticks the discharge has been wedged by a full yard
  // while loading is done and cranes are working — triggers a short-call departure.
  stallTicks?: number;
  // REAL-3 (D-81): terminal-KPI tick stamps for THIS call. arrivalTick = when it
  // reached the port (anchored); berthedTick = when it started berthing. A vessel
  // that berthed the same tick it arrived made "berth on arrival" (no anchor wait).
  // Both reset on recycle; undefined for genesis-warmup vessels.
  arrivalTick?: number;
  berthedTick?: number;
  // Earliest possible release of an approved hold (D-58 condition 3) — the
  // vessel may not berth before this tick, and reaching it does not bypass any
  // still-active weather restriction. Written by the holdVessel executor.
  heldUntilTick?: number;
  // REAL-4 (D-82): true while this vessel's berthing/unberthing manoeuvre is
  // blocked on the shared pilot/tug pool (a wait cause distinct from weather or
  // a berth queue). Written by stepPilotage.
  pilotageWaiting?: boolean;
  // GR-1: maritime scope. Absent on the 22 frozen Tuas baseline vessels; set on
  // the tracked vessels the global/regional views render. A tracked vessel keeps
  // its scope for life — it is the same entity in every view, never a copy.
  scope?: VesselScope;
  // GR-1: geographic position + route progress. Present only while the vessel is
  // owned by the maritime engine; the Tuas FSM places vessels from berth/anchorage
  // slots instead (the two coordinate frames never mix).
  track?: VesselTrackState;
  homePortId?: string;
  destinationPortId?: string;
};

export type CargoLotStatus = "discharging" | "yard" | "outbound" | "delivered";
export type CargoLot = {
  id: string;
  quantityTEU: number;
  containerCount: number;
  sizeMix: SizeMix;
  blockId?: string;
  slotRegion?: string;
  type: CargoType;
  status: CargoLotStatus;
  arrivalTick: number;
  customerId?: string;
  priority: Priority;
  dwellStartTick?: number;
  // REAL-2 (D-80): transshipment connection state. connectingServiceId names the
  // onward service the box waits for; connectDeadlineTick is the SLA tick by
  // which it must be loaded; connectMissedCount tracks blown windows (each miss
  // re-books to the onward service's next weekly call). loadingVesselId marks a
  // lot claimed by an alongside onward vessel currently loading it (status
  // "outbound"). All absent on import cargo.
  connectingServiceId?: string;
  connectDeadlineTick?: number;
  connectMissedCount?: number;
  loadingVesselId?: string;
};

export type Sector =
  | "healthcare"
  | "food"
  | "electronics"
  | "automotive"
  | "industrial"
  | "retail";
export type Customer = {
  id: string;
  name: string;
  sector: Sector;
  temperatureSensitive: boolean;
  defaultPriority: Priority;
  dailyConsumptionTEU: number;
  daysOfCoverRemaining: number;
  safetyStockDays: number;
};

export type AlternatePort = {
  id: string;
  name: string;
  extraSailingHours: number;
  note: string;
};

// ---------------------------------------------------------------------------
// GR-1: maritime domain (global + regional shipping network).
//
// Two coordinate frames coexist and never mix: the maritime engine works in
// WGS84 lat/long, the Tuas twin works in the abstract D-62 world frame. A vessel
// crosses between them by a status-gated handover, not a transform (GR-D6).
//
// Route GEOMETRY (nodes, edges, corridors, port hubs) is static reference data
// in src/maritime/* — it is never cloned per tick. Only the dynamic state below
// lives in SimState, so tick()/previewEffect/persistence cover it for free.
// ---------------------------------------------------------------------------

export type VesselScope = "deepSea" | "regional";

// The seam for a future live provider (GR-8, deferred). The first release is
// always "fully_simulated" — no adapters, keys or polling ship.
export type VesselDataMode =
  | "live_external"
  | "cached_external"
  | "live_with_simulated_operations"
  | "fully_simulated";

export type RouteNodeKind =
  | "port"
  | "waypoint"
  | "strait"
  | "anchorage"
  | "holding_area"
  | "approach";

// A temporary current-position→join-node connector, derived when an approved
// reroute joins the new path at a node that is not the current edge's end
// (GR-6 no-teleport contract). It is per-vessel derived data and is NEVER added
// to the static route graph. `kind` records what validated it.
export type RouteJoinSegment = {
  fromLat: number;
  fromLon: number;
  toNodeId: string;
  distanceNm: number;
  progressNm: number;
  sourceEdgeId?: string;
  kind: "current_edge_remainder" | "validated_segment";
};

export type VesselTrackState = {
  routePlanId: string;
  edgeIndex: number; // index into the active plan's node sequence
  progressNm: number; // distance travelled along the current edge
  latitude: number;
  longitude: number;
  speedKnots: number; // effective speed after weather factors
  courseDeg: number;
  lastUpdatedTick: number;
  joinSegment?: RouteJoinSegment;
};

export type RoutePlanStatus = "active" | "superseded" | "completed" | "cancelled";
export type VesselRoutePlan = {
  id: string;
  vesselId: string;
  routeVersion: number; // 1 = original; an approved reroute supersedes and bumps
  status: RoutePlanStatus;
  nodeIds: string[]; // ids into the STATIC route graph — no polylines in state
  originNodeId: string;
  destinationNodeId: string;
  totalDistanceNm: number;
  etaTick: number; // calculated
  expectedWaitMinutes: number;
  weatherRisk: number; // 0-100, aggregated over the plan's edges when built
  congestionRisk: number;
  totalCost: number; // routing cost (minutes) that selected this plan
  createdTick: number;
};

export type RerouteReason = "weather" | "congestion" | "berth_closure" | "safety" | "combined";
export type RerouteDecision = {
  id: string;
  vesselId: string;
  originalPlanId: string;
  newPlanId?: string; // set on execution
  reason: RerouteReason;
  highRiskEdgeIds: string[];
  delayAvoidedMinutes: number;
  additionalDistanceNm: number;
  approvalStatus: "pending" | "approved" | "dismissed" | "executed";
  createdTick: number;
};

// The record of a vessel crossing between the geographic frame and D-62.
// Discriminated on direction so each side carries only the state it actually
// captures. At most one non-completed handover may exist per vessel, and on the
// handover tick NEITHER engine moves the vessel (one movement owner per tick).
export type VesselHandoverState =
  | {
      direction: "regional_to_tuas";
      vesselId: string;
      status: "pending" | "active" | "completed";
      handoverTick: number;
      routeVersion: number;
      // Geographic state at the moment of crossing. headingDeg is METADATA only:
      // it is never numerically copied into the abstract D-62 frame — the D-62
      // vessel is oriented by the tangent of its approved approach path.
      regionalEntry: {
        latitude: number;
        longitude: number;
        headingDeg: number;
        speedKnots: number;
      };
      d62AnchorId: string;
      intendedAnchorageSlot?: string;
      intendedBerthId?: string;
    }
  | {
      direction: "tuas_to_regional";
      vesselId: string;
      status: "pending" | "active" | "completed";
      handoverTick: number;
      routeVersion: number;
      // headingDeg is the tangent of the D-62 departure path, recorded as
      // metadata; the resumed geographic course comes from the exit node's
      // first route segment, not from transforming this value.
      d62Exit: { anchorId: string; headingDeg: number; speedKnots: number };
      geographicExitNodeId: string;
    };

export type MaritimeState = {
  routePlans: VesselRoutePlan[];
  rerouteDecisions: RerouteDecision[];
  handovers: VesselHandoverState[];
};

export type WeatherState = {
  asOfTick: number;
  asOfMs?: number; // real epoch ms of the live observation; undefined when simulated
  windKts: number;
  gustKts: number;
  windDirDeg: number;
  waveHeightM: number;
  visibilityKm: number;
  precipMm: number;
  freshness: "live" | "stale" | "simulated";
  stormOverlay: boolean; // true when a simulated severe-weather overlay is active
  riskIndex: number;
  provenance: DataProvenance;
};

// A single external weather observation, fused from the two Open-Meteo points.
export type WeatherReading = {
  asOfMs: number;
  windKts: number;
  gustKts: number;
  windDirDeg: number;
  waveHeightM: number;
  visibilityKm: number;
  precipMm: number;
};

// The external truth, owned by the wall-clock poller (outside the engine).
// freshness is only meaningful when reading is present.
export type WeatherFeed = {
  reading: WeatherReading | null;
  freshness: "live" | "stale";
};

// REAL-5 (D-83): NEA lightning observations — external truth, same shape as
// WeatherFeed. `active` is a simple "lightning observed" boolean (any station
// reporting a strike), not a strike count — the gates only need risk/no-risk.
export type LightningReading = { asOfMs: number; active: boolean };
export type LightningFeed = { reading: LightningReading | null; freshness: "live" | "stale" };

// REAL-5 (D-83): NEA PSI/haze — external truth, same shape. `psi` is the west
// region's 24-hourly PSI reading (Tuas sits in the far west of Singapore).
export type HazeReading = { asOfMs: number; psi: number };
export type HazeFeed = { reading: HazeReading | null; freshness: "live" | "stale" };

export type DisruptionType =
  | "storm"
  | "arrivalSurge"
  | "craneFailure"
  | "berthClosure";
export type Disruption = {
  id: string;
  type: DisruptionType;
  targetIds: string[];
  startTick: number;
  durationTicks: number;
  severity: 1 | 2 | 3;
};

export type AlertSeverity = "info" | "warning" | "critical";
export type EntityType =
  | "vessel"
  | "berth"
  | "yardBlock"
  | "crane"
  | "gate"
  | "cargoLot"
  | "customer"
  | "portHub"; // GR-1: a port on the global/regional map
export type EntityRef = { entityType: EntityType; entityId: string };
export type Alert = {
  id: string;
  severity: AlertSeverity;
  message: string;
  entityRef?: EntityRef;
  tick: number; // most recent occurrence
  acknowledged: boolean;
  count: number; // D-77: identical unacknowledged repeats collapse into one ×N
  escalated?: boolean; // D-77: an unacknowledged-critical escalation was raised
  provenance: DataProvenance;
};

export type SimulationEffect =
  | { kind: "reassignBerth"; vesselId: string; toBerthId: string }
  | { kind: "divertVessel"; vesselId: string; toPortId: string }
  | { kind: "holdVessel"; vesselId: string; untilTick: number }
  | { kind: "reallocateYard"; lotIds: string[]; toBlockId: string }
  | { kind: "closeBerth"; berthId: string }
  // days is a typed calculated quantity (D-56): authored ONLY by the shared
  // shortfall calculation, validated as an integer ≥ 1, and applied verbatim by
  // the executor — displayed always equals executed.
  | { kind: "safetyStockAdvisory"; customerId: string; days: number; note?: string }
  // GR-1 (implemented GR-6): swap a tracked vessel's active route for an approved
  // alternative to the SAME destination. Execution preserves the vessel's exact
  // position and edge progress — see the no-teleport contract in effects.ts.
  | {
      kind: "rerouteVoyage";
      vesselId: string;
      toNodeIds: string[];
      reason: RerouteReason;
      decisionId?: string;
    };

export type RecommendationImpact = {
  waitHoursSaved?: number;
  teuProtected?: number;
  utilizationDeltaPct?: number;
};
export type ValidationStatus = "pending" | "valid" | "invalid";
export type RecommendationStatus = "pending" | "approved" | "dismissed";
export type Recommendation = {
  id: string;
  source: "rule" | "agent" | "user"; // D-69: user = manually initiated move, provenance user_input
  type: "reroute" | "reberth" | "hold" | "yardRealloc" | "safetyStock" | "connectionProtect";
  title: string;
  rationale: string;
  impact: RecommendationImpact;
  proposedEffect: SimulationEffect;
  validationStatus: ValidationStatus;
  validatedEffect?: SimulationEffect;
  validationMessage?: string;
  status: RecommendationStatus;
  createdTick: number;
  resolvedTick?: number; // D-76: when the duty manager approved/dismissed it
  provenance: DataProvenance;
};

export type KpiSnapshot = {
  tick: number;
  resilienceScore: number;
  berthOccupancyPct: number;
  vesselsWaiting: number;
  averageBerthWaitHours: number;
  yardUtilisationPct: number;
  craneAvailabilityPct: number;
  weatherRiskIndex: number;
  teuAtRisk: number;
  connectionsAtRisk: number; // REAL-2 (D-80): transshipment lots nearing their deadline un-lifted
  // REAL-3 (D-81): real terminal-operator KPIs.
  berthOnArrivalPct: number; // % of recent arrivals that berthed without anchoring
  turnaroundHours: number; // avg vessel arrival→departure over recent calls
  craneMovesPerHour: number; // gross moves per working STS crane per hour (compressed clock)
  rehandleRatio: number; // % of yard moves that were unproductive rehandles
};

// Weather-operations state machine (D-54): which operations the weather has
// suspended, plus the anti-flap counters. Suspend instantly, resume only after
// DOCTRINE.weather.recoveryClearTicks consecutive clear ticks. A stale feed
// holds the current suspensions and triggers no new ones (W7).
export type WxOps = {
  stsSuspended: boolean; // W1/W5: STS work frozen
  rtgSuspended: boolean; // W2/W5: yard→gate outflow 0, discharge cannot place
  movesSuspended: boolean; // W3/W5: no berth assignment; berthing/departing timers frozen
  stsClearTicks: number;
  rtgClearTicks: number;
  moveClearTicks: number;
  cautionTicks: number; // consecutive caution-band ticks (ETA slip every 3rd)
  staleHold: boolean; // stale-feed hold announced (one alert per stale episode)
};

// Pilotage & towage (REAL-4, D-82): a small shared pool of pilots and tugs.
// Every berthing/unberthing manoeuvre needs one pilot + DOCTRINE.pilotage.
// tugsPerManoeuvre tugs; a booking exists for exactly as long as its vessel is
// "berthing" or "departing" and is released the tick the vessel leaves that
// status. If the pool can't cover a manoeuvre, it waits (Vessel.pilotageWaiting)
// instead of being granted one.
export type PilotageBooking = { vesselId: string };
export type PilotageState = {
  pilotsAvailable: number;
  tugsAvailable: number;
  bookings: PilotageBooking[];
};

// REAL-5 (D-83): resolved lightning risk — the NEA feed when reachable
// (live/stale), the precipitation proxy (D-78) otherwise. Recomputed every
// tick, never stored as the source of truth (mirrors lightningRiskAt).
export type LightningState = {
  active: boolean;
  asOfMs?: number;
  freshness: "live" | "stale" | "simulated";
  provenance: DataProvenance;
  source: "nea" | "precip_proxy";
};

// REAL-5 (D-83): resolved haze — NEA PSI (west region) when reachable, else a
// calm-air simulated baseline. visibilityKm folds into the existing W3
// visibility gate (wxOps.ts) alongside the weather-derived value.
export type HazeState = {
  psi: number;
  visibilityKm: number;
  asOfMs?: number;
  freshness: "live" | "stale" | "simulated";
  provenance: DataProvenance;
};

// REAL-5 (D-83): deterministic tide curve — pure function of sim time + the
// world's seed, no external feed, always "live" by construction. Gates
// deep-draft (neopanamax) berthing to the open half of the cycle.
export type TideState = {
  heightM: number;
  windowOpen: boolean;
};

export type Rng = { state: number };

// REAL-6 (D-84): which doctrine value set is active — demo (compressed/
// instructional thresholds) or production (real-world calibrated values, per
// the CALIBRATION record). Lives on SimState (not just the store) so tick()
// stays a pure function of state: the same mode must be reproducible from the
// same seed + tick count.
export type CalibrationMode = "demo" | "production";

export type SimulationClock = {
  tick: number;
  simMinutes: number;
  seed: number;
  // "realtime" (D-84): the 1x "realistic shift" preset — ticks advance at
  // genuine wall-clock pace (TICK_SIM_MINUTES real minutes per tick) instead
  // of the compressed demo speeds.
  speed: 0.5 | 1 | 2 | 4 | 8 | "realtime";
  running: boolean;
};

export type SimState = {
  clock: SimulationClock;
  calibrationMode: CalibrationMode;
  rng: Rng;
  fingers: Finger[];
  berths: Berth[];
  yardBlocks: YardBlock[];
  cranes: Crane[];
  gate: GateState;
  customers: Customer[];
  alternatePorts: AlternatePort[];
  vessels: Vessel[];
  cargoLots: CargoLot[];
  weather: WeatherState;
  weatherFeed: WeatherFeed;
  lightningFeed: LightningFeed;
  hazeFeed: HazeFeed;
  wxOps: WxOps;
  pilotage: PilotageState;
  lightning: LightningState;
  haze: HazeState;
  tide: TideState;
  disruptions: Disruption[];
  alerts: Alert[];
  recommendations: Recommendation[];
  kpiHistory: KpiSnapshot[];
  terminal: TerminalStats;
  // GR-1: dynamic maritime state. Static route geometry stays in src/maritime/*
  // so it is never cloned per tick.
  maritime: MaritimeState;
  seq: number;
};

// REAL-3 (D-81): rolling logs the terminal KPIs are derived from. `completions`
// is appended on each normal vessel departure; `moves` is appended every tick
// (container lifts + rehandles + working-crane-ticks) for the gross-rate window.
export type TerminalStats = {
  completions: { turnaroundTicks: number; berthOnArrival: boolean }[];
  moves: { productive: number; rehandle: number; craneTicks: number }[];
};
