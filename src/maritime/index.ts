// GR-1: the maritime layer's public surface. Everything exported here is static
// reference data or a pure function over it — no simulation state lives in this
// directory (dynamic state belongs to SimState.maritime).

export * from "./config";
export * from "./ports";
export * from "./network";
export * from "./graph";
export * from "./geofence";
export * from "./maritimeDoctrine";
export * from "./clustering";
export * from "./selectors";
export { seedMaritimePopulation, bearingDeg } from "./populationGen";
