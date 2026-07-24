import { create } from "zustand";

// GR-4: Maritime Network view-shell UI state (viewport, layers). Lives in a
// store rather than component state so the viewport survives a Digital Twin
// round-trip — the same reasoning as opsStore. Deliberately NOT persisted and
// never touches sim state, so determinism is unaffected.

export type MapMode = "global" | "regional";

export type MapLayers = {
  corridors: boolean;
  weather: boolean;
  labels: boolean;
  trails: boolean;
};

// Zoom is a continuous scale exponent shared by the global and regional views —
// one projection, one continuum, no page switch between them (GR-D4).
export const MIN_ZOOM = 0.6;
/**
 * Zoom is a multiplier on BASE_SCALE (90), so the world spans 2π·90·zoom pixels.
 *
 * The old ceiling of 9 put the entire world in ~5,000 px — barely country
 * level, which meant "Zoom to Singapore" immediately hit the cap and the zoom-in
 * button disabled itself before the strait was ever legible. At 800 the world is
 * ~450,000 px, so a viewport shows roughly a degree of longitude: the Singapore
 * Strait, the Tuas approach and the anchorage all read clearly.
 */
export const MAX_ZOOM = 800;
const REGIONAL_ZOOM = 4;
const TUAS_HANDOFF_ZOOM = 7;

/**
 * The zoom at which the basemap upgrades to the finest (10m) land geometry.
 *
 * Below this the map still frames wide areas where Singapore is sub-pixel and
 * 50m is indistinguishable; at ~30 the viewport is roughly 20° wide, so the
 * Singapore Strait, southern Johor, Batam and Bintan all resolve and the coarse
 * 50m coastline (Singapore = a 9-vertex lozenge, most Riau islands absent)
 * becomes visibly wrong. See `basemapResolution` and BasemapLayer.
 */
const REGIONAL_DETAIL_ZOOM = 30;

// The Singapore Strait, where the regional story converges.
export const TUAS_CENTER: [number, number] = [103.7, 1.25];

// GR-5A: the "global" view frames the OPERATING NETWORK, not the whole globe.
// The box is the network's own extent (padded), and the projection is fitted to
// it, so the first frame lands on the shipping that matters rather than wasting
// the viewport on the poles — Antarctica alone dominated the old framing.
//
// `east` runs PAST the antimeridian and is deliberately not wrapped into
// [-180, 180]: the transpacific lanes (COR-TP3 and the Hong Kong–Los Angeles
// COR-TPX) terminate at Los Angeles on -118.26°, which is 241.74° east of
// Greenwich. The old ceiling of 142 stopped at Japan, so the Pacific crossing
// and both American ports fell outside the opening frame entirely. MapShell
// rotates the projection to NETWORK_CENTER before fitting, which puts this whole
// span on one side of the projection's own antimeridian.
export const NETWORK_BOUNDS: { west: number; east: number; south: number; north: number } = {
  west: -14, // Atlantic approaches to the English Channel and Iberia
  east: 258, // past Los Angeles / Long Beach (-118.26° + 360° = 241.74°), with
  // enough margin that the American port labels clear the right edge of the frame
  south: -38, // south of Australia's shipping approaches
  north: 62, // northern Europe
};

/**
 * The approximate zoom the fitted frame resolves to on a typical viewport.
 * Layers style against this while `fitted` is true, since the store's own zoom
 * is still at its default until the user takes manual control.
 */
export const FITTED_ZOOM = 1.4;

/**
 * The Regional scope: South-East Asia framed on the Malacca–Singapore axis,
 * wide enough to hold the strait, the Tuas approach and the surrounding
 * corridors. Used by the Overview⇄Regional toggle, which moves the CAMERA only —
 * mode is derived from zoom, so there is no separate mode state to drift.
 *
 * Zoom is a multiplier on BASE_SCALE (90), so a viewport shows
 * `width / (90 · zoom)` radians of longitude. The old 4.6 therefore spanned
 * ~190° on a typical map pane — half the planet, with the Malacca Strait a
 * thumbnail-sized sliver. At 22 the frame is ~25° wide: the strait runs corner
 * to corner, Singapore and the Tuas approach are legible, and Bangkok, Ho Chi
 * Minh City and Jakarta still anchor the edges.
 */
export const REGIONAL_CENTER: [number, number] = [102, 3];
export const REGIONAL_VIEW_ZOOM = 22;

/**
 * The "Zoom to Singapore" preset. Sized so the Singapore Strait, the Tuas
 * approach chain and the offshore anchorage all sit in one frame — the scale the
 * drill-down story actually needs, rather than the old 7.5 which stopped at
 * country level.
 */
export const TUAS_VIEW_ZOOM = 300;

export const NETWORK_CENTER: [number, number] = [
  (NETWORK_BOUNDS.west + NETWORK_BOUNDS.east) / 2,
  (NETWORK_BOUNDS.south + NETWORK_BOUNDS.north) / 2,
];

type MapViewStore = {
  center: [number, number]; // [lon, lat]
  zoom: number;
  /**
   * null = "frame the network": the projection fits NETWORK_BOUNDS to the
   * viewport, so the opening frame is correct at any window size. Any pan or
   * zoom sets an explicit zoom and takes over from the fit.
   */
  fitted: boolean;
  layers: MapLayers;
  hoveredId: string | null;
  setViewport: (center: [number, number], zoom: number) => void;
  panBy: (dLon: number, dLat: number) => void;
  zoomBy: (factor: number) => void;
  flyTo: (center: [number, number], zoom: number) => void;
  toggleLayer: (layer: keyof MapLayers) => void;
  setHovered: (id: string | null) => void;
  reset: () => void;
};

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
const clampCenter = ([lon, lat]: [number, number]): [number, number] => [
  ((((lon + 180) % 360) + 360) % 360) - 180,
  // Mercator diverges at the poles; clamp well inside them.
  Math.min(75, Math.max(-75, lat)),
];

export const useMapViewStore = create<MapViewStore>((set) => ({
  center: NETWORK_CENTER,
  zoom: 1,
  fitted: true,
  layers: { corridors: true, weather: true, labels: true, trails: true },
  hoveredId: null,
  setViewport: (center, zoom) =>
    set({ center: clampCenter(center), zoom: clampZoom(zoom), fitted: false }),
  panBy: (dLon, dLat) =>
    set((s) => ({ center: clampCenter([s.center[0] + dLon, s.center[1] + dLat]), fitted: false })),
  zoomBy: (factor) => set((s) => ({ zoom: clampZoom(s.zoom * factor), fitted: false })),
  flyTo: (center, zoom) => set({ center: clampCenter(center), zoom: clampZoom(zoom), fitted: false }),
  toggleLayer: (layer) => set((s) => ({ layers: { ...s.layers, [layer]: !s.layers[layer] } })),
  setHovered: (hoveredId) => set({ hoveredId }),
  reset: () => set({ center: NETWORK_CENTER, zoom: 1, fitted: true }),
}));

/** Which end of the continuum the map is currently showing. */
export function mapMode(zoom: number): MapMode {
  return zoom < REGIONAL_ZOOM ? "global" : "regional";
}

/** The three land-geometry scales, coarsest → finest (Natural Earth). */
export type BasemapResolution = "110m" | "50m" | "10m";

/**
 * Which bundled Natural Earth land scale the basemap should draw at this zoom.
 *
 * A finer band than {@link mapMode}: global keeps the tiny 110m set, the
 * intermediate regional band keeps 50m, and only the close Singapore-Strait band
 * loads the 10m set (3 MB, lazy) — where Singapore's real outline and the Riau
 * islands actually matter. Deliberately independent of `mapMode` so labels,
 * KPIs and the view title (which key off the two-value mode) are untouched.
 */
export function basemapResolution(zoom: number): BasemapResolution {
  if (zoom < REGIONAL_ZOOM) return "110m";
  if (zoom < REGIONAL_DETAIL_ZOOM) return "50m";
  return "10m";
}

/** True when the map is zoomed far enough in on Singapore to offer the twin. */
export function nearTuas(center: [number, number], zoom: number): boolean {
  if (zoom < TUAS_HANDOFF_ZOOM) return false;
  return Math.abs(center[0] - TUAS_CENTER[0]) < 4 && Math.abs(center[1] - TUAS_CENTER[1]) < 4;
}
