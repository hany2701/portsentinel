import type { Crane, SimState } from "../../sim";
import { yardBlockUtilisationPct } from "../../sim";
import { yardBlockBox, rtgCraneSlot, rtgSpan } from "../layout";
import { C, SUSPENDED, yardBandColor } from "../colors";
import type { TwinPresentation } from "../presentation";
import { isSelected, type PickHandlers } from "../picking";

// The yard gantry now spans its block AND the AGV transfer bay beside it, so a
// container is carried between the stack and the deck by a visible machine
// rather than crossing open ground unaided. Its span comes from `rtgSpan`, which
// is derived from the same bay offset the lane grid uses — the crane cannot
// reach somewhere the vehicles do not stop.
function RtgCrane({ crane, blockId, x, z, pres, sel, hover, onPick, onHover }: {
  crane: Crane; blockId: string; x: number; z: number; pres: TwinPresentation;
} & { sel: PickHandlers["selection"]; hover: string | null } & Pick<PickHandlers, "onPick" | "onHover">) {
  const p = pres.cranes[crane.id];
  const selected = isSelected(sel, "crane", crane.id);
  const span = rtgSpan(blockId);
  // Legs are placed relative to the crane's own origin (the block centre).
  const half = span.width / 2;
  const offset = span.centreX - x;
  const color =
    p?.status === "down" ? C.red
    : p?.status === "suspended" ? SUSPENDED
    : selected ? C.select
    : hover === crane.id ? "#f4d35e" : "#e8b923";
  return (
    <group
      position={[x, 0, z]}
      onClick={(e) => { e.stopPropagation(); onPick({ entityType: "crane", entityId: crane.id }, e.detail >= 2); }}
      onPointerOver={(e) => { e.stopPropagation(); onHover(crane.id); }}
      onPointerOut={() => onHover(null)}
    >
      <mesh position={[offset - half, 2.4, 0]} castShadow><boxGeometry args={[0.4, 5, 0.4]} /><meshStandardMaterial color={color} /></mesh>
      <mesh position={[offset + half, 2.4, 0]} castShadow><boxGeometry args={[0.4, 5, 0.4]} /><meshStandardMaterial color={color} /></mesh>
      <mesh position={[offset, 5, 0]} castShadow><boxGeometry args={[span.width + 0.6, 0.5, 0.6]} /><meshStandardMaterial color={color} /></mesh>
    </group>
  );
}

// Yard block pads (the clickable block) + their two RTG gantries. The pad tints to
// the doctrine band under the heatmap layer (OPS-YARD §1); containers render
// separately (instanced) in <Containers>.
export function YardBlocks({ sim, heatmap, showCranes, pres, selection, hoverId, onPick, onHover }: {
  sim: SimState; heatmap: boolean; showCranes: boolean; pres: TwinPresentation;
} & PickHandlers) {
  return (
    <group>
      {sim.yardBlocks.map((block) => {
        const box = yardBlockBox(block.id);
        const util = yardBlockUtilisationPct(sim, block.id);
        const selected = isSelected(selection, "yardBlock", block.id);
        const padColor = selected ? C.select : heatmap ? yardBandColor(util) : "#8b93a1";
        const rtgs = sim.cranes.filter((c) => c.kind === "RTG" && c.locationId === block.id);
        return (
          <group key={block.id}>
            <mesh
              position={[box.x, 0.06, box.z]}
              rotation={[-Math.PI / 2, 0, 0]}
              onClick={(e) => { e.stopPropagation(); onPick({ entityType: "yardBlock", entityId: block.id }, e.detail >= 2); }}
              onPointerOver={(e) => { e.stopPropagation(); onHover(block.id); }}
              onPointerOut={() => onHover(null)}
            >
              <planeGeometry args={[box.w, box.d]} />
              <meshStandardMaterial color={padColor} roughness={0.95} transparent opacity={hoverId === block.id ? 0.9 : 0.7} />
            </mesh>
            {showCranes && rtgs.map((c, i) => {
              const s = rtgCraneSlot(block.id, i);
              return <RtgCrane key={c.id} crane={c} blockId={block.id} x={s.x} z={s.z} pres={pres} sel={selection} hover={hoverId} onPick={onPick} onHover={onHover} />;
            })}
          </group>
        );
      })}
    </group>
  );
}
