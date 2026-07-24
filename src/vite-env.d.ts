/// <reference types="vite/client" />

// GR-8: satellite basemap provider configuration (see src/maritime/map/tileSource.ts).
interface ImportMetaEnv {
  /** "esri" (default, keyless) | "maptiler" | "mapbox" | "custom" | "none". */
  readonly VITE_SATELLITE_PROVIDER?: string;
  readonly VITE_MAPTILER_KEY?: string;
  readonly VITE_MAPBOX_TOKEN?: string;
  /** Custom XYZ template with {z}/{x}/{y} placeholders. */
  readonly VITE_SATELLITE_TILE_URL?: string;
  readonly VITE_SATELLITE_ATTRIBUTION?: string;
  readonly VITE_SATELLITE_MAX_ZOOM?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
