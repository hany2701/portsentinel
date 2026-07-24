import { Html } from "@react-three/drei";
import { yardBlockUtilisationPct } from "../sim";
import type { EntityRef, SimState } from "../sim";
import { berthLayout, yardBlockBox } from "./layout";
import { yardBandColor } from "./colors";
import { presentTwin } from "./presentation";
import { entityAnchor, findRef } from "./resolve";

// One-line label for the currently hovered/selected entity. Crane status and
// vessel holds come from the presentation layer (D-58) so labels never
// contradict what the scene animates.
function labelFor(sim: SimState, ref: EntityRef): string | null {
  const pres = presentTwin(sim);
  switch (ref.entityType) {
    case "vessel": {
      const v = sim.vessels.find((x) => x.id === ref.entityId);
      return v ? `${v.name} · ${v.class} · ${v.status}${pres.held[v.id] ? " · held" : ""}` : null;
    }
    case "berth": {
      const b = sim.berths.find((x) => x.id === ref.entityId);
      return b ? `Berth ${b.id} · ${b.status}${b.deepWater ? " · deep-water" : ""}` : null;
    }
    case "crane": {
      const c = sim.cranes.find((x) => x.id === ref.entityId);
      return c ? `${c.kind} ${c.id} · ${pres.cranes[c.id]?.status ?? c.status}` : null;
    }
    case "yardBlock": {
      const b = sim.yardBlocks.find((x) => x.id === ref.entityId);
      return b ? `${b.id} · ${Math.round(yardBlockUtilisationPct(sim, b.id))}%` : null;
    }
    default:
      return null;
  }
}

// How much larger the in-scene labels render than their original size.
//
// drei's <Html distanceFactor> scales the billboard in proportion to that
// factor, so multiplying it scales each label as a whole — type, padding, dot
// and corner radius together — and keeps the existing "shrinks with distance"
// behaviour intact. Scaling the factor is why the Tailwind type sizes below are
// untouched: bumping those alone would have grown the text inside a badge whose
// box stayed put.
const LABEL_SCALE = 4;

// The yard-block badges carry a whole line ("YB-E · 55%") rather than a two-
// character berth id, so they are already the widest labels in the scene and
// they collide before the berth ids do. At the full 4× they rendered up to
// 465px on a ~1166px canvas — around 40% of the viewport each — and overlapped
// heavily. At 3× they measure 132–295px and the eight blocks clear each other
// with room to spare, so no collision culling is needed to hold that promise;
// re-measure if this is raised again.
const YARD_LABEL_SCALE = 3;

// Permanent dark billboard block badges (ID + utilization %, dot at doctrine band —
// D-39) plus a transient label for the hovered/selected entity.
export function Badges({ sim, showLabels, selection, hoverId }: {
  sim: SimState; showLabels: boolean; selection: EntityRef | null; hoverId: string | null;
}) {
  const active = selection ?? findRef(sim, hoverId);
  const activeAnchor = active ? entityAnchor(sim, active) : null;
  const activeText = active ? labelFor(sim, active) : null;

  return (
    <group>
      {/* Permanent berth numbering on the quay faces (INT-2 gate) */}
      {showLabels &&
        sim.berths.map((b) => {
          const lay = berthLayout(b.id);
          return (
            <Html
              key={b.id}
              position={[lay.faceX + (lay.west ? 2.5 : -2.5), 1.6, lay.z]}
              center
              distanceFactor={80 * LABEL_SCALE}
              zIndexRange={[10, 0]}
              style={{ pointerEvents: "none" }}
            >
              <div className="whitespace-nowrap rounded bg-slate-900/75 px-1 py-0.5 text-[9px] font-semibold text-white shadow">
                {b.id}
              </div>
            </Html>
          );
        })}

      {showLabels &&
        sim.yardBlocks.map((block) => {
          const box = yardBlockBox(block.id);
          const util = Math.round(yardBlockUtilisationPct(sim, block.id));
          return (
            <Html key={block.id} position={[box.x, 5.5, box.z]} center distanceFactor={70 * YARD_LABEL_SCALE} zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
              <div className="flex items-center gap-1 whitespace-nowrap rounded bg-slate-900/85 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-md">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: yardBandColor(util) }} />
                {block.id} · {util}%
              </div>
            </Html>
          );
        })}

      {activeAnchor && activeText && (
        <Html position={activeAnchor} center distanceFactor={55 * LABEL_SCALE} zIndexRange={[30, 0]} style={{ pointerEvents: "none" }}>
          <div className="whitespace-nowrap rounded-md border border-violet-400/60 bg-slate-900/90 px-2 py-1 text-[11px] font-medium text-white shadow-lg">
            {activeText}
          </div>
        </Html>
      )}
    </group>
  );
}
