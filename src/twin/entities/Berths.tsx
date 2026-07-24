import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group, Mesh } from "three";
import type { Berth, Crane } from "../../sim";
import { APRON, craneTransfers } from "../agv";
import type { AgvFleet } from "./AGVs";
import { berthLayout, stsCraneSlot } from "../layout";
import { C, CARGO_COLORS, SUSPENDED } from "../colors";
import type { TwinPresentation } from "../presentation";
import { isSelected, type PickHandlers } from "../picking";

const BERTH_STRIP: Record<Berth["status"], string> = {
  available: C.green,
  occupied: C.blue,
  closed: C.red,
};

// A double-trolley STS gantry straddling the quay edge.
//
// The PORTAL trolley works the landside: it tracks the AGV waiting under the
// backreach, lowers its spreader onto the deck, and lifts or lands one box. The
// MAIN trolley works the seaward side, carrying that box out over the vessel.
// Real double-trolley cranes split the cycle exactly this way, and splitting it
// here is what lets the vehicle and the crane agree about a single container
// instead of animating past each other.
//
// The choreography is driven by the AGV's own dwell (agv.ts `craneTransfers`),
// so a box only ever moves while there is a vehicle underneath to take it. When
// nothing is there the crane idles, and it goes fully motionless when it is down
// or weather-suspended — animation stays gated by the same presentation flags
// that gate the sim (D-58).
function StsCrane({ crane, berthId, x, z, west, pres, fleet, sel, hover, onPick, onHover }: {
  crane: Crane; berthId: string; x: number; z: number; west: boolean; pres: TwinPresentation; fleet: AgvFleet;
} & { sel: PickHandlers["selection"]; hover: string | null } & Pick<PickHandlers, "onPick" | "onHover">) {
  const mainTrolley = useRef<Group>(null);
  const portalTrolley = useRef<Group>(null);
  const portalSpreader = useRef<Group>(null);
  const portalBox = useRef<Mesh>(null);
  const mainBox = useRef<Mesh>(null);
  const p = pres.cranes[crane.id];
  // Seaward reach, out over the hull; landside backreach, out over the AGV lane.
  const reach = 4.2 * (west ? -1 : 1);
  const back = -APRON * (west ? -1 : 1);

  useFrame((state) => {
    if (!p?.animate) return;
    const transfer = craneTransfers(fleet.current).get(berthId);

    if (transfer) {
      // A vehicle is underneath. One full landside cycle across its dwell:
      //   0.00–0.30  spreader down onto the deck
      //   0.30–0.45  latch
      //   0.45–0.75  spreader up, box aboard
      //   0.75–1.00  portal trolley runs the box inboard to the platform
      const t = transfer.progress;
      const importing = transfer.agv.mode === "import";
      const down = t < 0.3 ? t / 0.3 : t < 0.45 ? 1 : t < 0.75 ? 1 - (t - 0.45) / 0.3 : 0;
      if (portalSpreader.current) portalSpreader.current.position.y = -down * 6.2;
      if (portalTrolley.current) {
        const run = t < 0.75 ? 0 : (t - 0.75) / 0.25;
        portalTrolley.current.position.x = back * (1 - run * 0.55);
      }
      // The box rides the spreader on the half of the cycle where the crane is
      // actually holding it: lifting it off an export vehicle, or landing it on
      // an import one.
      if (portalBox.current) portalBox.current.visible = importing ? t < 0.45 : t >= 0.45;
    } else {
      // Idle between vehicles: park the portal trolley over the lane, spreader up.
      if (portalSpreader.current) portalSpreader.current.position.y = 0;
      if (portalTrolley.current) portalTrolley.current.position.x = back;
      if (portalBox.current) portalBox.current.visible = false;
    }

    // The seaward trolley keeps its own slower cycle out over the hull — the
    // ship-side half of the move, which is deliberately only suggested.
    if (mainTrolley.current) {
      const cycle = (Math.sin(state.clock.elapsedTime * 0.5 + z) * 0.5 + 0.5);
      mainTrolley.current.position.x = cycle * reach;
      if (mainBox.current) mainBox.current.visible = cycle > 0.25;
    }
  });
  const selected = isSelected(sel, "crane", crane.id);
  const down = p?.status === "down";
  const legColor =
    down ? C.red
    : p?.status === "suspended" ? SUSPENDED
    : p?.status === "degraded" ? C.amber
    : selected ? C.select
    : hover === crane.id ? "#cbd5e1" : "#dfe4ec";
  return (
    <group
      position={[x, 0, z]}
      onClick={(e) => { e.stopPropagation(); onPick({ entityType: "crane", entityId: crane.id }, e.detail >= 2); }}
      onPointerOver={(e) => { e.stopPropagation(); onHover(crane.id); }}
      onPointerOut={() => onHover(null)}
    >
      {/* Portal legs. The waterside pair straddles the quay edge; the landside
          pair stands clear of the AGV lane so vehicles pass BETWEEN them — which
          is the whole point of a portal, and what puts a vehicle under the
          backreach where the spreader can reach it. */}
      <mesh position={[0, 4, -1.6]} castShadow><boxGeometry args={[0.4, 8, 0.4]} /><meshStandardMaterial color={legColor} /></mesh>
      <mesh position={[0, 4, 1.6]} castShadow><boxGeometry args={[0.4, 8, 0.4]} /><meshStandardMaterial color={legColor} /></mesh>
      <mesh position={[back * 1.4, 4, -1.6]} castShadow><boxGeometry args={[0.4, 8, 0.4]} /><meshStandardMaterial color={legColor} /></mesh>
      <mesh position={[back * 1.4, 4, 1.6]} castShadow><boxGeometry args={[0.4, 8, 0.4]} /><meshStandardMaterial color={legColor} /></mesh>
      {/* Portal beam across the top of the legs */}
      <mesh position={[back * 0.7, 8.1, 0]} castShadow>
        <boxGeometry args={[Math.abs(back * 1.4) + 0.8, 0.45, 3.6]} />
        <meshStandardMaterial color={legColor} />
      </mesh>
      {/* Boom: seaward over the vessel AND landside over the lane, so both
          trolleys have rail to run on */}
      <mesh position={[(reach + back * 1.4) / 2, 8.6, 0]} castShadow>
        <boxGeometry args={[Math.abs(reach) + Math.abs(back * 1.4) + 2, 0.5, 0.5]} />
        <meshStandardMaterial color={legColor} />
      </mesh>

      {/* Main (seaward) trolley — the ship-side half of the move */}
      <group ref={mainTrolley} position={[0, 8, 0]}>
        <mesh><boxGeometry args={[0.9, 0.7, 0.9]} /><meshStandardMaterial color={down ? C.red : C.slate} /></mesh>
        <mesh ref={mainBox} position={[0, -2.6, 0]} castShadow visible={false}>
          <boxGeometry args={[1.4, 0.6, 1.3]} />
          <meshStandardMaterial color={CARGO_COLORS.standard} roughness={0.8} />
        </mesh>
      </group>

      {/* Portal (landside) trolley — works the AGV under the backreach */}
      <group ref={portalTrolley} position={[back, 8, 0]}>
        <mesh><boxGeometry args={[1, 0.7, 1]} /><meshStandardMaterial color={down ? C.red : "#8d97a6"} /></mesh>
        <group ref={portalSpreader}>
          {/* hoist ropes */}
          <mesh position={[0, -0.9, 0]}>
            <boxGeometry args={[0.06, 1.4, 0.06]} />
            <meshStandardMaterial color="#3f4855" />
          </mesh>
          {/* spreader beam */}
          <mesh position={[0, -1.7, 0]} castShadow>
            <boxGeometry args={[1.5, 0.18, 1.5]} />
            <meshStandardMaterial color={C.amber} />
          </mesh>
          <mesh ref={portalBox} position={[0, -2.15, 0]} castShadow visible={false}>
            <boxGeometry args={[1.5, 0.62, 1.32]} />
            <meshStandardMaterial color={CARGO_COLORS.standard} roughness={0.8} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

export function Berths({ berths, cranes, showCranes, pres, fleet, selection, hoverId, onPick, onHover }: { berths: Berth[]; cranes: Crane[]; showCranes: boolean; pres: TwinPresentation; fleet: AgvFleet } & PickHandlers) {
  return (
    <group>
      {berths.map((b) => {
        const lay = berthLayout(b.id);
        const selected = isSelected(selection, "berth", b.id);
        const stripColor = selected ? C.select : BERTH_STRIP[b.status];
        const stsCranes = cranes.filter((c) => c.kind === "STS" && c.locationId === b.id);
        return (
          <group key={b.id}>
            {/* quay-edge status strip (the clickable berth) */}
            <mesh
              position={[lay.faceX + (lay.west ? -0.3 : 0.3), 0.3, lay.z]}
              onClick={(e) => { e.stopPropagation(); onPick({ entityType: "berth", entityId: b.id }, e.detail >= 2); }}
              onPointerOver={(e) => { e.stopPropagation(); onHover(b.id); }}
              onPointerOut={() => onHover(null)}
            >
              <boxGeometry args={[0.6, 0.4, 14]} />
              <meshStandardMaterial color={stripColor} emissive={stripColor} emissiveIntensity={hoverId === b.id ? 0.5 : 0.2} />
            </mesh>
            {/* closed berths get a hatch overlay */}
            {b.status === "closed" && (
              <mesh position={[lay.faceX, 0.35, lay.z]}>
                <boxGeometry args={[8, 0.5, 14]} />
                <meshStandardMaterial color={C.red} wireframe transparent opacity={0.5} />
              </mesh>
            )}
            {showCranes && stsCranes.map((c, i) => {
              const s = stsCraneSlot(b.id, i);
              return <StsCrane key={c.id} crane={c} berthId={b.id} x={s.x} z={s.z} west={lay.west} pres={pres} fleet={fleet} sel={selection} hover={hoverId} onPick={onPick} onHover={onHover} />;
            })}
          </group>
        );
      })}
    </group>
  );
}
