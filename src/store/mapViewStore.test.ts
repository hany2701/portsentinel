import { beforeEach, describe, expect, it } from "vitest";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  TUAS_CENTER,
  mapMode,
  nearTuas,
  useMapViewStore,
} from "./mapViewStore";
import { useSimStore } from "./simStore";

describe("map view store (GR-4)", () => {
  beforeEach(() => {
    useMapViewStore.getState().reset();
  });

  it("starts at the world view", () => {
    expect(mapMode(useMapViewStore.getState().zoom)).toBe("global");
  });

  it("keeps global and regional on one continuum, not separate pages", () => {
    // The mode is derived from zoom — there is no page switch between them.
    expect(mapMode(1)).toBe("global");
    expect(mapMode(3.9)).toBe("global");
    expect(mapMode(4)).toBe("regional");
    expect(mapMode(8)).toBe("regional");
  });

  it("clamps zoom to the usable range", () => {
    const { zoomBy } = useMapViewStore.getState();
    for (let i = 0; i < 40; i++) zoomBy(2);
    expect(useMapViewStore.getState().zoom).toBe(MAX_ZOOM);
    for (let i = 0; i < 40; i++) zoomBy(0.5);
    expect(useMapViewStore.getState().zoom).toBe(MIN_ZOOM);
  });

  it("clamps latitude away from the Mercator singularity and wraps longitude", () => {
    const { setViewport } = useMapViewStore.getState();
    setViewport([0, 89], 1);
    expect(useMapViewStore.getState().center[1]).toBe(75);
    setViewport([0, -89], 1);
    expect(useMapViewStore.getState().center[1]).toBe(-75);
    setViewport([200, 0], 1);
    expect(useMapViewStore.getState().center[0]).toBe(-160);
  });

  it("offers the Tuas handoff only when zoomed in on Singapore", () => {
    expect(nearTuas(TUAS_CENTER, 7.5)).toBe(true);
    expect(nearTuas(TUAS_CENTER, 3)).toBe(false); // zoomed out
    expect(nearTuas([0, 0], 8)).toBe(false); // zoomed in elsewhere
  });

  it("flies to Singapore at a zoom that reaches the handoff threshold", () => {
    const { flyTo } = useMapViewStore.getState();
    flyTo(TUAS_CENTER, 7.5);
    const { center, zoom } = useMapViewStore.getState();
    expect(mapMode(zoom)).toBe("regional");
    expect(nearTuas(center, zoom)).toBe(true);
  });

  it("toggles layers independently", () => {
    const { toggleLayer } = useMapViewStore.getState();
    expect(useMapViewStore.getState().layers.weather).toBe(true);
    toggleLayer("weather");
    expect(useMapViewStore.getState().layers.weather).toBe(false);
    expect(useMapViewStore.getState().layers.corridors).toBe(true);
  });

  // MDS-6 (D-97a): "selection survives mode switches" — selection lives in
  // simStore, not here, so no mapViewStore action should ever touch it.
  it("never touches simStore's selection", () => {
    useSimStore.getState().select({ entityType: "vessel", entityId: "V-101" });
    const { setViewport, panBy, zoomBy, flyTo, toggleLayer, setHovered, reset } =
      useMapViewStore.getState();
    setViewport([90, 5], 6);
    panBy(1, 1);
    zoomBy(1.5);
    flyTo(TUAS_CENTER, 7.5);
    toggleLayer("labels");
    setHovered("V-999");
    reset();
    expect(useSimStore.getState().selection).toEqual({ entityType: "vessel", entityId: "V-101" });
  });

  // MDS-6 (D-97a): "viewport survives mode switches" — crossing the
  // global/regional zoom threshold during ordinary pan/zoom is not a page
  // change; only zoom itself should move, not the other viewport fields.
  it("leaves layers and hoveredId untouched by a passive mode-threshold crossing", () => {
    const { toggleLayer, setHovered, setViewport } = useMapViewStore.getState();
    toggleLayer("trails"); // now false
    setHovered("V-42");
    setViewport([105, 3], 1); // global
    expect(mapMode(useMapViewStore.getState().zoom)).toBe("global");
    setViewport([105, 3], 5); // crosses into regional via ordinary zoom, not a button
    const s = useMapViewStore.getState();
    expect(mapMode(s.zoom)).toBe("regional");
    expect(s.layers.trails).toBe(false);
    expect(s.hoveredId).toBe("V-42");
    expect(s.center).toEqual([105, 3]);
  });
});
