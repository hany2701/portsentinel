import { useMemo } from "react";
import { geoPath } from "d3-geo";
import { useProject, useProjection, useViewportSize } from "./MapShell";
import { outsideFrame } from "./layerBudget";
import { PORT_HUBS, portTier, type PortHub, type PortTier } from "../ports";
import { ROUTE_EDGES, ROUTE_NODES, SHIPPING_CORRIDORS, routeNodeById } from "../network";
import { edgeConditions } from "../selectors";
import { clusterCellDeg, clusterVessels } from "../clustering";
import { WEATHER_POINTS } from "../../sim/config";
import { MARITIME_DOCTRINE } from "../maritimeDoctrine";
import { weatherRiskBand } from "../../sim";
import { WEATHER_BAND_COLOR } from "../../twin/colors";
import { lineString, markersAlong, nodePathGeometry, type LonLat } from "../routeGeometry";
import { mapMode } from "../../store/mapViewStore";
import type { SimState, Vessel } from "../../sim";

// GR-4/GR-5/GR-5A: the map's data layers. Every layer derives from the
// authoritative vessel entities and the static network — none of them holds
// state, so no view can disagree with another about where a vessel is.
//
// GR-5A: routes are sampled great circles (routeGeometry) drawn through geoPath,
// not straight screen-space lines, so the map reads as a chart rather than a
// node-and-edge graph.

// One palette for the whole maritime view, so route roles stay legible and
// distinguishable without relying on hue alone (dash patterns and widths carry
// the same information for colour-blind readers).
export const ROUTE_STYLE = {
  // Corridors are the map's structural backbone, so they carry real weight —
  // subdued against the selected route, but never faint enough to read as a
  // debug grid.
  corridor: { stroke: "#4a86c4", width: 1.6 },
  active: { stroke: "#22c98a", width: 2.6 },
  original: { stroke: "#94a3b8", width: 1.6, dash: "6 5" },
  recommended: { stroke: "#38bdf8", width: 2.8, dash: "10 4" },
  highRisk: { stroke: "#f0603a", width: 5 },
  blocked: { stroke: "#7f1d1d", width: 3, dash: "2 4" },
  candidate: { stroke: "#a78bfa", width: 1.8, dash: "4 4" },
  // MDS-4 (§5.5): the temporary connector from where the vessel actually is to
  // where it rejoins an approved route. Deliberately unlike every other state —
  // it is the visible proof that a reroute did not teleport the ship.
  joinSegment: { stroke: "#f0b429", width: 2.4, dash: "1 3" },
} as const;

const PORT_TIER_STYLE: Record<PortTier, { r: number; labelZoom: number }> = {
  primary: { r: 5.5, labelZoom: 0 }, // always labelled
  regional: { r: 4, labelZoom: 2.2 },
  supporting: { r: 2.8, labelZoom: 4.5 },
};

const RISK_COLOR: Record<PortHub["riskLevel"], string> = {
  low: "#1baf7a",
  medium: "#eda100",
  high: "#d03b3b",
};

/** Shared helper: geographic points → an SVG path string via the projection. */
function useGeoPath(): (points: LonLat[]) => string | null {
  const projection = useProjection();
  const path = useMemo(() => geoPath(projection), [projection]);
  return (points) => {
    const geometry = lineString(points);
    return geometry ? path(geometry) : null;
  };
}

export function CorridorLayer({ zoom, dimmed }: { zoom: number; dimmed: boolean }) {
  const toPath = useGeoPath();
  // Corridor geometry is static, so it is sampled once and only re-projected.
  const corridors = useMemo(
    () => SHIPPING_CORRIDORS.map((c) => ({ id: c.id, points: nodePathGeometry(c.nodeIds) })),
    [],
  );
  // Background structure: present enough to read the network, never competing
  // with the selected route. Dimmed while a vessel is selected so its route
  // stands out — de-emphasised, not hidden (GR-5A §9).
  const opacity = (mapMode(zoom) === "global" ? 0.55 : 0.7) * (dimmed ? 0.4 : 1);

  return (
    <g aria-hidden="true">
      {corridors.map((c) => {
        const d = toPath(c.points);
        return d ? (
          <path
            key={c.id}
            d={d}
            fill="none"
            stroke={ROUTE_STYLE.corridor.stroke}
            strokeWidth={ROUTE_STYLE.corridor.width}
            strokeLinecap="round"
            opacity={opacity}
          />
        ) : null;
      })}
    </g>
  );
}

export function PortLayer({
  onSelect,
  selectedId,
  zoom,
  showLabels,
}: {
  onSelect: (portId: string) => void;
  selectedId: string | null;
  zoom: number;
  showLabels: boolean;
}) {
  const project = useProject();
  const viewport = useViewportSize();

  // GR-5A: label collision avoidance. Ports are laid out in tier order (primary
  // first) and a label is skipped when its box would overlap one already placed
  // — which is what stopped Hamburg/Rotterdam and the Singapore cluster from
  // stacking. Deterministic: same viewport, same labels, every render.
  const placed = useMemo(() => {
    const boxes: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
    const order = [...PORT_HUBS].sort((a, b) => {
      const rank = { primary: 0, regional: 1, supporting: 2 } as const;
      return rank[portTier(a)] - rank[portTier(b)] || a.id.localeCompare(b.id);
    });

    return order.map((hub) => {
      const p = project(hub.longitude, hub.latitude);
      // MDS-7 (D-99): Los Angeles and Long Beach sit outside the framed
      // network, so they were painted — and announced to screen readers —
      // hundreds of px off the edge. A port the frame cannot show is not drawn.
      if (!p || outsideFrame(p, viewport)) return { hub, point: null, label: false };
      const tier = portTier(hub);
      const style = PORT_TIER_STYLE[tier];
      const selected = selectedId === hub.id;
      // Selected ports always keep their label; otherwise the tier decides when
      // it earns screen space.
      let label = showLabels && (selected || zoom >= style.labelZoom);

      if (label) {
        const text = hub.name.split(",")[0];
        const box = {
          x0: p[0] + 6,
          y0: p[1] - 7,
          x1: p[0] + 6 + text.length * 5.2,
          y1: p[1] + 4,
        };
        const collides = boxes.some(
          (b) => !(box.x1 < b.x0 || box.x0 > b.x1 || box.y1 < b.y0 || box.y0 > b.y1),
        );
        if (collides && !selected) label = false;
        else boxes.push(box);
      }
      return { hub, point: p, label };
    });
  }, [project, zoom, showLabels, selectedId, viewport]);

  return (
    <g>
      {placed.map(({ hub, point, label }) => {
        if (!point) return null;
        const tier = portTier(hub);
        const style = PORT_TIER_STYLE[tier];
        const selected = selectedId === hub.id;
        return (
          <g key={hub.id} transform={`translate(${point[0]},${point[1]})`}>
            {selected && <circle r={style.r + 5} fill="none" stroke="#8b5cf6" strokeWidth={1.5} opacity={0.7} />}
            <circle
              r={selected ? style.r + 1.5 : style.r}
              fill={RISK_COLOR[hub.riskLevel]}
              stroke="#0b1a2b"
              strokeWidth={tier === "primary" ? 1.5 : 1}
              className="cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                onSelect(hub.id);
              }}
            >
              <title>{`${hub.name} — ${hub.riskLevel} risk, ~${hub.estimatedWaitHours} h wait (static reference)`}</title>
            </circle>
            {label && (
              <text
                x={style.r + 3}
                y={3}
                className="pointer-events-none text-[9px]"
                fill={tier === "primary" ? "#e2e8f0" : "#94a3b8"}
                fontWeight={tier === "primary" ? 600 : 400}
                stroke="#0b1a2b"
                strokeWidth={2.5}
                paintOrder="stroke"
              >
                {hub.name.split(",")[0]}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

export function VesselClusterLayer({
  vessels,
  zoom,
  onZoomTo,
  onSelect,
  selectedId,
}: {
  vessels: Vessel[];
  zoom: number;
  onZoomTo: (lon: number, lat: number) => void;
  /** Selects the vessel when a bubble holds exactly one. */
  onSelect?: (vesselId: string) => void;
  selectedId?: string | null;
}) {
  const project = useProject();
  const viewport = useViewportSize();
  // Clusters are derived from the real entities, so their counts always sum back
  // to the population — they are never a separate figure.
  const clusters = useMemo(
    () =>
      clusterVessels(
        vessels.flatMap((v) =>
          v.track ? [{ id: v.id, latitude: v.track.latitude, longitude: v.track.longitude }] : [],
        ),
        clusterCellDeg(zoom),
      ),
    [vessels, zoom],
  );

  // MDS-7 (D-99): the frame excludes the eastern half of the Transpacific
  // corridor, so some clusters land off-screen. They are not drawn, but the
  // vessels they carry are still counted and reported — the map must not imply
  // it is showing the whole population when it is not.
  const drawn = clusters.flatMap((cluster) => {
    const point = project(cluster.longitude, cluster.latitude);
    return point && !outsideFrame(point, viewport) ? [{ cluster, point }] : [];
  });
  const excluded =
    clusters.reduce((sum, c) => sum + c.count, 0) -
    drawn.reduce((sum, d) => sum + d.cluster.count, 0);

  return (
    <g>
      {excluded > 0 && (
        <g transform={`translate(${viewport.width - 10},18)`}>
          <text
            textAnchor="end"
            className="text-[10px]"
            fill="#94a3b8"
            stroke="#0b1a2b"
            strokeWidth={2.5}
            paintOrder="stroke"
          >
            {`+${excluded} vessel${excluded > 1 ? "s" : ""} outside this view`}
            <title>
              {`${excluded} tracked vessel${excluded > 1 ? "s sit" : " sits"} beyond the framed operating network, on the Transpacific leg to Los Angeles and Long Beach.`}
            </title>
          </text>
        </g>
      )}
      {drawn.map(({ cluster, point: p }) => {
        // Restrained sizing: a cluster is a fleet count, not a heat blob, so the
        // radius grows slowly and caps well before it can cover a port.
        const r = Math.min(11, 4.5 + Math.sqrt(cluster.count) * 1.5);
        // A bubble holding ONE vessel is that vessel, so clicking it selects
        // rather than zooms. Without this the Overview had no selectable vessel
        // at all in calm weather — every ship sat inside a cluster (only vessels
        // sailing into a hazard break out as individual markers), so clicking
        // what looked like a ship just zoomed and the vessel panel stayed empty.
        const single = cluster.count === 1 ? cluster.memberIds[0] : null;
        const isSelected = single !== null && single === selectedId;
        return (
          <g
            key={cluster.id}
            transform={`translate(${p[0]},${p[1]})`}
            className="cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              if (single && onSelect) onSelect(single);
              else onZoomTo(cluster.longitude, cluster.latitude);
            }}
          >
            <circle
              r={r}
              fill="#2b6fb8"
              fillOpacity={0.5}
              stroke={isSelected ? "#8b5cf6" : "#7fb0ea"}
              strokeWidth={isSelected ? 2.5 : 1}
            />
            <title>
              {single
                ? `1 vessel (simulated) — click to select`
                : `${cluster.count} vessels (simulated) — click to zoom in`}
            </title>
            {cluster.count > 1 && (
              <text
                textAnchor="middle"
                y={2.8}
                className="pointer-events-none fill-white text-[8px] font-semibold"
              >
                {cluster.count}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

/** A vessel hull silhouette, drawn pointing "up" and rotated to its course. */
function VesselGlyph({ scale, fill, stroke }: { scale: number; fill: string; stroke: string }) {
  return (
    <path
      d="M0,-6 C1.7,-3.4 2.5,-0.6 2.5,2.2 L2.5,4.6 L-2.5,4.6 L-2.5,2.2 C-2.5,-0.6 -1.7,-3.4 0,-6 Z"
      fill={fill}
      stroke={stroke}
      strokeWidth={0.7}
      transform={`scale(${scale})`}
    />
  );
}

export function VesselMarkerLayer({
  vessels,
  selectedId,
  exposedIds,
  tuasBoundIds,
  onSelect,
  zoom,
  showLabels,
}: {
  vessels: Vessel[];
  selectedId: string | null;
  /** Vessels whose remaining route crosses a hazard (MDS-1 §5.4). */
  exposedIds?: ReadonlySet<string>;
  /** Vessels bound for Tuas — the subset the duty manager owns. */
  tuasBoundIds?: ReadonlySet<string>;
  onSelect: (vesselId: string) => void;
  zoom: number;
  showLabels: boolean;
}) {
  const project = useProject();
  // Markers stay readable without ballooning: they grow a little with zoom and
  // are capped at both ends.
  const scale = Math.min(1.35, Math.max(0.75, 0.6 + zoom * 0.08));

  return (
    <g>
      {vessels.map((v) => {
        if (!v.track) return null;
        const p = project(v.track.longitude, v.track.latitude);
        if (!p) return null;
        const selected = v.id === selectedId;
        const exposed = exposedIds?.has(v.id) ?? false;
        const tuasBound = tuasBoundIds?.has(v.id) ?? false;
        const held = v.heldUntilTick !== undefined;
        const rerouted = v.track.joinSegment !== undefined;
        const deepSea = v.scope === "deepSea";
        // Exposure outranks the routine colours: a vessel sailing into a hazard
        // is the one thing on this map the duty manager must not miss.
        const fill = exposed
          ? "#f0603a"
          : held ? "#f0b429" : rerouted ? "#38bdf8" : deepSea ? "#8fb8e8" : "#67d6a8";

        return (
          <g
            key={v.id}
            transform={`translate(${p[0]},${p[1]})`}
            className="cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              onSelect(v.id);
            }}
          >
            {selected && (
              // Restrained halo — outline, not a glow, so it reads at any zoom.
              <circle r={11 * scale} fill="none" stroke="#c4b5fd" strokeWidth={1.6} opacity={0.9} />
            )}
            {exposed && !selected && (
              // Exposed vessels carry their own ring so they stay findable in a
              // crowd without the selection halo's weight.
              <circle r={9 * scale} fill="none" stroke="#f0603a" strokeWidth={1.2} opacity={0.85} />
            )}
            {exposed && tuasBound && (
              // Exposed AND ours: the brief's §4 Q4. A second, tighter ring marks
              // the vessels whose delay actually lands at Tuas.
              <circle r={13 * scale} fill="none" stroke="#f0b429" strokeWidth={1.1} strokeDasharray="2 2" opacity={0.9} />
            )}
            {/* Orientation comes from the track's course, which the movement
                engine derives from the local path tangent — so the hull always
                points along the drawn route. */}
            <g transform={`rotate(${v.track.courseDeg})`}>
              <VesselGlyph
                scale={selected ? scale * 1.35 : scale}
                fill={selected ? "#ede9fe" : fill}
                stroke={selected ? "#7c3aed" : "#0b1a2b"}
              />
            </g>
            <title>
              {`${v.name} (${v.id}) — ${Math.round(v.track.speedKnots)} kn, course ${Math.round(v.track.courseDeg)}°` +
                `${exposed ? ", EXPOSED — route crosses a hazard" : ""}${tuasBound ? ", Tuas-bound" : ""}` +
                `${held ? ", held" : ""}${rerouted ? ", rerouted" : ""} (simulated)`}
            </title>
            {showLabels && selected && (
              <text
                x={12 * scale}
                y={3}
                className="pointer-events-none fill-violet-100 text-[9px] font-medium"
                stroke="#0b1a2b"
                strokeWidth={2.5}
                paintOrder="stroke"
              >
                {v.name}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

/**
 * The Tuas operational frame, summarised on the geographic map (GR-7).
 *
 * A vessel that crosses the approach fence leaves the geographic frame — its
 * individual position lives in the D-62 twin from that point. Without this
 * marker it would simply disappear off the regional map mid-voyage. Instead the
 * anchorage carries an aggregate, and a way in to see it.
 *
 * MDS-1 follow-up: the headline number is the ANCHORAGE QUEUE — the ships
 * actually waiting for a berth. It previously counted only vessels that had
 * sailed in from the global network (at most 3, usually 0), so the map showed
 * nothing at Tuas while Operations showed six ships at anchor. The count now
 * comes from `anchorageQueue()` in sim/derive — the same function the Operations
 * view's tab badge uses — so the two screens cannot disagree.
 *
 * It is a COUNT, not a position: the two coordinate frames are never mixed.
 */
export function TuasFrameLayer({
  vessels,
  waiting,
  approaching,
  selectedId,
  onOpenTwin,
}: {
  /** Tracked vessels that crossed the fence — the GR-7 continuity story. */
  vessels: Vessel[];
  /** Ships at anchor waiting for a berth (canonical `anchorageQueue`). */
  waiting: number;
  /** Ships inbound but not yet anchored. */
  approaching: number;
  selectedId: string | null;
  onOpenTwin: () => void;
}) {
  const project = useProject();
  const anchorage = routeNodeById("NODE-TUAS-ANCHORAGE");
  // Render whenever the terminal has anything to report, not just when a
  // tracked vessel happens to be inside it.
  if (!anchorage || (vessels.length === 0 && waiting === 0 && approaching === 0)) return null;
  const p = project(anchorage.longitude, anchorage.latitude);
  if (!p) return null;

  const holdsSelection = selectedId !== null && vessels.some((v) => v.id === selectedId);
  const tracked = vessels.length > 0
    ? ` Of these, ${vessels.length} arrived via the tracked network — ${vessels.map((v) => `${v.name}: ${v.status}`).join(", ")}.`
    : "";

  return (
    <g transform={`translate(${p[0]},${p[1]})`} className="cursor-pointer" onClick={onOpenTwin}>
      {holdsSelection && <circle r={14} fill="none" stroke="#c4b5fd" strokeWidth={1.6} opacity={0.9} />}
      <circle r={9} fill="#1e7f5c" fillOpacity={0.55} stroke="#67d6a8" strokeWidth={1.2} />
      <text textAnchor="middle" y={3} className="pointer-events-none fill-white text-[8px] font-semibold">
        {waiting}
      </text>
      <title>
        {`Tuas anchorage: ${waiting} vessel(s) waiting for a berth, ${approaching} approaching.${tracked} ` +
          `Positions are shown in the Digital Twin (simulated). Click to open.`}
      </title>
    </g>
  );
}

/**
 * Maritime bottlenecks — the chokepoints the supported corridors actually pass
 * through.
 *
 * These are NOT new data: they are the existing `kind: "strait"` route nodes,
 * with their already-verified coordinates, drawn through the same projection as
 * everything else. Marking them is what turns a line on a map into a route with
 * a known constraint on it.
 *
 * Risk shown here is read from the same `edgeConditions` the routing cost model
 * uses — a chokepoint is only flagged when authoritative state says an edge
 * touching it is degraded. Nothing is inferred, and the small diamond marker
 * deliberately reads as a schematic annotation, not a charted navigational
 * feature.
 */
export function BottleneckLayer({
  sim,
  zoom,
  showLabels,
}: {
  sim: SimState;
  zoom: number;
  showLabels: boolean;
}) {
  const project = useProject();
  const viewport = useViewportSize();

  const bottlenecks = useMemo(() => {
    const conditions = edgeConditions(sim);
    // Worst condition on any edge touching each chokepoint.
    const worst = new Map<string, { blocked: boolean; risk: number }>();
    for (const edge of ROUTE_EDGES) {
      const cond = conditions.get(edge.id);
      if (!cond) continue;
      for (const nodeId of [edge.fromNodeId, edge.toNodeId]) {
        const prev = worst.get(nodeId) ?? { blocked: false, risk: 0 };
        worst.set(nodeId, {
          blocked: prev.blocked || cond.blocked,
          risk: Math.max(prev.risk, cond.weatherRisk),
        });
      }
    }
    return ROUTE_NODES.filter((n) => n.kind === "strait").map((node) => ({
      node,
      state: worst.get(node.id) ?? { blocked: false, risk: 0 },
    }));
  }, [sim]);

  return (
    <g>
      {bottlenecks.map(({ node, state }) => {
        const p = project(node.longitude, node.latitude);
        // MDS-7 (D-99): at Regional, four chokepoints (Suez, Sicily, Gibraltar,
        // the English Channel) and their labels painted off the western edge.
        if (!p || outsideFrame(p, viewport)) return null;
        const degraded = state.blocked || state.risk >= MARITIME_DOCTRINE.routing.highRiskWeatherThreshold;
        const colour = state.blocked ? "#f0603a" : degraded ? "#eda100" : "#7d9ec4";
        // Small and constant: a chokepoint annotates the route, it does not
        // compete with the vessels and ports on top of it.
        const r = 3.6;
        return (
          <g key={node.id} transform={`translate(${p[0]},${p[1]})`}>
            <rect
              x={-r}
              y={-r}
              width={r * 2}
              height={r * 2}
              transform="rotate(45)"
              fill={degraded ? colour : "none"}
              fillOpacity={0.75}
              stroke={colour}
              strokeWidth={1.3}
            />
            <title>
              {`${node.name} — maritime chokepoint. ` +
                (state.blocked
                  ? "A connecting segment is currently blocked (simulated)."
                  : degraded
                    ? `Elevated risk ${Math.round(state.risk)} on a connecting segment (calculated).`
                    : "No elevated risk on connecting segments.")}
            </title>
            {/* Named only once the map is zoomed in enough to have room, or
                whenever the chokepoint is actually degraded and worth reading. */}
            {showLabels && (degraded || zoom >= 3) && (
              <text
                x={r + 3}
                y={3}
                className="pointer-events-none text-[8px]"
                fill={degraded ? colour : "#8aa4c0"}
                stroke="#0b1a2b"
                strokeWidth={2.5}
                paintOrder="stroke"
              >
                {node.name}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

/**
 * Active storms, drawn where they actually are (MDS-1, D-91).
 *
 * The circle is the doctrine's weather cell radius projected honestly — the same
 * distance the risk falloff in `edgeConditions` uses — so the ring shows the
 * reach the model actually applies rather than a decorative blob. A storm with
 * no route targets sits over Singapore, exactly as it always has.
 */
export function DisruptionLayer({ sim }: { sim: SimState }) {
  const project = useProject();

  const storms = useMemo(() => {
    const out: { id: string; longitude: number; latitude: number; severity: number; name: string }[] = [];
    for (const d of sim.disruptions) {
      if (d.type !== "storm") continue;
      if (sim.clock.tick < d.startTick || sim.clock.tick >= d.startTick + d.durationTicks) continue;
      for (const nodeId of d.targetIds) {
        const node = routeNodeById(nodeId);
        if (node) {
          out.push({ id: `${d.id}-${nodeId}`, longitude: node.longitude, latitude: node.latitude, severity: d.severity, name: node.name });
        }
      }
    }
    return out;
  }, [sim]);

  if (storms.length === 0) return null;

  return (
    <g>
      {storms.map((s) => {
        const centre = project(s.longitude, s.latitude);
        // A degree of latitude is 60 nm everywhere, so this converts the cell
        // radius into map units without assuming anything about the projection.
        const edge = project(s.longitude, s.latitude + MARITIME_DOCTRINE.weather.cellRadiusNm / 60);
        if (!centre || !edge) return null;
        const r = Math.abs(edge[1] - centre[1]);
        return (
          <g key={s.id} transform={`translate(${centre[0]},${centre[1]})`} className="pointer-events-none">
            <circle r={r} fill="#f0603a" fillOpacity={0.1} stroke="#f0603a" strokeWidth={1.1} strokeDasharray="4 3" opacity={0.85} />
            <circle r={3.5} fill="#f0603a" />
            <title>{`Storm (severity ${s.severity}) at ${s.name} — simulated`}</title>
          </g>
        );
      })}
    </g>
  );
}

/** Short movement trails behind individually-rendered vessels (GR-5A §6). */
export function VesselTrailLayer({ trails }: { trails: Map<string, LonLat[]> }) {
  const toPath = useGeoPath();
  return (
    <g aria-hidden="true">
      {[...trails.entries()].map(([vesselId, points]) => {
        const d = toPath(points);
        return d ? (
          <path
            key={vesselId}
            d={d}
            fill="none"
            stroke="#7fb0ea"
            strokeWidth={1.2}
            strokeLinecap="round"
            opacity={0.35}
          />
        ) : null;
      })}
    </g>
  );
}

export type RouteOverlayProps = {
  /** The route the vessel is sailing now, from its actual current position. */
  active: LonLat[];
  /** The superseded route, shown for comparison after a reroute. */
  original?: LonLat[];
  /** A proposed route awaiting approval. */
  recommended?: LonLat[];
  /** Segments flagged hazardous by the cost model. */
  highRisk?: LonLat[][];
  /** Edges removed from routing entirely. */
  blocked?: LonLat[][];
  /** Other candidates, shown faintly for comparison. */
  candidates?: LonLat[][];
  /** The no-teleport connector from the vessel's live position (MDS-4). */
  join?: LonLat[];
  /**
   * Index into `candidates` the user is pointing at in the comparison table.
   * The matching line is brought forward so "which row is which line" needs no
   * legend — MDS-2.
   */
  hoveredCandidate?: number | null;
};

export function RouteOverlay({
  active,
  original = [],
  recommended = [],
  highRisk = [],
  blocked = [],
  candidates = [],
  join = [],
  hoveredCandidate = null,
}: RouteOverlayProps) {
  const toPath = useGeoPath();
  const project = useProject();

  // Direction ticks follow the LOCAL tangent of the drawn curve, so on a
  // projected great circle they lie along the path instead of pointing at the
  // far endpoint.
  const arrows = useMemo(() => markersAlong(active, Math.min(5, Math.floor(active.length / 8) + 1)), [active]);

  const draw = (points: LonLat[], style: { stroke: string; width: number; dash?: string }, key?: string) => {
    const d = toPath(points);
    return d ? (
      <path
        key={key}
        d={d}
        fill="none"
        stroke={style.stroke}
        strokeWidth={style.width}
        strokeDasharray={style.dash}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ) : null;
  };

  return (
    <g aria-hidden="true">
      {/* Painted back to front: context first, the live route last. */}
      {candidates.map((c, i) =>
        i === hoveredCandidate
          ? null // drawn last instead, so the pointed-at route is never buried
          : draw(c, ROUTE_STYLE.candidate, `cand-${i}`),
      )}
      {original.length > 1 && draw(original, ROUTE_STYLE.original, "original")}
      {blocked.map((b, i) => draw(b, ROUTE_STYLE.blocked, `blocked-${i}`))}
      {highRisk.map((h, i) => draw(h, ROUTE_STYLE.highRisk, `risk-${i}`))}
      {recommended.length > 1 && draw(recommended, ROUTE_STYLE.recommended, "recommended")}
      {active.length > 1 && draw(active, ROUTE_STYLE.active, "active")}
      {/* Above the active route: while a reroute is in flight this is the part
          the vessel is actually sailing, and it is the visible evidence that it
          started from where it was rather than snapping to the new path. */}
      {join.length > 1 && draw(join, ROUTE_STYLE.joinSegment, "join")}
      {hoveredCandidate !== null && candidates[hoveredCandidate] &&
        draw(
          candidates[hoveredCandidate],
          { ...ROUTE_STYLE.candidate, width: ROUTE_STYLE.candidate.width + 1.6 },
          "cand-hover",
        )}
      {arrows.map((a, i) => {
        const p = project(a.point[0], a.point[1]);
        return p ? (
          <path
            key={`arrow-${i}`}
            d="M0,-3.2 L2.4,2.4 L0,1 L-2.4,2.4 Z"
            fill={ROUTE_STYLE.active.stroke}
            opacity={0.9}
            transform={`translate(${p[0]},${p[1]}) rotate(${a.bearingDeg})`}
          />
        ) : null;
      })}
    </g>
  );
}

export function WeatherCellLayer({ sim }: { sim: SimState }) {
  const project = useProject();
  // The same weather state and the same risk taxonomy as the Weather page and
  // the Tuas twin (D-52 / plan §13) — one storm is never classified two ways.
  const band = weatherRiskBand(sim.weather.riskIndex);
  const storm = sim.disruptions.some(
    (d) => d.type === "storm" && sim.clock.tick < d.startTick + d.durationTicks,
  );
  if (band.id === "normal" && !storm) return null;

  const colour = WEATHER_BAND_COLOR[band.id].hex;
  return (
    <g aria-hidden="true">
      {Object.values(WEATHER_POINTS).map((point) => {
        const centre = project(point.longitude, point.latitude);
        const edge = project(point.longitude, point.latitude + MARITIME_DOCTRINE.weather.cellRadiusNm / 60);
        if (!centre || !edge) return null;
        const r = Math.abs(centre[1] - edge[1]);
        return (
          <g key={point.label}>
            {/* Soft fill + hatched edge: severity reads without an opaque block,
                and the dash pattern distinguishes it from a route for readers
                who cannot rely on hue. */}
            <circle cx={centre[0]} cy={centre[1]} r={r} fill={colour} fillOpacity={0.09} />
            <circle
              cx={centre[0]}
              cy={centre[1]}
              r={r}
              fill="none"
              stroke={colour}
              strokeWidth={1.2}
              strokeDasharray="3 5"
              opacity={0.75}
            >
              <title>{`${point.label} — ${band.label} weather risk ${Math.round(sim.weather.riskIndex)}`}</title>
            </circle>
          </g>
        );
      })}
    </g>
  );
}
