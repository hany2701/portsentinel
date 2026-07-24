# Satellite basemap — setup & deployment (GR-8 / D-88)

The Maritime Network map can draw a **satellite-imagery basemap** underneath the
operational overlays (corridors, routes, ports, chokepoints, vessels, weather).
The imagery is a **presentation layer only** — it never feeds the simulation, and
if it is unavailable the map falls back to the bundled Natural Earth vector
basemap with every route, vessel, control and behaviour intact.

## How it works

- One `geoMercator` projection drives both the SVG overlays and the raster
  tiles, so imagery and data share a single coordinate frame and cannot drift.
  Tiles are computed from that projection (`src/maritime/map/tiles.ts`) — no
  extra mapping SDK, no second map instance.
- On opening the Maritime Network, a single probe tile is loaded
  (`useSatelliteHealth`). Success → imagery renders; failure / offline / missing
  key → vector basemap. The result also drives the source-status line shown at
  the bottom of the map.
- Imagery is held visually subordinate: a colour filter reduces saturation and
  brightness and a dark-ocean wash lifts route/vessel contrast. Esri World
  Imagery carries **no roads, POIs or place labels**.

## Providers

Selected with `VITE_SATELLITE_PROVIDER` (see `.env.example`):

| Provider | Env vars | Key? | Notes |
|---|---|---|---|
| `esri` (default) | — | No | Esri World Imagery. Global XYZ `{z}/{y}/{x}`, works with no secret. |
| `maptiler` | `VITE_MAPTILER_KEY` | Yes | MapTiler Satellite. |
| `mapbox` | `VITE_MAPBOX_TOKEN` | Yes | Mapbox raster satellite tiles. |
| `custom` | `VITE_SATELLITE_TILE_URL` (+ `VITE_SATELLITE_ATTRIBUTION`) | — | Any licensed XYZ raster source. |
| `none` | — | — | Disables imagery — pure offline vector demo. |

Do **not** use Google Maps / Google Earth tiles outside Google's official SDK.

### Missing-key behaviour

If a keyed provider is selected without its key, the source resolves to
`available: false` and the app uses the vector basemap — the same clean fallback
as an offline failure. No blank map, no crash.

## Deployment

1. **Default (recommended for the demo):** deploy with no satellite env vars.
   Esri World Imagery loads with no secret; offline viewers get the vector map.
2. **Keyed provider:** set `VITE_SATELLITE_PROVIDER` and the provider key as a
   Vercel Environment Variable (Production/Preview). Because `VITE_`-prefixed
   vars are inlined into the client bundle at build time, the key ships to the
   browser — so you **must** restrict it:
   - MapTiler: add your deploy domain(s) under the key's *Allowed origins*.
   - Mapbox: set the token's *URL restrictions* to your deploy domain(s).
3. Rebuild/redeploy after changing any `VITE_` var (they are build-time).

## Attribution

The provider's required attribution is shown, unobstructed, at the bottom-centre
of the map whenever its imagery is active (e.g. *"Imagery © Esri, Maxar,
Earthstar Geographics"*). The same line always states that **routes and
conditions are simulated / calculated**, so the imagery is never mistaken for a
navigational chart. Keep the attribution visible if you restyle the map.

## What it does not do

- It is **not** a navigational chart and makes no depth/hazard claims.
- Esri World Imagery is generalised global imagery; terminal-scale Tuas fidelity
  remains in the D-62 digital twin, not this basemap.
