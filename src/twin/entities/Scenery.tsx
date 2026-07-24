import { useMemo } from "react";
import * as THREE from "three";
import { COMB_OUTLINE, FINGER_HALF_W, FINGER_TIP_Z, FINGER_X, GATE_HOUSES, GROUND, WAREHOUSES } from "../layout";
import { C } from "../colors";

// Static, non-interactive port scenery (INT-2 D-62): a full-area water plane with
// ONE continuous comb landmass extruded on top — inland platform + F1–F3 fingers +
// the F4 pentagon as a single polygon, so the three basins read as genuine open
// water between the fingers. Plus the quay-root road, three gate houses over the
// single GATE-1 entity (D-63) and decorative warehouses.
export function Scenery() {
  const combGeometry = useMemo(() => {
    const shape = new THREE.Shape();
    // Shape XY maps onto world XZ via rotation [-PI/2, 0, 0]: shape.y → −world.z.
    COMB_OUTLINE.forEach((v, i) => {
      if (i === 0) shape.moveTo(v.x, -v.z);
      else shape.lineTo(v.x, -v.z);
    });
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 1.2, bevelEnabled: false });
    return geo;
  }, []);

  const width = GROUND.maxX - GROUND.minX;
  const depth = GROUND.maxZ - GROUND.minZ;

  return (
    <group>
      {/* Open water everywhere; the land sits on top of it */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, (GROUND.minZ + GROUND.maxZ) / 2]} receiveShadow>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color={C.water} roughness={0.35} metalness={0.1} />
      </mesh>

      {/* One continuous comb landmass (platform + fingers + F4 pentagon). The
          slab top sits flush at ~0.05 so every entity tuned to the old ground
          plane (yard pads, containers, AGVs, cranes) needs no re-basing. */}
      <mesh geometry={combGeometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.15, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={C.ground} roughness={0.95} />
      </mesh>

      {/* The quay-root road used to be drawn here as a near-black strip across
          the full width, which read as a channel separating the fingers from the
          yard — the comb is ONE landmass and it should look like one. The AGV
          lane network (AgvLanes) now carries that traffic, painted in a tone
          close to the apron instead of cut into it. */}

      {/* Bollard caps at the finger tips (F1–F3 straight tips + F4's long tip) */}
      {FINGER_X.slice(0, 3).map((x, i) => (
        <mesh key={i} position={[x, 0.3, FINGER_TIP_Z + 1]} castShadow>
          <boxGeometry args={[FINGER_HALF_W * 2, 0.5, 1.5]} />
          <meshStandardMaterial color={C.deck} />
        </mesh>
      ))}
      <mesh position={[53.5, 0.3, -114]} castShadow>
        <boxGeometry args={[15, 0.5, 1.5]} />
        <meshStandardMaterial color={C.deck} />
      </mesh>

      {/* Three gate houses on the platform's south edge (visual-only, D-63) */}
      {GATE_HOUSES.map((g, i) => (
        <group key={i} position={[g.x, 0, g.z]}>
          <mesh position={[0, 1.4, 0]} castShadow>
            <boxGeometry args={[g.w, 2.8, g.d]} />
            <meshStandardMaterial color="#6b7280" roughness={0.8} />
          </mesh>
          <mesh position={[0, 3, 0]}>
            <boxGeometry args={[g.w + 1, 0.5, g.d + 1]} />
            <meshStandardMaterial color="#4b5563" />
          </mesh>
        </group>
      ))}

      {/* Decorative warehouses along the south edge */}
      {WAREHOUSES.map((w, i) => (
        <mesh key={i} position={[w.x, 1.6, w.z]} castShadow>
          <boxGeometry args={[w.w, 3.2, w.d]} />
          <meshStandardMaterial color="#7d8593" roughness={0.85} />
        </mesh>
      ))}
    </group>
  );
}
