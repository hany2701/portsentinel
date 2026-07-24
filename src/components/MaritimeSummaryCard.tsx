import { useMemo } from "react";
import { Globe2, ArrowUpRight } from "lucide-react";
import { useSimStore } from "../store/simStore";
import { REGIONAL_CENTER, REGIONAL_VIEW_ZOOM, useMapViewStore } from "../store/mapViewStore";
import {
  edgeConditions,
  geographicVessels,
  regionalKpis,
  regionalVessels,
  tuasFrameVessels,
} from "../maritime/selectors";
import { routeNodeById } from "../maritime/network";
import { MARITIME_DOCTRINE } from "../maritime/maritimeDoctrine";
import { MapShell } from "../maritime/map/MapShell";
import { BasemapLayer } from "../maritime/map/BasemapLayer";
import { SatelliteLayer } from "../maritime/map/SatelliteLayer";
import { TILE_SOURCE } from "../maritime/map/tileSource";
import { useSatelliteHealth } from "../maritime/map/useSatelliteHealth";
import {
  BottleneckLayer,
  CorridorLayer,
  PortLayer,
  VesselMarkerLayer,
  WeatherCellLayer,
} from "../maritime/map/layers";
import { Panel } from "./Panel";
import { SourceTag } from "./SourceTag";
import type { ViewId } from "../views/registry";

// An ENTRY POINT and summary, not a replacement for the Maritime Network tab.
//
// Everything here reads the same authoritative selectors the full view uses, so
// the two can never disagree about vessel counts, risk or disruptions. There is
// no second map: the card summarises, the tab renders.

export function MaritimeSummaryCard({ onNavigate }: { onNavigate: (view: ViewId) => void }) {
  const sim = useSimStore((s) => s.sim);
  const selection = useSimStore((s) => s.selection);
  const select = useSimStore((s) => s.select);
  const layers = useMapViewStore((s) => s.layers);

  // The card always shows the REGIONAL scope — the same frame the Maritime
  // Network tab's Regional button flies to. It used to mirror the shared
  // viewport store, so it inherited whatever the user last left the tab on
  // (usually the whole-network Overview, in which Singapore is a few pixels).
  // Pinning it means the summary is always the readable Malacca/Singapore
  // picture; the tab remains the place to roam.
  const effectiveZoom = REGIONAL_VIEW_ZOOM;

  // GR-8: the same satellite basemap the Maritime Network tab draws, on the same
  // shared projection — so the card is a small view of the real map rather than
  // a differently-styled second one. Same health probe, same fallback: anything
  // other than "ok" leaves the bundled vector basemap showing.
  const satelliteHealth = useSatelliteHealth(TILE_SOURCE);
  const satelliteOn = satelliteHealth === "ok";
  const satelliteCovering = satelliteOn || satelliteHealth === "probing";

  const regional = useMemo(() => regionalVessels(sim), [sim]);
  const selectedVesselId = selection?.entityType === "vessel" ? selection.entityId : null;
  const selectedPortId = selection?.entityType === "portHub" ? selection.entityId : null;

  const summary = useMemo(() => {
    const sailing = geographicVessels(sim);
    const inFrame = tuasFrameVessels(sim);
    const kpis = regionalKpis(sim);
    const conditions = edgeConditions(sim);

    // Route disruptions are derived from the SAME edge conditions the routing
    // cost model uses — the card never computes its own notion of risk.
    let blocked = 0;
    let hazardous = 0;
    let peakRisk = 0;
    const bottlenecks: string[] = [];
    for (const [edgeId, cond] of conditions) {
      peakRisk = Math.max(peakRisk, cond.weatherRisk);
      if (cond.blocked) {
        blocked++;
        // Name the chokepoint if either end of the edge is one. Edge ids are
        // `E-<from>__<to>` (network.ts), so the endpoints parse back out.
        for (const nodeId of edgeId.replace(/^E-/, "").split("__")) {
          const node = routeNodeById(nodeId);
          if (node?.kind === "strait" && !bottlenecks.includes(node.name)) bottlenecks.push(node.name);
        }
      } else if (cond.weatherRisk >= MARITIME_DOCTRINE.routing.highRiskWeatherThreshold) {
        hazardous++;
      }
    }

    return {
      sailing: sailing.length,
      regional: regionalVessels(sim).length,
      inFrame: inFrame.length,
      activeRoutes: sim.maritime.routePlans.filter((p) => p.status === "active").length,
      pendingReroutes: sim.maritime.rerouteDecisions.filter((d) => d.approvalStatus === "pending").length,
      blocked,
      hazardous,
      peakRisk,
      bottlenecks: bottlenecks.slice(0, 3),
      kpis,
    };
  }, [sim]);

  const riskTone = summary.blocked > 0 ? "bad" : summary.hazardous > 0 ? "warn" : "normal";

  return (
    <Panel
      title="Maritime Network"
      actions={
        <button
          type="button"
          onClick={() => onNavigate("maritime")}
          className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          View Maritime Network
        </button>
      }
    >
      <div className="mb-3 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <Globe2 className="h-3.5 w-3.5" aria-hidden="true" />
        <span>
          Showing <span className="font-medium text-slate-700 dark:text-slate-200">Regional</span> scope
        </span>
        <SourceTag variant="simulated" />
      </div>

      {/* The real map, not a picture of one: the same MapShell, the same
          layers, the same viewport store as the full tab — so panning or
          zooming here and opening the tab lands exactly where you left off.
          The legend is deliberately omitted; this is an overview. */}
      <div className="relative h-72 overflow-hidden rounded-md">
        <MapShell viewport={{ center: REGIONAL_CENTER, zoom: REGIONAL_VIEW_ZOOM }}>
          <BasemapLayer zoom={effectiveZoom} maxResolution={satelliteCovering ? "110m" : undefined} />
          {satelliteOn && <SatelliteLayer source={TILE_SOURCE} />}
          {layers.weather && <WeatherCellLayer sim={sim} />}
          <CorridorLayer zoom={effectiveZoom} dimmed={false} />
          <BottleneckLayer sim={sim} zoom={effectiveZoom} showLabels={false} />
          <PortLayer
            onSelect={(portId) => select({ entityType: "portHub", entityId: portId })}
            selectedId={selectedPortId}
            zoom={effectiveZoom}
            showLabels
          />
          <VesselMarkerLayer
            vessels={regional}
            selectedId={selectedVesselId}
            onSelect={(vesselId) => select({ entityType: "vessel", entityId: vesselId })}
            zoom={effectiveZoom}
            showLabels={false}
          />
        </MapShell>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
        <span>
          <span className="font-medium text-slate-700 dark:text-slate-200">{summary.sailing}</span> vessels
        </span>
        <span>
          <span className="font-medium text-slate-700 dark:text-slate-200">{summary.activeRoutes}</span> routes
        </span>
        <span className={riskTone === "normal" ? "" : "text-[#c98500] dark:text-[#eda100]"}>
          <span className="font-medium">{summary.blocked + summary.hazardous}</span> disruptions
        </span>
        {summary.pendingReroutes > 0 && (
          <span className="text-[#c98500] dark:text-[#eda100]">
            <span className="font-medium">{summary.pendingReroutes}</span> reroutes pending
          </span>
        )}
        {summary.bottlenecks.length > 0 && (
          <span className="text-[#d03b3b]">Affected: {summary.bottlenecks.join(", ")}</span>
        )}
      </div>
    </Panel>
  );
}
