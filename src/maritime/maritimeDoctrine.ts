// GR-2/GR-6: the single tuning surface for maritime routing and movement,
// following the src/sim/doctrine.ts pattern — a flat, commented constant block
// so every threshold has one home and no literal hides in a function.
//
// Route cost is expressed in MINUTES throughout, so travel time, weather,
// congestion and port waiting are directly commensurable and every term is
// non-negative (a hard requirement for Dijkstra).

export const MARITIME_DOCTRINE = {
  routing: {
    // Edge weather risk runs 0–100. At the top of the band this adds ~3.3 hours
    // to a leg, enough to prefer a detour of a few hundred nautical miles.
    weatherPenaltyMinPerPoint: 2,
    // Traffic density 0–100. Weighted below weather: congestion delays, weather
    // endangers.
    congestionPenaltyMinPerPoint: 1.5,
    // Expected berth wait at the destination, converted 1:1 from hours.
    portWaitMinPerHour: 60,
    // A restricted edge is not removed from the graph (so the inspector can
    // still show why it was avoided) but is priced out of every candidate.
    safetyRestrictionMin: 100_000,
    // At or above this edge weather risk the edge is removed from the search
    // entirely — the route is unsafe, not merely expensive.
    blockWeatherRiskAtOrAbove: 80,
    // GR-5A: at or above this the map draws the segment as hazardous. Set below
    // the blocking threshold so a manager sees a stretch turn dangerous before
    // it becomes unusable. Presentation threshold only — it never enters a cost.
    highRiskWeatherThreshold: 55,
    // GR-6: at or above this a route change is worth PROPOSING. Deliberately
    // above the visual threshold: showing a manager that a segment is worsening
    // is cheap, but asking them to approve a diversion is not, and ordinary
    // weather drift crosses 55 during a normal run. Only genuine deterioration
    // should reach the decision queue.
    rerouteWeatherThreshold: 70,
  },

  weather: {
    // How far a weather cell reaches. The simulation resolves one weather state
    // for the Singapore/Malacca area (D-52), so the cells below carry it out
    // along the corridor rather than inventing separate weather systems.
    cellRadiusNm: 400,
    // Risk bands that slow a vessel down. Below caution it sails at service
    // speed; a blocked edge stops it entirely (see movement factors).
    cautionRiskAtOrAbove: 40,
    severeRiskAtOrAbove: 65,
    // MDS-1 (D-91): how bad a storm is AT ITS OWN CENTRE, by severity.
    //
    // A storm placed on a distant chokepoint cannot take its intensity from the
    // Singapore weather reading — that would make a Red Sea storm dangerous only
    // when it happens to be raining at Tuas, which is nonsense and made the
    // remote-storm demo depend on the live feed. Severity alone defines it.
    //
    // Calibrated against the thresholds above so the gradation means something:
    // sev 1 sits under caution, sev 2 reaches high-risk at the centre but fades
    // before it blocks, sev 3 blocks near the centre and stays hazardous across
    // most of the cell. Ambient weather still applies around Singapore, and the
    // worst of the two wins.
    stormCentreRiskBySeverity: { 1: 35, 2: 65, 3: 95 } as Record<1 | 2 | 3, number>,
  },

  movement: {
    // Speed multipliers by weather band. A vessel slows before it diverts.
    cautionSpeedFactor: 0.85,
    severeSpeedFactor: 0.6,
  },

  congestion: {
    // Traffic density is derived from how many tracked vessels are currently on
    // an edge; this many vessels on one edge reads as fully congested.
    vesselsForFullCongestion: 8,
    // GR-6: at or above this congestion score a leg is worth rerouting around.
    // The shared Tuas approach chain sits at 100 by construction — every
    // corridor funnels through it — so this is set high and, more importantly,
    // the raiser only acts when an alternative genuinely improves on the
    // current route. Congestion on the approach to a vessel's OWN destination
    // is an arrival problem for berth and anchorage doctrine, not something a
    // vessel can sail around.
    highTrafficRisk: 85,
  },

  // Time-dependent routing (forecast-aware edge costs) is a deliberate future
  // upgrade, not an omission: the first release prices edges from current
  // conditions only, so a candidate route is reproducible from state alone.
} as const;
