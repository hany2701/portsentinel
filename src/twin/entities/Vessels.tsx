import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group } from "three";
import type { SimState, Vessel } from "../../sim";
import type { Slot } from "../layout";
import { vesselSlot } from "../resolve";
import { plannedPath, pathLength, pointAt, easeOutCubic, type Pt } from "../motion";
import { C, vesselColor } from "../colors";
import type { TwinPresentation } from "../presentation";
import { isSelected, type PickHandlers } from "../picking";

const CLASS_LEN: Record<Vessel["class"], number> = { feeder: 9, panamax: 11, neopanamax: 13.5 };
/**
 * How long a ship takes to glide between slots, in REAL seconds at 1× (D-72).
 *
 * Scaled by the sim speed, because it is a fixed wall-clock duration and the
 * tick is not: a tick is 2000 ms at 1× but 250 ms at 8×, so an unscaled 2.5 s
 * glide spanned TEN ticks. Ships that should have arrived, moored and left were
 * all still in flight together on the same basin lane, passing through each
 * other — which reads as overlapping hulls however wide the basin is. Scaling
 * keeps a transit near one tick at any speed, so a lane carries one ship at a
 * time. Floored so the fastest speeds still animate rather than teleport.
 */
const TRAVEL_SECONDS_AT_1X = 2.5;
const MIN_TRAVEL_SECONDS = 0.35;

function travelSeconds(speed: SimState["clock"]["speed"]): number {
  const multiplier = typeof speed === "number" ? speed : 1;
  return Math.max(MIN_TRAVEL_SECONDS, TRAVEL_SECONDS_AT_1X / multiplier);
}
// Transitions INTO approaching from these states are a voyage recycle — the
// ship respawns far north and must snap, never glide backwards (D-72).
const RECYCLE_FROM: Vessel["status"][] = ["berthing", "alongside", "departing", "diverted"];

// Resolve every placeable vessel to its world slot (berthed vessels are moored, so
// they bob less). Placement logic lives in resolve.vesselSlot so labels/focus agree.
function placements(sim: SimState): { vessel: Vessel; slot: Slot; moored: boolean }[] {
  const out: { vessel: Vessel; slot: Slot; moored: boolean }[] = [];
  for (const v of sim.vessels) {
    const slot = vesselSlot(sim, v);
    // A departing vessel is under way, not moored — it should ride the swell
    // like any other moving ship while it steams out of the port.
    if (slot) out.push({ vessel: v, slot, moored: v.status === "alongside" || v.status === "berthing" });
  }
  return out;
}

function Ship({ vessel, slot, moored, held, frozen, travel, selected, hovered, onPick, onHover }: {
  vessel: Vessel; slot: Slot; moored: boolean; held: boolean; frozen: boolean; travel: number; selected: boolean; hovered: boolean;
} & Pick<PickHandlers, "onPick" | "onHover">) {
  const outer = useRef<Group>(null);
  const ref = useRef<Group>(null);
  // D-72 travel state: displayed position eases along a planned water path
  // toward the authoritative slot; the sim slot is never second-guessed.
  const pos = useRef<Pt>({ x: slot.x, z: slot.z });
  const motion = useRef<{ target: Pt; path: Pt[]; total: number; t: number } | null>(null);
  const prevStatus = useRef(vessel.status);
  const L = CLASS_LEN[vessel.class];
  const phase = (vessel.name.charCodeAt(0) % 10) * 0.7;
  const amp = moored ? 0.03 : 0.1;
  useFrame((state, delta) => {
    // Snap (no travel) on voyage recycle and on diversion (D-72).
    const recycled = vessel.status === "approaching" && RECYCLE_FROM.includes(prevStatus.current);
    if (recycled || vessel.status === "diverted") {
      pos.current = { x: slot.x, z: slot.z };
      motion.current = null;
    }
    prevStatus.current = vessel.status;

    const m = motion.current;
    if (!m || m.target.x !== slot.x || m.target.z !== slot.z) {
      const path = plannedPath(pos.current, { x: slot.x, z: slot.z });
      motion.current = { target: { x: slot.x, z: slot.z }, path, total: pathLength(path), t: 0 };
    }
    const mo = motion.current!;
    // Frozen (weather-suspended move phase) ships stop mid-path instantly —
    // motion is gated by the same flag that gates the simulation (D-58 cond 4).
    if (!frozen && mo.t < 1 && mo.total > 0) mo.t = Math.min(1, mo.t + delta / travel);
    const { p, dir } = pointAt(mo.path, easeOutCubic(mo.t) * mo.total);
    pos.current = p;
    const travelling = mo.t < 1 && mo.total > 0 && (dir.x !== 0 || dir.z !== 0);
    if (outer.current) {
      outer.current.position.set(p.x, 0.5, p.z);
      outer.current.rotation.y = travelling ? Math.atan2(-dir.x, -dir.z) : slot.angleY;
    }
    if (!ref.current) return;
    const t = state.clock.elapsedTime;
    ref.current.position.y = Math.sin(t * 0.8 + phase) * amp;
    ref.current.rotation.z = Math.sin(t * 0.6 + phase) * (moored ? 0.004 : 0.02);
  });
  const base = selected ? C.select : vesselColor(vessel.status);
  const emissive = hovered ? 0.35 : selected ? 0.25 : 0;
  return (
    <group ref={outer} position={[slot.x, 0.5, slot.z]} rotation={[0, slot.angleY, 0]}>
      <group
        ref={ref}
        onClick={(e) => { e.stopPropagation(); onPick({ entityType: "vessel", entityId: vessel.id }, e.detail >= 2); }}
        onPointerOver={(e) => { e.stopPropagation(); onHover(vessel.id); }}
        onPointerOut={() => onHover(null)}
      >
        {/* hull */}
        <mesh castShadow position={[0, 0, 0]}><boxGeometry args={[3, 1.6, L]} /><meshStandardMaterial color={base} emissive={base} emissiveIntensity={emissive} roughness={0.6} /></mesh>
        {/* bow wedge */}
        <mesh castShadow position={[0, 0, -L / 2 - 0.6]} rotation={[0, Math.PI / 4, 0]}><boxGeometry args={[2.1, 1.5, 2.1]} /><meshStandardMaterial color={base} emissive={base} emissiveIntensity={emissive} roughness={0.6} /></mesh>
        {/* superstructure aft — amber while an approved hold is in force (D-58) */}
        <mesh castShadow position={[0, 1.2, L / 2 - 1.6]}><boxGeometry args={[2.4, 1.6, 2.2]} /><meshStandardMaterial color={held ? C.amber : "#e5e9f0"} roughness={0.7} /></mesh>
        <mesh position={[0, 2.2, L / 2 - 1.6]}><boxGeometry args={[0.7, 0.9, 0.7]} /><meshStandardMaterial color={C.slate} /></mesh>
      </group>
    </group>
  );
}

export function Vessels({ sim, pres, selection, hoverId, onPick, onHover }: { sim: SimState; pres: TwinPresentation } & PickHandlers) {
  return (
    <group>
      {placements(sim).map(({ vessel, slot, moored }) => (
        <Ship
          key={vessel.id}
          vessel={vessel}
          slot={slot}
          moored={moored}
          held={!!pres.held[vessel.id]}
          frozen={pres.movesSuspended && (vessel.status === "berthing" || vessel.status === "departing")}
          travel={travelSeconds(sim.clock.speed)}
          selected={isSelected(selection, "vessel", vessel.id)}
          hovered={hoverId === vessel.id}
          onPick={onPick}
          onHover={onHover}
        />
      ))}
    </group>
  );
}
