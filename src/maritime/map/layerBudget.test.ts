import { describe, expect, it } from "vitest";
import { LAYER_BUDGET, outsideFrame } from "./layerBudget";

// MDS-6 (D-97b): pins the per-mode layer budget this phase formalised out of
// what MaritimeNetwork.tsx already did ad hoc — a value change here is a
// deliberate rendering-rule change, not a silent drift.
describe("LAYER_BUDGET (MDS-6)", () => {
  it("pins the global scope: vessels cluster, no trails", () => {
    expect(LAYER_BUDGET.global).toEqual({ vesselRendering: "clustered", trails: false });
  });

  it("pins the regional scope: vessels draw individually, trails on", () => {
    expect(LAYER_BUDGET.regional).toEqual({ vesselRendering: "individual", trails: true });
  });

  it("covers both MapMode values exhaustively", () => {
    expect(Object.keys(LAYER_BUDGET).sort()).toEqual(["global", "regional"]);
  });
});

// MDS-7 (D-99): culling must only ever remove what the viewer cannot see. The
// measured Overview case is a 960x540 frame with the Transpacific markers
// painting 268-567 px past the left edge.
describe("outsideFrame (MDS-7)", () => {
  const viewport = { width: 960, height: 540 };

  it("keeps everything inside the frame", () => {
    expect(outsideFrame([0, 0], viewport)).toBe(false);
    expect(outsideFrame([480, 270], viewport)).toBe(false);
    expect(outsideFrame([960, 540], viewport)).toBe(false);
  });

  it("keeps points just outside, so a label straddling an edge is never culled", () => {
    // A port marker sitting 100 px past the edge still has its label on screen.
    expect(outsideFrame([-100, 270], viewport)).toBe(false);
    expect(outsideFrame([1060, 270], viewport)).toBe(false);
    expect(outsideFrame([480, -100], viewport)).toBe(false);
    expect(outsideFrame([480, 640], viewport)).toBe(false);
  });

  it("culls the measured Transpacific markers", () => {
    // Los Angeles label, LA/Long Beach markers, and the three Pacific clusters.
    for (const x of [-268, -303, -367, -441, -531, -567]) {
      expect(outsideFrame([x, 200], viewport)).toBe(true);
    }
  });

  it("culls beyond every edge, not just the west one", () => {
    expect(outsideFrame([1200, 270], viewport)).toBe(true);
    expect(outsideFrame([480, -200], viewport)).toBe(true);
    expect(outsideFrame([480, 800], viewport)).toBe(true);
  });
});
