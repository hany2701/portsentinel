import { useMemo, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group } from "three";
import type { TwinPresentation } from "../presentation";
import { CARGO_COLORS } from "../colors";
import { BOX, transferStackPos } from "../layout";
import { FINGER_CIRCUITS, cargoPhase, dwellProgress, pointAt, spawn, stepAgvs, type Agv } from "../agv";

// The AGV fleet (D-63 ruling 5, D-71). Geometry, traffic and cargo state all
// live in agv.ts — this file is only the mesh for one vehicle plus the frame
// loop that advances the fleet.
//
// The fleet is stepped at useFrame priority -1 so it has already moved by the
// time the quay cranes read `craneTransfers` in their own (default-priority)
// frame callback. That ordering is what keeps a spreader lined up with the
// vehicle it is working rather than trailing it by a frame.

export type AgvFleet = MutableRefObject<Agv[]>;

/**
 * Build the fleet from the presentation counts (D-71) — a finger only runs
 * vehicles while a vessel there is actually being worked, and an idle or
 * weather-suspended port runs none.
 *
 * Rebuilt only when the counts change, so vehicles keep their positions across
 * ordinary re-renders instead of teleporting back to their spawn points.
 */
export function useAgvFleet(agv: TwinPresentation["agv"]): AgvFleet {
  const fleet = useRef<Agv[]>([]);
  const key = `${agv.branchCounts.join(",")}|${agv.mainCount}`;
  useMemo(() => {
    // Each column runs its finger's vehicles plus a share of the yard traffic
    // (`mainCount`), because a column route IS the yard route for its blocks —
    // there is no separate shuttle network any more.
    const perColumn = Math.floor(agv.mainCount / FINGER_CIRCUITS.length);
    const spare = agv.mainCount % FINGER_CIRCUITS.length;
    fleet.current = FINGER_CIRCUITS.flatMap((circuit, f) =>
      spawn(circuit, (agv.branchCounts[f] ?? 0) + perColumn + (f < spare ? 1 : 0), f),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return fleet;
}

const BODY = "#c8cedb";
const CHASSIS = "#5b6472";

function Vehicle({ agv }: { agv: Agv }) {
  const ref = useRef<Group>(null);
  const boxes = useRef<Group>(null);

  useFrame(() => {
    if (!ref.current) return;
    const { p } = pointAt(agv.circuit, agv.s);
    ref.current.position.set(p.x, 0.35, p.z);
    ref.current.rotation.y = agv.yaw;
    // Show the deck load without remounting meshes every frame: the two box
    // slots are always present and simply hidden when nothing is aboard.
    //
    // The count shown EXCLUDES whatever is currently in flight, so the box being
    // handed over is drawn exactly once — in the air, by <TransferTeu> — instead
    // of appearing on the deck while it is still notionally in the stack. While
    // loading the deck shows the pre-handoff count; while unloading it already
    // shows the reduced one, because that box has left.
    if (boxes.current) {
      const phase = cargoPhase(agv);
      const onDeck = phase === "unloading" ? Math.max(0, agv.load - 1) : agv.load;
      boxes.current.children.forEach((child, i) => {
        child.visible = i < onDeck;
      });
    }
  });

  return (
    <group ref={ref}>
      {/* chassis + deck: low and flat, the way a port AGV actually looks —
          no cab, because nobody is driving it */}
      <mesh castShadow position={[0, 0, 0]}>
        <boxGeometry args={[1.7, 0.45, 3]} />
        <meshStandardMaterial color={BODY} roughness={0.7} />
      </mesh>
      <mesh position={[0, -0.28, 0]}>
        <boxGeometry args={[1.5, 0.25, 2.7]} />
        <meshStandardMaterial color={CHASSIS} roughness={0.9} />
      </mesh>
      {/* a coloured nose so heading is legible when the vehicle turns */}
      <mesh position={[0, 0.05, 1.35]}>
        <boxGeometry args={[1.2, 0.2, 0.3]} />
        <meshStandardMaterial color="#f0b429" emissive="#f0b429" emissiveIntensity={0.35} />
      </mesh>

      {/* Deck load: one 20ft box forward, one aft. A 2-TEU vehicle carries both;
          a 1-TEU vehicle shows only the forward slot; an empty one shows none. */}
      <group ref={boxes}>
        <mesh position={[0, 0.55, 0.68]} castShadow>
          <boxGeometry args={[1.5, 0.62, 1.32]} />
          <meshStandardMaterial color={CARGO_COLORS.standard} roughness={0.8} />
        </mesh>
        <mesh position={[0, 0.55, -0.68]} castShadow>
          <boxGeometry args={[1.5, 0.62, 1.32]} />
          <meshStandardMaterial color={CARGO_COLORS.reefer} roughness={0.8} />
        </mesh>
      </group>
    </group>
  );
}

/**
 * The container mid-handoff, drawn for whichever vehicle is at a yard bay.
 *
 * It travels a real, short path: from the top of the block's transfer stack,
 * over the 4.75-unit gap to the bay, and down onto the deck (or the reverse).
 * A lift arc at the midpoint reads as the yard crane picking it up and setting
 * it down rather than sliding it along the ground.
 *
 * This is the piece that was missing entirely: before, `load` flipped the moment
 * a vehicle reached a stop and a box simply appeared on the deck, with nothing
 * leaving the stack — the despawn/respawn the brief describes.
 */
function TransferTeu({ fleet }: { fleet: AgvFleet }) {
  const ref = useRef<Group>(null);

  useFrame(() => {
    const group = ref.current;
    if (!group) return;
    // At most one handoff is drawn per frame per vehicle; find the first active
    // one. Bays are one-vehicle-at-a-time (the brake keeps the next one back),
    // so this is one box per bay.
    const active = fleet.current.find((a) => {
      const phase = cargoPhase(a);
      return phase !== "idle" && a.atStop?.kind === "yard" && a.atStop.blockId;
    });
    if (!active || !active.atStop?.blockId) {
      group.visible = false;
      return;
    }
    group.visible = true;

    const stack = transferStackPos(active.atStop.blockId);
    const { p: bay } = pointAt(active.circuit, active.s);
    const t = dwellProgress(active);
    const loading = cargoPhase(active) === "loading";
    // 0 → 1 always runs stack → deck; reverse it for an unload.
    const u = loading ? t : 1 - t;

    const yardY = BOX * 2.2;
    const deckY = 1.0;
    group.position.x = stack.x + (bay.x - stack.x) * u;
    group.position.z = stack.z + (bay.z - stack.z) * u;
    // Lift over the gap, land flat at both ends.
    group.position.y = yardY + (deckY - yardY) * u + Math.sin(u * Math.PI) * 1.6;
  });

  return (
    <group ref={ref} visible={false}>
      <mesh castShadow>
        <boxGeometry args={[1.5, 0.62, 1.32]} />
        <meshStandardMaterial color={CARGO_COLORS.standard} roughness={0.8} />
      </mesh>
      {/* the spreader holding it, so the box is visibly carried */}
      <mesh position={[0, 0.5, 0]}>
        <boxGeometry args={[1.5, 0.14, 1.4]} />
        <meshStandardMaterial color="#eda100" />
      </mesh>
    </group>
  );
}

export function AGVs({ fleet }: { fleet: AgvFleet }) {
  // Priority -1: advance the whole fleet before anything reads it this frame.
  useFrame((_, delta) => {
    // Clamp the step so a backgrounded tab does not resume with one huge jump
    // that would teleport vehicles past their transfer points.
    stepAgvs(fleet.current, Math.min(delta, 0.1));
  }, -1);

  return (
    <group>
      {fleet.current.map((agv) => (
        <Vehicle key={agv.id} agv={agv} />
      ))}
      <TransferTeu fleet={fleet} />
    </group>
  );
}
