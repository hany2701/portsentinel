import { describe, expect, it } from "vitest";
import { resolveTileSource } from "./tileSource";

// GR-8: the provider resolver is pure (env injected), so every provider and
// every missing-key fallback path is covered without a network or import.meta.

describe("resolveTileSource (GR-8)", () => {
  it("defaults to keyless Esri World Imagery, available and correctly templated", () => {
    const s = resolveTileSource({});
    expect(s.id).toBe("esri");
    expect(s.available).toBe(true);
    expect(s.attribution).toMatch(/Esri/);
    // Esri uses {z}/{y}/{x} order — a swapped x/y would misplace every tile.
    expect(s.tileUrl(3, 7, 5)).toBe(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/5/7/3",
    );
  });

  it("disables imagery for provider 'none' (pure offline demo)", () => {
    const s = resolveTileSource({ VITE_SATELLITE_PROVIDER: "none" });
    expect(s.available).toBe(false);
    expect(s.unavailableReason).toBe("disabled");
  });

  it("falls back when a keyed provider has no key (missing-key)", () => {
    const s = resolveTileSource({ VITE_SATELLITE_PROVIDER: "maptiler" });
    expect(s.available).toBe(false);
    expect(s.unavailableReason).toBe("missing-key");
  });

  it("uses MapTiler with a key and embeds it in the tile URL", () => {
    const s = resolveTileSource({ VITE_SATELLITE_PROVIDER: "maptiler", VITE_MAPTILER_KEY: "K123" });
    expect(s.available).toBe(true);
    expect(s.tileUrl(1, 2, 3)).toContain("key=K123");
    expect(s.tileUrl(1, 2, 3)).toContain("/3/1/2.jpg");
  });

  it("uses Mapbox with a token", () => {
    const s = resolveTileSource({ VITE_SATELLITE_PROVIDER: "mapbox", VITE_MAPBOX_TOKEN: "T9" });
    expect(s.available).toBe(true);
    expect(s.tileUrl(1, 2, 3)).toContain("access_token=T9");
  });

  it("honours a custom XYZ template + attribution", () => {
    const s = resolveTileSource({
      VITE_SATELLITE_PROVIDER: "custom",
      VITE_SATELLITE_TILE_URL: "https://tiles.example/{z}/{x}/{y}.png",
      VITE_SATELLITE_ATTRIBUTION: "© Example",
    });
    expect(s.available).toBe(true);
    expect(s.tileUrl(4, 5, 6)).toBe("https://tiles.example/6/4/5.png");
    expect(s.attribution).toBe("© Example");
  });

  it("falls back when 'custom' is selected without a URL (missing-url)", () => {
    const s = resolveTileSource({ VITE_SATELLITE_PROVIDER: "custom" });
    expect(s.available).toBe(false);
    expect(s.unavailableReason).toBe("missing-url");
  });

  it("every available source carries a non-empty attribution string", () => {
    for (const env of [
      {},
      { VITE_SATELLITE_PROVIDER: "maptiler", VITE_MAPTILER_KEY: "K" },
      { VITE_SATELLITE_PROVIDER: "mapbox", VITE_MAPBOX_TOKEN: "T" },
    ]) {
      const s = resolveTileSource(env);
      expect(s.available).toBe(true);
      expect(s.attribution.length).toBeGreaterThan(0);
    }
  });
});
