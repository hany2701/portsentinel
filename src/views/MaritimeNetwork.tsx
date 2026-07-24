import { useEffect, useMemo, useRef, useState } from "react";
import { Anchor, Boxes, Gauge, Globe2, ListFilter, Ship } from "lucide-react";
import { useSimStore } from "../store/simStore";
import {
  FITTED_ZOOM,
  REGIONAL_CENTER,
  REGIONAL_VIEW_ZOOM,
  TUAS_CENTER,
  TUAS_VIEW_ZOOM,
  mapMode,
  nearTuas,
  useMapViewStore,
} from "../store/mapViewStore";
import { Tooltip } from "../components/Tooltip";
import { MapShell, ZoomControls } from "../maritime/map/MapShell";
import { MapDock } from "../maritime/map/MapDock";
import { BasemapLayer } from "../maritime/map/BasemapLayer";
import { SatelliteLayer } from "../maritime/map/SatelliteLayer";
import { TILE_SOURCE } from "../maritime/map/tileSource";
import { useSatelliteHealth } from "../maritime/map/useSatelliteHealth";
import {
  BottleneckLayer,
  CorridorLayer,
  DisruptionLayer,
  PortLayer,
  RouteOverlay,
  VesselClusterLayer,
  TuasFrameLayer,
  VesselMarkerLayer,
  VesselTrailLayer,
  WeatherCellLayer,
} from "../maritime/map/layers";
import { advanceTrails, drawableTrails } from "../maritime/trails";
import { LAYER_BUDGET } from "../maritime/map/layerBudget";
import type { LonLat } from "../maritime/routeGeometry";
import { KpiStrip, MapLegend, SelectedPortPanel, SelectedVesselPanel } from "../maritime/map/panels";
import { handoverTransition, transitionOpacity } from "../maritime/handoverTransition";
import {
  edgeConditions,
  exposedVessels,
  geographicVessels,
  globalKpis,
  joinPolyline,
  planPolyline,
  regionalKpis,
  regionalVessels,
  remainingPolyline,
  originalPlanFor,
  activePlanFor,
  tuasBoundAtSea,
  tuasFrameVessels,
  tuasQueueVessels,
} from "../maritime/selectors";
import { nodePathGeometry } from "../maritime/routeGeometry";
import { routeCandidates } from "../maritime/routeEngine";
import { tuasImpact } from "../maritime/tuasImpact";
import { edgeBetween } from "../maritime/graph";
import { MARITIME_DOCTRINE } from "../maritime/maritimeDoctrine";
import type { ViewProps } from "./registry";

// GR-4/GR-5: the Maritime Network view. ONE map shell carries the global⇄regional
// continuum: zooming changes detail, not the page, so the selected vessel and its
// route survive the whole journey down to the Tuas twin handoff (GR-D4).

export function MaritimeNetwork({ onNavigate }: ViewProps) {
  const sim = useSimStore((s) => s.sim);
  const selection = useSimStore((s) => s.selection);
  const select = useSimStore((s) => s.select);
  const { center, zoom, fitted, layers, toggleLayer, flyTo, reset } = useMapViewStore();
  // Which dock panel is open, or null. Collapsed by default so the map opens
  // unobstructed.
  const [dock, setDock] = useState<string | null>(null);
  // MDS-2: which comparison-table column the pointer is on. Held here because
  // BOTH the side panel and the map need it — one owner, no duplicate state.
  const [hoveredCandidate, setHoveredCandidate] = useState<number | null>(null);

  // GR-8: satellite imagery is a presentation layer. It probes the provider once
  // when this view mounts; anything other than "ok" (off, no key, offline, or a
  // failed provider) falls back to the bundled vector basemap. While it covers
  // the map, the vector layer stays mounted as a cheap 110m backdrop so a gap in
  // the tiles never shows blank and a fallback never flashes.
  const satelliteHealth = useSatelliteHealth(TILE_SOURCE);
  const satelliteOn = satelliteHealth === "ok";
  const satelliteCovering = satelliteOn || satelliteHealth === "probing";

  // While the map is in its fitted opening frame, the store's zoom is still the
  // default 1 — the fitted scale is what layers should style against.
  const effectiveZoom = fitted ? FITTED_ZOOM : zoom;
  const mode = mapMode(effectiveZoom);
  // MDS-6 (D-97b): the per-mode rendering rules, named once instead of
  // inlined as mode === "global" checks at each use site.
  const budget = LAYER_BUDGET[mode];
  const vessels = useMemo(() => geographicVessels(sim), [sim]);
  const regional = useMemo(() => regionalVessels(sim), [sim]);
  const tuasFrame = useMemo(() => tuasFrameVessels(sim), [sim]);
  const kpis = useMemo(() => (mode === "global" ? globalKpis(sim) : regionalKpis(sim)), [sim, mode]);

  // GR-5A: bounded presentation-only trails for the individually-drawn vessels.
  // Held in a ref, never in SimState — it is render history, not simulation.
  const trailBuffer = useRef<Map<string, LonLat[]>>(new Map());
  const trails = useMemo(() => {
    if (!budget.trails || !layers.trails) {
      trailBuffer.current = new Map();
      return new Map<string, LonLat[]>();
    }
    trailBuffer.current = advanceTrails(trailBuffer.current, sim, regional.map((v) => v.id));
    return drawableTrails(trailBuffer.current);
  }, [sim, regional, budget.trails, layers.trails]);

  const selectedVessel =
    selection?.entityType === "vessel"
      ? (sim.vessels.find((v) => v.id === selection.entityId) ?? null)
      : null;
  const selectedPortId = selection?.entityType === "portHub" ? selection.entityId : null;

  // Selecting on the map pops the matching dock panel open. This is what makes
  // dropping the permanent side column safe: the detail still arrives at the
  // moment of selection rather than waiting to be asked for. Keyed on the
  // selection object, which `select()` renews on every call — so re-selecting
  // the same entity after closing the panel reopens it (keying on id/type would
  // not change on a re-click, leaving the panel shut), and so a selection made
  // elsewhere (an alert link, the chat, the scenario) also lands with its panel
  // showing.
  useEffect(() => {
    if (selection?.entityType === "vessel") setDock("vessel");
    else if (selection?.entityType === "portHub") setDock("port");
  }, [selection]);

  // MDS-1 (§4 Q3/Q4): who is sailing into a hazard, and which of those are ours.
  // Derived from the same edgeConditions the routing engine uses, so the map can
  // never disagree with the engine about who is at risk.
  const exposedIds = useMemo(
    () => new Set(exposedVessels(sim).map((v) => v.id)),
    [sim],
  );
  const tuasBoundIds = useMemo(
    () => new Set(tuasBoundAtSea(sim).map((v) => v.id)),
    [sim],
  );
  // The arrival queue behind the fence. Not reroutable, but it is the terminal's
  // actual state — and where an approved reroute's consequence lands.
  const tuasQueue = useMemo(() => tuasQueueVessels(sim), [sim]);

  // Route geometry for the selected vessel: the active route starts at the
  // vessel's ACTUAL position, never at a distant waypoint.
  const routes = useMemo(() => {
    const empty = {
      original: [] as LonLat[],
      active: [] as LonLat[],
      highRisk: [] as LonLat[][],
      blocked: [] as LonLat[][],
      candidates: [] as LonLat[][],
      recommended: [] as LonLat[],
      join: [] as LonLat[],
    };
    if (!selectedVessel) return empty;
    const active = remainingPolyline(sim, selectedVessel);
    const originalPlan = originalPlanFor(sim, selectedVessel.id);
    const plan = activePlanFor(sim, selectedVessel.id);
    const superseded = originalPlan && plan && originalPlan.id !== plan.id;
    // Hazardous and unavailable stretches of the ACTIVE route, derived from the
    // same edge conditions the cost model uses — the map never invents risk.
    const conditions = edgeConditions(sim);
    const highRisk: LonLat[][] = [];
    const blocked: LonLat[][] = [];
    if (plan) {
      for (let i = 0; i < plan.nodeIds.length - 1; i++) {
        const edge = edgeBetween(plan.nodeIds[i], plan.nodeIds[i + 1]);
        const cond = edge && conditions.get(edge.id);
        if (!edge || !cond) continue;
        const geometry = nodePathGeometry([plan.nodeIds[i], plan.nodeIds[i + 1]]);
        if (cond.blocked) blocked.push(geometry);
        else if (cond.weatherRisk >= MARITIME_DOCTRINE.routing.highRiskWeatherThreshold) highRisk.push(geometry);
      }
    }
    // MDS-2: the alternatives the engine found, drawn so the trade-off in the
    // comparison table has a shape on the map. Each candidate's line starts at
    // the vessel's ACTUAL position for the same reason the active route does —
    // a route that begins at a distant waypoint misrepresents the decision.
    // Guarded: the 22 baseline Tuas vessels have no track at all, and they are
    // selectable from Operations and from alert links.
    const track = selectedVessel.track;
    const here: LonLat | null = track ? [track.longitude, track.latitude] : null;
    const options =
      here && selectedVessel.status === "enroute" ? routeCandidates(sim, selectedVessel.id) : [];
    const candidates = here
      ? options.slice(0, 3).map((c) => [here, ...nodePathGeometry(c.nodeIds)] as LonLat[])
      : [];

    // A proposal already in the queue is the "recommended" line — awaiting
    // approval, so it is drawn distinctly from both the active and the merely
    // considered routes (§5.5).
    const proposed = sim.recommendations.find(
      (rec) =>
        rec.status === "pending" &&
        rec.proposedEffect.kind === "rerouteVoyage" &&
        rec.proposedEffect.vesselId === selectedVessel.id,
    );
    const recommended =
      here && proposed && proposed.proposedEffect.kind === "rerouteVoyage"
        ? ([here, ...nodePathGeometry(proposed.proposedEffect.toNodeIds)] as LonLat[])
        : [];

    return {
      original: superseded ? planPolyline(originalPlan) : [],
      active,
      highRisk,
      blocked,
      candidates,
      recommended,
      // MDS-4: the no-teleport connector, drawn as its own route state.
      join: joinPolyline(selectedVessel),
    };
  }, [sim, selectedVessel]);

  // The vessel is offered to the twin when the map is on Singapore, or when the
  // vessel has already crossed into the Tuas frame (where the twin is the only
  // place it can be seen).
  const inTuasFrame = selectedVessel !== null && selectedVessel.status !== "enroute";
  // MDS-5: the handoff is offered wherever a Tuas impact exists — a Tuas-bound
  // vessel still days out has a berth window to inspect, and requiring the map
  // to be zoomed onto Singapore first hid the action exactly when the impact
  // summary was most interesting.
  const hasTuasImpact = selectedVessel !== null && tuasImpact(sim, selectedVessel) !== null;
  const showTuasHandoff =
    selectedVessel !== null && (nearTuas(center, zoom) || inTuasFrame || hasTuasImpact);
  const transition = handoverTransition(sim, selectedVessel?.id ?? null);

  // Focus the camera on the vessel before switching views, so the frame change
  // lands on a familiar picture rather than a jump cut. Presentation only.
  const openInTwin = () => {
    if (selectedVessel?.track) flyTo([selectedVessel.track.longitude, selectedVessel.track.latitude], TUAS_VIEW_ZOOM);
    onNavigate("twin");
  };

  return (
    // The map is the view: the KPI and selection panels used to hold a fixed
    // 20rem column beside it, and now float over the chart itself (see MapDock),
    // so the chart gets the full width.
    //
    // min-w-0 so this column can shrink below the map SVG's own width — a flex
    // item defaults to min-width:auto, which deadlocked with the SVG (the SVG is
    // sized from the container it sits in, and the container could not shrink
    // while the SVG held it open) and spilled scrollbars over the map whenever
    // the chat drawer narrowed <main>. The COLUMN owns the height and the map
    // flexes into whatever the toolbar leaves, so a toolbar that wraps onto a
    // second row shortens the map instead of overflowing the page.
    <div className="flex min-w-0 flex-col gap-2 lg:h-[calc(100vh-8rem)]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Globe2 className="h-4 w-4 text-slate-500" aria-hidden="true" />
            <h1 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {mode === "global" ? "Global shipping network" : "Regional maritime network"}
            </h1>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              {mode === "global" ? `${vessels.length} vessels` : `${regional.length} in area`}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Overview ⇄ Regional. This does NOT introduce a second mode
                store: mode is derived from zoom (mapMode), so the toggle simply
                flies the existing viewport to each scope. Selection, vessels,
                routes, disruptions and the simulation are untouched — only the
                camera moves. */}
            <div
              role="group"
              aria-label="Map scope"
              className="mr-1 inline-flex overflow-hidden rounded-md border border-slate-300 dark:border-slate-700"
            >
              <Tooltip label="Show the whole supported network — global routes, ports and vessel clusters">
                {(tip) => (
                  <button
                    {...tip}
                    type="button"
                    aria-pressed={mode === "global"}
                    onClick={() => reset()}
                    className={`px-2.5 py-1 text-xs ${
                      mode === "global"
                        ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                        : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                    }`}
                  >
                    Overview
                  </button>
                )}
              </Tooltip>
              <Tooltip label="Zoom to South-East Asia — Malacca, the Singapore Strait and the Tuas approach">
                {(tip) => (
                  <button
                    {...tip}
                    type="button"
                    aria-pressed={mode === "regional"}
                    onClick={() => flyTo(REGIONAL_CENTER, REGIONAL_VIEW_ZOOM)}
                    className={`px-2.5 py-1 text-xs ${
                      mode === "regional"
                        ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                        : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                    }`}
                  >
                    Regional
                  </button>
                )}
              </Tooltip>
            </div>
            {(["corridors", "weather", "labels", "trails"] as const).map((layer) => (
              <button
                key={layer}
                onClick={() => toggleLayer(layer)}
                aria-pressed={layers[layer]}
                className={`rounded border px-2 py-1 text-xs capitalize ${
                  layers[layer]
                    ? "border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-400"
                    : "border-slate-300 text-slate-500 dark:border-slate-700 dark:text-slate-400"
                }`}
              >
                {layer}
              </button>
            ))}
          </div>
        </div>

        {/* The map fills the available height now that the legend no longer
            takes a column of its own. */}
        <div className="relative min-h-[20rem] flex-1">
          <MapShell>
            {/* Painting order is the information hierarchy: basemap (vector
                and/or satellite), then weather, then the network, then routes,
                then vessels on top. The vector basemap is always mounted as the
                offline-safe base; when satellite imagery is healthy it draws on
                top of a cheap 110m vector backdrop, and every operational
                overlay stays above the imagery. */}
            <BasemapLayer zoom={zoom} maxResolution={satelliteCovering ? "110m" : undefined} />
            {satelliteOn && <SatelliteLayer source={TILE_SOURCE} />}
            {layers.weather && <WeatherCellLayer sim={sim} />}
            {layers.corridors && <CorridorLayer zoom={effectiveZoom} dimmed={selectedVessel !== null} />}
            {/* Chokepoints sit above the corridors they constrain but below the
                ports and vessels, so they annotate without obstructing. */}
            {layers.corridors && (
              <BottleneckLayer sim={sim} zoom={effectiveZoom} showLabels={layers.labels} />
            )}
            <RouteOverlay
              original={routes.original}
              active={routes.active}
              highRisk={routes.highRisk}
              blocked={routes.blocked}
              candidates={routes.candidates}
              recommended={routes.recommended}
              join={routes.join}
              hoveredCandidate={hoveredCandidate}
            />
            <PortLayer
              onSelect={(portId) => select({ entityType: "portHub", entityId: portId })}
              selectedId={selectedPortId}
              zoom={effectiveZoom}
              showLabels={layers.labels}
            />
            {/* GR-7: vessels inside the Tuas frame are summarised here rather
                than vanishing from the map at the fence. */}
            <TuasFrameLayer
              vessels={tuasFrame}
              waiting={tuasQueue.waiting.length}
              approaching={tuasQueue.approaching.length}
              selectedId={selectedVessel?.id ?? null}
              onOpenTwin={openInTwin}
            />
            {/* MDS-1: the disruption is drawn where it actually is. */}
            <DisruptionLayer sim={sim} />
            {budget.vesselRendering === "clustered" ? (
              // §5.4: normal vessels cluster, but exposed ones break out and are
              // drawn individually — the point of the overview is to show who is
              // sailing into trouble, which a cluster count hides.
              <>
                <VesselClusterLayer
                  vessels={vessels.filter((v) => !exposedIds.has(v.id))}
                  zoom={effectiveZoom}
                  onZoomTo={(lon, lat) => flyTo([lon, lat], Math.max(4.5, effectiveZoom * 2))}
                  onSelect={(vesselId) => select({ entityType: "vessel", entityId: vesselId })}
                  selectedId={selectedVessel?.id ?? null}
                />
                <VesselMarkerLayer
                  vessels={vessels.filter((v) => exposedIds.has(v.id))}
                  selectedId={selectedVessel?.id ?? null}
                  exposedIds={exposedIds}
                  tuasBoundIds={tuasBoundIds}
                  onSelect={(vesselId) => select({ entityType: "vessel", entityId: vesselId })}
                  zoom={effectiveZoom}
                  showLabels={layers.labels}
                />
              </>
            ) : (
              <>
                {layers.trails && <VesselTrailLayer trails={trails} />}
                <VesselMarkerLayer
                  vessels={regional}
                  selectedId={selectedVessel?.id ?? null}
                  exposedIds={exposedIds}
                  tuasBoundIds={tuasBoundIds}
                  onSelect={(vesselId) => select({ entityType: "vessel", entityId: vesselId })}
                  zoom={effectiveZoom}
                  showLabels={layers.labels}
                />
              </>
            )}
          </MapShell>
          <ZoomControls />
          <button
            onClick={() => flyTo(TUAS_CENTER, TUAS_VIEW_ZOOM)}
            className="absolute left-3 top-3 rounded border border-slate-700 bg-slate-900/80 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800"
          >
            Zoom to Singapore
          </button>

          {/* Legend, KPIs and the selection panels all live INSIDE the map now,
              in one bottom-left dock. Selecting a vessel or a port pops its
              panel open (see the effect above), which is what makes giving up
              the side column safe: the detail still arrives unprompted at the
              moment of selection. */}
          <MapDock
            open={dock}
            onOpenChange={setDock}
            items={[
              {
                id: "legend",
                label: "Legend",
                icon: <ListFilter className="h-3 w-3" aria-hidden="true" />,
                width: "w-[15rem]",
                content: <MapLegend />,
              },
              {
                id: "kpis",
                label: mode === "global" ? "Global KPIs" : "Regional KPIs",
                icon: <Gauge className="h-3 w-3" aria-hidden="true" />,
                width: "w-[20rem]",
                content: <KpiStrip kpis={kpis} scopeLabel={mode === "global" ? "Tracked" : "Regional"} />,
              },
              {
                id: "vessel",
                label: "Vessel",
                icon: <Ship className="h-3 w-3" aria-hidden="true" />,
                badge: selectedVessel?.name,
                width: "w-[26rem]",
                content: (
                  <>
                    {showTuasHandoff && (
                      <div className="mb-2 flex justify-end">
                        <button
                          onClick={openInTwin}
                          className="inline-flex items-center gap-1 rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-xs text-slate-100 hover:bg-white/20"
                        >
                          <Boxes className="h-3 w-3" aria-hidden="true" />
                          Open in Tuas twin
                        </button>
                      </div>
                    )}
                    <SelectedVesselPanel
                      sim={sim}
                      vessel={selectedVessel}
                      hoveredCandidate={hoveredCandidate}
                      onHoverCandidate={setHoveredCandidate}
                    />
                  </>
                ),
              },
              ...(selectedPortId
                ? [
                    {
                      id: "port",
                      label: "Port",
                      icon: <Anchor className="h-3 w-3" aria-hidden="true" />,
                      width: "w-[20rem]",
                      content: <SelectedPortPanel portId={selectedPortId} />,
                    },
                  ]
                : []),
            ]}
          />
          {transition && (
            // Cross-dissolving status chip covering the coordinate-frame change.
            // Purely visual: it reads the handover the engine already recorded
            // and never writes simulation state.
            <div
              className="pointer-events-none absolute inset-x-0 top-3 flex justify-center transition-opacity duration-500"
              style={{ opacity: transitionOpacity(transition.ageTicks) }}
              role="status"
            >
              <span className="rounded-full bg-sky-500/20 px-3 py-1 text-xs font-medium text-sky-200 ring-1 ring-sky-400/40">
                {transition.label} · {selectedVessel?.name}
              </span>
            </div>
          )}

          {/* GR-8: basemap source + a standing reminder that the operational
              overlays are simulated/calculated, not a navigational chart.
              Top-right, the one corner no overlay occupies at any map width: it
              used to be bottom-CENTRED, which the dock's chip row now runs
              underneath (that row is as wide as its chips, not the old single
              Legend button) — and it collided again when tried bottom-right on a
              narrow map. Provider attribution has to stay unobstructed. */}
          <div className="pointer-events-none absolute right-3 top-3 flex max-w-[45%] justify-end">
            <span className="max-w-full truncate rounded-full bg-slate-950/70 px-2.5 py-1 text-[10px] text-slate-300 ring-1 ring-slate-700/70 backdrop-blur">
              {satelliteOn ? (
                <>{TILE_SOURCE.attribution}</>
              ) : satelliteHealth === "probing" ? (
                <>Loading satellite imagery…</>
              ) : satelliteHealth === "failed" ? (
                <>Satellite imagery unavailable — vector basemap</>
              ) : (
                <>Vector basemap</>
              )}
              <span className="text-slate-500"> · Routes &amp; conditions are simulated / calculated</span>
            </span>
          </div>
        </div>
    </div>
  );
}
