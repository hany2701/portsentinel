import { useMemo } from "react";
import { useProjection, useViewportSize } from "./MapShell";
import { tilesInView } from "./tiles";
import type { TileSource } from "./tileSource";

// GR-8: the satellite imagery, drawn as raster tiles UNDER every operational
// overlay. It shares the map's one projection (via context), so it re-tiles only
// when the viewport pans/zooms — never on a simulation tick — and always aligns
// with the routes and vessels painted on top of it.
//
// The imagery is held visually SUBORDINATE to the data (task brief): a colour
// filter desaturates and darkens it, and a translucent dark-ocean wash lifts the
// contrast of the routes and vessels above. The tiles are shown as published,
// only filtered for presentation — never recoloured into a different map.

const TREATMENT_ID = "sat-treatment";

export function SatelliteLayer({ source }: { source: TileSource }) {
  const projection = useProjection();
  const { width, height } = useViewportSize();

  const { tiles } = useMemo(
    () => tilesInView(projection, width, height, source.maxZoom),
    [projection, width, height, source.maxZoom],
  );

  return (
    <g aria-hidden="true" data-testid="satellite-layer">
      <defs>
        {/* Reduced saturation + reduced brightness/contrast lift, so imagery
            reads as a muted backdrop rather than a vivid Earth view. */}
        <filter id={TREATMENT_ID} colorInterpolationFilters="sRGB">
          <feColorMatrix type="saturate" values="0.55" />
          <feComponentTransfer>
            <feFuncR type="linear" slope="0.82" intercept="0.02" />
            <feFuncG type="linear" slope="0.82" intercept="0.03" />
            <feFuncB type="linear" slope="0.86" intercept="0.05" />
          </feComponentTransfer>
        </filter>
      </defs>

      <g filter={`url(#${TREATMENT_ID})`}>
        {tiles.map((t) => (
          <image
            key={t.key}
            href={source.tileUrl(t.x, t.y, t.z)}
            x={t.left}
            y={t.top}
            width={t.size}
            height={t.size}
            preserveAspectRatio="none"
            // A tile that 404s or fails to load simply hides — no broken-image
            // glyph, and the dark map background shows through the gap.
            onError={(e) => {
              (e.currentTarget as SVGImageElement).style.display = "none";
            }}
          />
        ))}
      </g>

      {/* Dark maritime wash: a subtle blue-black overlay that unifies the imagery
          into the dashboard's palette and raises overlay contrast (GR-8). */}
      <rect x={0} y={0} width={width} height={height} fill="#08131f" opacity={0.34} />
    </g>
  );
}
