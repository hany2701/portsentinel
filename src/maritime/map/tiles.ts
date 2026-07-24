import type { GeoProjection } from "d3-geo";

// GR-8: which raster tiles cover the current viewport, computed from the SAME
// geoMercator projection the SVG overlays use — so imagery and overlays share
// one coordinate frame and can never drift apart. No d3-tile dependency: a
// geoMercator IS Web Mercator, so the tile grid is a direct function of the
// projection's scale and the pixel of the world's top-left corner.

/** The Mercator latitude limit (±85.0511°), where the projection's world square ends. */
const MERCATOR_MAX_LAT = 85.05112877980659;
const TILE_PX = 256;

export type Tile = {
  x: number; // wrapped tile column (0 .. 2^z-1)
  y: number; // tile row (0 .. 2^z-1)
  z: number;
  left: number; // screen px of the tile's left edge
  top: number; // screen px of the tile's top edge
  size: number; // screen px width/height (with a hairline overlap to hide seams)
  key: string;
};

export type TileView = { z: number; tiles: Tile[] };

/**
 * Tiles covering a `width`×`height` viewport under `projection`, capped at
 * `maxZoom`. Returns an empty set for a degenerate projection rather than
 * throwing, so a bad transform can never break the render.
 */
export function tilesInView(
  projection: GeoProjection,
  width: number,
  height: number,
  maxZoom: number,
): TileView {
  const scale = projection.scale();
  const worldPx = 2 * Math.PI * scale; // full-world pixel width at this scale
  if (!Number.isFinite(worldPx) || worldPx <= 0 || width <= 0 || height <= 0) {
    return { z: 0, tiles: [] };
  }

  // Integer zoom whose 256-px tiles best match the current world size.
  const z = Math.max(0, Math.min(maxZoom, Math.round(Math.log2(worldPx / TILE_PX))));
  const n = 2 ** z; // tiles per axis
  const k = worldPx / n; // one tile's on-screen size

  // MapShell rotates the projection LONGITUDINALLY to centre the map, which is
  // what lets the operating network cross the antimeridian and reach Los
  // Angeles. That rules out reading the world's left edge straight off
  // `projection([-180, 0])`: under rotation that longitude wraps to an arbitrary
  // interior point, and the tile grid would silently show the wrong part of the
  // Earth beneath the routes and vessels.
  //
  // Instead, measure from a longitude the rotation is guaranteed NOT to wrap —
  // the one it centres on — and slide back to real lon −180°, where XYZ column 0
  // begins. For an unrotated projection that reference is lon 0 and this reduces
  // to the original behaviour, so a projection steered by `.center()` alone is
  // unaffected. A longitude-only rotation leaves latitude untouched, so y still
  // comes straight from the projection.
  const refLon = -projection.rotate()[0];
  const pRef = projection([refLon, 0]);
  const p0y = projection([0, MERCATOR_MAX_LAT]);
  if (!pRef || !p0y || !Number.isFinite(pRef[0]) || !Number.isFinite(p0y[1])) {
    return { z, tiles: [] };
  }
  const originX = pRef[0] - ((refLon + 180) / 360) * worldPx;
  const originY = p0y[1];

  const xMin = Math.floor((0 - originX) / k);
  const xMax = Math.floor((width - originX) / k);
  const yMin = Math.max(0, Math.floor((0 - originY) / k));
  const yMax = Math.min(n - 1, Math.floor((height - originY) / k));

  const tiles: Tile[] = [];
  for (let x = xMin; x <= xMax; x++) {
    const col = ((x % n) + n) % n; // wrap longitude so a global view has no gap
    for (let y = yMin; y <= yMax; y++) {
      tiles.push({
        x: col,
        y,
        z,
        left: originX + x * k,
        top: originY + y * k,
        size: k + 0.5, // overlap by half a pixel to hide anti-aliased seams
        key: `${z}/${col}/${y}@${x}`, // untiled x keeps wrapped copies unique
      });
    }
  }
  return { z, tiles };
}
