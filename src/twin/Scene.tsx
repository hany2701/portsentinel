import type { SimState } from "../sim";
import { presentTwin } from "./presentation";
import { Scenery } from "./entities/Scenery";
import { Berths } from "./entities/Berths";
import { YardBlocks } from "./entities/YardBlocks";
import { Containers } from "./entities/Containers";
import { Vessels } from "./entities/Vessels";
import { AGVs, useAgvFleet } from "./entities/AGVs";
import { AgvLanes } from "./entities/AgvLanes";
import { SkyLight, Rain } from "./entities/Weather";
import { Badges } from "./Badges";
import type { PickHandlers } from "./picking";

export type Layers = { labels: boolean; cranes: boolean; agvs: boolean; heatmap: boolean };
export const DEFAULT_LAYERS: Layers = { labels: true, cranes: true, agvs: true, heatmap: false };

// The full port scene, driven entirely by live sim state. Every visible element is a
// function of the current SimState (no scene-local truth), so it stays in lockstep
// with the dashboard.
export function Scene({ sim, layers, selection, hoverId, onPick, onHover }: {
  sim: SimState; layers: Layers;
} & PickHandlers) {
  const pick: PickHandlers = { selection, hoverId, onPick, onHover };
  // Derived-presentation records (D-58): suspended/held/frozen encodings +
  // animation gating, computed once per state object.
  const pres = presentTwin(sim);
  // One fleet, shared: the AGVs component advances it and the quay cranes read
  // it to drive their spreaders, so a crane can never work a vehicle that isn't
  // there.
  const fleet = useAgvFleet(pres.agv);
  return (
    <group>
      <SkyLight risk={sim.weather.riskIndex} />
      <Rain risk={sim.weather.riskIndex} />
      <Scenery />
      {layers.agvs && <AgvLanes />}
      <Berths berths={sim.berths} cranes={sim.cranes} showCranes={layers.cranes} pres={pres} fleet={fleet} {...pick} />
      <YardBlocks sim={sim} heatmap={layers.heatmap} showCranes={layers.cranes} pres={pres} {...pick} />
      <Containers sim={sim} heatmap={layers.heatmap} />
      <Vessels sim={sim} pres={pres} {...pick} />
      {layers.agvs && <AGVs fleet={fleet} />}
      <Badges sim={sim} showLabels={layers.labels} selection={selection} hoverId={hoverId} />
    </group>
  );
}
