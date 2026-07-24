import { useEffect, useMemo, useState } from "react";
import { geoGraticule, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import land110 from "world-atlas/land-110m.json";
import type { Topology } from "topojson-specification";
import type { FeatureCollection, Geometry } from "geojson";
import { useProjection } from "./MapShell";
import { basemapResolution, type BasemapResolution } from "../../store/mapViewStore";

// GR-4: land from bundled Natural Earth TopoJSON — no tile server, no runtime
// fetch, so the demo works with no network at all (GR-D1/GR-D2). Three scales,
// each drawn where it earns its bytes (see `basemapResolution`): the 110m set
// ships in the initial chunk; the finer 50m and 10m sets are imported on demand
// as the map zooms into South-East Asia and then onto the Singapore Strait,
// where the real Singapore/Riau coastline matters (50m draws Singapore as a
// 9-vertex lozenge with most Riau islands missing; 10m gives Singapore a
// 40-vertex outline plus Batam, Bintan and the strait islands).

// The world-atlas JSON ships without types; its shape is fixed (one "land"
// GeometryCollection), so it is asserted once here rather than at each use.
function toFeatures(topology: unknown): FeatureCollection<Geometry> {
  const topo = topology as Topology;
  return feature(topo, topo.objects.land) as unknown as FeatureCollection<Geometry>;
}

const LAND_110 = toFeatures(land110);

const RESOLUTION_RANK: Record<BasemapResolution, number> = { "110m": 0, "50m": 1, "10m": 2 };

/** Clamp the wanted resolution so it is never finer than `cap`. */
function capResolution(want: BasemapResolution, cap: BasemapResolution): BasemapResolution {
  return RESOLUTION_RANK[want] <= RESOLUTION_RANK[cap] ? want : cap;
}

/** The finest land set the zoom wants that has actually finished loading. */
function pickLand(
  resolution: BasemapResolution,
  land50: FeatureCollection<Geometry> | null,
  land10: FeatureCollection<Geometry> | null,
): FeatureCollection<Geometry> {
  if (resolution === "10m" && land10) return land10;
  if (resolution !== "110m" && land50) return land50;
  return LAND_110;
}

// GR-8: `maxResolution` caps the detail so the vector basemap can serve as a
// cheap, always-present backdrop underneath the satellite tiles (which cover it
// when imagery is healthy) without loading the heavy 10m set for nothing. Omit
// it and the layer behaves exactly as before — the full 110m/50m/10m fallback.
export function BasemapLayer({
  zoom,
  maxResolution,
}: {
  zoom: number;
  maxResolution?: BasemapResolution;
}) {
  const projection = useProjection();
  const [land50, setLand50] = useState<FeatureCollection<Geometry> | null>(null);
  const [land10, setLand10] = useState<FeatureCollection<Geometry> | null>(null);
  const resolution = maxResolution
    ? capResolution(basemapResolution(zoom), maxResolution)
    : basemapResolution(zoom);

  // Load the finer sets on demand, once, when the zoom first calls for them. The
  // 110m basemap is already on screen, so a slow/failed import only forgoes
  // detail — it never blanks the map (GR-D1/GR-D2).
  useEffect(() => {
    if (resolution === "110m" || land50) return;
    let cancelled = false;
    import("world-atlas/land-50m.json")
      .then((mod) => !cancelled && setLand50(toFeatures(mod.default)))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [resolution, land50]);

  useEffect(() => {
    if (resolution !== "10m" || land10) return;
    let cancelled = false;
    import("world-atlas/land-10m.json")
      .then((mod) => !cancelled && setLand10(toFeatures(mod.default)))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [resolution, land10]);

  const path = useMemo(() => geoPath(projection), [projection]);
  // Draw the finest set the zoom wants AND that has finished loading; fall back
  // coarser while a finer set is still importing, so detail only ever sharpens.
  const land = pickLand(resolution, land50, land10);

  // GR-5A: the graticule sits UNDER the land and is nearly invisible — it exists
  // to hint at orientation, not to look like graph paper. Minor lines are drawn
  // only at global zoom (where they help read longitude across an ocean); the
  // major 30° lines carry the regional view on their own.
  const minorGraticule = useMemo(() => path(geoGraticule().step([15, 15])()), [path]);
  const majorGraticule = useMemo(() => path(geoGraticule().step([30, 30])()), [path]);
  const showMinor = resolution === "110m";

  return (
    <g aria-hidden="true">
      {showMinor && (
        <path d={minorGraticule ?? undefined} fill="none" stroke="#1b3a5c" strokeWidth={0.3} opacity={0.16} />
      )}
      <path d={majorGraticule ?? undefined} fill="none" stroke="#22456b" strokeWidth={0.4} opacity={0.28} />
      {/* Land above the grid: no grid lines cross the continents. */}
      <path d={path(land) ?? undefined} fill="#16283a" stroke="#2f5476" strokeWidth={0.6} />
    </g>
  );
}
