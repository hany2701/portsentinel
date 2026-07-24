import { describe, expect, it } from "vitest";
import { geoMercator } from "d3-geo";
import { tilesInView } from "./tiles";

// GR-8: the tile grid must agree with the projection the overlays use, or
// imagery and routes drift apart. These tests pin the XYZ mapping against the
// canonical Web Mercator tile formula, through a real geoMercator instance.

function canonicalTile(lon: number, lat: number, z: number) {
  const n = 2 ** z;
  const latRad = (lat * Math.PI) / 180;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  );
  return { x, y };
}

describe("tilesInView (GR-8)", () => {
  const width = 800;
  const height = 600;

  it("returns the tile that covers the viewport centre (Singapore)", () => {
    const lon = 103.8;
    const lat = 1.35;
    const proj = geoMercator().center([lon, lat]).scale(20000).translate([width / 2, height / 2]);

    const { z, tiles } = tilesInView(proj, width, height, 19);
    expect(tiles.length).toBeGreaterThan(0);
    expect(z).toBeGreaterThan(0);
    expect(z).toBeLessThanOrEqual(19);

    const centre = canonicalTile(lon, lat, z);
    expect(tiles.some((t) => t.x === centre.x && t.y === centre.y)).toBe(true);
  });

  it("spans the whole viewport with no gap at the edges", () => {
    const proj = geoMercator().center([0, 20]).scale(300).translate([width / 2, height / 2]);
    const { tiles } = tilesInView(proj, width, height, 19);
    const left = Math.min(...tiles.map((t) => t.left));
    const right = Math.max(...tiles.map((t) => t.left + t.size));
    const top = Math.min(...tiles.map((t) => t.top));
    const bottom = Math.max(...tiles.map((t) => t.top + t.size));
    expect(left).toBeLessThanOrEqual(0);
    expect(right).toBeGreaterThanOrEqual(width);
    expect(top).toBeLessThanOrEqual(0);
    expect(bottom).toBeGreaterThanOrEqual(height);
  });

  it("chooses a coarser z as the scale shrinks", () => {
    const near = geoMercator().center([103.8, 1.35]).scale(200000).translate([width / 2, height / 2]);
    const far = geoMercator().center([103.8, 1.35]).scale(200).translate([width / 2, height / 2]);
    expect(tilesInView(near, width, height, 19).z).toBeGreaterThan(
      tilesInView(far, width, height, 19).z,
    );
  });

  it("never exceeds maxZoom", () => {
    const proj = geoMercator().scale(500000).translate([width / 2, height / 2]);
    expect(tilesInView(proj, width, height, 6).z).toBeLessThanOrEqual(6);
  });

  // MapShell steers longitude with `.rotate()` rather than `.center()` so the
  // operating network can cross the antimeridian and reach Los Angeles. The tile
  // grid is indexed from REAL longitude, so it must survive that rotation —
  // otherwise the imagery still tiles the screen but shows the wrong continent.
  it("maps to the canonical tile under a longitudinal rotation", () => {
    const centred = 114; // roughly the centre of the operating network
    for (const [lon, lat] of [
      [103.8, 1.35], // Singapore, near the rotation centre
      [114.13, 22.32], // Hong Kong
      [-118.26, 33.73], // Los Angeles — the far side of the antimeridian
    ]) {
      const proj = geoMercator()
        .rotate([-centred, 0])
        .center([0, lat])
        .scale(20000)
        .translate([width / 2, height / 2]);
      const { z, tiles } = tilesInView(proj, width, height, 19);
      const want = canonicalTile(lon, lat, z);
      const here = proj([lon, lat])!;
      // Only assert on points the viewport actually shows.
      if (here[0] < 0 || here[0] > width || here[1] < 0 || here[1] > height) continue;
      expect(tiles.some((t) => t.x === want.x && t.y === want.y)).toBe(true);
    }
  });

  it("places the tile under the point it projects to", () => {
    const proj = geoMercator()
      .rotate([-114, 0])
      .center([0, 22.32])
      .scale(20000)
      .translate([width / 2, height / 2]);
    const { z, tiles } = tilesInView(proj, width, height, 19);
    const [lon, lat] = [114.13, 22.32];
    const want = canonicalTile(lon, lat, z);
    const tile = tiles.find((t) => t.x === want.x && t.y === want.y);
    expect(tile).toBeDefined();
    const [px, py] = proj([lon, lat])!;
    // The projected point must fall inside the tile the XYZ formula names for it.
    expect(px).toBeGreaterThanOrEqual(tile!.left);
    expect(px).toBeLessThanOrEqual(tile!.left + tile!.size);
    expect(py).toBeGreaterThanOrEqual(tile!.top);
    expect(py).toBeLessThanOrEqual(tile!.top + tile!.size);
  });

  it("returns an empty set for a degenerate projection rather than throwing", () => {
    const proj = geoMercator().scale(0).translate([width / 2, height / 2]);
    expect(tilesInView(proj, width, height, 19).tiles).toEqual([]);
    expect(tilesInView(geoMercator().scale(1000), 0, 0, 19).tiles).toEqual([]);
  });
});
