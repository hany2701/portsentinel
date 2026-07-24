import type { MapMode } from "../../store/mapViewStore";

// MDS-6 (D-97b): formalises the per-mode rendering rules that
// MaritimeNetwork.tsx already applied ad hoc (mode === "global" branches
// scattered across the vessel layer and the trail gate) into one named,
// tested source of truth. No new hide/show/count-cap rules — that stays
// MDS-7's decluttering scope. This module only names what already renders
// today, so a future change can't silently drift the two modes apart
// without a test noticing.
export type LayerBudget = {
  /** §5.4: at global scope, ordinary vessels cluster and only exposed ones
   *  break out as individual markers; at regional scope every tracked
   *  vessel in view draws individually — there is little enough traffic in
   *  the region to read without clustering. */
  vesselRendering: "clustered" | "individual";
  /** Presentation-only movement trails (GR-5A) are a regional-only detail —
   *  drawing them at global scope, over hundreds of km of already-clustered
   *  traffic, would be noise rather than signal. */
  trails: boolean;
};

export const LAYER_BUDGET: Record<MapMode, LayerBudget> = {
  global: { vesselRendering: "clustered", trails: false },
  regional: { vesselRendering: "individual", trails: true },
};

/**
 * MDS-7 (D-99): margin, in px, added around the viewport before a point is
 * treated as off-frame. Sized well past the longest port label (~85 px) so a
 * marker that is merely NEAR an edge is never culled — culling must not remove
 * anything a viewer can see. The elements this actually catches sit 268–567 px
 * beyond the edge.
 */
const OFF_FRAME_MARGIN = 120;

/**
 * True when a projected point falls far enough outside the viewport that
 * drawing it is wasted work.
 *
 * Exists because NETWORK_BOUNDS frames the operating network but not the
 * eastern half of the Transpacific corridor, so Los Angeles, Long Beach and the
 * vessels on that leg are painted where no one can see them. Presentation only:
 * the vessels remain in the population and in every count.
 */
export function outsideFrame(
  point: [number, number],
  viewport: { width: number; height: number },
): boolean {
  const [x, y] = point;
  return (
    x < -OFF_FRAME_MARGIN ||
    y < -OFF_FRAME_MARGIN ||
    x > viewport.width + OFF_FRAME_MARGIN ||
    y > viewport.height + OFF_FRAME_MARGIN
  );
}
