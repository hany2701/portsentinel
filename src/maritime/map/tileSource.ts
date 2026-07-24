// GR-8: satellite basemap provider configuration.
//
// The satellite imagery is a PRESENTATION layer only (see SatelliteLayer). This
// module resolves which imagery provider to use from build-time env vars and
// hands back a plain descriptor — a URL template, attribution text and an
// availability flag. It performs no network calls and holds no React state, so
// it is pure and unit-testable.
//
// Offline / no-key posture (supersedes the strict GR-D1/GR-D2 offline default,
// owner-directed — see D-88): if the chosen provider is unavailable (turned
// off, or a keyed provider with no key), `available` is false and the caller
// falls back to the bundled vector basemap. The demo therefore still runs with
// no network — it just draws vector land instead of imagery.

export type TileProviderId = "esri" | "maptiler" | "mapbox" | "custom" | "none";

export type TileSource = {
  id: TileProviderId;
  /** Human label for the source-status indicator. */
  label: string;
  /** Attribution string the provider requires to be shown (GR-8). */
  attribution: string;
  /** Highest zoom level the provider serves. */
  maxZoom: number;
  /** Build a tile URL for XYZ coordinates. */
  tileUrl: (x: number, y: number, z: number) => string;
  /** False → the caller uses the vector basemap instead. */
  available: boolean;
  unavailableReason?: "disabled" | "missing-key" | "missing-url";
};

type Env = Record<string, string | undefined>;

const NULL_URL = () => "";

/** A disabled/unavailable source, used for the vector-only fallback path. */
function unavailable(
  id: TileProviderId,
  reason: NonNullable<TileSource["unavailableReason"]>,
  label: string,
): TileSource {
  return { id, label, attribution: "", maxZoom: 0, tileUrl: NULL_URL, available: false, unavailableReason: reason };
}

/**
 * Resolve the tile source from an env map. Kept pure (env injected) so tests can
 * exercise every provider + missing-key path without touching `import.meta`.
 *
 * `VITE_SATELLITE_PROVIDER` selects the provider (default `esri`, which needs no
 * key so the demo works out of the box). Keyed providers become `available:
 * false` with reason `missing-key` when their key env var is absent — that is
 * the required missing-key fallback.
 */
export function resolveTileSource(env: Env): TileSource {
  const provider = (env.VITE_SATELLITE_PROVIDER || "esri").toLowerCase() as TileProviderId;

  switch (provider) {
    case "none":
      return unavailable("none", "disabled", "Vector basemap");

    case "maptiler": {
      const key = env.VITE_MAPTILER_KEY;
      if (!key) return unavailable("maptiler", "missing-key", "MapTiler Satellite");
      return {
        id: "maptiler",
        label: "MapTiler Satellite",
        attribution: "© MapTiler © OpenStreetMap contributors",
        maxZoom: 20,
        tileUrl: (x, y, z) => `https://api.maptiler.com/tiles/satellite-v2/${z}/${x}/${y}.jpg?key=${key}`,
        available: true,
      };
    }

    case "mapbox": {
      const token = env.VITE_MAPBOX_TOKEN;
      if (!token) return unavailable("mapbox", "missing-key", "Mapbox Satellite");
      return {
        id: "mapbox",
        label: "Mapbox Satellite",
        attribution: "© Mapbox © Maxar",
        maxZoom: 19,
        tileUrl: (x, y, z) => `https://api.mapbox.com/v4/mapbox.satellite/${z}/${x}/${y}@2x.jpg90?access_token=${token}`,
        available: true,
      };
    }

    case "custom": {
      const url = env.VITE_SATELLITE_TILE_URL;
      if (!url) return unavailable("custom", "missing-url", "Custom imagery");
      return {
        id: "custom",
        label: "Custom imagery",
        attribution: env.VITE_SATELLITE_ATTRIBUTION || "Imagery: custom source",
        maxZoom: Number(env.VITE_SATELLITE_MAX_ZOOM) || 19,
        tileUrl: (x, y, z) =>
          url.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y)),
        available: true,
      };
    }

    case "esri":
    default:
      // Esri World Imagery: global coverage, no API key required for basic tile
      // access, standard XYZ ({z}/{y}/{x}) — the pragmatic default so the demo
      // works with no secrets and a testable offline fallback.
      return {
        id: "esri",
        label: "Esri World Imagery",
        attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
        maxZoom: 19,
        tileUrl: (x, y, z) =>
          `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
        available: true,
      };
  }
}

/**
 * The resolved tile source for this build. Computed ONCE at module load so its
 * object identity is stable — SatelliteLayer and useSatelliteHealth depend on it
 * and must not re-probe or re-render every tick.
 */
export const TILE_SOURCE: TileSource = resolveTileSource(
  import.meta.env as unknown as Env,
);
