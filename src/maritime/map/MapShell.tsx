import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { geoMercator, type GeoProjection } from "d3-geo";
import type { ReactNode } from "react";
import { MAX_ZOOM, MIN_ZOOM, NETWORK_BOUNDS, NETWORK_CENTER, useMapViewStore } from "../../store/mapViewStore";
import { Tooltip } from "../../components/Tooltip";

// GR-4: the shared map viewport. ONE projection carries the whole global⇄regional
// continuum (GR-D4) — zooming is a scale change, not a page switch, so the
// selected vessel and every layer stay put across the transition.

const ProjectionContext = createContext<GeoProjection | null>(null);

export function useProjection(): GeoProjection {
  const projection = useContext(ProjectionContext);
  if (!projection) throw new Error("useProjection must be used inside <MapShell>");
  return projection;
}

// GR-8: the viewport pixel size, exposed alongside the projection so the
// satellite tile layer can compute which tiles cover the screen. Separate
// context so `useProjection`'s signature (used everywhere) is untouched.
const SizeContext = createContext<{ width: number; height: number }>({ width: 0, height: 0 });

export function useViewportSize(): { width: number; height: number } {
  return useContext(SizeContext);
}

/** Project a [lon, lat] pair, returning null when it falls off the projection. */
export function useProject(): (lon: number, lat: number) => [number, number] | null {
  const projection = useProjection();
  return (lon, lat) => {
    const point = projection([lon, lat]);
    return point && Number.isFinite(point[0]) && Number.isFinite(point[1]) ? point : null;
  };
}

// GR-5A: the network bounding box as a GeoJSON polygon, so d3 can fit the
// projection to it. Sampled along each edge because a Mercator-projected
// rectangle is not a screen-space rectangle.
const NETWORK_EXTENT: GeoJSON.Polygon = {
  type: "Polygon",
  coordinates: [
    (() => {
      const { west, east, south, north } = NETWORK_BOUNDS;
      const ring: [number, number][] = [];
      const step = (east - west) / 16;
      for (let lon = west; lon <= east; lon += step) ring.push([lon, north]);
      for (let lon = east; lon >= west; lon -= step) ring.push([lon, south]);
      ring.push([west, north]);
      return ring;
    })(),
  ],
};

// Scale that makes the whole world span the viewport width, used as the unit
// for the zoom multiplier once the user takes manual control.
const BASE_SCALE = 90;

// Per-click zoom factor. The range now spans MIN_ZOOM 0.6 to MAX_ZOOM 800, so a
// 1.3× step would need ~27 clicks to cross it; 1.7 crosses it in ~14 while still
// feeling like a step rather than a jump.
const ZOOM_STEP = 1.7;

/**
 * A fixed frame for a map that is NOT the interactive one.
 *
 * Passing `viewport` pins the shell to that centre/zoom and turns off panning,
 * wheel-zoom and the arrow keys, so an embedded summary map always shows the
 * scope it is meant to show instead of mirroring wherever the user last left
 * the Maritime Network tab. Entity selection still works — that comes from the
 * SVG layers, not from these handlers.
 */
export type FixedViewport = { center: [number, number]; zoom: number };

export function MapShell({ children, viewport }: { children: ReactNode; viewport?: FixedViewport }) {
  const store = useMapViewStore();
  const interactive = !viewport;
  const center = viewport ? viewport.center : store.center;
  const zoom = viewport ? viewport.zoom : store.zoom;
  const fitted = viewport ? false : store.fitted;
  const { setViewport, zoomBy } = store;
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 960, height: 540 });
  // A press only becomes a pan once it travels past this many pixels; below it
  // the gesture is a click and must reach the vessel/port markers underneath.
  const DRAG_THRESHOLD_PX = 4;
  const drag = useRef<{
    x: number;
    y: number;
    center: [number, number];
    pointerId: number;
    panning: boolean;
  } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // While `fitted`, the projection is FITTED to the operating network so the
  // opening frame is right at any window size and no viewport is wasted on the
  // poles. The first pan or zoom switches to explicit centre/scale control.
  //
  // Both branches steer with `.rotate([-lon, 0]).center([0, lat])` rather than
  // `.center([lon, lat])`. The two are identical for the centre point itself,
  // but the rotation also re-wraps every OTHER longitude around that centre.
  // With a plain centre, d3 wraps into [-180, 180] about Greenwich, so once the
  // network reached Los Angeles the transpacific leg tried to draw from +145°
  // to -118° — 263° the wrong way round the globe, straight off the left edge —
  // instead of the 97° hop east across the Pacific. Rotating first makes the
  // dateline crossing continuous, which is what lets the Hong Kong–LA corridor
  // appear at all. Rotation is set BEFORE scale/translate/center because
  // geoMercator recomputes its clip extent from the rotation on those calls.
  const projection = useMemo(() => {
    const p = geoMercator();
    if (fitted) {
      const padding = 12;
      p.rotate([-NETWORK_CENTER[0], 0]).fitExtent(
        [
          [padding, padding],
          [Math.max(padding + 1, size.width - padding), Math.max(padding + 1, size.height - padding)],
        ],
        NETWORK_EXTENT,
      );
    } else {
      p.rotate([-center[0], 0])
        .center([0, center[1]])
        .scale(BASE_SCALE * zoom)
        .translate([size.width / 2, size.height / 2]);
    }
    return p;
  }, [center, zoom, fitted, size.width, size.height]);

  // Effective scale drives drag sensitivity, so a drag moves the map by exactly
  // the distance under the cursor in both fitted and manual modes.
  const degreesPerPixel = 360 / (2 * Math.PI * projection.scale());
  // The fitted projection's own centre and zoom, so handing over to manual
  // control is seamless.
  const currentCenter = useMemo<[number, number]>(() => {
    if (!fitted) return center;
    const inverted = projection.invert?.([size.width / 2, size.height / 2]);
    return inverted && Number.isFinite(inverted[0]) ? [inverted[0], inverted[1]] : center;
  }, [fitted, center, projection, size.width, size.height]);
  const currentZoom = fitted ? projection.scale() / BASE_SCALE : zoom;

  // The wheel handler is attached natively and NON-PASSIVE so it can call
  // preventDefault(). React registers wheel listeners at the root as passive, so
  // preventDefault() inside an onWheel prop is silently ignored — which is why a
  // trackpad pinch over the map zoomed the map AND the whole browser page at
  // once (a pinch arrives as a wheel event with ctrlKey set), and why a
  // two-finger scroll zoomed the map while also scrolling the dashboard behind
  // it. Consuming the event here keeps the gesture on the map alone.
  const live = useRef({ fitted, currentCenter, currentZoom, setViewport, zoomBy, interactive });
  live.current = { fitted, currentCenter, currentZoom, setViewport, zoomBy, interactive };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const s = live.current;
      if (!s.interactive) return;
      e.preventDefault();
      // From the fitted frame, adopt its scale first so the wheel does not snap
      // back to zoom 1.
      if (s.fitted) s.setViewport(s.currentCenter, s.currentZoom);
      s.zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <div
      ref={ref}
      // `touch-none` stops the browser claiming pinch/pan gestures over the map
      // before the handlers above see them.
      className={`relative h-full w-full touch-none overflow-hidden rounded-lg bg-[#0b1a2b] dark:bg-[#08131f] ${
        interactive ? "cursor-grab active:cursor-grabbing" : ""
      }`}
      onPointerDown={
        interactive
          ? (e) => {
              // Record the press but do NOT capture the pointer yet. Capturing on
              // pointerdown retargets the browser-synthesised `click` to this
              // container (which has no click handler) instead of the vessel/port
              // marker under the cursor, so selecting a vessel silently did
              // nothing — most visibly while a scenario was running and the map
              // was the thing you were trying to click. Capture is deferred to
              // the first real drag movement below.
              drag.current = {
                x: e.clientX,
                y: e.clientY,
                center: currentCenter,
                pointerId: e.pointerId,
                panning: false,
              };
            }
          : undefined
      }
      onPointerMove={
        interactive
          ? (e) => {
              const d = drag.current;
              if (!d) return;
              if (!d.panning) {
                // Below the threshold this is still a click in progress; leave the
                // markers to receive it.
                if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_THRESHOLD_PX) return;
                // A genuine drag: take over panning now, and capture the pointer so
                // it keeps tracking outside the element. Past this distance the
                // browser abandons the click, so markers are unaffected. Starting
                // from the fitted frame hands control over at the equivalent
                // centre/scale, so the map does not jump under the cursor.
                d.panning = true;
                e.currentTarget.setPointerCapture(e.pointerId);
              }
              setViewport(
                [
                  d.center[0] - (e.clientX - d.x) * degreesPerPixel,
                  d.center[1] + (e.clientY - d.y) * degreesPerPixel,
                ],
                currentZoom,
              );
            }
          : undefined
      }
      onPointerUp={
        interactive
          ? (e) => {
              const d = drag.current;
              drag.current = null;
              // Only release what a real drag captured; a plain click never took
              // the capture.
              if (d?.panning && e.currentTarget.hasPointerCapture(e.pointerId)) {
                e.currentTarget.releasePointerCapture(e.pointerId);
              }
            }
          : undefined
      }
      role={interactive ? "application" : "img"}
      aria-label={
        interactive
          ? "Maritime network map. Drag to pan, scroll to zoom."
          : "Maritime network map, regional scope"
      }
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={
        !interactive
          ? undefined
          : (e) => {
              const step = 8 / currentZoom;
              const c = currentCenter;
              if (e.key === "ArrowLeft") setViewport([c[0] - step, c[1]], currentZoom);
              else if (e.key === "ArrowRight") setViewport([c[0] + step, c[1]], currentZoom);
              else if (e.key === "ArrowUp") setViewport([c[0], c[1] + step], currentZoom);
              else if (e.key === "ArrowDown") setViewport([c[0], c[1] - step], currentZoom);
              else if (e.key === "+" || e.key === "=") {
                if (fitted) setViewport(c, currentZoom);
                zoomBy(ZOOM_STEP);
              } else if (e.key === "-") {
                if (fitted) setViewport(c, currentZoom);
                zoomBy(1 / ZOOM_STEP);
              } else return;
              e.preventDefault();
            }
      }
    >
      <svg width={size.width} height={size.height} className="block touch-none select-none">
        <ProjectionContext.Provider value={projection}>
          <SizeContext.Provider value={size}>{children}</SizeContext.Provider>
        </ProjectionContext.Provider>
      </svg>
    </div>
  );
}

export function ZoomControls() {
  const { zoom, zoomBy, reset } = useMapViewStore();
  const btn =
    "flex h-7 w-7 items-center justify-center rounded border border-slate-700 bg-slate-900/80 text-sm text-slate-200 hover:bg-slate-800";
  return (
    <div className="absolute bottom-3 right-3 flex flex-col gap-1">
      <Tooltip label="Zoom in" placement="left">
        {(tip) => (
          <button {...tip} className={btn} onClick={() => zoomBy(ZOOM_STEP)} disabled={zoom >= MAX_ZOOM} aria-label="Zoom in">
            +
          </button>
        )}
      </Tooltip>
      <Tooltip label="Zoom out" placement="left">
        {(tip) => (
          <button {...tip} className={btn} onClick={() => zoomBy(1 / ZOOM_STEP)} disabled={zoom <= MIN_ZOOM} aria-label="Zoom out">
            −
          </button>
        )}
      </Tooltip>
      <Tooltip label="Reset to the Overview scope" placement="left">
        {(tip) => (
          <button {...tip} className={`${btn} text-[10px]`} onClick={reset} aria-label="Reset to overview">
            ⌂
          </button>
        )}
      </Tooltip>
    </div>
  );
}
