export * from "./types";
export { DOCTRINE, DOCTRINE_CORPUS, WEATHER_BANDS, weatherRiskBand, lightningRiskAt, hazeVisibilityKm, CALIBRATION, applyCalibrationMode } from "./doctrine";
export { syncCalibrationMode } from "./calibration";
export type { DoctrineSection, WeatherBand, WeatherBandId } from "./doctrine";
export { generateWorld } from "./worldGen";
export { SERVICE_ROSTER, SERVICE_CADENCE_TICKS, DEMO_SERVICE_CADENCE_TICKS, PRODUCTION_SERVICE_CADENCE_TICKS, SERVICE_JITTER, serviceById, servicesForClass, nextServiceSlot, setServiceCadence } from "./roster";
export type { Service } from "./roster";
export { tick, clone } from "./tick";
export {
  stepMaritime,
  isHandoverTick,
  openHandover,
  activePlan,
  handOverToRegional,
  makeRoutePlan,
  remainingDistanceNm,
  D62_APPROACH_ENTRY_ANCHOR,
  D62_DEPARTURE_EXIT_ANCHOR,
} from "./maritimeStep";
export { refreshWeather, computeRiskIndex } from "./weather";
export { stepMarineEnvironment } from "./marineFeeds";
export { tideHeightM, tideWindowOpen, ticksUntilTideWindow } from "./tide";
export { computeKpis, resilienceScore, scoreStress, resilienceBreakdown } from "./resilience";
export type { ScoreBreakdown, ResilienceFactor } from "./resilience";
export { validateEffect } from "./validators";
export type { ValidationResult } from "./validators";
export { applyEffect } from "./effects";
export { previewEffect } from "./preview";
export type { PreviewResult } from "./preview";
export { assertInvariants } from "./invariants";
export {
  anchorageQueue,
  atRiskByService,
  averageBerthWaitHours,
  avgTurnaroundHours,
  berthOccupancyPct,
  berthOnArrivalPct,
  berthOptions,
  connectionsAtRisk,
  connectionsAtRiskTEU,
  connectionsMissed,
  craneAvailabilityPct,
  craneMovesPerHour,
  isConnectionAtRisk,
  rehandleRatio,
  transshipmentWaiting,
  craneUnitsAtBerth,
  isHighPriority,
  maxAnchorageWait,
  projectedBerthWaitHours,
  remainingStormTicks,
  safetyStockOutlook,
  safetyStockShortfallDays,
  teuAtRisk,
  vesselDataMode,
  vesselPriorityRank,
  vesselsWaiting,
  vesselWaitHours,
  yardBlockOccupiedTEU,
  yardBlockUtilisationPct,
  yardUtilisationPct,
} from "./derive";
export type { SafetyStockOutlook, BerthOption, ConnectionRisk } from "./derive";
export {
  vesselRemainingWorkTicks,
  projectedETD,
  berthTimeline,
  serviceCallSlots,
  berthConflicts,
  yardFlowForecast,
  agvMetrics,
  queueEntryForecast,
  cargoJourney,
  dwellBuckets,
  yardCategoryPressure,
} from "./opsDerive";
export type {
  BerthWindow,
  BerthTimelineRow,
  ServiceCallSlot,
  BerthConflict,
  YardFlowBucket,
  AgvTransferLeg,
  AgvMetrics,
  QueueCause,
  QueueEntryForecast,
  JourneyStage,
  DwellBucket,
  YardCategoryPressure,
} from "./opsDerive";
export {
  retrieveDoctrine,
  retrieveDoctrineScored,
  doctrineIndex,
  retrievalProvider,
  TFIDF_PROVIDER,
  NO_RAG_PROVIDER,
  type RetrievedSection,
  type RetrievalMode,
  type RetrievalProvider,
} from "./retrieval";
// GR-9: the retrieval evaluation harness (dev/analysis only — no runtime path
// depends on it, and it never calls a model).
export {
  MARITIME_EVAL_CASES,
  corpusSectionIds,
  evaluateCase,
  evaluateSet,
  scoreAnswer,
  type EvalCase,
  type EvalSummary,
  type RetrievalMetrics,
  type AnswerScore,
} from "./retrievalEval";
export { searchDoctrine, type DoctrineHit } from "./searchIndex";
export {
  TICK_REAL_MS,
  TICK_SIM_MINUTES,
  SPEEDS,
  FORECAST_HORIZON_OPTIONS,
  formatSimTime,
  ticksToHours,
  WEATHER_POLL_MS,
  WEATHER_STALE_MS,
  WEATHER_MAX_FAILURES,
  WEATHER_POINTS,
} from "./config";
