# Geographic reference data — provenance record

Every coordinate the maritime layer ships is `static_reference` provenance. This
file is the mandated record for each bundled dataset (GR-1). Coordinates are
never derived from port names or roster rotation strings alone — the roster
decides *which* ports exist, published positions decide *where* they are.

**Coordinate reference assumptions (all datasets):** WGS84 geographic
coordinates, decimal degrees, longitude first in TopoJSON/d3-geo order
(`[lon, lat]`), latitude positive north, longitude positive east. No projection
is baked into the data; projection happens at render time (`geoMercator`).

---

## 1. Port hub coordinates — `src/maritime/ports.ts`

| Field | Value |
|---|---|
| Dataset name | PortSentinel port-hub reference set |
| Version | 1.0.0 |
| Original source | Published port positions from the NGA *World Port Index* (Pub. 150) and the port authorities' own published terminal locations |
| Licence / attribution | World Port Index is a US Government work in the public domain; no attribution required, credited here for traceability |
| Bundled path | `src/maritime/ports.ts` (typed TS module) |
| Capture date | 2026-07-21 |
| Coordinate source | Each hub's approximate harbour-entrance position, rounded to 2 decimal places (~1.1 km) — the map's zoom range never resolves finer, and rounding keeps the values obviously conceptual rather than navigational |
| Manual corrections | `PORT-TUAS` uses the Tuas Port terminal position (1.24 N, 103.62 E) rather than the generic "Singapore" harbour centroid, so it agrees with `WEATHER_POINTS.tuas` in `src/sim/config.ts` |

Which ports exist is fixed by the nine service rotations in `src/sim/roster.ts`
(`rotationNote`). `PORT-PTP` and `PORT-KLANG` deliberately reuse the ids of the
existing `AlternatePort` entries in `src/sim/worldGen.ts` so a divert target and
a map hub are one entity, never two.

## 2. Route waypoints — `src/maritime/network.ts`

| Field | Value |
|---|---|
| Dataset name | PortSentinel corridor waypoint set |
| Version | 1.0.0 |
| Original source | Hand-placed by inspection of published shipping-lane geography (straits, canal approaches, ocean crossings) |
| Licence / attribution | Original to this project |
| Bundled path | `src/maritime/network.ts` |
| Capture date | 2026-07-21 |
| Coordinate source | Each waypoint sits in open water on the conventional lane for its corridor; the rationale for each is a comment on its definition |
| Manual corrections | None |

These are **conceptual routing waypoints for a decision-support prototype, not
navigational waypoints**. Edge distances are computed at module load with
`d3-geo`'s `geoDistance` × 3440.065 nm (mean Earth radius), i.e. great-circle
distance — they ignore traffic separation schemes, depth and weather routing.

## 3. Land basemap — `world-atlas/land-110m.json`, `land-50m.json`, `land-10m.json`

| Field | Value |
|---|---|
| Dataset name | Natural Earth land polygons, 1:110m, 1:50m and 1:10m physical scales |
| Version | `world-atlas` 2.0.2 (pinned in `package.json`) |
| Original source | naturalearthdata.com, redistributed as pre-built TopoJSON by the `world-atlas` package |
| Licence / attribution | Natural Earth is in the public domain — no permission or attribution required. `world-atlas` itself is ISC-licensed (see `node_modules/world-atlas/LICENSE`). Credited here by choice, for traceability. |
| Bundled path | Imported directly from the `world-atlas` package rather than copied into the repo, so there is one copy and `package.json` pins its version. Vite inlines it at build time. |
| Capture / extraction date | 2026-07-21 (package install) |
| Coordinate source | Dataset as published, unmodified (WGS84 lon/lat, `[lon, lat]` order) |
| Manual corrections | None |

The basemap is bundled, never fetched: the demo must run with no network access
(GR-D1/GR-D2). The map draws three scales, each where it earns its bytes
(`basemapResolution` in `src/store/mapViewStore.ts`):

- **Global** (zoom < 4) → `land-110m.json` (55 KB) — ships in the initial chunk.
- **Intermediate / regional-wide** (4 ≤ zoom < 30) → `land-50m.json` (545 KB) —
  `import()`-ed on demand for the South-East Asia framing.
- **Close regional** (zoom ≥ 30, i.e. the Singapore-Strait band and the
  "Zoom to Singapore" / Tuas-approach presets) → `land-10m.json` (3.0 MB) —
  `import()`-ed on demand.

All three are static imports resolved at build time — there is no runtime
request in any path; the finer sets are code-split so the initial bundle stays
small.

**Why 10m for the Singapore band (the fix, 2026-07-21).** At 1:50m Natural
Earth draws Singapore as a **9-vertex lozenge** and omits most of the Riau
archipelago, so the Singapore Strait region read as visibly wrong once the map
was zoomed in. The 1:10m set draws **Singapore as a 40-vertex outline** as a
landmass distinct from southern Johor, and adds **Batam (61 verts), Bintan
(88 verts)** and ~18 smaller strait/southern islands that are absent at 50m —
so Singapore, Johor, Batam, Bintan, the Singapore Strait and the Malacca
approach are all recognisable. Verified against the bundled data directly.

**Honest resolution limit.** Natural Earth 10m is a generalised global coastline
(~1 km); it does **not** resolve Jurong Island as a separate island or the Tuas
reclamation edge — that terminal-scale fidelity lives in the D-62 Tuas twin, not
this basemap. Sub-terminal Singapore detail would require an OSM-derived
coastline clipped to South-East Asia; 10m clears the "recognisable regional
geography" bar without it, so that heavier dataset is not bundled.
